import { useEffect, useState } from "react";
import { Building2, Eye, LoaderCircle, RefreshCw, Search, UserRound } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { DataTablePager } from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { StaffLink } from "@/components/staff-link";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { openDocumentPreview } from "@/pages/documents/data/document-api";
import { fetchCompanyFinancialAccounts } from "@/pages/company-finance/data";
import { ProviderSettlementDialog } from "@/pages/company-finance/provider-settlement-dialog";
import { useFinanceAutoRefresh } from "@/pages/company-finance/use-finance-auto-refresh";
import type { CompanyFinancialAccount, CompanyProviderLiability } from "@/pages/company-finance/types";
import {
  canMarkInvoicePaidByPatient,
  patientPaymentErrorReason,
  type PatientPaymentErrorReason,
} from "@/pages/invoices/model/incoming-invoice-payment";

type IncomingInvoice = CompanyProviderLiability & {
  currency: string;
  invoice_scope: string;
  patient_receivable_gross: string;
  allocated_receivable_gross: string;
  remaining_receivable_gross: string;
};
type Props = { canManage: boolean; patientId: string; orderId: string; reloadToken: number; onChanged: () => void };

export function IncomingInvoices({ canManage, patientId, orderId, reloadToken, onChanged }: Props) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const locale = lang === "de" ? "de-DE" : "ru-RU";
  const [rows, setRows] = useState<IncomingInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<IncomingInvoice | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<IncomingInvoice | null>(null);
  const [paymentChoice, setPaymentChoice] = useState<IncomingInvoice | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [accounts, setAccounts] = useState<CompanyFinancialAccount[]>([]);
  const [opening, setOpening] = useState<string | null>(null);
  useFinanceAutoRefresh(() => setRefresh((value) => value + 1), busy);
  const loadFailed = tx("Не удалось загрузить входящие счета.", "Eingangsrechnungen konnten nicht geladen werden.");
  const accountsFailed = tx("Не удалось загрузить счета компании.", "Unternehmenskonten konnten nicht geladen werden.");

  useEffect(() => {
    let active = true;
    setBusy(true);
    const params = new URLSearchParams({ page: String(page + 1), per_page: "25", search });
    if (patientId) params.set("patient_id", patientId);
    if (orderId) params.set("order_id", orderId);
    const timer = window.setTimeout(() => {
      void apiFetch<{ items: IncomingInvoice[]; total: number }>(`/external-invoices?${params}`, { forceFresh: true })
        .then((data) => { if (active) { setRows(data.items ?? []); setTotal(data.total ?? 0); setError(null); } })
        .catch(() => { if (active) setError(loadFailed); })
        .finally(() => { if (active) setBusy(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [page, search, patientId, orderId, refresh, reloadToken, loadFailed]);

  const selectedCurrency = selected?.currency;
  useEffect(() => {
    if (!selectedCurrency || !canManage) return;
    let active = true;
    setAccounts([]);
    void fetchCompanyFinancialAccounts(selectedCurrency, true)
      .then((data) => { if (active) setAccounts(data.items); })
      .catch(() => { if (active) setError(accountsFailed); });
    return () => { active = false; };
  }, [selectedCurrency, canManage, refresh, accountsFailed]);

  useEffect(() => {
    if (paymentChoice || !pendingSettlement) return;
    setSelected(pendingSettlement);
    setPendingSettlement(null);
  }, [paymentChoice, pendingSettlement]);

  async function preview(row: IncomingInvoice) {
    if (!row.source_document_id || opening) return;
    const popup = window.open("", "_blank");
    if (!popup) { setError(tx("Разрешите открытие документа в новой вкладке.", "Erlauben Sie das Öffnen des Dokuments in einem neuen Tab.")); return; }
    setOpening(row.id);
    try { await openDocumentPreview(row.source_document_id, loadFailed, popup); }
    catch { popup.close(); setError(tx("Не удалось открыть оригинал счёта.", "Das Rechnungsoriginal konnte nicht geöffnet werden.")); }
    finally { setOpening(null); }
  }
  const money = (amount: string, currency: string) => new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(amount));
  const statusLabel = (row: IncomingInvoice) => {
    if (row.status === "cancelled") return tx("Отменён", "Storniert");
    if (row.status === "expected") return tx("Ожидается", "Erwartet");
    if (row.settlement_status === "paid_by_patient") return tx("Оплачен пациентом", "Vom Patienten bezahlt");
    if (row.settlement_status === "paid") return tx("Оплачен", "Bezahlt");
    if (row.settlement_status === "partial") return tx("Частично оплачен", "Teilweise bezahlt");
    if (row.status === "received") return tx("На проверке", "Zu prüfen");
    if (row.status === "overdue") return tx("Просрочен", "Überfällig");
    return tx("К оплате", "Zu zahlen");
  };
  const payerLabel = (row: IncomingInvoice) => row.paid_by === "patient"
    ? tx("Пациент", "Patient")
    : Number(row.company_paid_gross) > 0
      ? Number(row.remaining_gross) > 0 ? tx("GMed, частично", "GMed, teilweise") : "GMed"
      : tx("Не оплачен", "Unbezahlt");
  const patientBillingLabel = (row: IncomingInvoice) => {
    const receivable = Number(row.patient_receivable_gross);
    const allocated = Number(row.allocated_receivable_gross);
    const remaining = Number(row.remaining_receivable_gross);
    if (!row.patient_id || row.paid_by === "patient" || receivable <= 0) return tx("Не требуется", "Nicht erforderlich");
    if (remaining <= 0) return tx("Выставлено / в черновике", "Berechnet / im Entwurf");
    if (allocated > 0) return tx("Частично выставлено", "Teilweise berechnet");
    if (row.paid_by === "agency" && Number(row.remaining_gross) <= 0) return tx("Не выставлено", "Nicht berechnet");
    return tx("После оплаты", "Nach Zahlung");
  };
  const paymentErrorLabel = (reason: PatientPaymentErrorReason | null) => {
    if (reason === "company_invoice") return tx("Этот счёт не привязан к пациенту. Для него доступна только оплата GMed.", "Diese Rechnung ist keinem Patienten zugeordnet. Dafür ist nur eine Zahlung durch GMed möglich.");
    if (reason === "company_payment_exists") return tx("Сначала отмените проведённые оплаты GMed.", "Stornieren Sie zuerst die bereits gebuchten GMed-Zahlungen.");
    if (reason === "invalid_date") return tx("Укажите корректную дату оплаты, не позднее сегодняшней.", "Geben Sie ein gültiges Zahlungsdatum ein, das nicht nach dem heutigen Datum liegt.");
    if (reason === "not_approved") return tx("Сначала подтвердите неоплаченный входящий счёт.", "Prüfen Sie zuerst die unbezahlte Eingangsrechnung.");
    if (reason === "not_patient_paid") return tx("Счёт уже был изменён. Обновите список и повторите действие.", "Die Rechnung wurde bereits geändert. Aktualisieren Sie die Liste und versuchen Sie es erneut.");
    if (reason === "invoice_changed") return tx("Счёт был изменён. Обновите список и повторите действие.", "Die Rechnung wurde geändert. Aktualisieren Sie die Liste und versuchen Sie es erneut.");
    if (reason === "cancelled") return tx("У отменённого счёта нельзя менять способ оплаты.", "Bei einer stornierten Rechnung kann die Zahlungsart nicht geändert werden.");
    return tx("Не удалось изменить способ оплаты.", "Die Zahlungsart konnte nicht geändert werden.");
  };
  async function updatePatientPayment(row: IncomingInvoice, paid: boolean) {
    if (paid && !canMarkInvoicePaidByPatient(row)) {
      setPaymentError(paymentErrorLabel("company_invoice"));
      return;
    }
    setPaymentBusy(true);
    setPaymentError(null);
    setError(null);
    setPaymentChoice(null);
    try {
      await apiFetch(`/external-invoices/${row.id}/patient-payment`, {
        method: "POST",
        body: JSON.stringify({ request_id: crypto.randomUUID(), paid, paid_on: paidOn }),
      });
      setRefresh((value) => value + 1);
      onChanged();
    } catch (cause) {
      setError(paymentErrorLabel(patientPaymentErrorReason(cause)));
    } finally {
      setPaymentBusy(false);
    }
  }
  async function approvePaymentChoice(row: IncomingInvoice) {
    setPaymentBusy(true);
    setPaymentError(null);
    try {
      await apiFetch(`/external-invoices/${row.id}/approve`, { method: "POST", body: "{}" });
      setPaymentChoice(current => current?.id === row.id ? { ...current, status: "approved" } : current);
      setRefresh(value => value + 1);
      onChanged();
    } catch {
      setPaymentError(tx("Не удалось подтвердить входящий счёт.", "Die Eingangsrechnung konnte nicht bestätigt werden."));
    } finally {
      setPaymentBusy(false);
    }
  }
  const columns: ColumnDef<IncomingInvoice>[] = [
    { id: "document", label: tx("Входящий счёт", "Eingangsrechnung"), accessor: row => row.external_invoice_number, required: true, pinned: "left", width: 200, render: row => <span className="font-mono font-semibold">{row.external_invoice_number}</span> },
    { id: "provider", label: tx("Поставщик", "Lieferant"), accessor: row => row.provider_name ?? "", width: 220, render: row => row.provider_name || "—" },
    { id: "status", label: tx("Статус", "Status"), accessor: statusLabel, width: 190, render: row => <StatusBadge tone={row.status === "cancelled" ? "neutral" : Number(row.remaining_gross) === 0 ? "success" : row.status === "received" || row.status === "expected" ? "warning" : row.status === "overdue" ? "error" : "info"}>{statusLabel(row)}</StatusBadge> },
    { id: "payer", label: tx("Кто оплатил", "Bezahlt von"), accessor: payerLabel, width: 145, render: row => <StatusBadge tone={row.paid_by === "patient" ? "info" : Number(row.company_paid_gross) > 0 ? "success" : "neutral"}>{payerLabel(row)}</StatusBadge> },
    { id: "patient_billing", label: tx("Счёт пациенту", "Patientenrechnung"), accessor: patientBillingLabel, width: 195, render: row => {
      const badge = <StatusBadge tone={patientBillingLabel(row) === tx("Не выставлено", "Nicht berechnet") ? "warning" : Number(row.remaining_receivable_gross) <= 0 && Number(row.patient_receivable_gross) > 0 ? "success" : "neutral"}>{patientBillingLabel(row)}</StatusBadge>;
      return row.patient_id && row.paid_by === "agency" ? <StaffLink to={`/patients/${row.patient_id}?tab=billing`} aria-label={`${tx("Открыть выставление пациенту", "Patientenabrechnung öffnen")}: ${row.patient_name}`}>{badge}</StaffLink> : badge;
    } },
    { id: "amount", label: tx("Сумма счёта", "Rechnungsbetrag"), accessor: row => Number(row.amount_gross), width: 150, render: row => <span className="font-mono tabular-nums">{money(row.amount_gross, row.currency)}</span> },
    { id: "paid", label: tx("Выплачено компанией", "Vom Unternehmen bezahlt"), accessor: row => Number(row.company_paid_gross), width: 180, render: row => <span className="font-mono tabular-nums">{money(row.company_paid_gross, row.currency)}</span> },
    { id: "remaining", label: tx("Осталось выплатить", "Noch zu zahlen"), accessor: row => Number(row.remaining_gross), width: 180, render: row => <span className={`font-mono font-semibold tabular-nums ${Number(row.remaining_gross) > 0 ? "text-rose-700 dark:text-rose-400" : ""}`}>{money(row.remaining_gross, row.currency)}</span> },
    { id: "due", label: tx("Срок оплаты", "Fällig am"), accessor: row => row.due_date, width: 140, render: row => row.due_date ? new Date(`${row.due_date}T00:00:00`).toLocaleDateString(locale) : "—" },
    { id: "patient", label: tx("Пациент", "Patient"), accessor: row => row.patient_name, width: 210, render: row => row.patient_id ? <StaffLink to={`/patients/${row.patient_id}`}>{row.patient_name || row.patient_pid}</StaffLink> : tx("Расход компании", "Unternehmensausgabe") },
    { id: "order", label: tx("Заказ", "Auftrag"), accessor: row => row.order_number ?? "", width: 155, render: row => row.order_id ? <StaffLink to={`/orders/${row.order_id}`}>{row.order_number}</StaffLink> : row.patient_id ? <StatusBadge tone="warning">{tx("Без заказа", "Ohne Auftrag")}</StatusBadge> : "—" },
  ];
  return <section className="space-y-3" aria-label={tx("Входящие счета", "Eingangsrechnungen")}>
    {error ? <Banner tone="error">{error}</Banner> : null}
    <DataTableSurface rows={rows} columns={columns} rowId={row => row.id} loading={busy} defaultDensity="compact" storageKey="incoming-invoices"
      mobilePrimaryColumnId="document" mobileDetailColumnIds={["provider", "status", "payer", "patient_billing", "amount", "remaining", "patient", "order"]}
      toolbarStart={<><AdminSectionTitle>{tx("Входящие счета", "Eingangsrechnungen")}</AdminSectionTitle><div className="relative min-w-48 flex-1 sm:max-w-sm"><Search className="absolute left-2.5 top-2 size-4 text-muted-foreground" /><Input className="h-8 pl-8" type="search" aria-label={tx("Поиск входящих счетов", "Eingangsrechnungen suchen")} placeholder={tx("Номер, поставщик или пациент", "Nummer, Lieferant oder Patient")} value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-3.5" />{tx("Обновить", "Aktualisieren")}</Button></>}
      toolbarAfter={<DataTablePager pageIndex={page} pageSize={25} totalRows={total} totalPages={Math.max(1, Math.ceil(total / 25))} previousLabel={tx("Назад", "Zurück")} nextLabel={tx("Далее", "Weiter")} onPageChange={setPage} />}
      emptyState={tx("Входящих счетов пока нет", "Noch keine Eingangsrechnungen")}
      rowActionsWidth={canManage ? 225 : 55} rowActions={row => <div className="flex items-center gap-2">
        {row.source_document_id ? <Button type="button" size="icon-sm" variant="outline" disabled={Boolean(opening)} aria-label={`${tx("Оригинал счёта", "Rechnungsoriginal")}: ${row.external_invoice_number}`} onClick={() => void preview(row)}>{opening === row.id ? <LoaderCircle className="size-4 animate-spin" /> : <Eye className="size-4" />}</Button> : null}
        {canManage && !["cancelled", "expected"].includes(row.status) ? <Button type="button" size="sm" variant={row.paid_by === "unpaid" ? "default" : "outline"} disabled={paymentBusy} onClick={() => { setPaymentError(null); setPaidOn(new Date().toISOString().slice(0, 10)); setPaymentChoice(row); }}>{tx("Оплата", "Zahlung")}</Button> : null}
      </div>} />
    <ProviderSettlementDialog liability={selected} accounts={accounts} locale={locale} onClose={() => setSelected(null)} onChanged={() => { setRefresh(value => value + 1); onChanged(); }} />
    <Dialog open={Boolean(paymentChoice)} onOpenChange={(open) => { if (!open && !paymentBusy) { setPaymentError(null); setPaymentChoice(null); } }}>
      <DialogContent className="gap-0 overflow-hidden rounded-xl p-0 sm:max-w-xl sm:pb-0">
        <DialogHeader className="shrink-0 gap-1.5 border-b border-border/70 bg-muted/20 px-4 py-3.5 pr-12 sm:px-5 sm:pr-14">
          <DialogTitle className="flex min-w-0 items-center gap-2 text-base">
            <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 break-words">{tx("Оплата входящего счёта", "Zahlung der Eingangsrechnung")}</span>
          </DialogTitle>
          <DialogDescription className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-5">
            {paymentChoice ? <><span className="font-mono font-medium text-foreground">{paymentChoice.external_invoice_number}</span><span aria-hidden>·</span><span className="min-w-0 break-words">{paymentChoice.provider_name || "—"}</span></> : null}
          </DialogDescription>
        </DialogHeader>
        {paymentChoice ? <div className="space-y-4 p-4 sm:p-5">
          <label className="block space-y-1.5 text-xs font-medium text-muted-foreground">
            <span>{tx("Дата оплаты", "Zahlungsdatum")}</span>
            <Input className="h-9 rounded-md bg-background text-sm text-foreground" type="date" max={new Date().toISOString().slice(0, 10)} value={paidOn} disabled={paymentBusy} onChange={(event) => setPaidOn(event.target.value)} />
          </label>
          {paymentError ? <Banner tone="error">{paymentError}</Banner> : null}
          {paymentChoice.status === "received" ? <Banner tone="warning"><div className="flex flex-wrap items-center justify-between gap-3"><span>{tx("Сначала подтвердите реквизиты входящего счёта.", "Prüfen Sie zuerst die Eingangsrechnung.")}</span><Button type="button" size="sm" variant="outline" disabled={paymentBusy} onClick={() => void approvePaymentChoice(paymentChoice)}>{paymentBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}{tx("Подтвердить счёт", "Rechnung bestätigen")}</Button></div></Banner> : null}
          {!canMarkInvoicePaidByPatient(paymentChoice) ? <Banner tone="warning">{tx("Это расход компании без привязки к пациенту. Его можно оплатить только через GMed.", "Dies ist eine Unternehmensausgabe ohne Patientenzuordnung. Sie kann nur über GMed bezahlt werden.")}</Banner> : null}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-muted-foreground">{tx("Кто оплатил счёт?", "Wer hat die Rechnung bezahlt?")}</legend>
            <div className={`grid gap-3 ${canMarkInvoicePaidByPatient(paymentChoice) ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
              {canMarkInvoicePaidByPatient(paymentChoice) ? <button type="button" disabled={paymentBusy || paymentChoice.status === "received" || paymentChoice.paid_by === "agency"}
                className="group flex min-h-32 flex-col rounded-lg border border-border/70 bg-card p-3.5 text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 dark:hover:border-sky-800 dark:hover:bg-sky-950/20"
                onClick={() => void updatePatientPayment(paymentChoice, paymentChoice.paid_by !== "patient")}>
                <span className="mb-3 flex size-9 items-center justify-center rounded-md border border-sky-100 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300"><UserRound className="size-4.5" /></span>
                <span className="block text-sm font-semibold text-foreground">{paymentChoice.paid_by === "patient" ? tx("Снова не оплачен", "Wieder unbezahlt") : tx("Пациент оплатил сам", "Patient hat selbst bezahlt")}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{tx("Движение денег GMed не создаётся.", "Es wird keine GMed-Geldbewegung erstellt.")}</span>
              </button> : null}
              <button type="button" disabled={paymentBusy || paymentChoice.paid_by === "patient" || ["received", "expected"].includes(paymentChoice.status)}
                className="group flex min-h-32 flex-col rounded-lg border border-border/70 bg-card p-3.5 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => { setPaymentError(null); setPendingSettlement(paymentChoice); setPaymentChoice(null); }}>
                <span className="mb-3 flex size-9 items-center justify-center rounded-md border border-orange-100 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/50 dark:text-orange-300"><Building2 className="size-4.5" /></span>
                <span className="block text-sm font-semibold text-foreground">{Number(paymentChoice.company_paid_gross) > 0 ? tx("История оплат GMed", "GMed-Zahlungsverlauf") : tx("Оплатила GMed", "Von GMed bezahlt")}</span>
                <span className="mt-1 block text-xs leading-5 text-muted-foreground">{tx("Оплата проводится через счёт компании.", "Die Zahlung wird über ein Unternehmenskonto gebucht.")}</span>
              </button>
            </div>
          </fieldset>
        </div> : null}
        <div className="flex shrink-0 justify-end border-t border-border/70 bg-muted/20 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button type="button" variant="outline" size="sm" className="h-9 w-full rounded-md sm:h-8 sm:w-auto" disabled={paymentBusy} onClick={() => { setPaymentError(null); setPaymentChoice(null); }}>
            {tx("Закрыть", "Schließen")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </section>;
}
