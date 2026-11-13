import { formatUiText } from "@/lib/i18n";

/**
 * The sentence shown after «Исполнить» of a DSGVO request: what was done and
 * the next step, in the UI language — never the raw server answer (QA
 * 2026-11-13 F-B4). `ui` is the `uiText` dictionary of the UI language.
 */
export function privacyExecutionSummary(
  payload: unknown,
  ui: Record<string, string | undefined>,
): string {
  const text = (key: string, values?: Record<string, string | number>) =>
    formatUiText(ui[key] ?? ui.compliance_executed_generic ?? key, values);
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const count = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : 0;

  const execution = record(record(payload).execution);
  switch (execution.mode) {
    case "manual_fulfilment": {
      const type = typeof execution.request_type === "string" ? execution.request_type : "";
      return ["access", "portability", "rectification", "objection"].includes(type)
        ? text(`compliance_executed_${type}`)
        : text("compliance_executed_generic");
    }
    case "restriction":
      return text("compliance_executed_restriction");
    case "third_party_revoke":
      return text("compliance_executed_third_party_revoke", {
        consents: count(execution.revoked_count),
        shares: count(execution.revoked_document_share_count),
      });
    case "erasure":
      return text("compliance_executed_erasure", {
        files: count(execution.erased_document_files),
        accounts: count(execution.disabled_portal_accounts),
      });
    default:
      return text("compliance_executed_generic");
  }
}
