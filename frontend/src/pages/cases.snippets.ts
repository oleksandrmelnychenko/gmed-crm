export type CaseTextSnippetContext = {
  patientName: string;
  patientPid: string;
  caseId: string;
  caseUuid: string;
  hauptanfragegrund: string;
  zuweiser: string;
  today: string;
};

export const CASE_TEXT_SNIPPET_PLACEHOLDERS = [
  "{patient_name}",
  "{patient_pid}",
  "{case_id}",
  "{case_uuid}",
  "{hauptanfragegrund}",
  "{zuweiser}",
  "{today}",
] as const;

export function renderCaseTextSnippet(
  body: string,
  context: CaseTextSnippetContext,
) {
  const replacements: Record<string, string> = {
    patient_name: context.patientName,
    patient_pid: context.patientPid,
    case_id: context.caseId,
    case_uuid: context.caseUuid,
    hauptanfragegrund: context.hauptanfragegrund,
    zuweiser: context.zuweiser,
    today: context.today,
  };

  return body.replace(/\{([a-z_]+)\}/g, (match, key: string) => {
    const value = replacements[key];
    if (value == null) return match;
    return value;
  });
}

export function appendSnippetToNarrative(current: string, renderedSnippet: string) {
  const narrative = current.trim();
  const snippet = renderedSnippet.trim();
  if (!snippet) return current;
  if (!narrative) return snippet;
  return `${narrative}\n\n${snippet}`;
}
