import { useCallback, useEffect, useMemo, useState } from "react";
import { ConciergeBell, RefreshCw } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Banner } from "@/components/ui-shell";
import { formatAppDate } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

import { fetchConciergeBillingQueue } from "./api";
import {
  canReadConciergeBillingQueue,
  conciergeQueueAction,
  conciergeQueuePatients,
  filterConciergeQueue,
  patientBillingHref,
  patientLabel,
  type ConciergeBillingQueueItem,
} from "./model";

/**
 * Number of concierge services ready to bill, for the tab badge. 0 for roles
 * without the list or when it cannot be loaded.
 */
export function useConciergeBillingQueueCount(reloadToken: number): number {
  const { user } = useAuth();
  const allowed = canReadConciergeBillingQueue(user?.role);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    fetchConciergeBillingQueue()
      .then((data) => {
        if (active) setCount(data.items.length);
      })
      .catch(() => {
        if (active) setCount(0);
      });
    return () => {
      active = false;
    };
  }, [allowed, reloadToken]);
  return allowed ? count : 0;
}

/** Billing work list: concierge services with billing status «ready». */
export function ConciergeBillingQueue({
  initialPatientId = "",
  onCount,
}: {
  initialPatientId?: string;
  onCount?: (count: number) => void;
}) {
  const { lang, t } = useLang();
  const { user } = useAuth();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const allowed = canReadConciergeBillingQueue(user?.role);
  const [rows, setRows] = useState<ConciergeBillingQueueItem[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [patientId, setPatientId] = useState(initialPatientId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const loadFailed = tx(
    "Не удалось загрузить услуги Concierge к выставлению счёта.",
    "Abrechnungsbereite Concierge-Leistungen konnten nicht geladen werden.",
  );

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setBusy(true);
    fetchConciergeBillingQueue()
      .then((data) => {
        if (!active) return;
        setRows(data.items);
        setTruncated(data.truncated);
        setError(null);
        onCount?.(data.items.length);
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
  }, [allowed, revision, loadFailed, onCount]);

  const patients = useMemo(() => conciergeQueuePatients(rows), [rows]);
  const visibleRows = useMemo(() => filterConciergeQueue(rows, patientId), [rows, patientId]);

  if (!allowed) return null;

  const dateLabel = (value: string | null) => (value ? formatAppDate(value) || "—" : "—");

  const columns: ColumnDef<ConciergeBillingQueueItem>[] = [
    {
      id: "patient",
      label: tx("Пациент", "Patient"),
      accessor: (row) => patientLabel(row),
      width: 220,
      render: (row) => (
        <StaffLink className="hover:text-primary hover:underline" to={patientBillingHref(row.patient_id)}>
          {patientLabel(row)}
        </StaffLink>
      ),
    },
    {
      id: "order",
      label: tx("Заказ", "Auftrag"),
      accessor: (row) => row.order_number ?? "",
      width: 150,
      render: (row) =>
        row.order_id && row.order_number ? (
          <StaffLink className="font-mono text-xs hover:text-primary hover:underline" to={`/orders/${encodeURIComponent(row.order_id)}`}>
            {row.order_number}
          </StaffLink>
        ) : (
          <span className="text-muted-foreground">{tx("Без заказа", "Ohne Auftrag")}</span>
        ),
    },
    {
      id: "service",
      label: tx("Услуга", "Leistung"),
      accessor: (row) => row.title,
      minWidth: 220,
      render: (row) => <span className="block min-w-0 truncate font-medium" title={row.title}>{row.title}</span>,
    },
    {
      id: "date",
      label: tx("Дата", "Datum"),
      accessor: (row) => row.service_date ?? "",
      width: 120,
      render: (row) => dateLabel(row.service_date),
    },
    {
      id: "sale_price",
      label: tx("Цена продажи", "Verkaufspreis"),
      accessor: (row) => (row.sale_price === null ? null : Number(row.sale_price)),
      width: 140,
      render: (row) => (
        row.sale_price === null ? (
          <span className="block text-right text-xs font-medium text-amber-700 dark:text-amber-300" data-testid="concierge-queue-no-price">
            {tx("Нет цены продажи", "Kein Verkaufspreis")}
          </span>
        ) : (
          <span className="block text-right font-mono tabular-nums">
            {formatMoneyAmount(row.sale_price, row.currency || "EUR")}
          </span>
        )
      ),
    },
    {
      id: "action",
      label: tx("Действие", "Aktion"),
      accessor: () => "",
      width: 210,
      render: (row) => {
        // F-C8: an unpriced service cannot be billed; its price is set on
        // the service. A service already on a draft opens that draft.
        const action = conciergeQueueAction(row);
        const label = action.kind === "set_price"
          ? tx("Указать цену в услуге", "Preis in der Leistung erfassen")
          : action.kind === "open_draft"
            ? tx("В черновике — открыть", "Im Entwurf – öffnen")
            : tx("Выставить счёт пациенту", "Dem Patienten berechnen");
        return (
          <StaffLink className="text-sm font-medium text-primary hover:underline" to={action.href}>
            {label}
          </StaffLink>
        );
      },
    },
  ];

  return (
    <div className="space-y-3" data-testid="concierge-billing-queue">
      {error ? <Banner tone="error">{error}</Banner> : null}
      {truncated ? (
        <Banner tone="warning">
          {tx(
            "Показаны первые 500 услуг. Выберите пациента, чтобы увидеть остальные.",
            "Die ersten 500 Leistungen werden angezeigt. Wählen Sie einen Patienten für die übrigen.",
          )}
        </Banner>
      ) : null}
      <DataTableSurface
        rows={visibleRows}
        columns={columns}
        loading={busy}
        rowId={(row) => row.id}
        dictionary={t as unknown as Record<string, string>}
        defaultDensity="compact"
        rowsGrowWithContent
        storageKey="invoices-concierge-billing-queue"
        mobilePrimaryColumnId="service"
        mobileDetailColumnIds={["patient", "order", "date", "sale_price", "action"]}
        emptyState={tx(
          "Нет услуг Concierge, готовых к выставлению счёта.",
          "Keine abrechnungsbereiten Concierge-Leistungen.",
        )}
        toolbarStart={
          <div className="flex flex-wrap items-center gap-2">
            <AdminSectionTitle icon={ConciergeBell}>
              {tx("Concierge: готово к выставлению счёта", "Concierge: bereit zur Abrechnung")}
            </AdminSectionTitle>
            <NativeComboboxSelect
              aria-label={tx("Пациент", "Patient")}
              value={patientId}
              onChange={(event) => setPatientId(event.target.value)}
            >
              <option value="">{tx("Все пациенты", "Alle Patienten")}</option>
              {patientId && !patients.some((patient) => patient.id === patientId) ? (
                <option value={patientId}>{tx("Выбранный пациент", "Gewählter Patient")}</option>
              ) : null}
              {patients.map((patient) => (
                <option key={patient.id} value={patient.id}>{patient.label}</option>
              ))}
            </NativeComboboxSelect>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={reload}>
              <RefreshCw className={cn("size-3.5", busy && "animate-spin")} />
              {tx("Обновить", "Aktualisieren")}
            </Button>
          </div>
        }
      />
    </div>
  );
}
