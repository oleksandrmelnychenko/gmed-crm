import { useState } from "react";
import { CircleAlert, Info, LoaderCircle } from "lucide-react";

import { StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";

import {
  identificationLacksRepresentative,
  identificationPersons,
  identificationRuleText,
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
import { PARENT_ROLE_CHIP_CLASS } from "./trusted-contact-role";

// A long label wraps on a phone instead of widening the wizard; on one line
// it keeps the pill shape of the other badges.
const LABEL_CLASS = "h-auto min-h-5 max-w-full shrink justify-start rounded-[10px] text-left leading-4 whitespace-normal";

function Label({ label, testId, step }: { label: IdentificationLabel; testId: string; step?: string }) {
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
      {step ? <span className="shrink-0 text-[11px] font-medium text-muted-foreground">{step}</span> : null}
      <span className="inline-flex min-w-0 max-w-full" data-testid={testId} data-tone={label.tone}>
        <StatusBadge tone={label.tone} className={LABEL_CLASS}>{label.text}</StatusBadge>
      </span>
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
 * payment from the own account is to be expected and offers no confirmation
 * (an earlier one can still be taken back).
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
  const persons = identificationPersons(status, tx);
  // Somebody signed with a QES and the payment from the own account is still awaited.
  const paymentPending = persons.some(({ subject, person, paymentExpected }) => (
    person.qes !== null && !person.own_account_payment && paymentExpected && !hinted.has(subject)
  ));
  return (
    <div className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3.5" data-testid="lead-identification-status">
      <div className="space-y-1">
        <div className="text-xs font-semibold text-foreground">
          {tx("Идентификация по квалифицированной подписи", "Identifizierung per qualifizierter Signatur")}
        </div>
        <p className="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground" data-testid="lead-identification-rule" data-pending={paymentPending ? "true" : "false"}>
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{identificationRuleText(tx)}</span>
        </p>
      </div>
      {status.minor ? (
        <p data-testid="lead-identification-minor">
          <StatusChip tone="warning" className="items-start whitespace-normal text-left">
            <CircleAlert aria-hidden="true" className="mt-0.5" />
            <span>
              {tx(
                "Пациент несовершеннолетний: подписывают и идентифицируются законные представители, ребёнок — нет; платёж подтверждается только у того, кто платит.",
                "Der Patient ist minderjährig: Es unterschreiben und werden identifiziert die gesetzlichen Vertreter, nicht das Kind; die Zahlung wird nur bei der zahlenden Person bestätigt.",
              )}
            </span>
          </StatusChip>
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
        {persons.map(({ subject, role, detail, person, canConfirm, paymentExpected, paidByThirdParty, wide, note }) => {
          const confirmed = Boolean(person.own_account_payment);
          const signature = qualifiedSignatureLabel(person, tx);
          // Cash or a payment through a third party, or a parent who does not
          // pay (only signs): no own-account payment to confirm.
          const expected = paymentExpected && !hinted.has(subject);
          return (
            <li
              key={subject}
              className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-border/70 bg-card p-2.5 shadow-xs"
              data-testid={`lead-identification-${subject}`}
            >
              <span
                className={cn(
                  "inline-flex w-full flex-wrap items-center gap-1.5 text-[13px] font-semibold text-foreground",
                  wide ? "" : namedLines ? "sm:w-44 sm:shrink-0" : "sm:w-28 sm:shrink-0",
                )}
              >
                {role}
                {detail ? <StatusChip className={cn(PARENT_ROLE_CHIP_CLASS, "whitespace-normal")}>{detail}</StatusChip> : null}
              </span>
              <Label step={tx("1 · Подпись КЭП", "1 · QES")} label={signature} testId={`lead-identification-qes-${subject}`} />
              <Label step={tx("2 · Платёж со своего счёта", "2 · Zahlung vom eigenen Konto")} label={ownAccountPaymentLabel(person, tx, expected, paidByThirdParty)} testId={`lead-identification-payment-${subject}`} />
              {person.qes && confirmed ? (
                <StatusBadge tone="success" className={LABEL_CLASS} data-testid={`lead-identification-done-${subject}`}>
                  {tx("Идентифицирован по КЭП", "Per QES identifiziert")}
                </StatusBadge>
              ) : null}
              {canEdit && canConfirm && (confirmed || expected) ? (
                <Button
                  type="button"
                  variant={confirmed ? "ghost" : "default"}
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
