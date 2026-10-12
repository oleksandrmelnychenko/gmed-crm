import { appDateKey } from "@/lib/app-time-zone";
import type { TranslationKey } from "@/lib/i18n";
import type { DunningEvent, InvoiceItem } from "./types";

const PREVIOUS_LEVEL: Record<string, string> = { second: "first", collections: "second" };

/**
 * The deadline (`YYYY-MM-DD`) of the previous letter while it still runs:
 * the next level is sent only after it (QA D2-06, as the automatic run and
 * `create_dunning_event`); `null` once it has passed or for a first reminder.
 */
export function dunningDeadlineRunning(
  events: readonly Pick<DunningEvent, "level" | "payment_due_date">[],
  nextLevel: string | null,
  today = appDateKey(),
): string | null {
  const previous = nextLevel ? PREVIOUS_LEVEL[nextLevel] : undefined;
  if (!previous) return null;
  const deadline = events.find((event) => event.level === previous)?.payment_due_date ?? null;
  return deadline && deadline >= today ? deadline : null;
}

/** `DD.MM.YYYY` of a `YYYY-MM-DD` key. */
function germanDate(key: string) {
  const [year, month, day] = key.split("-");
  return year && month && day ? `${day}.${month}.${year}` : key;
}

/** The day after `deadline` (`YYYY-MM-DD`), when the next level opens. */
function dayAfter(deadline: string) {
  const date = new Date(`${deadline}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return deadline;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** Why the next level waits, and who may send it earlier. */
export function dunningDeadlineHint(deadline: string, lang: string, canOverride: boolean) {
  const from = germanDate(dayAfter(deadline));
  if (lang === "de") {
    return `Die Zahlungsfrist des letzten Schreibens läuft bis ${germanDate(deadline)}. Die nächste Stufe ist ab ${from} möglich${canOverride ? "; als CEO können Sie sie mit Begründung vorher senden" : ""}.`;
  }
  return `Срок оплаты из последнего письма действует до ${germanDate(deadline)}. Следующий уровень можно отправить с ${from}${canOverride ? "; как CEO вы можете отправить раньше, указав причину" : ""}.`;
}

/**
 * The note of an automatic reminder: the system sent it, the UI words it
 * (QA D2-12; older events stored an English text).
 */
export function automaticDunningNote(level: string, lang: string) {
  if (lang === "de") {
    switch (level) {
      case "first": return "Automatisch erstellt: Zahlungsfrist überschritten.";
      case "second": return "Automatisch erstellt: Frist der Zahlungserinnerung abgelaufen.";
      case "collections": return "Automatisch erstellt: Frist der 1. Mahnung abgelaufen.";
      default: return "Automatisch erstellt.";
    }
  }
  switch (level) {
    case "first": return "Создано автоматически: срок оплаты истёк.";
    case "second": return "Создано автоматически: срок из напоминания об оплате истёк.";
    case "collections": return "Создано автоматически: срок из первого требования истёк.";
    default: return "Создано автоматически.";
  }
}

/** Label and text of the CEO's early sending (reason required). */
export function dunningOverrideCopy(lang: string) {
  return lang === "de"
    ? {
        label: "Begründung für das vorzeitige Senden (nur CEO)",
        placeholder: "z. B. Zahlung schriftlich verweigert",
        tooShort: "Bitte eine Begründung mit 3 bis 1000 Zeichen angeben.",
      }
    : {
        label: "Причина досрочной отправки (только CEO)",
        placeholder: "например, письменный отказ от оплаты",
        tooShort: "Укажите причину (от 3 до 1000 символов).",
      };
}

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

/** A refusal the shared invoice error texts word (with dates), not a key. */
export function isDunningDeadlineError(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  const body = (error as { body?: { error?: unknown } }).body;
  return code === "dunning_previous_deadline_running" || body?.error === "dunning_previous_deadline_running";
}

export function dunningErrorKey(error: unknown): TranslationKey {
  return (error instanceof Error && DUNNING_ERRORS[error.message])
    || "invoices_workspace_dunning_save_error";
}
