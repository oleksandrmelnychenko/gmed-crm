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
import { Banner, Field, textareaClass } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

import { cancelOrder, fetchOrderCancellationPreview } from "../data/order-cancellation-api";
import {
  ORDER_CANCEL_REASON_MAX,
  isValidOrderCancelReason,
  orderCancellationBalance,
  orderCancellationErrorMessage,
  orderCancellationReasonLabel,
  type OrderCancellationSettlement,
  type OrderCancellationSummary,
} from "../model/order-cancellation";

type Bilingual = (ru: string, de: string) => string;

function bilingual(lang: Lang): Bilingual {
  return (ru, de) => (lang === "de" ? de : ru);
}

/**
 * The amounts that stay on a cancelled order: what accrued (delivered or
 * invoiced services, third-party costs), what was invoiced and paid, and the
 * resulting final step — a final invoice or a refund.
 */
export function OrderCancellationBasis({
  settlement,
  lang,
}: {
  settlement: OrderCancellationSettlement;
  lang: Lang;
}) {
  const tx = bilingual(lang);
  const money = (value: number) => formatMoneyAmount(value, settlement.currency);
  const balance = orderCancellationBalance(settlement);
  const rows: Array<[string, number]> = [
    [tx("Оказано и подлежит оплате", "Erbracht und abzurechnen"), settlement.accrued_gross],
    [tx("Выставлено счетами", "In Rechnung gestellt"), settlement.invoiced_gross],
    [tx("Получено от пациента", "Vom Patienten erhalten"), settlement.paid_gross],
  ];
  return (
    <div className="grid gap-2 text-xs">
      <dl className="grid gap-1.5 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border/70 bg-card px-3 py-2">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
              {money(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="font-medium text-foreground" data-testid="order-cancellation-balance">
        {balance.kind === "to_bill"
          ? tx(
              `К итоговому расчёту: пациент должен ещё ${money(balance.amount)}${settlement.uninvoiced_gross > 0 ? ` (не выставлено счётом: ${money(settlement.uninvoiced_gross)})` : ""}.`,
              `Für die Schlussabrechnung: Der Patient schuldet noch ${money(balance.amount)}${settlement.uninvoiced_gross > 0 ? ` (noch nicht berechnet: ${money(settlement.uninvoiced_gross)})` : ""}.`,
            )
          : balance.kind === "to_refund"
            ? tx(
                `Пациенту к возврату: ${money(balance.amount)}.`,
                `Rückerstattung an den Patienten: ${money(balance.amount)}.`,
              )
            : tx(
                "Расчёты закрыты: оказанное оплачено полностью.",
                "Ausgeglichen: Die erbrachten Leistungen sind vollständig bezahlt.",
              )}
      </p>
      {settlement.lines.length > 0 ? (
        <ul className="grid gap-1">
          {settlement.lines.map((line, index) => (
            <li
              key={`${line.description}-${index}`}
              className="flex min-w-0 items-baseline justify-between gap-3 border-t border-border/50 pt-1"
            >
              <span className="min-w-0 break-words text-muted-foreground">{line.description}</span>
              <span className="shrink-0 font-mono tabular-nums text-foreground">
                {money(line.gross)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Banner of a cancelled order (not a contract termination): reason and billing basis. */
export function OrderCancellationBanner({
  reason,
  cancelledAtLabel,
  settlement,
  lang,
}: {
  reason: string | null;
  cancelledAtLabel: string | null;
  settlement: OrderCancellationSettlement | null;
  lang: Lang;
}) {
  const tx = bilingual(lang);
  return (
    <Banner tone="warning" withIcon>
      <div className="grid gap-2" data-testid="order-cancellation-banner">
        <p className="font-semibold">
          {tx("Заказ отменён", "Auftrag storniert")}
          {cancelledAtLabel ? ` · ${cancelledAtLabel}` : ""}
        </p>
        {reason ? (
          <p className="whitespace-pre-wrap break-words">
            {tx("Причина", "Grund")}: {orderCancellationReasonLabel(reason, lang)}
          </p>
        ) : null}
        <p className="text-xs">
          {tx(
            "Запланированные услуги, предстоящие приёмы и открытые предложения отменены. Оказанные и выставленные позиции остаются основанием для итогового счёта или возврата.",
            "Geplante Leistungen, anstehende Termine und offene Angebote wurden storniert. Erbrachte und berechnete Positionen bleiben die Grundlage für die Schlussrechnung oder eine Rückerstattung.",
          )}
        </p>
        {settlement ? <OrderCancellationBasis settlement={settlement} lang={lang} /> : null}
      </div>
    </Banner>
  );
}

/**
 * Cancels the order with a required reason. Shows first what the cancellation
 * does: planned services, upcoming appointments and open quotes that are
 * cancelled, and what stays as the basis for final billing or a refund.
 */
export function OrderCancellationDialog({
  orderId,
  open,
  lang,
  onClose,
  onCancelled,
}: {
  orderId: string | null;
  open: boolean;
  lang: Lang;
  onClose: () => void;
  onCancelled: (summary: OrderCancellationSummary) => void;
}) {
  const tx = bilingual(lang);
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<OrderCancellationSummary | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !orderId) return;
    let active = true;
    setReason("");
    setError("");
    setPreview(null);
    setPreviewError("");
    fetchOrderCancellationPreview(orderId)
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch((cause: unknown) => {
        if (active) setPreviewError(orderCancellationErrorMessage(cause, bilingual(lang)));
      });
    return () => {
      active = false;
    };
  }, [open, orderId, lang]);

  const reasonValid = isValidOrderCancelReason(reason);

  async function submit() {
    if (!orderId || busy) return;
    if (!reasonValid) {
      setError(
        tx(
          "Укажите причину отмены (от 3 символов).",
          "Bitte einen Stornogrund angeben (mindestens 3 Zeichen).",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const summary = await cancelOrder(orderId, reason.trim());
      toast.success(tx("Заказ отменён.", "Auftrag storniert."));
      onClose();
      onCancelled(summary);
    } catch (cause) {
      setError(orderCancellationErrorMessage(cause, tx));
    } finally {
      setBusy(false);
    }
  }

  const money = (value: number) =>
    formatMoneyAmount(value, preview?.settlement?.currency ?? "EUR");

  return (
    <Dialog
      dirty={reason.trim().length > 0 && !busy}
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      {open ? (
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{tx("Отменить заказ", "Auftrag stornieren")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Отмена закрывает всё, что ещё не выполнено. Оказанные и выставленные позиции остаются и служат основанием для итогового счёта или возврата.",
                "Die Stornierung schließt alles, was noch nicht erbracht ist. Erbrachte und berechnete Positionen bleiben und sind die Grundlage für die Schlussrechnung oder eine Rückerstattung.",
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
            {previewError ? (
              <Banner tone="error" withIcon>
                {previewError}
              </Banner>
            ) : !preview ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {tx("Проверяем, что будет отменено…", "Prüfe, was storniert wird…")}
              </p>
            ) : (
              <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3 text-sm">
                <div className="grid gap-1">
                  <p className="font-medium text-foreground">{tx("Будет отменено", "Wird storniert")}</p>
                  <ul className="grid gap-0.5 text-xs text-muted-foreground" data-testid="order-cancellation-preview">
                    <li>
                      {tx("Запланированные услуги", "Geplante Leistungen")}:{" "}
                      {preview.cancelled_services.length}
                      {preview.cancelled_services.length > 0
                        ? ` · ${money(preview.cancelled_services.reduce((sum, item) => sum + item.gross, 0))}`
                        : ""}
                    </li>
                    {preview.cancelled_services.map((service) => (
                      <li key={service.id} className="pl-3">
                        {service.description} · {money(service.gross)}
                      </li>
                    ))}
                    <li>
                      {tx("Предстоящие приёмы", "Anstehende Termine")}:{" "}
                      {preview.cancelled_appointment_ids.length}
                    </li>
                    <li>
                      {tx("Открытые предложения (сметы)", "Offene Angebote")}:{" "}
                      {preview.closed_quotes.length > 0
                        ? preview.closed_quotes.map((quote) => quote.quote_number).join(", ")
                        : "0"}
                    </li>
                    {preview.rejected_amendment_ids.length > 0 ? (
                      <li>
                        {tx("Изменения суммы на согласовании", "Ausstehende Betragsänderungen")}:{" "}
                        {preview.rejected_amendment_ids.length}
                      </li>
                    ) : null}
                  </ul>
                </div>
                {preview.settlement ? (
                  <div className="grid gap-1">
                    <p className="font-medium text-foreground">
                      {tx("Остаётся основанием для расчёта", "Bleibt Grundlage der Abrechnung")}
                    </p>
                    <OrderCancellationBasis settlement={preview.settlement} lang={lang} />
                  </div>
                ) : null}
              </div>
            )}
            <Field label={tx("Причина отмены", "Stornogrund")} htmlFor={reasonId} required>
              <textarea
                id={reasonId}
                className={cn(textareaClass, "min-h-20")}
                value={reason}
                maxLength={ORDER_CANCEL_REASON_MAX}
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
                {tx("Не отменять", "Nicht stornieren")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || !reasonValid || Boolean(previewError)}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {tx("Отменить заказ", "Auftrag stornieren")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
