import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { inputClass, selectClass } from "@/components/record-workspace/primitives/design-tokens";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { STAFF_CONSENT_CHANNELS, STAFF_CONSENT_NOTE_MAX, type StaffConsentChannel } from "@/pages/patient-lead/lead-request-api";
import { cabinetStaffText } from "@/pages/patient-lead/lead-request-staff-mode";

const headerBarClass = "flex min-w-0 items-center gap-2 border-b border-border/70 bg-muted/20 px-3.5 py-2.5";
const headerTitleClass = "min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground";

/**
 * A card of the consent dialogs with the header bar of the patient card's sections. As a
 * `fieldset` the legend is for screen readers only: a visible legend sits on the border
 * (fix-92, the same fix as the advance-basis section in 483f2dee).
 */
export function ConsentCard({ icon: Icon, title, fieldset = false, testId, children }: {
  icon?: LucideIcon; title?: ReactNode; fieldset?: boolean; testId?: string; children: ReactNode;
}) {
  const header = title ? (
    <div className={headerBarClass} aria-hidden={fieldset || undefined}>
      {Icon ? <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
      <h3 className={headerTitleClass}>{title}</h3>
    </div>
  ) : null;
  if (fieldset) {
    return (
      <fieldset className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card text-sm" data-testid={testId}>
        <legend className="sr-only">{title}</legend>
        {header}
        <div className="space-y-3 px-3.5 py-3">{children}</div>
      </fieldset>
    );
  }
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card text-sm" data-testid={testId}>
      {header}
      <div className="space-y-3 px-3.5 py-3">{children}</div>
    </section>
  );
}

const HOW_REQUIRED = { ru: "Выберите, как клиент сообщил.", de: "Bitte auswählen, wie der Kunde es mitgeteilt hat." } as const;

/**
 * How the client told GMED (required) and an optional note — the staff record of a consent
 * change, with the app's select and input. `missing` marks the way after a save without it.
 */
export function ConsentRecordFields({ lang, testId, howLabel, how, note, onHow, onNote, missing = false, disabled = false }: {
  lang: string; testId: string; howLabel: string; how: StaffConsentChannel | ""; note: string;
  onHow: (how: StaffConsentChannel | "") => void; onNote: (note: string) => void; missing?: boolean; disabled?: boolean;
}) {
  const text = cabinetStaffText(lang === "de" ? "de" : "ru");
  const howId = `${testId}-record-how`;
  const shown = missing && !how;
  return (
    <div className="grid gap-x-3 gap-y-2.5 sm:grid-cols-2" data-testid={`${testId}-record`}>
      <div className="min-w-0 space-y-1.5 text-xs" data-testid={howId}>
        <label htmlFor={howId} className="block font-mono font-medium leading-5 text-foreground/75">
          {howLabel}<span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
        </label>
        <NativeComboboxSelect id={howId} className={selectClass} value={how} disabled={disabled} required
          aria-invalid={shown || undefined} aria-describedby={shown ? `${howId}-error` : undefined}
          onChange={(event) => onHow(event.target.value as StaffConsentChannel | "")}>
          <option value="">—</option>
          {STAFF_CONSENT_CHANNELS.map((channel) => <option key={channel} value={channel}>{text.channels[channel]}</option>)}
        </NativeComboboxSelect>
        {shown ? <p id={`${howId}-error`} role="alert" className="text-destructive" data-testid={`${howId}-error`}>{HOW_REQUIRED[lang === "de" ? "de" : "ru"]}</p> : null}
      </div>
      <div className="min-w-0 space-y-1.5 text-xs">
        <label htmlFor={`${testId}-record-note`} className="block font-mono font-medium leading-5 text-foreground/75">{text.consentNote}</label>
        <Input id={`${testId}-record-note`} className={inputClass} maxLength={STAFF_CONSENT_NOTE_MAX} value={note} disabled={disabled}
          autoComplete="off" onChange={(event) => onNote(event.target.value)} data-testid={`${testId}-record-note`} />
      </div>
    </div>
  );
}

/** Brings the «Как клиент сообщил» field into view and focuses it. */
export function focusConsentRecordHow(testId: string) {
  const field = document.getElementById(`${testId}-record-how`);
  field?.scrollIntoView({ block: "center" });
  field?.focus();
}
