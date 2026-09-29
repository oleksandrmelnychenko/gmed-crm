import { useEffect, useId, useMemo, useState } from "react";
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
import {
  BILLING_REVERSAL_REASON_MAX,
  type BillingReversalPreview,
  type IssuedCreditNote,
  billingReversalBlockedMessage,
  billingReversalErrorMessage,
  billingReversalNeedsFinanceRole,
  billingReversalReasonHint,
  billingReversalSuccessMessage,
  isValidBillingReversalReason,
} from "@/lib/billing-reversal";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

import type { ConciergeService } from "./model";

type ReversalOptions = {
  service_id: string;
  billing_status: string;
  can_issue_credit_note: boolean;
  order_lines: BillingReversalPreview[];
};

type ReversedService = ConciergeService & {
  billing_reversal?: { credit_notes?: IssuedCreditNote[] };
};

/** The service was billed outside GMED: only its billing state is reversed. */
const OUTSIDE = "outside";

/**
 * Cancels a billed or settled concierge service with its billing reversed
 * (decision 2026-09-29): staff pick the order line that billed it — it is
 * cancelled, with a credit note when a released invoice bills it (CEO and
 * billing only) — or state that it was billed outside GMED. The service's
 * billing becomes "reversed" and its task is cancelled.
 */
export function ConciergeBillingReversalDialog({
  service,
  lang,
  onClose,
  onReversed,
}: {
  service: ConciergeService | null;
  lang: Lang;
  onClose: () => void;
  onReversed: (service: ConciergeService) => void;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const reasonId = useId();
  const lineGroupId = useId();
  const [options, setOptions] = useState<ReversalOptions | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string>(OUTSIDE);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const serviceId = service?.id ?? null;

  useEffect(() => {
    setOptions(null);
    setSelected(OUTSIDE);
    setReason("");
    setError("");
    setBusy(false);
    if (!serviceId) return;
    let active = true;
    setLoading(true);
    apiFetch<ReversalOptions>(`/concierge-services/${serviceId}/billing-reversal-options`, {
      forceFresh: true,
    })
      .then((value) => {
        if (!active) return;
        setOptions(value);
        const sameOrder = value.order_lines.find((line) => line.same_order && !line.blocked_reason);
        if (sameOrder) setSelected(sameOrder.order_leistung_id);
      })
      .catch((cause) => {
        if (active) setError(billingReversalErrorMessage(cause, tx));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [serviceId]);

  const line = useMemo(
    () => options?.order_lines.find((item) => item.order_leistung_id === selected) ?? null,
    [options, selected],
  );
  const canIssueCreditNote = options?.can_issue_credit_note ?? false;
  const blocked = line
    ? Boolean(billingReversalBlockedMessage(line, tx)) ||
      billingReversalNeedsFinanceRole(line, canIssueCreditNote)
    : false;
  const reasonValid = isValidBillingReversalReason(reason);

  async function submit() {
    if (!service || busy || blocked || !options) return;
    if (!reasonValid) {
      setError(billingReversalReasonHint(tx));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const updated = await apiFetch<ReversedService>(
        `/concierge-services/${service.id}/cancel-with-billing-reversal`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: reason.trim(),
            order_leistung_id: line ? line.order_leistung_id : null,
            issue_credit_note: line?.requires_credit_note ?? false,
          }),
        },
      );
      toast.success(
        line
          ? billingReversalSuccessMessage(updated.billing_reversal?.credit_notes ?? [], tx)
          : tx("Сервис отменён, начисление сторнировано.", "Service storniert, Abrechnung storniert."),
      );
      onClose();
      onReversed(updated);
    } catch (cause) {
      setError(billingReversalErrorMessage(cause, tx));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      dirty={reason.trim().length > 0 && !busy}
      open={service !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {service ? (
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {tx("Отменить сервис со сторно начисления", "Service mit Abrechnungsstorno stornieren")}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "Счёт на сервис уже выставлен. Выберите позицию заказа, по которой он выставлен: она будет отменена (с кредит-нотой, если счёт выпущен). Начисление сервиса получит статус «Сторнировано», задача будет отменена.",
                "Der Service ist bereits abgerechnet. Wählen Sie die Auftragsposition, über die er abgerechnet wurde: Sie wird storniert (mit Gutschrift, wenn die Rechnung ausgestellt ist). Die Abrechnung des Service wird „Storniert“, die Aufgabe wird abgebrochen.",
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
              {service.title}
            </p>
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {tx("Загружаем позиции заказа…", "Auftragspositionen werden geladen …")}
              </p>
            ) : options ? (
              <fieldset className="grid gap-1.5" aria-labelledby={lineGroupId}>
                <legend id={lineGroupId} className="mb-1 text-sm font-medium text-foreground">
                  {tx("Позиция заказа", "Auftragsposition")}
                </legend>
                {options.order_lines.map((item) => (
                  <label
                    key={item.order_leistung_id}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <input
                      type="radio"
                      name={lineGroupId}
                      className="mt-1"
                      checked={selected === item.order_leistung_id}
                      disabled={busy}
                      onChange={() => setSelected(item.order_leistung_id)}
                    />
                    <span className="min-w-0 break-words">
                      {item.description}
                      <span className="block text-xs text-muted-foreground">
                        {[item.order_number, formatMoneyAmount(item.line_gross, item.currency)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </label>
                ))}
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <input
                    type="radio"
                    name={lineGroupId}
                    className="mt-1"
                    checked={selected === OUTSIDE}
                    disabled={busy}
                    onChange={() => setSelected(OUTSIDE)}
                  />
                  <span>
                    {tx(
                      "Выставлено вне GMED — только сторнировать статус начисления",
                      "Außerhalb von GMED abgerechnet – nur den Abrechnungsstatus stornieren",
                    )}
                  </span>
                </label>
              </fieldset>
            ) : null}
            {line ? (
              <BillingReversalNotice preview={line} canIssueCreditNote={canIssueCreditNote} tx={tx} />
            ) : null}
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
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {tx("Назад", "Zurück")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || blocked || !reasonValid || !options}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {line?.requires_credit_note
                  ? tx("Выставить кредит-ноту и отменить", "Gutschrift ausstellen und stornieren")
                  : tx("Отменить сервис", "Service stornieren")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
