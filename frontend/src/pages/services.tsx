import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { LoaderCircle, RefreshCw, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColumnVisibilityMenu } from "@/components/data-table/column-visibility-menu";
import { DataTable } from "@/components/data-table/data-table";
import { DensityToggle } from "@/components/data-table/density-toggle";
import { FilterBuilder } from "@/components/data-table/filter-builder";
import { applyFilters } from "@/components/data-table/filter-logic";
import { SortBuilder } from "@/components/data-table/sort-builder";
import { applySort } from "@/components/data-table/sort-logic";
import type {
  ColumnDef,
  DensityLevel,
  FilterPredicate,
  SortStack,
} from "@/components/data-table/types";
import {
  EmptyCell,
  PageHeader,
  StatCard,
} from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  conciergeServiceKindLabel,
  conciergeServiceSourceLabel,
  conciergeServiceStatusTone,
  formatPortalCurrency,
  formatPortalDateTime,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";

const PatientServicesPage = lazy(() =>
  import("@/pages/patients/portal-services-page").then((module) => ({
    default: module.PatientServicesPage,
  })),
);

type StaffConciergeService = {
  id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  appointment_id: string | null;
  appointment_title: string | null;
  provider_id: string | null;
  provider_name: string | null;
  assigned_concierge_id: string | null;
  assigned_concierge_name: string | null;
  service_kind: string;
  title: string;
  status: string;
  booking_reference: string | null;
  vendor_name: string | null;
  vendor_contact: string | null;
  starts_at: string | null;
  ends_at: string | null;
  cost_estimate: string | null;
  actual_cost: string | null;
  currency: string;
  billing_status: string;
  service_notes: string | null;
  billing_notes: string | null;
  request_source: string;
  completed_at: string | null;
  billed_at: string | null;
  created_at: string;
  updated_at: string;
};

const STAFF_SERVICES_CACHE_TTL_MS = 10_000;
const ACTIVE_SERVICE_STATUSES = new Set(["planned", "booked", "confirmed", "in_service"]);
const BILLING_READY_STATUSES = new Set(["ready", "billed"]);
const DEFAULT_FROZEN_COLUMNS = ["title"];
const MAX_FROZEN_COLUMNS = 3;

function buildServicesPath(filters: { search: string; mineOnly: boolean }) {
  const params = new URLSearchParams();
  const search = filters.search.trim();
  if (search) params.set("search", search);
  if (filters.mineOnly) params.set("mine_only", "true");
  const query = params.toString();
  return query ? `/concierge-services?${query}` : "/concierge-services";
}

function billingStatusTone(status: string) {
  if (status === "settled") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "billed" || status === "ready") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }
  return "border-slate-200 bg-slate-100 text-slate-700";
}

type ServicesText = (de: string, ru: string, en: string) => string;

