import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { useCan } from "@/lib/permissions";
import { cn } from "@/lib/utils";

import {
  fetchTerminationSettlementQueue,
  type TerminationSettlement,
  type TerminationSettlementFilter,
} from "./api";
import {
  settlementBalanceClass,
  settlementBalanceLabel,
  settlementStatusLabel,
  toAmount,
} from "./model";
import { AdvancePaymentHint, FinalInvoiceLink, SettlementActions } from "./ui";

/** Billing queue: final settlements of orders stopped by a contract termination. */
export function TerminationSettlementQueue({
  onOpenInvoice,
}: {
  onOpenInvoice?: (invoiceId: string) => void;
}) {
  const { lang, t } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const canView = useCan("invoices.view");
  const [filter, setFilter] = useState<TerminationSettlementFilter>("open");
  const [rows, setRows] = useState<TerminationSettlement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const loadFailed = tx(
    "Не удалось загрузить расчёты при расторжении.",
    "Abrechnungen bei Kündigung konnten nicht geladen werden.",
  );

  useEffect(() => {
    if (!canView) return;
    let active = true;
    setBusy(true);
    fetchTerminationSettlementQueue(filter)
      .then((data) => {
        if (!active) return;
        setRows(data);
        setError(null);
      })
      .catch(() => {
        if (active) setError(loadFailed);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [canView, filter, revision, loadFailed]);

  if (!canView) return null;

  const dateLabel = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU");
  };
  const money = (row: TerminationSettlement, value: unknown) => formatMoneyAmount(value, row.currency || "EUR");

  const columns: ColumnDef<TerminationSettlement>[] = [
    {
      id: "patient",
      label: tx("Пациент", "Patient"),
      accessor: (row) => `${row.patient_name} ${row.patient_pid ?? ""}`,
      width: 210,
      render: (row) => (
        <StaffLink className="hover:text-primary hover:underline" to={`/patients/${encodeURIComponent(row.patient_id)}?tab=billing`}>
          {row.patient_name || row.patient_pid || "—"}
        </StaffLink>
      ),
    },
    {
      id: "order",
      label: tx("Заказ", "Auftrag"),
      accessor: (row) => row.order_number,
      width: 150,
      render: (row) => (
        <StaffLink className="font-mono text-xs hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(row.order_id)}`}>
          {row.order_number}
        </StaffLink>
      ),
    },
    {
      id: "terminated_at",
      label: tx("Расторгнут", "Gekündigt"),
      accessor: (row) => row.terminated_at,
      width: 120,
      render: (row) => dateLabel(row.terminated_at),
    },
    {
      id: "accrued",
      label: tx("Набежало", "Angefallen"),
      accessor: (row) => toAmount(row.current.accrued_gross),
      width: 130,
      render: (row) => <span className="block text-right font-mono tabular-nums">{money(row, row.current.accrued_gross)}</span>,
    },
    {
      id: "paid",
      label: tx("Оплачено", "Bezahlt"),
      accessor: (row) => toAmount(row.current.paid_gross),
      width: 130,
      render: (row) => <span className="block text-right font-mono tabular-nums">{money(row, row.current.paid_gross)}</span>,
    },
    {
      id: "balance",
      label: tx("Итог", "Saldo"),
      accessor: (row) => toAmount(row.current.balance_gross),
      width: 220,
      render: (row) => (
        <span className={cn("text-sm font-semibold", settlementBalanceClass(row.current.balance_gross))}>
          {settlementBalanceLabel(row.current.balance_gross, row.currency, lang)}
        </span>
      ),
    },
    {
      id: "uninvoiced",
      label: tx("Не выставлено", "Nicht berechnet"),
      accessor: (row) => toAmount(row.current.uninvoiced_gross),
      width: 140,
      render: (row) => <span className="block text-right font-mono tabular-nums">{money(row, row.current.uninvoiced_gross)}</span>,
    },
    {
      id: "final_invoice",
      label: tx("Финальный счёт", "Schlussrechnung"),
      accessor: (row) => row.final_invoice?.invoice_number ?? "",
      width: 230,
      render: (row) => <FinalInvoiceLink invoice={row.final_invoice} currency={row.currency} lang={lang} />,
    },
    {
      id: "status",
      label: tx("Статус", "Status"),
      accessor: (row) => row.status,
      width: 110,
      render: (row) => (
        <StatusBadge tone={row.status === "open" ? "warning" : "success"}>
          {settlementStatusLabel(row.status, lang)}
        </StatusBadge>
      ),
    },
    {
      id: "actions",
      label: tx("Действия", "Aktionen"),
      accessor: () => "",
      width: 360,
      render: (row) => (
        <SettlementActions settlement={row} lang={lang} onChanged={reload} onInvoiceCreated={onOpenInvoice} size="xs" />
      ),
    },
  ];

  return (
    <div className="space-y-3" data-testid="termination-settlement-queue">
      {error ? <Banner tone="error">{error}</Banner> : null}
      <DataTableSurface
        rows={rows}
        columns={columns}
        loading={busy}
        rowId={(row) => row.id}
        dictionary={t as unknown as Record<string, string>}
        defaultDensity="compact"
        storageKey="invoices-termination-settlements"
        mobilePrimaryColumnId="patient"
        mobileDetailColumnIds={["order", "balance", "uninvoiced", "final_invoice", "actions"]}
        emptyState={tx("Нет расчётов при расторжении.", "Keine Abrechnungen bei Kündigung.")}
        toolbarStart={
          <div className="flex flex-wrap items-center gap-2">
            <AdminSectionTitle>{tx("Расчёты при расторжении", "Abrechnung bei Kündigung")}</AdminSectionTitle>
            <NativeComboboxSelect
              aria-label={tx("Статус расчёта", "Status der Abrechnung")}
              value={filter}
              onChange={(event) => setFilter(event.target.value as TerminationSettlementFilter)}
            >
              <option value="open">{tx("Открытые", "Offen")}</option>
              <option value="settled">{tx("Закрытые", "Abgeschlossen")}</option>
              <option value="all">{tx("Все", "Alle")}</option>
            </NativeComboboxSelect>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reload}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              {tx("Обновить", "Aktualisieren")}
            </Button>
          </div>
        }
      />
      <AdvancePaymentHint lang={lang} />
    </div>
  );
}
