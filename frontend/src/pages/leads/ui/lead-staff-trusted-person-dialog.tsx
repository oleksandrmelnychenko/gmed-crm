import { useState } from "react";
import { UserRoundPen, UserRoundPlus } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SectionHeading } from "@/components/ui/section-heading";
import { ApiRequestError } from "@/lib/api";
import { TrustedPersonsEditor } from "@/pages/patient-lead/lead-trusted-persons-editor";
import type { RecipientDraft } from "@/pages/patient-lead/lead-trusted-persons-model";
import { StaffConsentRecordFields } from "@/pages/patient-lead/lead-request-staff-consent";

import { addLeadTrustedPerson, editLeadTrustedPerson } from "../data/lead-portal-intake-api";
import type { LeadPortalConsentRecipient } from "../model/lead-portal-consents";
import { staffTrustedPersonError, trustedPersonToSend } from "../model/lead-staff-trusted-person";

type Tx = (ru: string, de: string) => string;

/** What the dialog does: add a person, or change the stored one at `index` of the cabinet list. */
export type StaffTrustedPersonTarget =
  | { kind: "add"; draft: RecipientDraft }
  | { kind: "edit"; index: number; stored: LeadPortalConsentRecipient; draft: RecipientDraft };

/**
 * Staff add or change a trusted person with the cabinet's full data set
 * (owner 2026-11-18), recorded with how the client gave the consent.
 */
export function StaffTrustedPersonDialog({ leadId, target, lang, tx, onClose, onSaved }: {
  leadId: string;
  target: StaffTrustedPersonTarget;
  lang: string;
  tx: Tx;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [persons, setPersons] = useState<RecipientDraft[]>([target.draft]);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const language = lang === "de" ? "de" : "ru";

  const record = async (recorded: { how: string; note: string }) => {
    const person = trustedPersonToSend(persons[0]);
    if (!person) {
      setShowErrors(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (target.kind === "add") await addLeadTrustedPerson(leadId, person, language, recorded);
      else await editLeadTrustedPerson(leadId, target.index, target.stored, person, language, recorded);
      onSaved();
      onClose();
    } catch (cause) {
      const body = cause instanceof ApiRequestError ? (cause.body as { code?: string; field?: string } | null) : null;
      const code = cause instanceof ApiRequestError ? cause.code ?? body?.code : undefined;
      setShowErrors(true);
      setError(staffTrustedPersonError(code, body?.field, tx));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open allowImplicitDismissal onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="gap-4 sm:max-w-2xl" data-testid="staff-trusted-person-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <SectionHeading icon={target.kind === "add" ? UserRoundPlus : UserRoundPen}>
              {target.kind === "add" ? tx("Доверенное лицо", "Vertrauensperson") : tx("Изменить доверенное лицо", "Vertrauensperson ändern")}
            </SectionHeading>
          </DialogTitle>
        </DialogHeader>
        <TrustedPersonsEditor persons={persons} onChange={setPersons} lang={language} disabled={busy} showErrors={showErrors} variant="staff" single />
        {error ? <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-testid="staff-trusted-person-error">{error}</p> : null}
        <StaffConsentRecordFields lang={language} testId="staff-trusted-person" busy={busy} hint="" onRecord={(recorded) => void record(recorded)} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