function buildServiceColumns(l: ServicesText): ColumnDef<StaffConciergeService>[] {
  return [
    {
      id: "title",
      label: l("Service", "Сервис", "Service"),
      accessor: (row) => row.title,
      filterType: "text",
      pinned: "left",
      width: 260,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs font-medium text-foreground">{row.title}</span>
      ),
    },
    {
      id: "status",
      label: l("Status", "Статус", "Status"),
      accessor: (row) => row.status,
      filterType: "enum",
      filterOptions: ["planned", "booked", "confirmed", "in_service", "completed", "cancelled"].map(
        (value) => ({ value, label: portalStatusLabel(value) }),
      ),
      width: 130,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className={cn("rounded-full", conciergeServiceStatusTone(row.status))}>
          {portalStatusLabel(row.status)}
        </Badge>
      ),
    },
    {
      id: "billing_status",
      label: l("Abrechnung", "Биллинг", "Billing"),
      accessor: (row) => row.billing_status,
      filterType: "enum",
      filterOptions: ["draft", "ready", "billed", "settled"].map((value) => ({
        value,
        label: portalStatusLabel(value),
      })),
      width: 110,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className={cn("rounded-full", billingStatusTone(row.billing_status))}>
          {portalStatusLabel(row.billing_status)}
        </Badge>
      ),
    },
    {
      id: "patient",
      label: l("Patient", "Пациент", "Patient"),
      accessor: (row) => row.patient_name,
      filterType: "text",
      width: 200,
      sortable: true,
      render: (row) => (
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-xs text-foreground">{row.patient_name}</span>
          {row.patient_pid ? (
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              {row.patient_pid}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: "service_kind",
      label: l("Art", "Тип", "Kind"),
      accessor: (row) => row.service_kind,
      filterType: "enum",
      filterOptions: ["hotel", "transfer", "vip_terminal", "flight", "chauffeur", "translation_support"].map(
        (value) => ({ value, label: conciergeServiceKindLabel(value) }),
      ),
      width: 140,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="rounded-full">
          {conciergeServiceKindLabel(row.service_kind)}
        </Badge>
      ),
    },
    {
      id: "request_source",
      label: l("Quelle", "Источник", "Source"),
      accessor: (row) => row.request_source,
      filterType: "enum",
      filterOptions: ["patient_portal", "appointment_bootstrap", "care_team"].map((value) => ({
        value,
        label: conciergeServiceSourceLabel(value),
      })),
      width: 160,
      sortable: true,
      render: (row) => (
        <Badge variant="outline" className="rounded-full">
          {conciergeServiceSourceLabel(row.request_source)}
        </Badge>
      ),
    },
    {
      id: "vendor",
      label: l("Anbieter", "Поставщик", "Vendor"),
      accessor: (row) => row.vendor_name,
      filterType: "text",
      width: 180,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.vendor_name ?? "—"}
        </span>
      ),
    },
    {
      id: "booking",
      label: l("Buchung", "Бронь", "Booking"),
      accessor: (row) => row.booking_reference,
      filterType: "text",
      width: 140,
      sortable: true,
      render: (row) => (
        <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
          {row.booking_reference ?? "—"}
        </span>
      ),
    },
    {
      id: "schedule",
      label: l("Zeitplan", "Расписание", "Schedule"),
      accessor: (row) => row.starts_at,
      filterType: "date",
      width: 230,
      sortable: true,
      render: (row) => {
        const start = row.starts_at ? formatPortalDateTime(row.starts_at) : null;
        const end = row.ends_at ? formatPortalDateTime(row.ends_at) : null;
        const schedule = [start, end].filter(Boolean).join(" – ");
        return (
          <span className="truncate text-xs tabular-nums text-muted-foreground">
            {schedule || "—"}
          </span>
        );
      },
    },
    {
      id: "cost",
      label: l("Kosten", "Стоимость", "Cost"),
      accessor: (row) => Number(row.actual_cost ?? row.cost_estimate ?? 0),
      filterType: "number",
      width: 110,
      sortable: true,
      render: (row) => {
        const cost = row.actual_cost ?? row.cost_estimate;
        return (
          <span className="truncate text-xs tabular-nums text-foreground">
            {cost ? formatPortalCurrency(cost) : "—"}
          </span>
        );
      },
    },
    {
      id: "concierge",
      label: l("Concierge", "Консьерж", "Concierge"),
      accessor: (row) => row.assigned_concierge_name,
      filterType: "text",
      width: 170,
      sortable: true,
      render: (row) => (
        <span className="truncate text-xs text-muted-foreground">
          {row.assigned_concierge_name ?? "—"}
        </span>
      ),
    },
  ];
}

