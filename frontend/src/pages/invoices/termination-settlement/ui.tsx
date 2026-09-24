import { useCallback, useEffect, useId, useState } from "react";
import { CheckCircle2, FilePlus2, LoaderCircle, OctagonAlert } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
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
import { Banner, Field, StatusBadge, textareaClass } from "@/components/ui-shell";
import { ApiRequestError } from "@/lib/api";
import type { Lang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { useCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import {
  createTerminationFinalInvoice,
  fetchOrderTerminationSettlement,
  fetchPatientTerminationSettlements,
  settleTermination,
  type TerminationFigures,
  type TerminationSettlement,
  type TerminationSettlementLine,
} from "./api";
import {
  canCreateFinalInvoice,
  finalInvoiceStatusLabel,
  isValidForceNote,
  FORCE_SETTLE_NOTE_MIN,
  settlementActionErrorMessage,
  settlementBalanceClass,
  settlementBalanceLabel,
  settlementBalanceTone,
  settlementLineStatusLabel,
  settlementStatusLabel,
} from "./model";

function txFor(lang: Lang) {
  return (ru: string, de: string) => (lang === "de" ? de : ru);
}

function formatDate(value: string | null | undefined, lang: Lang) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU");
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn("font-mono text-sm font-semibold tabular-nums", className)}>{value}</p>
    </div>
  );
}

/** Accrued / invoiced / paid / uninvoiced and the balance verdict for one order. */
export function SettlementFigures({
  figures,
  currency,
  lang,
  className,
}: {
  figures: Pick<TerminationFigures, "accrued_gross" | "invoiced_gross" | "paid_gross" | "balance_gross" | "uninvoiced_gross">;
  currency: string;
  lang: Lang;
  className?: string;
}) {
  const tx = txFor(lang);
  const money = (value: unknown) => formatMoneyAmount(value, currency || "EUR");
  return (
    <div className={cn("grid gap-3", className)}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label={tx("Набежало", "Angefallen")} value={money(figures.accrued_gross)} />
        <Figure label={tx("Уже выставлено", "Bereits berechnet")} value={money(figures.invoiced_gross)} />
        <Figure label={tx("Оплачено", "Bezahlt")} value={money(figures.paid_gross)} />
        <Figure label={tx("Не выставлено", "Nicht berechnet")} value={money(figures.uninvoiced_gross)} />
      </div>
      <p className={cn("text-sm font-semibold", settlementBalanceClass(figures.balance_gross))}>
        {settlementBalanceLabel(figures.balance_gross, currency, lang)}
      </p>
    </div>
  );
}

