import { useEffect, useMemo, useState } from "react";
import { FileArchive, LoaderCircle } from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Banner, EmptyCell, Field, Section, StatusBadge, TabLoader, checkboxClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { toast } from "@/components/ui/toast";
import { appDateKey } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { personnelApi, type PersonnelEmployeeRow, type PersonnelExportInput } from "./api";
import { formatMonth, monthKeyOf, monthOptions } from "./model";
import { errorMessage } from "./personnel-ui";

const MONTHS_BACK = 120;

/** ZIP export for an auditor (Betriebsprüfung) or the tax adviser. */
export function ExportTab() {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [employees, setEmployees] = useState<PersonnelEmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeVersions, setIncludeVersions] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    personnelApi
      .employees()
      .then((list) => {
        if (!cancelled) setEmployees(list.employees);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason, t.common_failed_load));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t.common_failed_load]);

  const monthChoices = useMemo(
    () => [
      { value: "", label: t.personnel_export_no_limit },
      ...monthOptions(monthKeyOf(), MONTHS_BACK).map((month) => ({ value: month, label: formatMonth(month) })),
    ],
    [t.personnel_export_no_limit],
  );

  const columns = useMemo<ColumnDef<PersonnelEmployeeRow>[]>(
    () => [
      {
        id: "name",
        label: t.personnel_employee,
        accessor: (row) => `${row.last_name} ${row.first_name}`,
        sortable: true,
        required: true,
        width: 260,
        render: (row) => (
          <span className={cn("truncate text-xs font-medium", row.is_active ? "text-foreground" : "text-muted-foreground")}>
            {row.display_name}
          </span>
        ),
      },
      {
        id: "personnel_number",
        label: t.personnel_number,
        accessor: (row) => row.personnel_number ?? "",
        sortable: true,
        width: 160,
        render: (row) => <span className="font-mono text-xs">{row.personnel_number || "—"}</span>,
      },
      {
        id: "status",
        label: t.personnel_status,
        accessor: (row) => (row.is_active ? t.personnel_status_active : t.personnel_status_former),
        filterType: "enum",
        filterOptions: [
          { value: t.personnel_status_active, label: t.personnel_status_active },
          { value: t.personnel_status_former, label: t.personnel_status_former },
        ],
        sortable: true,
        width: 130,
        render: (row) => (
          <StatusBadge tone={row.is_active ? "success" : "neutral"}>
            {row.is_active ? t.personnel_status_active : t.personnel_status_former}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );

  const rangeInvalid = Boolean(from && to && from > to);
  const canExport = !busy && !rangeInvalid && (scope === "all" || selected.length > 0);

  const runExport = async () => {
    if (!canExport) return;
    const input: PersonnelExportInput = { include_versions: includeVersions };
    if (scope === "selected") input.employee_ids = [...selected];
    if (from) input.from = from;
    if (to) input.to = to;
    setBusy(true);
    try {
      const name = await personnelApi.exportArchive(
        input,
        `Personalakten_Export_${appDateKey().replaceAll("-", "")}.zip`,
      );
      toast.success(formatUiText(t.personnel_export_done, { name }));
    } catch (reason) {
      toast.error(errorMessage(reason, t.common_failed_load));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <Section title={t.personnel_export_scope}>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={t.personnel_export_scope}>
          {(
            [
              ["all", t.personnel_export_all],
              ["selected", formatUiText(t.personnel_export_selected, { count: selected.length })],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              className="h-8 rounded-md px-2.5 text-xs"
              variant={scope === value ? "default" : "ghost"}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {loading ? <TabLoader /> : null}
        {scope === "selected" && !loading ? (
          <DataTableSurface
            rows={employees}
            columns={columns}
            rowId={(row) => row.id}
            defaultDensity="comfortable"
            dictionary={tr}
            selectionEnabled
            selectedIds={selected}
            onSelectedIdsChange={setSelected}
            mobilePrimaryColumnId="name"
            mobileDetailColumnIds={["personnel_number", "status"]}
            tableClassName="max-h-96"
            emptyState={<EmptyCell>{t.personnel_employees_empty}</EmptyCell>}
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.personnel_month_from}>
            <SelectField value={from} aria-label={t.personnel_month_from} onValueChange={setFrom} options={monthChoices} />
          </Field>
          <Field label={t.personnel_month_to}>
            <SelectField value={to} aria-label={t.personnel_month_to} onValueChange={setTo} options={monthChoices} />
          </Field>
        </div>
        {rangeInvalid ? <p className="text-xs text-destructive">{t.personnel_range_invalid}</p> : null}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={includeVersions}
            onChange={(event) => setIncludeVersions(event.target.checked)}
          />
          {t.personnel_export_include_versions}
        </label>
        <div>
          <Button
            type="button"
            className="h-9 gap-1.5 rounded-lg px-3.5"
            onClick={() => void runExport()}
            disabled={!canExport}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <FileArchive className="size-4" />}
            {t.personnel_export_download}
          </Button>
        </div>
      </Section>
      <aside className={cn("h-fit rounded-xl p-4", tokens.surface.mutedCard)}>
        <Section title={t.personnel_export_contents_title}>
          <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            <li>{t.personnel_export_contents_files}</li>
            <li>{t.personnel_export_contents_index}</li>
            <li>{t.personnel_export_contents_manifest}</li>
            <li>{t.personnel_export_contents_report}</li>
          </ul>
          <p className="text-xs text-muted-foreground">{t.personnel_export_logged}</p>
        </Section>
      </aside>
    </div>
  );
}
