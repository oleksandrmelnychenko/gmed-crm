import { useEffect, useId, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { BillingReversalNotice } from "@/components/billing-reversal-notice";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { Field, textareaClass } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  BILLING_REVERSAL_REASON_MAX,
  type IssuedCreditNote,
  billingReversalBlockedMessage,
  billingReversalErrorMessage,
  billingReversalNeedsFinanceRole,
  billingReversalReasonHint,
  billingReversalSuccessMessage,
  isValidBillingReversalReason,
} from "@/lib/billing-reversal";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  closeAppointmentBillingReversal,
  useAppointmentBillingReversalRequest,
} from "@/pages/appointments/model/billing-reversal-request";

type CancelWithReversalResponse = {
  ok: boolean;
  billing_reversals?: { credit_notes?: IssuedCreditNote[] }[];
};

/**
 * Confirms cancelling a visit with an approved interpreter report: the
 * report's billing is reversed in the same transaction (its order line is
 * cancelled, with a credit note when a released invoice bills it — CEO and
 * billing only). The report stays approved as the record of the hours.
 */
export function AppointmentBillingReversalDialog() {
  const request = useAppointmentBillingReversalRequest();
  const { lang } = useLang();
  const { user } = useAuth();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canIssueCreditNote = hasCapability(user, "invoices.finance");
  const preview = request?.reversal ?? null;
  const blocked = preview
    ? Boolean(billingReversalBlockedMessage(preview, tx)) ||
      billingReversalNeedsFinanceRole(preview, canIssueCreditNote)
    : false;
  const reasonValid = isValidBillingReversalReason(reason);

  useEffect(() => {
    setReason("");
    setError("");
    setBusy(false);
  }, [request]);

  async function submit() {
    if (!request || busy || blocked) return;
    if (!reasonValid) {
      setError(billingReversalReasonHint(tx));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch<CancelWithReversalResponse>(
        `/appointments/${request.appointmentId}/status`,
        {
          method: "POST",
          body: JSON.stringify({
            status: "cancelled",
            recurrence_scope: request.recurrenceScope,
            reverse_billing: true,
            billing_reversal_reason: reason.trim(),
          }),
        },
      );
      const creditNotes = (response.billing_reversals ?? []).flatMap(
        (reversal) => reversal.credit_notes ?? [],
      );
      toast.success(
        creditNotes.length > 0
          ? billingReversalSuccessMessage(creditNotes, tx)
          : tx("Термин отменён, начисление сторнировано.", "Termin abgesagt, Abrechnung storniert."),
      );
      const done = request.onDone;
      closeAppointmentBillingReversal();
      done();
    } catch (cause) {
      setError(billingReversalErrorMessage(cause, tx));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      dirty={reason.trim().length > 0 && !busy}
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !busy) closeAppointmentBillingReversal();
      }}
    >
      {request ? (
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {tx("Отменить термин со сторно начисления", "Termin mit Abrechnungsstorno absagen")}
            </DialogTitle>
            <DialogDescription>
              {tx(
                `У термина есть утверждённый отчёт переводчика (${request.interpreterName}, ${request.hours} ч). Отчёт остаётся утверждённым, а его начисление сторнируется вместе с отменой термина.`,
                `Der Termin hat einen freigegebenen Dolmetscherbericht (${request.interpreterName}, ${request.hours} Std.). Der Bericht bleibt freigegeben; seine Abrechnung wird mit der Absage storniert.`,
              )}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {request.lineDescription ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-medium break-words text-foreground">
                {request.lineDescription}
                {request.orderNumber ? ` · ${request.orderNumber}` : ""}
              </p>
            ) : null}
            {preview ? (
              <BillingReversalNotice
                preview={preview}
                canIssueCreditNote={canIssueCreditNote}
                tx={tx}
              />
            ) : (
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-foreground">
                {tx(
                  "Позиция заказа по отчёту ещё не создана: часы не будут выставлены.",
                  "Für den Bericht besteht noch keine Auftragsposition: Die Stunden werden nicht abgerechnet.",
                )}
              </p>
            )}
            <Field label={tx("Причина", "Grund")} htmlFor={reasonId} required>
              <textarea
                id={reasonId}
                className={cn(textareaClass, "min-h-24")}
                value={reason}
                maxLength={BILLING_REVERSAL_REASON_MAX}
                disabled={busy || blocked}
                aria-invalid={Boolean(error) && !reasonValid}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {error ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <p>{error}</p>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={closeAppointmentBillingReversal}
              >
                {tx("Назад", "Zurück")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || blocked || !reasonValid}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {preview?.requires_credit_note
                  ? tx("Выставить кредит-ноту и отменить", "Gutschrift ausstellen und absagen")
                  : tx("Отменить термин", "Termin absagen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
