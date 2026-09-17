export type OrderNeedService = {
  name: string;
  note: string | null;
};

export type OrderNeedFact = {
  label: string;
  value: string;
};

export type OrderNeedSummary = {
  primaryNeed: string | null;
  services: OrderNeedService[];
  facts: OrderNeedFact[];
  interpreterRequired: boolean;
  additionalNotes: string[];
};

const SERVICE_PREFIXES = ["Запрошенные услуги:", "Gewünschte Leistungen:"];
const COMMENT_HEADINGS = ["Комментарии к услугам:", "Kommentare zu Leistungen:"];
const INTERPRETER_MARKERS = ["Нужен переводчик", "Dolmetscher benötigt"];
const FACT_PREFIXES = [
  "Комментарий клиента:",
  "Kundennachricht:",
  "Текущее местонахождение:",
  "Aktueller Aufenthaltsort:",
  "Предпочитаемое место лечения:",
  "Bevorzugter Behandlungsort:",
  "Желаемый срок:",
  "Gewünschter Zeitraum:",
  "Может приехать:",
  "Kann anreisen:",
  "Проездные документы:",
  "Reisedokumente:",
];

function splitPrefixedValue(line: string, prefixes: string[]) {
  const prefix = prefixes.find((candidate) => line.startsWith(candidate));
  if (!prefix) return null;
  return { label: prefix.slice(0, -1), value: line.slice(prefix.length).trim() };
}

export function summarizeOrderNeeds(value: string | null | undefined): OrderNeedSummary {
  const summary: OrderNeedSummary = {
    primaryNeed: null,
    services: [],
    facts: [],
    interpreterRequired: false,
    additionalNotes: [],
  };
  const lines = (value ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let readingServiceComments = false;
  const comments = new Map<string, string>();
  let lastCommentedService: string | null = null;

  for (const line of lines) {
    if (COMMENT_HEADINGS.includes(line)) {
      readingServiceComments = true;
      continue;
    }

    if (INTERPRETER_MARKERS.includes(line)) {
      summary.interpreterRequired = true;
      readingServiceComments = false;
      continue;
    }

    const serviceValue = splitPrefixedValue(line, SERVICE_PREFIXES);
    if (serviceValue) {
      summary.services = serviceValue.value
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, note: null }));
      readingServiceComments = false;
      continue;
    }

    const fact = splitPrefixedValue(line, FACT_PREFIXES);
    if (fact) {
      summary.facts.push(fact);
      readingServiceComments = false;
      continue;
    }

    if (readingServiceComments && line.startsWith("- ")) {
      const separator = line.indexOf(":", 2);
      if (separator > 2) {
        lastCommentedService = line.slice(2, separator).trim();
        comments.set(lastCommentedService, line.slice(separator + 1).trim());
        continue;
      }
    }

    // A comment typed on several lines stays with its service.
    if (readingServiceComments && lastCommentedService) {
      comments.set(lastCommentedService, `${comments.get(lastCommentedService)}\n${line}`.trim());
      continue;
    }

    if (!summary.primaryNeed) summary.primaryNeed = line;
    else summary.additionalNotes.push(line);
  }

  summary.services = summary.services.map((service) => ({
    ...service,
    note: comments.get(service.name) || null,
  }));
  for (const [name, note] of comments) {
    if (!summary.services.some((service) => service.name === name)) {
      summary.services.push({ name, note: note || null });
    }
  }
  return summary;
}
