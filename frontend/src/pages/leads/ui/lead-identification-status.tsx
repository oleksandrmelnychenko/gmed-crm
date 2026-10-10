import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import {
  identificationLacksRepresentative,
  identificationPersons,
  noOwnAccountPaymentHint,
  ownAccountHintSubjects,
  ownAccountPaymentLabel,
  qualifiedSignatureLabel,
  type DeclaredPaymentRoute,
  type IdentificationLabel,
  type IdentificationSubject,
  type LeadIdentificationStatus,
  type Tx,
} from "../model/lead-identification";
import type { LeadIdentificationStatusState } from "../model/use-lead-identification-status";

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
 * A minor has no line of his own: the legal representatives sign and pay, each
 * on a line; a payer who is one of them repeats that person's labels without a
 * second confirmation. An adult's representative and legal guardian (Betreuer)
 * each get a line of their own below the patient's. When the stated payment
 * route is cash, crypto or a
 * payment through a third party, the paying person's line says that no
 * payment from the own account is to be expected; the button stays.
 */
export function LeadIdentificationStatusView({
  status,
  canEdit,
  disabled,
  busy,
  errorMessage,
  tx,
  paymentRoute = null,
  onSetOwnAccountPayment,
}: {
  status: LeadIdentificationStatus;
  canEdit: boolean;
  disabled: boolean;
  /** The person whose confirmation is being saved. */
  busy: IdentificationSubject | null;
  errorMessage: string;
  tx: Tx;
  /** The payment route of section 8 (the intake's billing); null while unknown. */
  paymentRoute?: DeclaredPaymentRoute | null;
  onSetOwnAccountPayment: (subject: IdentificationSubject, confirmed: boolean) => void;
}) {
  const hinted = ownAccountHintSubjects(status, paymentRoute);
  // A line captioned by a person's name needs more room than a role.
  const namedLines = status.minor || status.acting_persons.length > 0;
  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="lead-identification-status">
      <div className="text-xs font-semibold text-foreground">
        {tx("Идентификация по квалифицированной подписи", "Identifizierung per qualifizierter Signatur")}
      </div>
      {status.minor ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-identification-minor">
          {tx(
            "Пациент несовершеннолетний: подписывают и платят законные представители, у ребёнка своей строки нет.",
            "Der Patient ist minderjährig: Es unterschreiben und zahlen die gesetzlichen Vertreter, das Kind hat keine eigene Zeile.",
          )}
        </p>
      ) : null}
      {identificationLacksRepresentative(status) ? (
        <p className="text-xs font-medium leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-identification-no-representative">
          {tx(
            "Добавьте родителя или законного представителя",
            "Bitte einen Elternteil oder eine gesetzliche Vertreterin / einen gesetzlichen Vertreter hinzufügen",
          )}
        </p>
      ) : null}
      <ul className="space-y-2">
        {identificationPersons(status, tx).map(({ subject, role, detail, person, canConfirm, wide, note }) => {
          const confirmed = Boolean(person.own_account_payment);
          return (
            <li
              key={subject}
              className="flex flex-wrap items-center gap-x-2 gap-y-1.5"
              data-testid={`lead-identification-${subject}`}
            >
              <span
                className={cn(
                  "w-full text-[13px] font-medium text-foreground",
                  wide ? "" : namedLines ? "sm:w-44 sm:shrink-0" : "sm:w-28 sm:shrink-0",
                )}
              >
                {role}
                {detail ? <span className="font-normal text-muted-foreground">{` · ${detail}`}</span> : null}
              </span>
              <Label label={qualifiedSignatureLabel(person, tx)} testId={`lead-identification-qes-${subject}`} />
              <Label label={ownAccountPaymentLabel(person, tx)} testId={`lead-identification-payment-${subject}`} />
              {canEdit && canConfirm ? (
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
              {note ? (
                <span
                  className="w-full text-xs font-medium text-amber-700 dark:text-amber-300"
                  data-testid={`lead-identification-note-${subject}`}
                >
                  {note}
                </span>
              ) : null}
              {hinted.has(subject) ? (
                <span
                  className="w-full text-xs leading-5 text-amber-700 dark:text-amber-300"
                  data-testid={`lead-identification-own-account-hint-${subject}`}
                >
                  {noOwnAccountPaymentHint(tx)}
                </span>
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
 * wizard: whether the patient — for a minor each legal representative — and a
 * third-party payer signed with a QES and whether staff confirmed the payment
 * from that person's own account. Only information — nothing is blocked. The
 * status is loaded by the wizard (`useLeadIdentificationStatus`), which also
 * needs it for the sheet buttons; nothing is shown until it is loaded, nor
 * when the server does not know it.
 */
export function LeadIdentificationStatus({
  identification,
  canEdit,
  disabled,
  tx,
  errorText,
  paymentRoute = null,
}: {
  /** The loaded status and the action that confirms a payment. */
  identification: Pick<LeadIdentificationStatusState, "status" | "setOwnAccountPayment">;
  canEdit: boolean;
  disabled: boolean;
  tx: Tx;
  errorText: (error: unknown) => string;
  /** The payment route of section 8 (the intake's billing); null while unknown. */
  paymentRoute?: DeclaredPaymentRoute | null;
}) {
  const { status, setOwnAccountPayment } = identification;
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
      paymentRoute={paymentRoute}
      onSetOwnAccountPayment={(subject, confirmed) => void change(subject, confirmed)}
    />
  );
}
