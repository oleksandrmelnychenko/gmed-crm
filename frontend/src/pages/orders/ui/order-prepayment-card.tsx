import { useState } from "react";
import { LoaderCircle } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner } from "@/components/record-workspace/recipes/banner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAppDate } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { paymentStatusLabel } from "@/lib/payment-status";
import { LeadConfirmDialog } from "@/pages/leads/ui/lead-confirm-dialog";

import { updateOrderCommercialBasis } from "../data/order-api";
import {
  signedTermsChangeConfirmText,
  withSignedTermsConfirmation,
} from "../model/client-signature";
import {
  orderPrepaymentError,
  orderPrepaymentErrorMessage,
  orderPrepaymentTerms,
  orderPrepaymentUpdate,
  type OrderPrepaymentTerms,
} from "../model/order-prepayment";
import { OrderPrepaymentFields } from "./order-prepayment-fields";

/**
 * The required prepayment of an order in its workspace (QA 2026-10-31). When
 * the order total falls below it no new quote can be made, so the card says so
 * and lets the order owner adjust it. On an order the client signed the
 * prepayment is a signed term: saving asks to confirm the reset of the
 * signature.
 */
export function OrderPrepaymentCard({
  order,
  canEdit,
  lang,
  onSaved,
}: {
  order: {
    id: string;
    total_estimated?: unknown;
    currency?: string | null;
    prepayment_required?: boolean;
    prepayment_amount?: unknown;
    prepayment_due_at?: string | null;
    process_gates?: { payment_tracking?: { status: string } | null } | null;
  };
  /** The order owner, on an order that is still open. */
  canEdit: boolean;
  lang: Lang;
  onSaved: () => void;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const formLang = lang === "de" ? "de" : "ru";
  const currency = order.currency || "EUR";
  const stored = orderPrepaymentTerms(order);
  const paymentStatus = order.process_gates?.payment_tracking?.status;
  const total = order.total_estimated == null ? null : Number(order.total_estimated);
  const orderTotal = total !== null && Number.isFinite(total) ? total : null;
  const exceedsTotal = orderPrepaymentError(stored, orderTotal) === "amount_exceeds_total";
  const [form, setForm] = useState<OrderPrepaymentTerms | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signedTermsAsk, setSignedTermsAsk] = useState<{ text: string; resolve: (yes: boolean) => void } | null>(null);

  async function save() {
    if (!form || busy) return;
    const invalid = orderPrepaymentError(form, orderTotal);
    if (invalid) {
      setError(orderPrepaymentErrorMessage(invalid, formLang));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await withSignedTermsConfirmation(
        (confirmSignatureReset) => updateOrderCommercialBasis(order.id, {
          ...orderPrepaymentUpdate(form),
          ...(confirmSignatureReset ? { confirm_signature_reset: true } : {}),
        }),
        (refusal) => new Promise<boolean>((resolve) => setSignedTermsAsk({
          text: signedTermsChangeConfirmText(refusal, null),
          resolve,
        })),
      );
      setForm(null);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="min-w-0 space-y-2 rounded-xl border border-border/50 bg-card p-3"
      data-testid="order-prepayment"
      aria-label={tx("Предоплата", "Vorauszahlung")}
    >
      <AdminSectionTitle>{tx("Предоплата", "Vorauszahlung")}</AdminSectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] leading-5">
        <p data-testid="order-prepayment-current">
          {stored.prepayment_required ? (
            <>
              <span className="font-medium text-foreground">
                {formatMoneyAmount(stored.prepayment_amount, currency)}
              </span>
              {/* After payment the line read as still owed (QA 2026-11-01, U-7). */}
              {paymentStatus === "paid" || paymentStatus === "partially_paid" ? (
                <span className="font-medium text-emerald-700 dark:text-emerald-400" data-testid="order-prepayment-paid">
                  {" · "}
                  {paymentStatusLabel(paymentStatus, formLang)}
                </span>
              ) : null}
              {stored.prepayment_due_at ? (
                <span className="text-muted-foreground">
                  {" · "}
                  {tx("срок", "Frist")} {formatAppDate(stored.prepayment_due_at)}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-muted-foreground">
              {tx("Предоплата не предусмотрена", "Keine Vorauszahlung vorgesehen")}
            </span>
          )}
        </p>
        {exceedsTotal ? (
          <Banner tone="warning" withIcon>
            <span data-testid="order-prepayment-exceeds-total">
              {tx(
                `Предоплата больше суммы заказа (${formatMoneyAmount(orderTotal, currency)}). Новое предложение не создать, пока она не изменена.`,
                `Die Vorauszahlung übersteigt die Auftragssumme (${formatMoneyAmount(orderTotal, currency)}). Ein neues Angebot ist erst möglich, wenn sie angepasst wurde.`,
              )}
            </span>
          </Banner>
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-md"
            data-testid="order-prepayment-edit"
            onClick={() => {
              setError("");
              setForm(stored);
            }}
          >
            {tx("Изменить предоплату", "Vorauszahlung ändern")}
          </Button>
        ) : null}
      </div>
      <Dialog
        open={form !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setForm(null);
        }}
        dirty={!busy && form !== null && JSON.stringify(form) !== JSON.stringify(stored)}
      >
        {form ? (
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>{tx("Изменить предоплату", "Vorauszahlung ändern")}</DialogTitle>
              <DialogDescription>
                {orderTotal !== null
                  ? tx(
                      `Сумма заказа: ${formatMoneyAmount(orderTotal, currency)}.`,
                      `Auftragssumme: ${formatMoneyAmount(orderTotal, currency)}.`,
                    )
                  : null}
              </DialogDescription>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <OrderPrepaymentFields
                value={form}
                lang={formLang}
                onChange={(patch) => setForm((current) => (current ? { ...current, ...patch } : current))}
              />
              {error ? (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  <p>{error}</p>
                </div>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="outline" disabled={busy} onClick={() => setForm(null)}>
                  {tx("Отмена", "Abbrechen")}
                </Button>
                <Button type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {tx("Сохранить", "Speichern")}
                </Button>
              </DialogFooter>
            </form>
            <LeadConfirmDialog
              open={Boolean(signedTermsAsk)}
              testId="order-prepayment-signed-terms-dialog"
              title={tx("Изменить подписанные условия заказа?", "Unterschriebene Auftragsbedingungen ändern?")}
              description={signedTermsAsk?.text}
              confirmLabel={tx("Изменить, подпись сбросится", "Ändern, Unterschrift entfällt")}
              cancelLabel={tx("Отмена", "Abbrechen")}
              destructive
              onConfirm={() => {
                signedTermsAsk?.resolve(true);
                setSignedTermsAsk(null);
              }}
              onCancel={() => {
                signedTermsAsk?.resolve(false);
                setSignedTermsAsk(null);
              }}
            />
          </DialogContent>
        ) : null}
      </Dialog>
    </section>
  );
}
