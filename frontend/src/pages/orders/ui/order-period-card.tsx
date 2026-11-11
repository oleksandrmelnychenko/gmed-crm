import { useState } from "react";
import { CalendarRange, LoaderCircle } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Field } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SectionHeading } from "@/components/ui/section-heading";
import { formatAppDate } from "@/lib/app-time-zone";
import type { Lang } from "@/lib/i18n";
import { LeadConfirmDialog } from "@/pages/leads/ui/lead-confirm-dialog";

import { updateOrderCommercialBasis } from "../data/order-api";
import {
  signedTermsChangeConfirmText,
  withSignedTermsConfirmation,
} from "../model/client-signature";

/** What is wrong with a programme period typed in the dialog, or null. */
export function orderPeriodError(
  period: { date_from: string; date_to: string },
  lang: Lang,
): string | null {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  if (!period.date_from || !period.date_to) {
    return tx("Укажите начало и окончание программы", "Bitte Beginn und Ende des Programms angeben");
  }
  if (period.date_to < period.date_from) {
    return tx("Окончание не может быть раньше начала", "Das Ende darf nicht vor dem Beginn liegen");
  }
  return null;
}

/**
 * The programme period of an order in its workspace. An order made with
 * «Создать заказ» had no period and no place to set it (QA 2026-11-11, F6);
 * an order from a lead gets it in the lead wizard. On an order the client
 * signed the period is a signed term: saving asks to confirm the reset of
 * the signature.
 */
export function OrderPeriodCard({
  order,
  canEdit,
  lang,
  onSaved,
}: {
  order: { id: string; date_from?: string | null; date_to?: string | null };
  /** The order owner, on an order that is still open. */
  canEdit: boolean;
  lang: Lang;
  onSaved: () => void;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const stored = { date_from: order.date_from ?? "", date_to: order.date_to ?? "" };
  const [form, setForm] = useState<{ date_from: string; date_to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signedTermsAsk, setSignedTermsAsk] = useState<{ text: string; resolve: (yes: boolean) => void } | null>(null);

  async function save() {
    if (!form || busy) return;
    const invalid = orderPeriodError(form, lang);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await withSignedTermsConfirmation(
        (confirmSignatureReset) => updateOrderCommercialBasis(order.id, {
          date_from: form.date_from,
          date_to: form.date_to,
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
      data-testid="order-period"
      aria-label={tx("Период программы", "Programmzeitraum")}
    >
      <AdminSectionTitle icon={CalendarRange}>{tx("Период программы", "Programmzeitraum")}</AdminSectionTitle>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] leading-5">
        <p data-testid="order-period-current">
          {stored.date_from || stored.date_to ? (
            <span className="font-medium text-foreground">
              {stored.date_from ? formatAppDate(stored.date_from) : "—"} – {stored.date_to ? formatAppDate(stored.date_to) : "—"}
            </span>
          ) : (
            <span className="text-muted-foreground">{tx("Период не указан", "Zeitraum nicht angegeben")}</span>
          )}
        </p>
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-md"
            data-testid="order-period-edit"
            onClick={() => {
              setError("");
              setForm(stored);
            }}
          >
            {stored.date_from || stored.date_to
              ? tx("Изменить период", "Zeitraum ändern")
              : tx("Указать период", "Zeitraum angeben")}
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
              <DialogTitle><SectionHeading icon={CalendarRange}>{tx("Период программы", "Programmzeitraum")}</SectionHeading></DialogTitle>
            </DialogHeader>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={tx("Начало", "Beginn")}>
                  <Input
                    type="date"
                    data-testid="order-period-from"
                    value={form.date_from}
                    onChange={(event) => setForm((current) => (current ? { ...current, date_from: event.target.value } : current))}
                  />
                </Field>
                <Field label={tx("Окончание", "Ende")}>
                  <Input
                    type="date"
                    data-testid="order-period-to"
                    value={form.date_to}
                    min={form.date_from || undefined}
                    onChange={(event) => setForm((current) => (current ? { ...current, date_to: event.target.value } : current))}
                  />
                </Field>
              </div>
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
              testId="order-period-signed-terms-dialog"
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
