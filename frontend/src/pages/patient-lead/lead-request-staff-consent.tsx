import { useState } from "react";

import { STAFF_CONSENT_CHANNELS, STAFF_CONSENT_NOTE_MAX, type StaffConsentChannel, type StaffConsentRecord } from "./lead-request-api";
import { cabinetStaffText } from "./lead-request-staff-mode";

/**
 * Staff record a consent the client gave them (owner decision 2026-10-29): how the client gave it
 * (required) and an optional note, then «Record the consent». Used for the single consents, the
 * consent form options, the trusted persons and the cost-estimate consent. The test ids are
 * `${testId}-record`, `-record-how`, `-record-note`, `-record-save`.
 */
export function StaffConsentRecordFields({
  lang,
  testId,
  busy = false,
  hint,
  onRecord,
  onCancel,
}: {
  lang: string;
  testId: string;
  busy?: boolean;
  /** A line above the fields, e.g. that the changes wait for the record. */
  hint?: string;
  onRecord: (recorded: StaffConsentRecord) => void;
  onCancel?: () => void;
}) {
  const text = cabinetStaffText(lang);
  const [how, setHow] = useState<StaffConsentChannel | "">("");
  const [note, setNote] = useState("");
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-muted/30 p-3" data-testid={`${testId}-record`}>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      <label className="block space-y-1 text-xs">
        <span className="font-mono font-medium text-foreground/80">{text.consentHow}</span>
        <select
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          value={how}
          disabled={busy}
          onChange={(event) => setHow(event.target.value as StaffConsentChannel | "")}
          data-testid={`${testId}-record-how`}
        >
          <option value="">—</option>
          {STAFF_CONSENT_CHANNELS.map((channel) => <option key={channel} value={channel}>{text.channels[channel]}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-xs">
        <span className="font-mono font-medium text-foreground/80">{text.consentNote}</span>
        <input
          className="h-9 w-full rounded-lg border border-input bg-background px-2 text-sm"
          maxLength={STAFF_CONSENT_NOTE_MAX}
          value={note}
          disabled={busy}
          onChange={(event) => setNote(event.target.value)}
          data-testid={`${testId}-record-note`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="h-8 rounded-lg bg-[var(--brand)] px-3 text-xs font-medium text-white disabled:opacity-50"
          disabled={busy || !how}
          onClick={() => { if (how) onRecord({ how, note }); }}
          data-testid={`${testId}-record-save`}
        >
          {text.recordConsent}
        </button>
        {onCancel ? (
          <button type="button" className="h-8 rounded-lg border border-border px-3 text-xs" disabled={busy} onClick={onCancel}>
            {text.cancel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
