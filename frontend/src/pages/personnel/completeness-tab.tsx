import { Fragment, useEffect, useMemo, useState } from "react";

import { AdminToolbar } from "@/components/admin-page-patterns";
import { ToolbarField } from "@/components/data-table/toolbar-field";
import { Banner, TabLoader } from "@/components/ui-shell";
import { SelectField } from "@/components/ui/select-field";
import { formatUiText, useLang } from "@/lib/i18n";
import { StaffLink } from "@/components/staff-link";
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
import { categoryLabel, errorMessage } from "./personnel-ui";

const MONTHS_BACK = 120;

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
      <AdminToolbar className="items-end">
        <ToolbarField label={t.personnel_month_from} className="w-32">
          <SelectField
            value={range.from}
            aria-label={t.personnel_month_from}
            className="h-8 text-xs"
            onValueChange={(from) => setRange((current) => ({ from, to: current.to < from ? from : current.to }))}
            options={monthChoices}
          />
        </ToolbarField>
        <ToolbarField label={t.personnel_month_to} className="w-32">
          <SelectField
            value={range.to}
            aria-label={t.personnel_month_to}
            className="h-8 text-xs"
            onValueChange={(to) => setRange((current) => ({ from: current.from > to ? to : current.from, to }))}
            options={monthChoices}
          />
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

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {COMPLETENESS_CODES.map((code) => (
          <span key={code} className="inline-flex items-center gap-1">
            <span
              className={cn(
                "inline-flex size-5 items-center justify-center rounded border text-[11px] font-semibold",
                completenessCellClass(code),
              )}
            >
              {completenessCellSymbol(code)}
            </span>
            {cellLabel(code)}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatUiText(t.personnel_late_rule, { days: data?.late_days ?? 7 })}
      </p>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading && !data ? <TabLoader /> : null}
      {data && data.employees.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">{t.personnel_employees_empty}</p>
      ) : null}
      {data && data.employees.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-max min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th
                  rowSpan={2}
                  className="sticky left-0 z-10 min-w-48 bg-muted/30 px-3 py-2 text-left font-medium"
                >
                  {t.personnel_employee}
                </th>
                {data.months.map((month) => (
                  <th
                    key={month}
                    colSpan={data.categories.length}
                    className="border-l border-border px-2 py-1.5 text-center font-medium"
                  >
                    {formatMonth(month)}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-border bg-muted/20">
                {data.months.map((month) => (
                  <Fragment key={month}>
                    {data.categories.map((category, index) => (
                      <th
                        key={`${month}-${category.code}`}
                        className={cn(
                          "px-1 py-1 text-center text-[10px] font-normal text-muted-foreground",
                          index === 0 && "border-l border-border",
                        )}
                        title={categoryLabel(t, category.code, category.file_label)}
                      >
                        {categoryLabel(t, category.code, category.file_label).slice(0, 3)}
                      </th>
                    ))}
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.employees.map((employee) => (
                <tr key={employee.id} className="border-b border-border last:border-b-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left font-normal"
                  >
                    <StaffLink
                      to={`/personnel/${employee.id}`}
                      className={cn("hover:underline", !employee.is_active && "text-muted-foreground")}
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
                            className={cn("px-1 py-1 text-center", index === 0 && "border-l border-border")}
                          >
                            <span
                              className={cn(
                                "inline-flex size-6 items-center justify-center rounded border text-[11px] font-semibold",
                                completenessCellClass(code),
                              )}
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
