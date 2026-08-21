import { startTransition, useEffect, useMemo, useReducer, useState, type FormEvent } from "react";
import { Download, LoaderCircle, RefreshCw, Upload } from "lucide-react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  InfoRow,
  inputClass,
  ListItem,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { agencyServiceNameLabel } from "@/lib/agency-service-labels";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  fetchPortalAccountStatement,
  fetchPortalInvoiceDetail,
  fetchPortalInvoiceCreditNotes,
  fetchPortalInvoicePayments,
  fetchPortalInvoiceRefunds,
  fetchPortalInvoices,
  uploadPortalPaymentProof,
} from "@/pages/patients/data/portal-api";
import {
  formatPortalCurrency,
  formatPortalDate,
  formatPortalDateTime,
  invoiceTypeLabel,
  downloadPortalInvoicePdf,
  openPortalInvoicePdf,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type {
  PortalAccountStatement,
  PortalInvoiceItem,
  PortalInvoiceCreditNoteTransaction,
  PortalInvoiceLineItem,
  PortalInvoicePaymentTransaction,
  PortalInvoiceRefundTransaction,
} from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

function invoiceAmountsVisible(invoice: PortalInvoiceItem) {
  return invoice.portal_visibility?.amounts_visible_to_patient ?? true;
}

function invoicePdfVisible(invoice: PortalInvoiceItem) {
  return invoice.portal_visibility?.pdf_visible_to_patient ?? true;
}

function invoiceTypeBadgeTone(invoiceType: string): StatusTone {
  if (invoiceType === "advance") return "brand";
  if (invoiceType === "interim") return "info";
  if (invoiceType === "final") return "success";
  return "neutral";
}

function portalPaymentMethodLabel(method: string, lang: string) {
  const labels: Record<string, [string, string]> = {
    bank_transfer: ["Überweisung", "Банковский перевод"],
    card: ["Karte", "Карта"],
    cash: ["Bar", "Наличные"],
    direct_debit: ["Lastschrift", "Прямое списание"],
    cheque: ["Scheck", "Чек"],
    other: ["Sonstige", "Другое"],
    legacy_import: ["Übernommener Bestand", "Перенесённый остаток"],
  };
  const label = labels[method];
  if (!label) return method;
  return lang === "de" ? label[0] : label[1];
}

function portalAccountStateLabel(state: string, lang: string) {
  const labels: Record<string, [string, string]> = {
    paid: ["Bezahlt", "Оплачено"],
    partially_paid: ["Teilbezahlt – Rest offen", "Частично оплачено — требуется доплата"],
    unpaid: ["Nicht bezahlt", "Не оплачено"],
    amount_hidden: ["Betrag nicht freigegeben", "Сумма не открыта для просмотра"],
    invoice_adjustment: ["Rechnung korrigiert", "Счёт скорректирован"],
  };
  const label = labels[state];
  return label ? (lang === "de" ? label[0] : label[1]) : state;
}

const PORTAL_INVOICE_REALTIME_EVENTS = [
  "invoice.created",
  "invoice.status_changed",
  "invoice.payment_recorded",
  "invoice.payment_reversed",
  "invoice.credit_note_created",
  "invoice.credit_note_reversed",
  "invoice.refund_recorded",
  "invoice.refund_reversed",
  "invoice.dunning_created",
  "invoice.overdue_marked",
  "document.payment_proof_uploaded",
] as const;

function formatPortalCountLabel(template: string, count: number) {
  return template.replace("{count}", String(count));
}

interface PatientInvoicesState {
  invoices: PortalInvoiceItem[];
  accountStatement: PortalAccountStatement | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  notice: string;
  version: number;
  selectedInvoiceId: string;
  detail: PortalInvoiceItem | null;
  detailPayments: PortalInvoicePaymentTransaction[];
  detailCreditNotes: PortalInvoiceCreditNoteTransaction[];
  detailRefunds: PortalInvoiceRefundTransaction[];
  detailBusy: boolean;
  detailError: string;
  uploadOpen: boolean;
  uploadBusy: boolean;
  uploadError: string;
  uploadNote: string;
  uploadFile: File | null;
}

type PatientInvoicesAction =
  | Partial<PatientInvoicesState>
  | ((current: PatientInvoicesState) => Partial<PatientInvoicesState>);

const INITIAL_PATIENT_INVOICES_STATE: PatientInvoicesState = {
  invoices: [],
  accountStatement: null,
  loading: true,
  refreshing: false,
  error: "",
  notice: "",
  version: 0,
  selectedInvoiceId: "",
  detail: null,
  detailPayments: [],
  detailCreditNotes: [],
  detailRefunds: [],
  detailBusy: false,
  detailError: "",
  uploadOpen: false,
  uploadBusy: false,
  uploadError: "",
  uploadNote: "",
  uploadFile: null,
};

function patientInvoicesReducer(
  current: PatientInvoicesState,
  action: PatientInvoicesAction,
): PatientInvoicesState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function usePatientInvoicesPageContent() {
  const { t, lang } = useLang();
  const [accountStatementCurrency, setAccountStatementCurrency] = useState("");
  const [invoicesState, dispatchInvoicesState] = useReducer(
    patientInvoicesReducer,
    INITIAL_PATIENT_INVOICES_STATE,
  );
  const {
    accountStatement,
    detail,
    detailPayments,
    detailCreditNotes,
    detailRefunds,
    detailBusy,
    detailError,
    error,
    invoices,
    loading,
    notice,
    refreshing,
    selectedInvoiceId,
    uploadBusy,
    uploadError,
    uploadFile,
    uploadNote,
    uploadOpen,
    version,
  } = invoicesState;
  useRealtimeSubscription(PORTAL_INVOICE_REALTIME_EVENTS, (event) => {
    clearApiCache("/me/invoices");
    clearApiCache("/me/account-statement");
    if (event.entity_type === "invoice") {
      clearApiCache(`/me/invoices/${event.entity_id}`);
      clearApiCache(`/me/invoices/${event.entity_id}/payments`);
      clearApiCache(`/me/invoices/${event.entity_id}/credit-notes`);
      clearApiCache(`/me/invoices/${event.entity_id}/refunds`);
    }
    if (selectedInvoiceId) {
      clearApiCache(`/me/invoices/${selectedInvoiceId}`);
      clearApiCache(`/me/invoices/${selectedInvoiceId}/payments`);
      clearApiCache(`/me/invoices/${selectedInvoiceId}/credit-notes`);
      clearApiCache(`/me/invoices/${selectedInvoiceId}/refunds`);
    }
    dispatchInvoicesState((current) => ({ version: current.version + 1 }));
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      dispatchInvoicesState((current) => ({
        refreshing: !current.loading,
        error: "",
      }));

      try {
        const [rows, statement] = await Promise.all([
          fetchPortalInvoices(),
          fetchPortalAccountStatement(accountStatementCurrency || undefined).catch(() => null),
        ]);
        if (cancelled) return;
        startTransition(() => {
          if (statement && !accountStatementCurrency) {
            setAccountStatementCurrency(statement.currency);
          }
          dispatchInvoicesState((current) => ({
            invoices: rows,
            accountStatement: statement,
            error: "",
            selectedInvoiceId:
              current.selectedInvoiceId &&
              rows.some((item) => item.id === current.selectedInvoiceId)
                ? current.selectedInvoiceId
                : "",
            loading: false,
            refreshing: false,
          }));
        });
      } catch (err) {
        if (cancelled) return;
        dispatchInvoicesState({
          error: err instanceof Error ? err.message : t.portal_invoices_failed_to_load_invoices,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [accountStatementCurrency, t.portal_invoices_failed_to_load_invoices, version]);

  useEffect(() => {
    if (!selectedInvoiceId) {
      dispatchInvoicesState({ detail: null, detailPayments: [], detailCreditNotes: [], detailRefunds: [], detailError: "" });
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      dispatchInvoicesState({ detailBusy: true });
      try {
        const invoice = await fetchPortalInvoiceDetail(selectedInvoiceId);
        const [payments, creditNotes, refunds] = await Promise.all([
          invoiceAmountsVisible(invoice)
            ? fetchPortalInvoicePayments(selectedInvoiceId).then((response) => response.items)
            : Promise.resolve([]),
          fetchPortalInvoiceCreditNotes(selectedInvoiceId).then((response) => response.items),
          invoiceAmountsVisible(invoice)
            ? fetchPortalInvoiceRefunds(selectedInvoiceId).then((response) => response.items)
            : Promise.resolve([]),
        ]);
        if (cancelled) return;
        dispatchInvoicesState({
          detail: invoice,
          detailPayments: payments,
          detailCreditNotes: creditNotes,
          detailRefunds: refunds,
          detailError: "",
          detailBusy: false,
        });
      } catch (err) {
        if (cancelled) return;
        dispatchInvoicesState({
          detailError: err instanceof Error ? err.message : t.portal_invoices_failed_to_load_invoice_detail,
          detailBusy: false,
        });
      }
    }

    void loadDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedInvoiceId, t.portal_invoices_failed_to_load_invoice_detail, version]);

  const totalBalance = useMemo(
    () =>
      invoices.reduce(
        (sum, item) =>
          invoiceAmountsVisible(item) ? sum + Number(item.balance_due ?? 0) : sum,
        0,
      ),
    [invoices],
  );
  const hiddenAmountCount = useMemo(
    () => invoices.filter((item) => !invoiceAmountsVisible(item)).length,
    [invoices],
  );
  const overdueCount = useMemo(
    () => invoices.filter((item) => item.status === "overdue").length,
    [invoices],
  );
  const proofPendingCount = useMemo(
    () =>
      invoices.filter(
        (item) =>
          !["paid", "cancelled"].includes(item.status) &&
          !item.last_payment_proof_at,
      ).length,
    [invoices],
  );

  async function handlePaymentProofUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    if (!uploadFile) {
      dispatchInvoicesState({ uploadError: t.portal_invoices_choose_a_file_first });
      return;
    }

    dispatchInvoicesState({ uploadBusy: true, uploadError: "", notice: "" });

    try {
      const formData = new FormData();
      formData.set("file", uploadFile);
      formData.set("order_id", detail.order_id);
      formData.set("upload_kind", "payment_proof");
      formData.set(
        "auto_name",
        `${t.portal_invoices_payment_proof} ${detail.invoice_number}`,
      );
      if (uploadNote.trim()) {
        formData.set("notes", uploadNote.trim());
      }

      await uploadPortalPaymentProof(formData);
      dispatchInvoicesState((current) => ({
        notice: t.portal_invoices_payment_proof_uploaded_for_the_billing_team,
        uploadOpen: false,
        uploadFile: null,
        uploadNote: "",
        uploadBusy: false,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchInvoicesState({
        uploadError: err instanceof Error ? err.message : t.portal_invoices_failed_to_upload_payment_proof,
        uploadBusy: false,
      });
    }
  }

  if (loading) {
    return (
      <div className="min-h-[320px]">
        <TabLoader />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t.portal_invoices_my_invoices}
        description={t.portal_invoices_review_released_invoice_snapshots_track_payment_state_and_upload}
        actions={
          <>
            <CountBadge>{t.portal_invoices_patient_portal}</CountBadge>
            <a href="/documents">
              <Button variant="outline" className={tokens.control.primaryButton}>
                <Upload className="size-4" />
                {t.portal_invoices_open_documents}
              </Button>
            </a>
            <Button
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => dispatchInvoicesState((current) => ({ version: current.version + 1 }))}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t.portal_invoices_refresh}
            </Button>
          </>
        }
      />
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={t.portal_invoices_visible_invoices} value={String(invoices.length)} />
        <StatCard label={t.portal_invoices_outstanding_balance} value={hiddenAmountCount > 0 ? t.portal_invoices_partly_hidden : formatPortalCurrency(totalBalance)} />
        <StatCard label={t.portal_invoices_missing_payment_proof} value={String(proofPendingCount)} description={formatPortalCountLabel(t.portal_invoices_overdue_count, overdueCount)} />
      </section>

      {accountStatement ? (
        <Section
          title={lang === "de" ? "Meine Zahlungen und offenen Beträge" : "Мои оплаты и суммы к доплате"}
          accessory={
            <div className="flex items-center gap-2">
              {accountStatement.available_currencies.length > 1 ? (
                <select
                  aria-label={lang === "de" ? "Währung" : "Валюта"}
                  className={cn(inputClass, "h-8 w-[88px] py-1 text-xs")}
                  value={accountStatement.currency}
                  onChange={(event) => setAccountStatementCurrency(event.target.value)}
                >
                  {accountStatement.available_currencies.map((currency) => (
                    <option key={currency} value={currency}>{currency}</option>
                  ))}
                </select>
              ) : null}
              <CountBadge>{accountStatement.items.length}</CountBadge>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <InfoRow
              className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
              label={lang === "de" ? "Kontosaldo" : "Сальдо взаиморасчётов"}
              value={
                accountStatement.summary.closing_balance == null
                  ? lang === "de" ? "Abstimmung erforderlich" : "Требуется сверка"
                  : Number(accountStatement.summary.closing_balance) > 0
                    ? `${formatPortalCurrency(accountStatement.summary.closing_balance, accountStatement.currency)} ${lang === "de" ? "offener Betrag" : "долг"}`
                    : Number(accountStatement.summary.closing_balance) < 0
                      ? `${formatPortalCurrency(Math.abs(Number(accountStatement.summary.closing_balance)), accountStatement.currency)} ${lang === "de" ? "Guthaben" : "переплата"}`
                      : formatPortalCurrency(0, accountStatement.currency)
              }
            />
            {[
              [lang === "de" ? "Rechnungen gesamt" : "Всего по счетам", accountStatement.summary.invoiced_gross],
              [lang === "de" ? "Bezahlt" : "Оплачено", accountStatement.summary.cash_paid],
              [lang === "de" ? "Vorauszahlung verrechnet" : "Зачтено предоплат", accountStatement.summary.prepayment_applied],
              [lang === "de" ? "Vorauszahlung verfügbar" : "Доступно предоплаты", accountStatement.summary.available_prepayment],
              [lang === "de" ? "Noch zu zahlen" : "Требуется доплатить", accountStatement.summary.total_due],
            ].map(([label, value]) => (
              <InfoRow
                key={label}
                className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                label={label}
                value={value == null ? (lang === "de" ? "Teilweise ausgeblendet" : "Часть данных скрыта") : formatPortalCurrency(value, accountStatement.currency)}
              />
            ))}
          </div>
          {!accountStatement.amounts_complete ? (
            <div className="mt-4">
              <Banner tone="warning">
                {lang === "de"
                  ? "Die Summe ist nicht vollständig: ausgeblendete Rechnungsbeträge und interne Anbieterbelege werden hier nicht offengelegt. Verbindlich sind die für Sie freigegebenen Rechnungen."
                  : "Итог может быть неполным: скрытые суммы счетов и внутренние документы поставщиков здесь не раскрываются. Обязательными являются доступные вам счета."}
              </Banner>
            </div>
          ) : null}
          <p className="mt-4 text-sm text-muted-foreground">
            {lang === "de"
              ? "„Bezahlt“ sind eingegangene Zahlungen. „Vorauszahlung verrechnet“ wurde bereits einer Rechnung zugeordnet. „Noch zu zahlen“ ist der verbleibende Betrag der sichtbaren Rechnungen."
              : "«Оплачено» — поступившие платежи. «Зачтено предоплат» — сумма, уже применённая к счетам. «Требуется доплатить» — остаток по доступным вам счетам."}
          </p>
          {accountStatement.movements.some((movement) =>
            movement.kind === "balance_adjustment" ||
            movement.kind === "balance_adjustment_reversal"
          ) ? (
            <div className="mt-4 space-y-2">
              <div className={tokens.text.eyebrow}>
                {lang === "de" ? "Weitere Kontokorrekturen" : "Дополнительные корректировки"}
              </div>
              {accountStatement.movements
                .filter((movement) =>
                  movement.kind === "balance_adjustment" ||
                  movement.kind === "balance_adjustment_reversal"
                )
                .map((movement) => (
                  <ListItem key={movement.id} className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">
                        {movement.kind === "balance_adjustment_reversal"
                          ? lang === "de" ? "Korrektur storniert" : "Сторно корректировки"
                          : lang === "de" ? "Kontokorrektur" : "Корректировка счёта"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatPortalDate(movement.entry_date)} · {movement.description}
                      </div>
                    </div>
                    <div className="font-mono text-sm font-semibold tabular-nums text-foreground">
                      {movement.direction === "debit" ? "+" : "−"}
                      {formatPortalCurrency(
                        movement.direction === "debit" ? movement.debit : movement.credit,
                        movement.currency,
                      )}
                    </div>
                  </ListItem>
                ))}
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            {accountStatement.items.map((item) => {
              const isCreditAdjustment = item.kind === "credit_note" || item.kind === "credit_note_reversal";
              return (
              <ListItem key={`${item.kind}:${item.id}`} className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className={tokens.text.eyebrow}>
                      {isCreditAdjustment
                        ? item.kind === "credit_note"
                          ? lang === "de" ? "Gutschrift" : "Кредит-нота"
                          : lang === "de" ? "Gutschrift storniert" : "Отмена кредит-ноты"
                        : item.kind === "prepayment"
                        ? lang === "de" ? "Vorauszahlung" : "Предоплата"
                        : lang === "de" ? "Rechnung" : "Счёт"}
                      {item.document_number ? ` · ${item.document_number}` : ""}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">
                      {item.order_number ?? item.description}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {formatPortalDate(item.entry_date)}
                    </div>
                  </div>
                  <StatusBadge
                    tone={item.payment_state === "paid" ? "success" : item.payment_state === "partially_paid" ? "warning" : "neutral"}
                  >
                    {portalAccountStateLabel(item.payment_state, lang)}
                  </StatusBadge>
                </div>
                <div className={cn("grid gap-3", !isCreditAdjustment && "sm:grid-cols-3")}>
                  <InfoRow
                    className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                    label={lang === "de" ? "Gesamt" : "Всего"}
                    value={item.amounts_visible && item.amount_gross != null ? formatPortalCurrency(item.amount_gross, accountStatement.currency) : t.portal_invoices_hidden}
                  />
                  {!isCreditAdjustment ? <InfoRow
                    className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                    label={lang === "de" ? "Bezahlt / verrechnet" : "Оплачено / зачтено"}
                    value={item.amounts_visible ? formatPortalCurrency(Number(item.cash_paid ?? 0) + Number(item.prepayment_applied ?? 0), accountStatement.currency) : t.portal_invoices_hidden}
                  /> : null}
                  {!isCreditAdjustment ? <InfoRow
                    className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                    label={item.kind === "prepayment" ? (lang === "de" ? "Noch verfügbar" : "Ещё доступно") : (lang === "de" ? "Noch zu zahlen" : "Требуется доплатить")}
                    value={item.amounts_visible ? formatPortalCurrency(item.kind === "prepayment" ? item.prepayment_available : item.amount_due, accountStatement.currency) : t.portal_invoices_hidden}
                  /> : null}
                </div>
              </ListItem>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section title={t.portal_invoices_my_invoices} accessory={<CountBadge>{invoices.length}</CountBadge>}>
        {invoices.length === 0 ? (
          <EmptyCell>
            <p className="text-base font-semibold text-foreground">{t.portal_invoices_no_invoices_released_yet}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {t.portal_invoices_billing_snapshots_will_appear_here_once_they_are_available_for_p}
            </p>
          </EmptyCell>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {invoices.map((invoice) => {
              const amountsVisible = invoiceAmountsVisible(invoice);
              const balanceDue = Number(invoice.balance_due ?? 0);

              return (
                <ListItem
                  key={invoice.id}
                  onClick={() => dispatchInvoicesState({ selectedInvoiceId: invoice.id })}
                  className={cn(
                    "space-y-4",
                    selectedInvoiceId === invoice.id && "border-primary/60 bg-primary/5 ring-2 ring-primary/15",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className={tokens.text.eyebrow}>{invoice.invoice_number}</div>
                      <h2 className="mt-2 text-base font-semibold text-foreground">{invoice.order_number}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t.portal_invoices_issued} {formatPortalDateTime(invoice.issued_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={invoice.status}>
                        {portalStatusLabel(invoice.status)}
                      </StatusBadge>
                      <StatusBadge tone={invoiceTypeBadgeTone(invoice.invoice_type)}>
                        {invoiceTypeLabel(invoice.invoice_type)}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_total}
                      value={amountsVisible ? formatPortalCurrency(invoice.total_gross) : t.portal_invoices_hidden}
                    />
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_open}
                      value={amountsVisible ? formatPortalCurrency(balanceDue) : t.portal_invoices_hidden}
                    />
                    <InfoRow
                      className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_payment_proof}
                      value={invoice.last_payment_proof_at ? `${t.portal_invoices_uploaded} ${formatPortalDate(invoice.last_payment_proof_at)}` : t.portal_invoices_not_uploaded}
                    />
                  </div>
                </ListItem>
              );
            })}
          </div>
        )}
      </Section>

      <Sheet open={Boolean(selectedInvoiceId)} onOpenChange={(open) => { if (!open) dispatchInvoicesState({ selectedInvoiceId: "" }); }}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-3xl">
          <AdminSheetScaffold
            title={detail ? detail.invoice_number : t.portal_invoices_invoice_detail}
            description={t.portal_invoices_commercial_totals_line_items_and_payment_proof_handoff_for_the_s}
            headerClassName="px-4 py-3"
            bodyClassName="min-h-0 overscroll-y-contain space-y-4 px-5 py-4"
          >
            <div className="space-y-6">
            {detailBusy ? (
              <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-muted-foreground", tokens.surface.softCard)}>
                <LoaderCircle className="size-4 animate-spin" />
                {t.portal_invoices_loading_invoice_detail}
              </div>
            ) : detailError ? (
              <Banner tone="error">
                {detailError}
              </Banner>
            ) : !detail ? (
              <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                {t.portal_invoices_choose_an_invoice_card_to_open_the_detail_workspace}
              </div>
            ) : (
              <>
                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                        <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                        <span>{t.portal_invoices_invoice_overview}</span>
                      </h2>
                      <p className={cn("mt-1", tokens.text.muted)}>{t.portal_invoices_amounts_due_date_and_linked_quote_order_context}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(tokens.control.primaryButton, !invoicePdfVisible(detail) && "hidden")}
                        onClick={() =>
                          void openPortalInvoicePdf(detail.id).catch((err) => {
                            dispatchInvoicesState({
                              detailError: err instanceof Error ? err.message : t.portal_invoices_failed_to_open_invoice_pdf,
                            });
                          })
                        }
                      >
                        {t.portal_invoices_preview_pdf}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(tokens.control.primaryButton, !invoicePdfVisible(detail) && "hidden")}
                        onClick={() =>
                          void downloadPortalInvoicePdf(detail.id, `${detail.invoice_number}.pdf`).catch((err) => {
                            dispatchInvoicesState({
                              detailError: err instanceof Error ? err.message : t.portal_invoices_failed_to_download_invoice_pdf,
                            });
                          })
                        }
                      >
                        <Download className="size-4" />
                        {t.portal_invoices_download_pdf}
                      </Button>
                      <StatusBadge status={detail.status}>
                        {portalStatusLabel(detail.status)}
                      </StatusBadge>
                      <StatusBadge tone={invoiceTypeBadgeTone(detail.invoice_type)}>
                        {invoiceTypeLabel(detail.invoice_type)}
                      </StatusBadge>
                    </div>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_issued_at} value={formatPortalDateTime(detail.issued_at)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_due_date} value={formatPortalDate(detail.due_date)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_order} value={detail.order_number} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_quote} value={detail.quote_number || t.portal_invoices_not_set} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_total_gross} value={invoiceAmountsVisible(detail) ? formatPortalCurrency(detail.total_gross) : t.portal_invoices_hidden} />
                    {invoiceAmountsVisible(detail) && Number(detail.credited_amount ?? 0) > 0 ? (
                      <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={lang === "de" ? "Gutschriften" : "Кредит-ноты"} value={`−${formatPortalCurrency(detail.credited_amount)}`} />
                    ) : null}
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_open_balance} value={invoiceAmountsVisible(detail) ? formatPortalCurrency(detail.balance_due) : t.portal_invoices_hidden} />
                  </div>
                  {detail.notes ? (
                    <div className={cn("mt-4 rounded-xl px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                      {detail.notes}
                    </div>
                  ) : null}
                </section>

                {detailCreditNotes.length > 0 ? (
                  <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                    <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                      <span>{lang === "de" ? "Rechnungskorrekturen" : "Корректировки счета"}</span>
                    </h2>
                    <p className={cn("mt-1", tokens.text.muted)}>
                      {lang === "de" ? "Hier sehen Sie freigegebene Gutschriften und Stornierungen." : "Здесь показаны доступные вам кредит-ноты и их отмены."}
                    </p>
                    <div className="mt-5 space-y-2">
                      {detailCreditNotes.map((credit) => {
                        const isReversal = credit.transaction_type === "reversal";
                        return (
                          <div key={credit.id} className={cn("flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 bg-background/70 p-3", credit.is_reversed && "opacity-70")}>
                            <div>
                              <div className="text-sm font-semibold text-foreground">{credit.document_number}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{formatPortalDate(credit.issued_on)} · {credit.reason}</div>
                            </div>
                            <div className="font-mono font-semibold tabular-nums text-emerald-700">
                              {credit.amounts_visible ? `${isReversal ? "+" : "−"}${formatPortalCurrency(credit.amount_gross)}` : t.portal_invoices_hidden}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                {invoiceAmountsVisible(detail) ? (
                  <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                    <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                      <span>{t.portal_invoices_payment_history}</span>
                    </h2>
                    <p className={cn("mt-1", tokens.text.muted)}>
                      {t.portal_invoices_payment_history_description}
                    </p>
                    <div className="mt-5 space-y-2">
                      {detailPayments.length === 0 ? (
                        <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                          {t.portal_invoices_no_payments}
                        </div>
                      ) : (
                        detailPayments.map((payment) => {
                          const isReversal = payment.transaction_type === "reversal";
                          return (
                            <div
                              key={payment.id}
                              className={cn(
                                "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 bg-background/70 p-3",
                                payment.is_reversed && "opacity-70",
                              )}
                            >
                              <div>
                                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                                  <span>
                                    {isReversal
                                      ? t.portal_invoices_payment_reversal
                                      : t.portal_invoices_payment_received}
                                  </span>
                                  {payment.is_reversed ? (
                                    <StatusBadge tone="neutral">
                                      {t.portal_invoices_payment_reversed}
                                    </StatusBadge>
                                  ) : null}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">
                                  {formatPortalDate(payment.received_on)} · {portalPaymentMethodLabel(payment.payment_method, lang)}
                                </div>
                                {payment.payment_reference ? (
                                  <div className="mt-1 text-xs text-muted-foreground">
                                    {t.portal_invoices_payment_reference}: {payment.payment_reference}
                                  </div>
                                ) : null}
                              </div>
                              <div
                                className={cn(
                                  "font-mono font-semibold tabular-nums",
                                  isReversal ? "text-rose-700" : "text-emerald-700",
                                )}
                              >
                                {isReversal ? "−" : "+"}
                                {formatPortalCurrency(payment.amount_gross)}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </section>
                ) : null}

                {invoiceAmountsVisible(detail) && detailRefunds.length > 0 ? (
                  <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                    <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                      <span>{lang === "de" ? "Rückzahlungen" : "Возвраты"}</span>
                    </h2>
                    <p className={cn("mt-1", tokens.text.muted)}>
                      {lang === "de"
                        ? "Hier sehen Sie tatsächlich ausgezahlte Guthaben und eventuelle Stornierungen."
                        : "Здесь показаны фактически возвращённые суммы и возможные сторнирования."}
                    </p>
                    <div className="mt-5 space-y-2">
                      {detailRefunds.map((refund) => {
                        const isReversal = refund.transaction_type === "reversal";
                        return (
                          <div
                            key={refund.id}
                            className={cn(
                              "flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/70 bg-background/70 p-3",
                              refund.is_reversed && "opacity-70",
                            )}
                          >
                            <div>
                              <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
                                <span>
                                  {isReversal
                                    ? lang === "de" ? "Rückzahlungsstorno" : "Сторно возврата"
                                    : lang === "de" ? "Rückzahlung ausgeführt" : "Возврат выполнен"}
                                </span>
                                {refund.is_reversed ? (
                                  <StatusBadge tone="neutral">
                                    {lang === "de" ? "Storniert" : "Сторнирован"}
                                  </StatusBadge>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {formatPortalDate(refund.refunded_on)} · {refund.reason}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {portalPaymentMethodLabel(refund.payment_method, lang)}
                                {refund.payment_reference ? ` · ${refund.payment_reference}` : ""}
                              </div>
                            </div>
                            <div
                              className={cn(
                                "font-mono font-semibold tabular-nums",
                                isReversal ? "text-foreground" : "text-rose-700",
                              )}
                            >
                              {isReversal ? "+" : "−"}
                              {formatPortalCurrency(refund.amount_gross)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : null}

                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                        <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                        <span>{t.portal_invoices_payment_proof}</span>
                      </h2>
                      <p className={cn("mt-1", tokens.text.muted)}>
                        {t.portal_invoices_upload_transfer_receipt_or_payment_confirmation_once_funds_were}
                      </p>
                    </div>
                    <Button
                      type="button"
                      className={tokens.control.primaryButton}
                      disabled={uploadBusy || ["paid", "cancelled"].includes(detail.status)}
                      onClick={() => {
                        dispatchInvoicesState({ uploadError: "", uploadOpen: true });
                      }}
                    >
                      <Upload className="size-4" />
                      {t.portal_invoices_upload_payment_proof}
                    </Button>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)} label={t.portal_invoices_uploaded_proofs} value={String(detail.payment_proof_count ?? 0)} />
                    <InfoRow className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
                      label={t.portal_invoices_latest_upload}
                      value={detail.last_payment_proof_at ? formatPortalDateTime(detail.last_payment_proof_at) : t.portal_invoices_not_uploaded}
                    />
                  </div>
                </section>

                <section className={cn("rounded-xl p-5", tokens.surface.card)}>
                  <h2 className={cn(tokens.text.sectionTitle, "inline-flex items-center gap-2")}>
                    <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
                    <span>{t.portal_invoices_line_items}</span>
                  </h2>
                  <p className={cn("mt-1", tokens.text.muted)}>{t.portal_invoices_materialized_billing_lines_for_the_current_invoice_snapshot}</p>
                  <div className="mt-5 space-y-3">
                    {!detail.line_items || detail.line_items.length === 0 ? (
                      <div className={cn("rounded-xl px-4 py-6 text-sm text-muted-foreground", tokens.surface.dashed)}>
                        {t.portal_invoices_no_line_items_available}
                      </div>
                    ) : (
                      detail.line_items.map((line) => (
                        <InvoiceLineCard
                          key={[
                            detail.id,
                            line.description,
                            line.quantity,
                            line.unit_price,
                            line.line_gross,
                          ].join("|")}
                          line={line}
                        />
                      ))
                    )}
                  </div>
                </section>
              </>
            )}
            </div>
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>

      <Dialog
        open={uploadOpen}
        onOpenChange={(open) => {
          dispatchInvoicesState({
            uploadOpen: open,
            uploadBusy: open ? uploadBusy : false,
            uploadError: open ? uploadError : "",
          });
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t.portal_invoices_upload_payment_proof}</DialogTitle>
            <DialogDescription>
              {t.portal_invoices_this_file_is_attached_internally_for_billing_follow_up_and_is_no}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void handlePaymentProofUpload(event)}>
            <Field label={t.portal_invoices_file} htmlFor="invoice-payment-proof">
              <input
                id="invoice-payment-proof"
                type="file"
                className={cn(
                  inputClass,
                  "block w-full py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground",
                )}
                onChange={(event) => dispatchInvoicesState({ uploadFile: event.target.files?.[0] ?? null })}
              />
            </Field>
            <Field label={t.portal_invoices_note} htmlFor="invoice-payment-proof-note">
              <textarea
                id="invoice-payment-proof-note"
                className={cn(textareaClass, "min-h-[110px]")}
                placeholder={t.portal_invoices_optional_transfer_reference_payment_date_or_clarification}
                value={uploadNote}
                onChange={(event) => dispatchInvoicesState({ uploadNote: event.target.value })}
              />
            </Field>
            {uploadError ? <Banner tone="error">{uploadError}</Banner> : null}
            <DialogFooter>
              <Button type="button" variant="outline" className={tokens.control.primaryButton} onClick={() => dispatchInvoicesState({ uploadOpen: false })}>
                {t.portal_invoices_cancel}
              </Button>
              <Button type="submit" className={tokens.control.primaryButton} disabled={uploadBusy}>
                {uploadBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
                {t.portal_invoices_send_proof}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PatientInvoicesPage(...args: Parameters<typeof usePatientInvoicesPageContent>) {
  return usePatientInvoicesPageContent(...args);
}

function InvoiceLineCard({ line }: { line: PortalInvoiceLineItem }) {
  const { t } = useLang();
  const description = agencyServiceNameLabel(undefined, line.description, t);
  return (
    <article className={cn("rounded-xl px-4 py-4", tokens.surface.mutedCard)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{description}</p>
          <p className={cn("mt-1", tokens.text.muted)}>
            {t.portal_invoices_qty} {line.quantity} · {t.portal_invoices_unit} {formatPortalCurrency(line.unit_price)} · {t.uiText.finance_catalog_vat_label} {line.vat_rate}%
          </p>
        </div>
        <CountBadge>{formatPortalCurrency(line.line_gross)}</CountBadge>
      </div>
      {line.notes ? <p className={cn("mt-3", tokens.text.muted)}>{line.notes}</p> : null}
    </article>
  );
}
