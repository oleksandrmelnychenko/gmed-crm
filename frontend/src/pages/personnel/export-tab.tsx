import { useEffect, useMemo, useState } from "react";
import { FileArchive, LoaderCircle } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, Field, TabLoader } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { appDateKey } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";

import { personnelApi, type PersonnelEmployeeRow, type PersonnelExportInput } from "./api";
import { formatMonth, monthKeyOf, monthOptions } from "./model";
import { PERSONNEL_CHECKBOX_CLASS, errorMessage } from "./personnel-ui";

const MONTHS_BACK = 120;

/** ZIP export for an auditor (Betriebsprüfung) or the tax adviser. */
export function ExportTab() {
  const { t } = useLang();
  const [employees, setEmployees] = useState<PersonnelEmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
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

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rangeInvalid = Boolean(from && to && from > to);
  const canExport = !busy && !rangeInvalid && (scope === "all" || selected.size > 0);

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
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-4">
        <AdminSectionTitle>{t.personnel_export_scope}</AdminSectionTitle>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="personnel-export-scope"
              checked={scope === "all"}
              onChange={() => setScope("all")}
            />
            {t.personnel_export_all}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="personnel-export-scope"
              checked={scope === "selected"}
              onChange={() => setScope("selected")}
            />
            {formatUiText(t.personnel_export_selected, { count: selected.size })}
          </label>
        </div>
        {error ? <Banner tone="error">{error}</Banner> : null}
        {loading ? <TabLoader /> : null}
        {scope === "selected" && !loading ? (
          <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-lg border border-border bg-card">
            {employees.map((employee) => (
              <li key={employee.id}>
                <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/30">
                  <input
                    type="checkbox"
                    className={PERSONNEL_CHECKBOX_CLASS}
                    checked={selected.has(employee.id)}
                    onChange={() => toggle(employee.id)}
                  />
                  <span className={employee.is_active ? "" : "text-muted-foreground"}>
                    {employee.display_name}
                  </span>
                  {employee.personnel_number ? (
                    <span className="font-mono text-xs text-muted-foreground">{employee.personnel_number}</span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
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
            className={PERSONNEL_CHECKBOX_CLASS}
            checked={includeVersions}
            onChange={(event) => setIncludeVersions(event.target.checked)}
          />
          {t.personnel_export_include_versions}
        </label>
        <Button type="button" onClick={() => void runExport()} disabled={!canExport}>
          {busy ? <LoaderCircle className="animate-spin" /> : <FileArchive />}
          {t.personnel_export_download}
        </Button>
      </div>
      <aside className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
        <p className="font-medium">{t.personnel_export_contents_title}</p>
        <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          <li>{t.personnel_export_contents_files}</li>
          <li>{t.personnel_export_contents_index}</li>
          <li>{t.personnel_export_contents_manifest}</li>
          <li>{t.personnel_export_contents_report}</li>
        </ul>
        <p className="text-xs text-muted-foreground">{t.personnel_export_logged}</p>
      </aside>
    </div>
  );
}
