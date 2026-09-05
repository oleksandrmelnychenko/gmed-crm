export type ServiceDescriptionItem = { id: string; text: string };

/** Compatibility with the paragraph/list rules used by existing documents. */
export function legacyServiceDescriptionItems(text: string | null | undefined): ServiceDescriptionItem[] {
  const points: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) points.push(current.trim());
    current = "";
  };
  for (const rawLine of (text ?? "").replace(/\r/g, "").split("\n")) {
    const line = rawLine.trim();
    if (!line) { flush(); continue; }
    const marker = /^(?:[-•] |[0-9]+[.)]\s*)(.+)$/u.exec(line);
    if (marker) flush();
    current += `${current ? " " : ""}${marker ? marker[1].trim() : line}`;
  }
  flush();
  return points.map((text, index) => ({ id: `legacy-${index + 1}`, text }));
}

export function serviceDescriptionItems(
  items: ServiceDescriptionItem[] | null | undefined,
  legacyText?: string | null,
): ServiceDescriptionItem[] {
  return items ?? legacyServiceDescriptionItems(legacyText);
}

export function serviceDescriptionText(items: ServiceDescriptionItem[]): string {
  return items.map((item) => item.text.trim()).filter(Boolean).join("\n\n");
}
