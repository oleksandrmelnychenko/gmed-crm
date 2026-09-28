import { appDateKey } from "@/lib/app-time-zone";
import type { TranslationKey } from "@/lib/i18n";
import type { InvoiceItem } from "./types";

// Keep the preflight in sync with create_dunning_event. The server uses Berlin dates.
export function dunningBlockReason(
  invoice: Pick<InvoiceItem, "status" | "balance_due" | "due_date" | "dunning_block"> | null,
  today = appDateKey(),
): TranslationKey | null {
  if (!invoice) return "invoices_workspace_dunning_unavailable";
  const block = invoice.dunning_block;
  if (block && (!("active" in block) || block.active)) return "revenue_invoices_dunning_blocked";
  const balance = Number(invoice.balance_due);
  if (!Number.isFinite(balance)) return "invoices_workspace_dunning_unavailable";
  if (balance <= 0 || ["paid", "cancelled"].includes(invoice.status)) {
    return "invoices_workspace_dunning_ineligible";
  }
  if (invoice.status === "draft") return "invoices_workspace_dunning_not_sent";
  if (!invoice.due_date) return "invoices_workspace_dunning_missing_due_date";
  if (invoice.due_date >= today) return "invoices_workspace_dunning_not_overdue";
  return null;
}

const DUNNING_ERRORS: Record<string, TranslationKey> = {
  "Invoice must be sent before dunning starts": "invoices_workspace_dunning_not_sent",
  "Invoice is not eligible for dunning": "invoices_workspace_dunning_ineligible",
  "Invoice due date is required for dunning": "invoices_workspace_dunning_missing_due_date",
  "Invoice is not overdue yet": "invoices_workspace_dunning_not_overdue",
  "First reminder already exists for this invoice": "invoices_workspace_dunning_changed",
  "Second reminder requires a first reminder": "invoices_workspace_dunning_changed",
  "Second reminder already exists for this invoice": "invoices_workspace_dunning_changed",
  "Collections escalation requires a second reminder": "invoices_workspace_dunning_changed",
  "Collections escalation already exists for this invoice": "invoices_workspace_dunning_changed",
  "Dunning is blocked for this invoice; clear the dunning block first": "revenue_invoices_dunning_blocked",
};

export function dunningErrorKey(error: unknown): TranslationKey {
  return (error instanceof Error && DUNNING_ERRORS[error.message])
    || "invoices_workspace_dunning_save_error";
}