/** Collapsible breakdown of the accrued lines. */
export function SettlementLines({
  lines,
  currency,
  lang,
  title,
}: {
  lines: TerminationSettlementLine[];
  currency: string;
  lang: Lang;
  title?: string;
}) {
  const tx = txFor(lang);
  if (lines.length === 0) return null;
  return (
    <details className="rounded-lg border border-border/60">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground">
        {title ?? tx("Позиции расчёта", "Positionen der Abrechnung")} ({lines.length})
      </summary>
      <ul className="divide-y divide-border/60">
        {lines.map((line, index) => (
          <li
            key={`${line.order_leistung_id ?? line.external_invoice_id ?? "line"}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-sm"
          >
            <span className="min-w-0">
              <span className="block break-words">{line.description}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <StatusBadge tone={line.status === "cancelled" ? "error" : line.due_in_full ? "warning" : "neutral"}>
                  {settlementLineStatusLabel(line, lang)}
                </StatusBadge>
                {line.source === "third_party_cost"
                  ? tx("Внешний расход", "Fremdkosten")
                  : `${line.quantity} × ${formatMoneyAmount(line.unit_price, currency)}`}
              </span>
            </span>
            <span className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums">
              {formatMoneyAmount(line.gross, currency)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Forced close: requires a note because the remaining balance is written off. */
function ForceSettleDialog({
  settlement,
  lang,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  settlement: TerminationSettlement | null;
  lang: Lang;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const tx = txFor(lang);
  const noteId = useId();
  const [note, setNote] = useState("");
  const settlementId = settlement?.id ?? null;
  useEffect(() => setNote(""), [settlementId]);
  const valid = isValidForceNote(note);
  return (
    <Dialog
      open={settlement !== null}
      dirty={note.trim().length > 0 && !busy}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      {settlement ? (
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{tx("Закрыть расчёт с остатком", "Abrechnung mit Restbetrag schließen")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Расчёт ещё не сведён. Принудительное закрытие списывает остаток: пациенту больше не будет выставлено и не будет возвращено ничего по этому заказу.",
                "Die Abrechnung ist noch nicht ausgeglichen. Beim erzwungenen Schließen wird der Restbetrag ausgebucht: für diesen Auftrag wird nichts mehr berechnet oder erstattet.",
              )}
            </DialogDescription>
          </DialogHeader>
          <SettlementFigures figures={settlement.current} currency={settlement.currency} lang={lang} />
          <Field label={tx("Причина списания", "Grund der Ausbuchung")} htmlFor={noteId} required>
            <textarea
              id={noteId}
              className={cn(textareaClass, "min-h-20")}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          {!valid && note.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {tx(`Минимум ${FORCE_SETTLE_NOTE_MIN} символа.`, `Mindestens ${FORCE_SETTLE_NOTE_MIN} Zeichen.`)}
            </p>
          ) : null}
          {error ? <Banner tone="error">{error}</Banner> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-action="write"
              disabled={busy || !valid}
              onClick={() => onConfirm(note.trim())}
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {tx("Списать и закрыть", "Ausbuchen und schließen")}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/**
 * Billing actions on a termination settlement: draft the final invoice for the
 * uninvoiced accrued amount, and close the settlement (forced close = write-off).
 */
export function SettlementActions({
  settlement,
  lang,
  onChanged,
  onInvoiceCreated,
  size = "sm",
}: {
  settlement: TerminationSettlement;
  lang: Lang;
  onChanged: () => void;
  onInvoiceCreated?: (invoiceId: string) => void;
  size?: "sm" | "xs";
}) {
  const tx = txFor(lang);
  const canCreate = useCan("invoices.create");
  const canFinance = useCan("invoices.finance");
  const [busy, setBusy] = useState<"invoice" | "settle" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceTarget, setForceTarget] = useState<TerminationSettlement | null>(null);

  if (settlement.status !== "open" || (!canCreate && !canFinance)) return null;

  async function createInvoice() {
    setBusy("invoice");
    setError(null);
    try {
      const invoice = await createTerminationFinalInvoice(settlement.order_id);
      toast.success(
        invoice.idempotent_replay
          ? tx(`Черновик ${invoice.invoice_number} уже существует.`, `Entwurf ${invoice.invoice_number} existiert bereits.`)
          : tx(`Черновик финального счёта ${invoice.invoice_number} создан.`, `Entwurf der Schlussrechnung ${invoice.invoice_number} erstellt.`),
      );
      onChanged();
      onInvoiceCreated?.(invoice.id);
    } catch (cause) {
      setError(settlementActionErrorMessage(cause, lang, tx("Не удалось создать финальный счёт.", "Schlussrechnung konnte nicht erstellt werden.")));
    } finally {
      setBusy(null);
    }
  }

  async function settle(force: boolean, note?: string) {
    setBusy("settle");
    setError(null);
    try {
      await settleTermination(settlement.order_id, force ? { force: true, note } : note ? { note } : {});
      toast.success(tx("Расчёт закрыт.", "Abrechnung geschlossen."));
      setForceTarget(null);
      onChanged();
    } catch (cause) {
      const notBalanced =
        cause instanceof ApiRequestError && cause.body?.error === "termination_settlement_not_balanced";
      if (!force && notBalanced) {
        setForceTarget(settlement);
      } else {
        setError(settlementActionErrorMessage(cause, lang, tx("Не удалось закрыть расчёт.", "Abrechnung konnte nicht geschlossen werden.")));
      }
    } finally {
      setBusy(null);
    }
  }

  const invoiceAllowed = canCreateFinalInvoice(settlement);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {canCreate ? (
          <Button
            type="button"
            size={size}
            variant="outline"
            data-action="write"
            disabled={busy !== null || !invoiceAllowed}
            title={invoiceAllowed ? undefined : tx("Нет невыставленной суммы.", "Kein nicht berechneter Betrag.")}
            onClick={() => void createInvoice()}
          >
            {busy === "invoice" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FilePlus2 className="size-3.5" />}
            {tx("Создать финальный счёт", "Schlussrechnung erstellen")}
          </Button>
        ) : null}
        {canFinance ? (
          <Button
            type="button"
            size={size}
            variant="outline"
            data-action="write"
            disabled={busy !== null}
            onClick={() => (settlement.can_settle ? void settle(false) : setForceTarget(settlement))}
          >
            {busy === "settle" && !forceTarget ? <LoaderCircle className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            {tx("Закрыть расчёт", "Abrechnung schließen")}
          </Button>
        ) : null}
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      <ForceSettleDialog
        settlement={forceTarget}
        lang={lang}
        busy={busy === "settle"}
        error={forceTarget ? error : null}
        onCancel={() => {
          setForceTarget(null);
          setError(null);
        }}
        onConfirm={(note) => void settle(true, note)}
      />
    </div>
  );
}

export function FinalInvoiceLink({
  invoice,
  currency,
  lang,
}: {
  invoice: TerminationSettlement["final_invoice"];
  currency: string;
  lang: Lang;
}) {
  if (!invoice) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <StaffLink
        className="font-mono text-xs font-semibold text-primary hover:underline"
        to={`/invoices?invoice=${encodeURIComponent(invoice.id)}`}
      >
        {invoice.invoice_number}
      </StaffLink>
      <StatusBadge status={invoice.status}>{finalInvoiceStatusLabel(invoice.status, lang)}</StatusBadge>
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatMoneyAmount(invoice.total_gross, currency)}
      </span>
    </span>
  );
}

/** Hint shown next to billing actions: advances are not applied automatically. */
export function AdvancePaymentHint({ lang }: { lang: Lang }) {
  const tx = txFor(lang);
  return (
    <p className="text-xs leading-5 text-muted-foreground">
      {tx(
        "Предоплаты не зачитываются автоматически: выпустите черновик финального счёта и зачтите аванс в самом счёте («Зачесть предоплату»). При переплате оформите кредит-ноту и возврат в счёте.",
        "Vorauszahlungen werden nicht automatisch angerechnet: Schlussrechnungsentwurf freigeben und die Vorauszahlung in der Rechnung anrechnen („Vorauszahlung anrechnen“). Bei Überzahlung Gutschrift und Erstattung in der Rechnung erfassen.",
      )}
    </p>
  );
}

/** One settlement as a card: figures, lines, final invoice and billing actions. */
export function TerminationSettlementCard({
  settlement,
  lang,
  onChanged,
}: {
  settlement: TerminationSettlement;
  lang: Lang;
  onChanged: () => void;
}) {
  const tx = txFor(lang);
  return (
    <section
      className="grid gap-3 rounded-xl border border-border/70 bg-card p-4 shadow-sm"
      data-testid="termination-settlement-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <OctagonAlert className="size-4 text-rose-600" aria-hidden />
            {tx("Расчёт при расторжении договора", "Abrechnung bei Vertragskündigung")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {tx("Заказ", "Auftrag")}{" "}
            <StaffLink className="font-mono hover:underline" to={`/orders/${encodeURIComponent(settlement.order_id)}`}>
              {settlement.order_number}
            </StaffLink>
            {" · "}
            {tx("договор", "Vertrag")} <span className="font-mono">{settlement.contract_number}</span>
            {" · "}
            {tx("расторгнут", "gekündigt")} {formatDate(settlement.terminated_at, lang)}
          </p>
        </div>
        <StatusBadge tone={settlement.status === "open" ? "warning" : "success"}>
          {settlementStatusLabel(settlement.status, lang)}
        </StatusBadge>
      </div>
      <SettlementFigures figures={settlement.current} currency={settlement.currency} lang={lang} />
      {settlement.current.warnings.length > 0 ? (
        <Banner tone="warning">
          <ul className="list-disc pl-4">
            {settlement.current.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
      <SettlementLines lines={settlement.lines} currency={settlement.currency} lang={lang} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-muted-foreground">{tx("Финальный счёт", "Schlussrechnung")}:</span>
        <FinalInvoiceLink invoice={settlement.final_invoice} currency={settlement.currency} lang={lang} />
      </div>
      {settlement.status === "settled" ? (
        <p className="text-xs text-muted-foreground">
          {tx("Закрыт", "Geschlossen")} {formatDate(settlement.settled_at, lang)}
          {settlement.settled_by_name ? ` · ${settlement.settled_by_name}` : ""}
          {settlement.settlement_forced && settlement.settled_balance_gross
            && settlementBalanceTone(settlement.settled_balance_gross) !== "even"
            ?` · ${tx("списано", "ausgebucht")} ${formatMoneyAmount(settlement.settled_balance_gross, settlement.currency)}`
            : ""}
          {settlement.settlement_note ? ` · ${settlement.settlement_note}` : ""}
        </p>
      ) : (
        <>
          <SettlementActions settlement={settlement} lang={lang} onChanged={onChanged} />
          <AdvancePaymentHint lang={lang} />
        </>
      )}
    </section>
  );
}

/** Patient billing area: every termination settlement of the patient (hidden when none). */
export function PatientTerminationSettlements({ patientId, lang }: { patientId: string; lang: Lang }) {
  const canView = useCan("invoices.view");
  const [settlements, setSettlements] = useState<TerminationSettlement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!canView) return;
    let active = true;
    fetchPatientTerminationSettlements(patientId)
      .then((rows) => {
        if (!active) return;
        setSettlements(rows);
        setError(null);
      })
      .catch(() => {
        if (active) {
          setError(lang === "de"
            ? "Abrechnungen bei Kündigung konnten nicht geladen werden."
            : "Не удалось загрузить расчёты при расторжении.");
        }
      });
    return () => {
      active = false;
    };
  }, [canView, lang, patientId, revision]);

  if (!canView) return null;
  if (error) return <Banner tone="error">{error}</Banner>;
  if (settlements.length === 0) return null;
  return (
    <div className="grid gap-3" data-testid="patient-termination-settlements">
      {settlements.map((settlement) => (
        <TerminationSettlementCard key={settlement.id} settlement={settlement} lang={lang} onChanged={reload} />
      ))}
    </div>
  );
}

/** Order page banner for orders stopped by a framework-contract termination. */
export function OrderTerminationBanner({
  orderId,
  patientId,
  lang,
}: {
  orderId: string;
  patientId: string | null;
  lang: Lang;
}) {
  const tx = txFor(lang);
  const canViewOrders = useCan("orders.view");
  const canViewInvoices = useCan("invoices.view");
  const canLoad = canViewOrders || canViewInvoices;
  const [settlement, setSettlement] = useState<TerminationSettlement | null>(null);

  useEffect(() => {
    if (!canLoad) return;
    let active = true;
    setSettlement(null);
    fetchOrderTerminationSettlement(orderId)
      .then((row) => {
        if (active) setSettlement(row);
      })
      .catch(() => {
        // 404 = no settlement stored; the banner still explains the stop.
      });
    return () => {
      active = false;
    };
  }, [canLoad, orderId]);

  return (
    <div
      role="status"
      className="grid gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-900"
      data-testid="order-termination-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-semibold">
          <OctagonAlert className="size-4 shrink-0" aria-hidden />
          {tx("Заказ остановлен из-за расторжения договора", "Auftrag wegen Vertragskündigung gestoppt")}
        </p>
        {settlement ? (
          <StatusBadge tone={settlement.status === "open" ? "warning" : "success"}>
            {settlementStatusLabel(settlement.status, lang)}
          </StatusBadge>
        ) : null}
      </div>
      {settlement ? (
        <SettlementFigures
          figures={settlement.current}
          currency={settlement.currency}
          lang={lang}
          className="text-foreground"
        />
      ) : null}
      {patientId && canViewInvoices ? (
        <StaffLink
          className="w-fit text-sm font-medium text-primary hover:underline"
          to={`/patients/${encodeURIComponent(patientId)}?tab=billing`}
        >
          {tx("Открыть расчёт в карточке пациента", "Abrechnung in der Patientenakte öffnen")}
        </StaffLink>
      ) : null}
    </div>
  );
}
