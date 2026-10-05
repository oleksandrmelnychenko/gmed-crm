import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";

import {
  identificationPersons,
  ownAccountPaymentLabel,
  qualifiedSignatureLabel,
  type IdentificationLabel,
  type IdentificationSubject,
  type LeadIdentificationStatus,
  type Tx,
} from "../model/lead-identification";
import { useLeadIdentificationStatus } from "../model/use-lead-identification-status";

// A long label wraps on a phone instead of widening the wizard; on one line
// it keeps the pill shape of the other badges.
const LABEL_CLASS = "h-auto min-h-5 max-w-full shrink justify-start rounded-[10px] text-left leading-4 whitespace-normal";

function Label({ label, testId }: { label: IdentificationLabel; testId: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full" data-testid={testId} data-tone={label.tone}>
      <StatusBadge tone={label.tone} className={LABEL_CLASS}>{label.text}</StatusBadge>
    </span>
  );
}

/**
 * The block itself, without requests of its own: per person one line with the
 * role, the qualified signature and the payment from the own account. The
 * payment is confirmed or taken back with one button, for roles that may edit.
 */
export function LeadIdentificationStatusView({
  status,
  canEdit,
  disabled,
  busy,
  errorMessage,
  tx,
  onSetOwnAccountPayment,
}: {
  status: LeadIdentificationStatus;
  canEdit: boolean;
  disabled: boolean;
  /** The person whose confirmation is being saved. */
  busy: IdentificationSubject | null;
  errorMessage: string;
  tx: Tx;
  onSetOwnAccountPayment: (subject: IdentificationSubject, confirmed: boolean) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="lead-identification-status">
      <div className="text-xs font-semibold text-foreground">
        {tx("Идентификация по квалифицированной подписи", "Identifizierung per qualifizierter Signatur")}
      </div>
      <ul className="space-y-2">
        {identificationPersons(status, tx).map(({ subject, role, person }) => {
          const confirmed = Boolean(person.own_account_payment);
          return (
            <li
              key={subject}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
              data-testid={`lead-identification-${subject}`}
            >
              <span className="w-full text-[13px] font-medium text-foreground sm:w-28 sm:shrink-0">{role}</span>
              <Label label={qualifiedSignatureLabel(person, tx)} testId={`lead-identification-qes-${subject}`} />
              <Label label={ownAccountPaymentLabel(person, tx)} testId={`lead-identification-payment-${subject}`} />
              {canEdit ? (
                <Button
                  type="button"
                  variant={confirmed ? "ghost" : "outline"}
                  size="xs"
                  disabled={disabled || busy !== null}
                  aria-label={`${confirmed ? tx("Отменить", "Zurücknehmen") : tx("Подтвердить платёж", "Zahlung bestätigen")} — ${role}`}
                  onClick={() => onSetOwnAccountPayment(subject, !confirmed)}
                >
                  {busy === subject ? <LoaderCircle className="size-3 animate-spin" /> : null}
                  {confirmed ? tx("Отменить", "Zurücknehmen") : tx("Подтвердить платёж", "Zahlung bestätigen")}
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive" data-testid="lead-identification-error">{errorMessage}</p>
      ) : null}
      <p className="text-xs leading-5 text-muted-foreground">
        {tx(
          "§ 12 Abs. 1 GwG: к квалифицированной подписи нужен платёж со счёта на имя этого человека. Это не блокирует работу.",
          "§ 12 Abs. 1 GwG: Zur qualifizierten Signatur gehört eine Zahlung von einem Konto auf den Namen dieser Person. Das blockiert die Arbeit nicht.",
        )}
      </p>
    </div>
  );
}

/**
 * "Identification by qualified signature" in the GwG section of the lead
 * wizard: whether the patient (and a third-party payer) signed with a QES and
 * whether staff confirmed the payment from that person's own account. Only
 * information — nothing is blocked. Nothing is shown until the status is
 * loaded, nor when the server does not know it.
 */
export function LeadIdentificationStatus({
  leadId,
  documents,
  payerVersion,
  canEdit,
  disabled,
  tx,
  errorText,
}: {
  leadId: string;
  /** The lead's documents and the version of the payer declaration: the status is loaded again when they change. */
  documents?: unknown;
  payerVersion?: string | null;
  canEdit: boolean;
  disabled: boolean;
  tx: Tx;
  errorText: (error: unknown) => string;
}) {
  const { status, setOwnAccountPayment } = useLeadIdentificationStatus(leadId, documents, payerVersion);
  const [busy, setBusy] = useState<IdentificationSubject | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  if (!status) return null;

  async function change(subject: IdentificationSubject, confirmed: boolean) {
    setBusy(subject);
    setErrorMessage("");
    try {
      await setOwnAccountPayment(subject, confirmed);
    } catch (error) {
      setErrorMessage(errorText(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <LeadIdentificationStatusView
      status={status}
      canEdit={canEdit}
      disabled={disabled}
      busy={busy}
      errorMessage={errorMessage}
      tx={tx}
      onSetOwnAccountPayment={(subject, confirmed) => void change(subject, confirmed)}
    />
  );
}
