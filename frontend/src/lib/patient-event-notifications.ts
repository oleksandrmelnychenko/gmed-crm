/**
 * Notices to the patient about what the team did (owner decision 2026-11-10,
 * global QA finding «the patient gets no notification»): a visit added,
 * confirmed, moved or cancelled; a service changed; a payment registered, a
 * new invoice or a correction.
 *
 * The server stores a code (`kind`), the facts (`params`) and an English
 * fallback text. The codes of these notices are chosen by the appointment,
 * concierge and invoice routes, so this module does not depend on one exact
 * name: it places a code by its words (`appointment…cancel…`,
 * `concierge_service…status…`, `…payment…`) and by the entity the notice
 * points to, words the title in the portal's language and builds the text
 * from the facts it finds. Without usable facts the stored text stays; a
 * code it cannot place returns null and the caller shows the stored notice.
 *
 * Only for the patient's portal: staff notices keep their own renderers.
 */
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { t as translationsFor, type Lang, type Translations } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";

export interface PatientEventNotice {
  kind: string;
  title: string;
  body: string | null;
  params?: Record<string, unknown> | null;
  entity_type?: string | null;
}

export interface PatientEventCopy {
  title: string;
  body: string | null;
}

type Texts = { ru: string; de: string };

function pick(texts: Texts, lang: Lang): string {
  return lang === "de" ? texts.de : texts.ru;
}

