import { Tooltip } from "@base-ui/react/tooltip";
import { Eye, Lock } from "lucide-react";
import { useId, useState } from "react";

import { cn } from "@/lib/utils";

type Tx = (ru: string, de: string) => string;

/**
 * Marks a wizard field whose text the client sees (and may change) in the
 * lead cabinet (owner 2026-11-02: «Потрібен вказівник, що це побачать
 * пацієнти»). One component for every such field, next to its label.
 */
export function ClientVisibleNote({ tx, className }: { tx: Tx; className?: string }) {
  const label = tx("Видно клиенту в кабинете", "Für den Kunden im Portal sichtbar");
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger
        render={<span role="img" tabIndex={0} />}
        data-testid="client-visible-note"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        aria-description={tx(
          "Этот текст клиент видит в своём кабинете и может изменить",
          "Diesen Text sieht der Kunde in seinem Portal und kann ihn ändern",
        )}
        closeOnClick={false}
        onClick={() => setOpen(true)}
        className={cn("inline-flex size-5 shrink-0 cursor-help items-center justify-center rounded text-amber-700 focus-visible:outline-2 focus-visible:outline-ring dark:text-amber-400", className)}
      >
        <Eye aria-hidden="true" className="size-3.5" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="top" sideOffset={4} className="z-[100]">
          <Tooltip.Popup id={tooltipId} role="tooltip" className="rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
            {label}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
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
