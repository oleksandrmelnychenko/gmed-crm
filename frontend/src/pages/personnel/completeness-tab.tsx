import { Fragment, useEffect, useMemo, useState } from "react";

import { AdminToolbar } from "@/components/admin-page-patterns";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import { StaffLink } from "@/components/staff-link";
import { Banner, EmptyCell, TabLoader } from "@/components/ui-shell";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { personnelApi, type PersonnelCompleteness } from "./api";
import {
  COMPLETENESS_CODES,
  completenessCellClass,
  completenessCellSymbol,
  countCompleteness,
  defaultMonthRange,
  formatMonth,
  monthKeyOf,
  monthOptions,
  type CompletenessCode,
} from "./model";
import { categoryLabel, categoryShortLabel, errorMessage } from "./personnel-ui";

const MONTHS_BACK = 120;
const CELL_CLASS = "inline-flex items-center justify-center rounded border text-[11px] font-semibold";

/**
 * Employees × months matrix of the expected monthly documents (timesheets,
 * payslips): archived on time, late, missing, still within the grace period,
 * or not employed in that month.
 */
export function CompletenessTab() {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [range, setRange] = useState(() => defaultMonthRange());
  const [data, setData] = useState<PersonnelCompleteness | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    personnelApi
      .completeness(range.from, range.to)
      .then((payload) => {
        if (!cancelled) setData(payload);
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
  }, [range, t.common_failed_load]);

  const monthChoices = useMemo(
    () => monthOptions(monthKeyOf(), MONTHS_BACK).map((month) => ({ value: month, label: formatMonth(month) })),
    [],
  );
  const counts = useMemo(() => countCompleteness(data?.employees ?? []), [data]);
  const cellLabel = (code: string) => tr[`personnel_cell_${code}`] ?? code;

  return (
    <div className="space-y-3">
      <AdminToolbar className="items-end border-border/70">
        <ToolbarField label={t.personnel_month_from} className="w-32">
          <NativeComboboxSelect
            value={range.from}
            aria-label={t.personnel_month_from}
            className="h-8 rounded-md bg-field text-xs"
            onChange={(event) => {
              const from = event.target.value;
              setRange((current) => ({ from, to: current.to < from ? from : current.to }));
            }}
          >
            {monthChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </NativeComboboxSelect>
        </ToolbarField>
        <ToolbarField label={t.personnel_month_to} className="w-32">
          <NativeComboboxSelect
            value={range.to}
            aria-label={t.personnel_month_to}
            className="h-8 rounded-md bg-field text-xs"
            onChange={(event) => {
              const to = event.target.value;
              setRange((current) => ({ from: current.from > to ? to : current.from, to }));
            }}
          >
            {monthChoices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </NativeComboboxSelect>
        </ToolbarField>
        {data ? (
          <p className="ml-auto self-center text-xs text-muted-foreground">
            {formatUiText(t.personnel_completeness_summary, {
              missing: counts.missing,
              late: counts.late,
            })}
          </p>
        ) : null}
      </AdminToolbar>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
        {COMPLETENESS_CODES.map((code) => (
          <span key={code} className="inline-flex items-center gap-1">
            <span aria-hidden className={cn(CELL_CLASS, "size-5", completenessCellClass(code))}>
              {completenessCellSymbol(code)}
            </span>
            {cellLabel(code)}
          </span>
        ))}
        <span>· {formatUiText(t.personnel_late_rule, { days: data?.late_days ?? 7 })}</span>
      </p>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading && !data ? <TabLoader /> : null}
      {data && data.employees.length === 0 ? <EmptyCell>{t.personnel_employees_empty}</EmptyCell> : null}
      {data && data.employees.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border/70 bg-card shadow-sm">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/70 bg-muted/40 text-muted-foreground">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 min-w-48 border-r border-border/70 bg-muted px-3 py-2 text-left font-medium"
                >
                  {t.personnel_employee}
                </th>
                {data.months.map((month) => (
                  <th
                    key={month}
                    colSpan={data.categories.length}
                    className="border-l border-border/70 px-2 py-1.5 text-center font-medium tabular-nums"
                  >
                    {formatMonth(month)}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border/70 bg-muted/40">
                {data.months.map((month) => (
                  <Fragment key={month}>
                    {data.categories.map((category, index) => (
                      <th
                        key={`${month}-${category.code}`}
                        className={cn(
                          "px-1 py-1 text-center text-[10px] font-normal text-muted-foreground",
                          index === 0 && "border-l border-border/70",
                        )}
                        title={categoryLabel(t, category.code, category.file_label)}
                      >
                        {categoryShortLabel(t, category.code, category.file_label)}
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((employee) => (
                <tr key={employee.id} className="border-b border-border/40 last:border-b-0 hover:bg-muted/20">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-r border-border/70 bg-card px-3 py-1.5 text-left font-normal"
                  >
                    <StaffLink
                      to={`/personnel/${employee.id}`}
                      className={cn(
                        "font-medium text-foreground hover:underline",
                        !employee.is_active && "text-muted-foreground",
                      )}
                    >
                      {employee.display_name}
                    </StaffLink>
                  </th>
                  {data.months.map((month) => (
                    <Fragment key={month}>
                      {data.categories.map((category, index) => {
                        const code: CompletenessCode | undefined =
                          employee.cells[month]?.[category.code];
                        return (
                          <td
                            key={`${month}-${category.code}`}
                            className={cn("px-1 py-1 text-center", index === 0 && "border-l border-border/70")}
                          >
                            <span
                              className={cn(CELL_CLASS, "size-6", completenessCellClass(code))}
                              title={`${categoryLabel(t, category.code, category.file_label)} ${formatMonth(month)}: ${cellLabel(code ?? "not_employed")}`}
                            >
                              {completenessCellSymbol(code)}
                            </span>
                          </td>
                        );
                      })}
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