function StaffServicesPage() {
  const { lang } = useLang();
  const [items, setItems] = useState<StaffConciergeService[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [search, setSearch] = useState("");
  const [mineOnly, setMineOnly] = useState(false);

  const [filterPredicates, setFilterPredicates] = useState<FilterPredicate[]>([]);
  const [sortStack, setSortStack] = useState<SortStack>([{ field: "schedule", dir: "desc" }]);
  const [density, setDensity] = useState<DensityLevel>("compact");
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [frozenColumns, setFrozenColumns] = useState<string[]>(DEFAULT_FROZEN_COLUMNS);

  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  const baseColumns = useMemo(() => buildServiceColumns(l), [l]);
  const columns = useMemo<ColumnDef<StaffConciergeService>[]>(() => {
    const frozenSet = new Set(frozenColumns);
    return baseColumns.map((column) => ({
      ...column,
      pinned: frozenSet.has(column.id) ? "left" : column.pinned === "right" ? "right" : undefined,
    }));
  }, [baseColumns, frozenColumns]);

  const accessors = useMemo(() => {
    const map: Record<string, ColumnDef<StaffConciergeService>["accessor"]> = {};
    for (const column of columns) map[column.id] = column.accessor;
    return map;
  }, [columns]);

  const visibleRows = useMemo(() => {
    const filtered = applyFilters(items, filterPredicates, { accessors });
    return applySort(filtered, sortStack, { accessors });
  }, [accessors, filterPredicates, items, sortStack]);

  const handleColumnFreezeChange = useCallback((columnId: string, frozen: boolean) => {
    if (frozen) {
      setFrozenColumns((current) =>
        current.includes(columnId) || current.length >= MAX_FROZEN_COLUMNS
          ? current
          : [...current, columnId],
      );
    } else {
      setFrozenColumns((current) => current.filter((id) => id !== columnId));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await apiFetch<StaffConciergeService[]>(
          buildServicesPath({ search, mineOnly }),
          { cacheTtlMs: STAFF_SERVICES_CACHE_TTL_MS },
        );
        if (cancelled) return;
        startTransition(() => {
          setItems(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : l(
                "Concierge-Services konnten nicht geladen werden.",
                "Не удалось загрузить concierge-сервисы.",
                "Failed to load concierge services.",
              ),
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [l, loading, mineOnly, search, version]);

  const activeCount = useMemo(
    () => items.filter((item) => ACTIVE_SERVICE_STATUSES.has(item.status)).length,
    [items],
  );
  const readyForBillingCount = useMemo(
    () => items.filter((item) => BILLING_READY_STATUSES.has(item.billing_status)).length,
    [items],
  );
  const portalRequestCount = useMemo(
    () => items.filter((item) => item.request_source === "patient_portal").length,
    [items],
  );

  const operatorLabels = useMemo(
    () => ({
      contains: l("enthält", "содержит", "contains"),
      does_not_contain: l("enthält nicht", "не содержит", "does not contain"),
      is_empty: l("ist leer", "пусто", "is empty"),
      is_not_empty: l("ist nicht leer", "не пусто", "is not empty"),
      is: l("ist", "равно", "is"),
      is_not: l("ist nicht", "не равно", "is not"),
      is_any_of: l("ist eines von", "одно из", "is any of"),
      is_none_of: l("ist keines von", "ни одно из", "is none of"),
      has_any: l("hat eines von", "имеет любое", "has any"),
      has_all: l("hat alle", "имеет все", "has all"),
      has_none: l("hat keines", "не имеет", "has none"),
      before: l("vor", "до", "before"),
      after: l("nach", "после", "after"),
      between: l("zwischen", "между", "between"),
      last_n_days: l("letzte N Tage", "за N дней", "last N days"),
      equals: l("gleich", "равно", "equals"),
    }),
    [l],
  );

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Concierge-Services werden geladen...", "Загрузка concierge-сервисов...", "Loading concierge services...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title={l("Concierge-Services", "Concierge-сервисы", "Concierge services")} />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        <StatCard label={l("Aktiv", "Активные", "Active")} value={activeCount} />
        <StatCard label={l("Billing-ready", "Готовы к биллингу", "Billing-ready")} value={readyForBillingCount} />
        <StatCard label={l("Portal-Anfragen", "Запросы портала", "Portal requests")} value={portalRequestCount} />
      </div>

      <div className="relative z-30 flex flex-col gap-2 rounded-lg border border-border bg-card/80 p-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={l("Patient, Anbieter, Buchung...", "Пациент, провайдер, бронь...", "Patient, provider, booking...")}
              className="h-8 w-full rounded-lg bg-background pl-8 text-[13px]"
            />
          </div>

          <label className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-input bg-background px-2.5 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(event) => setMineOnly(event.target.checked)}
              className="size-3.5 rounded border-slate-300"
            />
            {l("Meine", "Мои", "Mine")}
          </label>

          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {visibleRows.length === items.length
                ? `${items.length}`
                : `${visibleRows.length} / ${items.length}`}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              title={l("Aktualisieren", "Обновить", "Refresh")}
              aria-label={l("Aktualisieren", "Обновить", "Refresh")}
              onClick={() => setVersion((value) => value + 1)}
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2">
          <FilterBuilder
            columns={columns}
            rows={items}
            filters={filterPredicates}
            onChange={setFilterPredicates}
            translations={{
              addFilter: l("Filter", "Фильтр", "Filter"),
              clearAll: l("Leeren", "Очистить", "Clear"),
              searchPlaceholder: l("Felder suchen", "Поиск полей", "Search fields"),
              noFields: l("Keine verfügbaren Felder", "Нет доступных полей", "No available fields"),
              remove: l("Filter entfernen", "Удалить фильтр", "Remove filter"),
              valuePlaceholder: l("Wert", "Значение", "Value"),
              yes: l("Ja", "Да", "Yes"),
              no: l("Nein", "Нет", "No"),
              operatorLabels,
            }}
          />

          <SortBuilder
            columns={columns}
            value={sortStack}
            onChange={setSortStack}
            translations={{
              addSort: l("Sortierung hinzufügen", "Добавить сортировку", "Add sort"),
              clearAll: l("Leeren", "Очистить", "Clear"),
              ascending: l("Aufsteigend", "По возрастанию", "Asc"),
              descending: l("Absteigend", "По убыванию", "Desc"),
              emptyHint: l("Sortierung", "Сортировка", "Sort"),
              moveUp: l("Nach oben", "Выше", "Move up"),
              moveDown: l("Nach unten", "Ниже", "Move down"),
              remove: l("Sortierung entfernen", "Удалить сортировку", "Remove sort"),
            }}
          />

          <div className="flex items-center gap-1">
            <ColumnVisibilityMenu
              columns={columns}
              hiddenColumns={hiddenColumns}
              onChange={setHiddenColumns}
              defaultHidden={[]}
              frozenColumns={frozenColumns}
              onFrozenColumnsChange={setFrozenColumns}
              defaultFrozen={DEFAULT_FROZEN_COLUMNS}
              maxFrozenColumns={MAX_FROZEN_COLUMNS}
              buttonLabel={l("Spalten", "Колонки", "Columns")}
              searchPlaceholder={l("Spalten suchen", "Поиск колонок", "Search columns")}
              resetLabel={l("Zurücksetzen", "Сбросить", "Reset")}
              showAllLabel={l("Alle anzeigen", "Показать все", "Show all")}
              hideAllLabel={l("Alle ausblenden", "Скрыть все", "Hide all")}
              noMatchLabel={l("Keine Treffer", "Нет совпадений", "No match")}
              requiredNoteLabel={l("erforderlich", "обязательная", "required")}
              freezeLabel={l("Fixieren", "Закрепить", "Freeze")}
              unfreezeLabel={l("Lösen", "Открепить", "Unfreeze")}
              frozenNoteLabel={l("fixiert", "закреплена", "frozen")}
            />
            <DensityToggle
              value={density}
              onChange={setDensity}
              ariaLabel={l("Zeilendichte", "Плотность строк", "Row density")}
              labels={{
                comfortable: l("Komfortabel", "Свободно", "Comfortable"),
                compact: l("Kompakt", "Компактно", "Compact"),
                condensed: l("Dicht", "Плотно", "Condensed"),
              }}
            />
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyCell>
          {l(
            "Keine Concierge-Services im aktuellen Filter.",
            "Нет concierge-сервисов в текущем фильтре.",
            "No concierge services in the current filter.",
          )}
        </EmptyCell>
      ) : (
        <DataTable
          rows={visibleRows}
          columns={columns}
          hiddenColumns={hiddenColumns}
          sort={sortStack}
          onSortChange={setSortStack}
          onColumnFreezeChange={handleColumnFreezeChange}
          isColumnFreezeDisabled={(column, nextFrozen) =>
            nextFrozen &&
            !frozenColumns.includes(column.id) &&
            frozenColumns.length >= MAX_FROZEN_COLUMNS
          }
          density={density}
          rowId={(row) => row.id}
          className="min-h-[480px]"
        />
      )}
    </div>
  );
}

export function ServicesPage() {
  const { user } = useAuth();

  if (user?.role === "patient") {
    return (
      <Suspense fallback={<div className="min-h-[40vh]" />}>
        <PatientServicesPage />
      </Suspense>
    );
  }

  return <StaffServicesPage />;
}
