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
import {
  type BillingReversalPreview,
  billingReversalBlockedMessage,
  billingReversalNeedsFinanceRole,
  billingReversalSuccessMessage,
} from "@/lib/billing-reversal";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  cancelOrderLeistung,
  fetchLeistungCancellationPreview,
  type CancelledOrderLeistung,
} from "../data/order-api";
import {
  LEISTUNG_CANCEL_REASON_MAX,
  isStaleLeistungCancelError,
  isValidLeistungCancelReason,
  leistungCancelErrorMessage,
  leistungCancelReasonHint,
} from "../model/leistung-cancellation";

export type CancelLeistungTarget = {
  id: string;
  /** Display name of the service line shown in the confirmation. */
  name: string;
};

type CancelLeistungDialogProps = {
  orderId: string | null;
  /** The service line to cancel; `null` closes the dialog. */
  leistung: CancelLeistungTarget | null;
  lang: Lang;
  onClose: () => void;
  onCancelled: (result: CancelledOrderLeistung) => void;
  /** The line changed on the server (409/404): reload the order. */
  onStale: () => void;
};

/**
 * Confirms cancelling ("Stornieren") an order service line. The line stays on
 * the order with who, when and why, but no longer counts for quotes, invoices
 * or the order completion gate. The dialog first asks the server what the
 * cancellation does: a line on a released invoice is cancelled together with
 * a credit note (amount shown, CEO / billing only), a line on a draft invoice
 * waits until the draft is cancelled (decision 2026-09-29).
 */
export function CancelLeistungDialog({
  orderId,
  leistung,
  lang,
  onClose,
  onCancelled,
  onStale,
}: CancelLeistungDialogProps) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<BillingReversalPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const leistungId = leistung?.id ?? null;

  useEffect(() => {
    setReason("");
    setError("");
    setBusy(false);
    setPreview(null);
    if (!orderId || !leistungId) return;
    let active = true;
    setPreviewLoading(true);
    fetchLeistungCancellationPreview(orderId, leistungId)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((cause) => {
        if (active) setError(leistungCancelErrorMessage(cause, tx));
      })
      .finally(() => {
        if (active) setPreviewLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId, leistungId]);

  const reasonValid = isValidLeistungCancelReason(reason);
  const canIssueCreditNote = preview?.can_issue_credit_note ?? false;
  const blocked = preview
    ? Boolean(billingReversalBlockedMessage(preview, tx)) ||
      billingReversalNeedsFinanceRole(preview, canIssueCreditNote)
    : true;

  async function submit() {
    if (!orderId || !leistung || busy || !preview || blocked) return;
    if (!reasonValid) {
      setError(leistungCancelReasonHint(tx));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await cancelOrderLeistung(
        orderId,
        leistung.id,
        reason.trim(),
        preview.requires_credit_note,
      );
      toast.success(billingReversalSuccessMessage(result.credit_notes ?? [], tx));
      onClose();
      onCancelled(result);
    } catch (cause) {
      setError(leistungCancelErrorMessage(cause, tx));
      if (isStaleLeistungCancelError(cause)) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      dirty={reason.trim().length > 0 && !busy}
      open={leistung !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {leistung ? (
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{tx("Отменить услугу", "Leistung stornieren")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Услуга останется в заказе с отметкой об отмене, но больше не учитывается в предложениях, счетах и при завершении заказа.",
                "Die Leistung bleibt mit Stornovermerk im Auftrag, zählt aber nicht mehr für Angebote, Rechnungen und den Auftragsabschluss.",
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
            <p className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-medium break-words text-foreground">
              {leistung.name}
            </p>
            {previewLoading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {tx("Проверяем счета…", "Rechnungen werden geprüft …")}
              </p>
            ) : preview && preview.status !== "planned" ? (
              <BillingReversalNotice
                preview={preview}
                canIssueCreditNote={canIssueCreditNote}
                tx={tx}
              />
            ) : null}
            <Field label={tx("Причина отмены", "Stornogrund")} htmlFor={reasonId} required>
              <textarea
                id={reasonId}
                className={cn(textareaClass, "min-h-24")}
                value={reason}
                maxLength={LEISTUNG_CANCEL_REASON_MAX}
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
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || blocked || !reasonValid}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {preview?.requires_credit_note
                  ? tx("Выставить кредит-ноту и отменить", "Gutschrift ausstellen und stornieren")
                  : tx("Отменить услугу", "Leistung stornieren")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
