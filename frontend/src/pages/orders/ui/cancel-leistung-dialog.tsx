import { useEffect, useId, useState } from "react";
import { LoaderCircle } from "lucide-react";

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
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { cancelOrderLeistung, type CancelledOrderLeistung } from "../data/order-api";
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
  /** The planned service line to cancel; `null` closes the dialog. */
  leistung: CancelLeistungTarget | null;
  lang: Lang;
  onClose: () => void;
  onCancelled: (result: CancelledOrderLeistung) => void;
  /** The line changed on the server (409/404): reload the order. */
  onStale: () => void;
};

/**
 * Confirms cancelling ("Stornieren") a still-planned order service line. The
 * line stays on the order with who, when and why, but no longer counts for
 * quotes, invoices or the order completion gate.
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
  const leistungId = leistung?.id ?? null;

  useEffect(() => {
    setReason("");
    setError("");
    setBusy(false);
  }, [leistungId]);

  const reasonValid = isValidLeistungCancelReason(reason);

  async function submit() {
    if (!orderId || !leistung || busy) return;
    if (!reasonValid) {
      setError(leistungCancelReasonHint(tx));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await cancelOrderLeistung(orderId, leistung.id, reason.trim());
      toast.success(tx("Услуга отменена.", "Leistung storniert."));
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
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>{tx("Отменить услугу", "Leistung stornieren")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Услуга останется в заказе с отметкой об отмене, но больше не учитывается в предложениях, счетах и при завершении заказа. Отменить можно только запланированную услугу.",
                "Die Leistung bleibt mit Stornovermerk im Auftrag, zählt aber nicht mehr für Angebote, Rechnungen und den Auftragsabschluss. Nur geplante Leistungen können storniert werden.",
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
            <Field label={tx("Причина отмены", "Stornogrund")} htmlFor={reasonId} required>
              <textarea
                id={reasonId}
                className={cn(textareaClass, "min-h-24")}
                value={reason}
                maxLength={LEISTUNG_CANCEL_REASON_MAX}
                disabled={busy}
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
              <Button type="submit" variant="destructive" disabled={busy || !reasonValid}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {tx("Отменить услугу", "Leistung stornieren")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