/** The first fact of `params` that is set, by any of its usual names. */
function fact(item: PatientEventNotice, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item.params?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** "2026-11-13" → "13.11.2026"; an instant → Berlin date and time; other text as is. */
function when(value: string | null, time?: string | null): string {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = formatAppDate(`${value}T12:00:00Z`) || value;
    return time ? `${date} ${time.slice(0, 5)}` : date;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatAppDateTime(value) || value;
  return value;
}

function hasWord(kind: string, pattern: RegExp): boolean {
  return pattern.test(kind);
}

type Family = "appointment" | "service" | "money";

/** Which of the three families a notice belongs to, or null. */
export function patientEventFamily(item: Pick<PatientEventNotice, "kind" | "entity_type">): Family | null {
  const kind = item.kind.toLowerCase();
  const entity = (item.entity_type ?? "").toLowerCase();
  // Requests have their own notices (`appointment_request_update`).
  if (entity === "appointment_request" || kind.includes("appointment_request")) return null;
  if (entity === "concierge_service" || /concierge_service|patient_service(?!_package)/.test(kind)) return "service";
  if (entity === "appointment" || kind.includes("appointment")) return "appointment";
  if (
    ["invoice", "credit_note", "invoice_payment", "payment", "refund"].includes(entity)
    || /invoice|payment|credit_note|refund/.test(kind)
  ) {
    return "money";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

function appointmentCopy(item: PatientEventNotice, lang: Lang): PatientEventCopy {
  const kind = item.kind.toLowerCase();
  const title = fact(item, "title", "appointment_title", "visit_title");
  const current = when(
    fact(item, "new_date", "date", "new_starts_at", "starts_at", "appointment_date"),
    fact(item, "new_time_start", "time_start", "new_time", "time"),
  );
  const previous = when(
    fact(item, "old_date", "previous_date", "from_date", "old_starts_at", "previous_starts_at"),
    fact(item, "old_time_start", "previous_time_start", "from_time", "old_time", "previous_time"),
  );
  const moved = Boolean(previous && current && previous !== current);

  let heading: Texts;
  if (hasWord(kind, /cancel|storn/)) {
    heading = { ru: "Визит отменён", de: "Termin abgesagt" };
  } else if (moved || hasWord(kind, /mov|resched|postpon|time|date/)) {
    heading = { ru: "Визит перенесён", de: "Termin verschoben" };
  } else if (hasWord(kind, /confirm/)) {
    heading = { ru: "Визит подтверждён", de: "Termin bestätigt" };
  } else if (hasWord(kind, /creat|add|schedul|new|plann|book/)) {
    heading = { ru: "Новый визит в вашем расписании", de: "Neuer Termin in Ihrem Plan" };
  } else {
    heading = { ru: "Визит изменён", de: "Termin geändert" };
  }

  const timing = moved ? `${previous} → ${current}` : current;
  const facts = [title, timing].filter(Boolean).join(" · ");
  return { title: pick(heading, lang), body: facts || item.body };
}

// ---------------------------------------------------------------------------
// Concierge services
// ---------------------------------------------------------------------------

function serviceStatusLabel(status: string, tr: Translations): string {
  const label = tr[`portal_status_${status}` as keyof Translations];
  return typeof label === "string" ? label : status;
}

function serviceCopy(item: PatientEventNotice, lang: Lang): PatientEventCopy {
  const tr = translationsFor(lang);
  const kind = item.kind.toLowerCase();
  const title = fact(item, "title", "service_title");
  const status = fact(item, "new_status", "status");
  const current = when(fact(item, "new_starts_at", "starts_at"));
  const previous = when(fact(item, "old_starts_at", "previous_starts_at"));
  const moved = Boolean(previous && current && previous !== current);
  // A service staff added (`patient_service_added`, concierge_services.rs)
  // carries its first status too; it is news, not a status change (QA N1).
  const added = hasWord(kind, /creat|(^|_)add(ed)?($|_)|(^|_)new($|_)/);

  let heading: Texts;
  if (hasWord(kind, /cancel|storn/) || status === "cancelled") {
    heading = { ru: "Сервис отменён", de: "Service storniert" };
  } else if (added) {
    heading = { ru: "Добавлен новый сервис", de: "Neuer Service geplant" };
  } else if (moved || hasWord(kind, /mov|resched|time|date/)) {
    heading = { ru: "Время сервиса изменено", de: "Zeit Ihres Services geändert" };
  } else if (hasWord(kind, /status/) || status) {
    heading = { ru: "Статус сервиса изменён", de: "Status Ihres Services geändert" };
  } else if (hasWord(kind, /book/)) {
    heading = { ru: "Новый сервис", de: "Neuer Service" };
  } else {
    heading = { ru: "Сервис обновлён", de: "Service aktualisiert" };
  }

  const timing = moved
    ? `${previous} → ${current}`
    : current || (added ? pick({ ru: "время уточняется", de: "Zeit wird noch abgestimmt" }, lang) : "");
  const facts = [title, status ? serviceStatusLabel(status, tr) : null, timing].filter(Boolean).join(" · ");
  return { title: pick(heading, lang), body: facts || item.body };
}

// ---------------------------------------------------------------------------
// Invoices and payments
// ---------------------------------------------------------------------------

function moneyCopy(item: PatientEventNotice, lang: Lang): PatientEventCopy {
  const kind = item.kind.toLowerCase();
  const entity = (item.entity_type ?? "").toLowerCase();
  const number = fact(item, "invoice_number", "document_number", "credit_note_number", "number");
  const amount = fact(item, "amount", "amount_gross", "paid_amount", "total_gross");
  const currency = fact(item, "currency") ?? "EUR";

  let heading: Texts;
  if (hasWord(kind, /credit_note|correction/) || entity === "credit_note") {
    heading = { ru: "Корректировка счёта", de: "Rechnungskorrektur" };
  } else if (hasWord(kind, /refund/) || entity === "refund") {
    heading = { ru: "Возврат зарегистрирован", de: "Erstattung verbucht" };
  } else if (hasWord(kind, /payment|paid/)) {
    heading = { ru: "Платёж зарегистрирован", de: "Zahlung verbucht" };
  } else if (hasWord(kind, /releas|visible|new|creat|issu|publish|availab/)) {
    heading = { ru: "Новый счёт", de: "Neue Rechnung" };
  } else {
    heading = { ru: "Счёт обновлён", de: "Rechnung aktualisiert" };
  }

  const facts = [number, amount ? formatMoneyAmount(amount, currency) : null].filter(Boolean).join(" · ");
  return { title: pick(heading, lang), body: facts || item.body };
}

// ---------------------------------------------------------------------------
// Documents, recommendations, subscriptions (exact codes of the server)
// ---------------------------------------------------------------------------

/**
 * Notices with a fixed code: a released document was withdrawn
 * (`documents.rs`), a recommendation was changed or withdrawn
 * (`patient_recommendations.rs`), a subscription was assigned, paused,
 * resumed or ended (`service_packages.rs`). `fact` is the name the notice
 * carries in `params`.
 */
const FIXED_PATIENT_NOTICES: Record<string, { title: Texts; body: Texts; fact: string }> = {
  document_release_revoked: {
    title: { ru: "Документ отозван", de: "Dokument zurückgezogen" },
    body: {
      ru: "Документ больше не доступен в портале.",
      de: "Das Dokument ist im Portal nicht mehr verfügbar.",
    },
    fact: "document_name",
  },
  recommendation_updated: {
    title: { ru: "Рекомендация изменена", de: "Empfehlung geändert" },
    body: {
      ru: "Команда сопровождения изменила рекомендацию. Откройте её, чтобы увидеть актуальный текст и срок действия.",
      de: "Ihr Betreuungsteam hat die Empfehlung geändert. Öffnen Sie sie, um den aktuellen Text und die Gültigkeit zu sehen.",
    },
    fact: "title",
  },
  recommendation_withdrawn: {
    title: { ru: "Рекомендация отозвана", de: "Empfehlung zurückgezogen" },
    body: {
      ru: "Команда сопровождения отозвала рекомендацию.",
      de: "Ihr Betreuungsteam hat die Empfehlung zurückgezogen.",
    },
    fact: "title",
  },
  subscription_assigned: {
    title: { ru: "Новая подписка", de: "Neues Abonnement" },
    body: {
      ru: "Подписка добавлена в ваш портал.",
      de: "Das Abonnement wurde Ihrem Portal hinzugefügt.",
    },
    fact: "package_name",
  },
  subscription_paused: {
    title: { ru: "Подписка приостановлена", de: "Abonnement pausiert" },
    body: {
      ru: "Новые запросы закрыты до возобновления; согласованные визиты и чат с менеджером остаются доступными.",
      de: "Neue Anfragen sind bis zur Fortsetzung geschlossen; vereinbarte Termine und der Chat mit Ihrem Manager bleiben verfügbar.",
    },
    fact: "package_name",
  },
  subscription_resumed: {
    title: { ru: "Подписка возобновлена", de: "Abonnement fortgesetzt" },
    body: { ru: "Все разделы портала снова доступны.", de: "Alle Bereiche des Portals sind wieder verfügbar." },
    fact: "package_name",
  },
  subscription_ended: {
    title: { ru: "Подписка завершена", de: "Abonnement beendet" },
    body: {
      ru: "Документы, счета и аккаунт остаются доступными.",
      de: "Dokumente, Rechnungen und Ihr Konto bleiben verfügbar.",
    },
    fact: "package_name",
  },
};

/** The codes above, for the report and the tests. */
export const FIXED_PATIENT_NOTICE_KINDS = Object.keys(FIXED_PATIENT_NOTICES);

function fixedNoticeCopy(item: PatientEventNotice, lang: Lang): PatientEventCopy | null {
  const notice = FIXED_PATIENT_NOTICES[item.kind];
  if (!notice) return null;
  const name = fact(item, notice.fact);
  const body = pick(notice.body, lang);
  return { title: pick(notice.title, lang), body: name ? `${name}. ${body}` : body };
}

/**
 * The portal wording of a visit, service or money notice, or null for a code
 * outside these families (the caller shows the stored text then).
 */
export function patientEventNotificationCopy(item: PatientEventNotice, lang: Lang): PatientEventCopy | null {
  const fixed = fixedNoticeCopy(item, lang);
  if (fixed) return fixed;
  switch (patientEventFamily(item)) {
    case "appointment":
      return appointmentCopy(item, lang);
    case "service":
      return serviceCopy(item, lang);
    case "money":
      return moneyCopy(item, lang);
    default:
      return null;
  }
}

/**
 * Where a patient's notice of a new entity type leads: the page of its
 * family. Known entity types have their own links (`notificationHrefForRole`).
 */
export function patientEventHref(item: Pick<PatientEventNotice, "kind" | "entity_type">): string | null {
  switch (patientEventFamily(item)) {
    case "appointment":
      return "/appointments";
    case "service":
      return "/services";
    case "money":
      return "/invoices";
    default:
      return null;
  }
}
