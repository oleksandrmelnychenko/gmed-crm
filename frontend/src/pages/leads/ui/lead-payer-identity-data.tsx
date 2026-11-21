import { IdCardLanyard } from "lucide-react";

import { SectionHeading } from "@/components/ui/section-heading";

import type { LeadPayerLinkState } from "../data/lead-payer-link-api";
import { saveStaffPayerIdentityDocumentData } from "../data/lead-payer-paper-questionnaire-api";
import type { IdentityDocumentSource } from "../model/lead-identity-document-data";
import type { Tx } from "../model/lead-payer";
import { LeadIdentityDocumentDataForm } from "./lead-identity-document-data";

/** The payer's answers as the staff form's source (no staff marks: the statement has none). */
export function payerIdentityDocumentSource(state: LeadPayerLinkState): IdentityDocumentSource | null {
  const answers = state.questionnaire?.answers;
  if (!answers) return null;
  return {
    id_document_type: answers.id_document_type,
    id_document_number: answers.id_document_number,
    id_issuing_authority: answers.id_issuing_authority,
    id_issuing_country: answers.id_issuing_country,
    id_issued_on: answers.id_issued_on,
    id_valid_until: answers.id_valid_until,
  };
}

/**
 * Staff enter the data of the third-party payer's identity document from the
 * copy the payer uploaded on the link (owner 2026-11-21: the link asks for the
 * copy only). Shown once the payer sent the questionnaire; staff may write
 * these answers after the send, every other answer stays the payer's.
 */
export function LeadPayerIdentityDocumentData({
  leadId,
  state,
  tx,
  lang,
  disabled = false,
  onSaved,
}: {
  leadId: string;
  state: LeadPayerLinkState;
  tx: Tx;
  lang: string;
  disabled?: boolean;
  /** After a save: reload the payer link's state. */
  onSaved: () => void;
}) {
  const questionnaire = state.questionnaire;
  if (state.mode !== "link" || !questionnaire?.submitted_at) return null;
  const scans = questionnaire.identity_documents.map((document) => ({ id: document.id, name: document.file_name }));
  return (
    <section className="space-y-2 rounded-xl border border-border/70 bg-card p-3" data-testid="lead-payer-id-data-card">
      <h4><SectionHeading icon={IdCardLanyard}>{tx("Документ плательщика", "Ausweis des Zahlers")}</SectionHeading></h4>
      <LeadIdentityDocumentDataForm
        key={leadId}
        source={payerIdentityDocumentSource(state)}
        tx={tx}
        lang={lang}
        disabled={disabled}
        birthDate={questionnaire.answers.date_of_birth}
        scanCount={scans.length}
        scans={scans}
        unreadableToggle={false}
        testId="lead-payer-id-data"
        save={async (input, options) => {
          // The server ignores the form's `id_document_unreadable` for the payer.
          const stored = await saveStaffPayerIdentityDocumentData(leadId, input, options);
          onSaved();
          return stored;
        }}
      />
    </section>
  );
}
