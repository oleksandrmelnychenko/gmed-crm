import { Eye, Lock } from "lucide-react";

import { cn } from "@/lib/utils";

type Tx = (ru: string, de: string) => string;

/**
 * Marks a wizard field whose text the client sees (and may change) in the
 * lead cabinet (owner 2026-11-02: «Потрібен вказівник, що це побачать
 * пацієнти»). One component for every such field, next to its label.
 */
export function ClientVisibleNote({ tx, className }: { tx: Tx; className?: string }) {
  return (
    <span
      data-testid="client-visible-note"
      title={tx(
        "Этот текст клиент видит в своём кабинете и может изменить",
        "Diesen Text sieht der Kunde in seinem Portal und kann ihn ändern",
      )}
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-medium leading-4 text-amber-700 dark:text-amber-400",
        className,
      )}
    >
      <Eye aria-hidden="true" className="size-3 shrink-0" />
      {tx("Видно клиенту в кабинете", "Für den Kunden im Portal sichtbar")}
    </span>
  );
}

/** The label of the staff-only comment of the services step, with its lock. */
export function StaffOnlyLabel({ tx }: { tx: Tx }) {
  return (
    <span data-testid="staff-only-label" className="inline-flex items-center gap-1">
      <Lock aria-hidden="true" className="size-3 shrink-0" />
      {tx("Внутренний комментарий (клиент не видит)", "Interner Kommentar (für den Kunden nicht sichtbar)")}
    </span>
  );
}

/** Longest staff-only comment (`leads.services_internal_note`, checked by the server too). */
export const SERVICES_INTERNAL_NOTE_MAX_LENGTH = 4000;

/**
 * The staff-only comment of the services step (`leads.services_internal_note`):
 * saved with the wizard's lead update, never sent to the cabinet, the payer
 * link or a client PDF.
 */
export function ServicesInternalNoteField({
  id,
  value,
  onChange,
  tx,
  labelClassName,
  textareaClassName,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  tx: Tx;
  labelClassName?: string;
  textareaClassName?: string;
  disabled?: boolean;
}) {
  return (
    <div className="min-w-0 space-y-1.5 border-l-2 border-border pl-3" data-testid="lead-services-internal-note">
      <label htmlFor={id} className={cn("block", labelClassName)}>
        <StaffOnlyLabel tx={tx} />
      </label>
      <textarea
        id={id}
        rows={3}
        className={textareaClassName}
        maxLength={SERVICES_INTERNAL_NOTE_MAX_LENGTH}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={tx("Заметки для команды: договорённости, следующие шаги", "Notizen für das Team: Absprachen, nächste Schritte")}
      />
    </div>
  );
}
