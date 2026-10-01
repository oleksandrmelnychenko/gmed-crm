import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Save, Trash2 } from "lucide-react";

import { AdminTableCard } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { StaffLink } from "@/components/staff-link";
import {
  Banner,
  EmptyCell,
  Field,
  Section,
  StatusBadge,
  TabLoader,
  checkboxClass,
} from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { formatAppDate } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";

import {
  personnelApi,
  type PersonnelCategory,
  type PersonnelRetentionDue,
  type PersonnelSettings,
} from "./api";
import { documentSortKey, formatDocumentPeriod } from "./model";
import { ReasonDialog, RowIconAction, categoryLabel, errorMessage } from "./personnel-ui";

type DueDocument = PersonnelRetentionDue["documents"][number];

/**
 * Archive settings (late threshold, TSA, deletion switch), retention periods
 * per category and the documents whose retention period has ended.
 */
export function SettingsTab({
  categories,
  onCategoriesChanged,
}: {
  categories: readonly PersonnelCategory[];
  onCategoriesChanged: () => void;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [settings, setSettings] = useState<PersonnelSettings | null>(null);
  const [form, setForm] = useState({ late_days: "", tsa_url: "", deletion_enabled: false });
  const [due, setDue] = useState<PersonnelRetentionDue | null>(null);
  const [years, setYears] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<DueDocument | null>(null);

  const load = useCallback(() => {
    setError("");
    Promise.all([personnelApi.settings(), personnelApi.retentionDue()])
      .then(([loaded, dueList]) => {
        setSettings(loaded);
        setForm({
          late_days: String(loaded.late_days),
          tsa_url: loaded.tsa_url ?? "",
          deletion_enabled: loaded.deletion_enabled,
        });
        setDue(dueList);
      })
      .catch((reason: unknown) => setError(errorMessage(reason, t.common_failed_load)));
  }, [t.common_failed_load]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    setYears(Object.fromEntries(categories.map((category) => [category.code, String(category.retention_years)])));
  }, [categories]);

  const lateDays = Number(form.late_days);
  const lateDaysValid = Number.isInteger(lateDays) && lateDays >= 0 && lateDays <= 60;
  const settingsChanged =
    settings !== null &&
    (String(settings.late_days) !== form.late_days ||
      (settings.tsa_url ?? "") !== form.tsa_url.trim() ||
      settings.deletion_enabled !== form.deletion_enabled);

  const saveSettings = async () => {
    if (!settings || !lateDaysValid) return;
    setSaving("settings");
    try {
      const patch: Partial<PersonnelSettings> = {};
      if (String(settings.late_days) !== form.late_days) patch.late_days = lateDays;
      if ((settings.tsa_url ?? "") !== form.tsa_url.trim()) patch.tsa_url = form.tsa_url.trim();
      if (settings.deletion_enabled !== form.deletion_enabled) patch.deletion_enabled = form.deletion_enabled;
      await personnelApi.updateSettings(patch);
      toast.success(t.personnel_settings_saved);
      load();
    } catch (reason) {
      toast.error(errorMessage(reason, t.common_failed_update));
    } finally {
      setSaving(null);
    }
  };

  const saveYears = useCallback(
    async (category: PersonnelCategory) => {
      const value = Number(years[category.code]);
      if (!Number.isInteger(value) || value < 1 || value > 50) {
        toast.error(t.personnel_retention_years_invalid);
        return;
      }
      setSaving(category.code);
      try {
        await personnelApi.updateCategory(category.code, value);
        toast.success(t.personnel_settings_saved);
        onCategoriesChanged();
      } catch (reason) {
        toast.error(errorMessage(reason, t.common_failed_update));
      } finally {
        setSaving(null);
      }
    },
    [onCategoriesChanged, t, years],
  );

  const retentionColumns = useMemo<ColumnDef<PersonnelCategory>[]>(
    () => [
      {
        id: "category",
        label: t.personnel_category,
        accessor: (category) => categoryLabel(t, category.code, category.file_label),
        filterType: "text",
        sortable: true,
        required: true,
        width: 280,
        render: (category) => (
          <span className="truncate text-xs font-medium text-foreground">
            {categoryLabel(t, category.code, category.file_label)}
            {category.monthly ? (
              <span className="ml-1 font-normal text-muted-foreground">({t.personnel_monthly})</span>
            ) : null}
          </span>
        ),
      },
      {
        id: "years",
        label: t.personnel_retention_years,
        accessor: (category) => category.retention_years,
        sortable: true,
        width: 110,
        cellClassName: "flex items-center",
        render: (category) => (
          <Input
            type="number"
            min={1}
            max={50}
            className="h-7 w-20 rounded-md bg-field text-xs"
            aria-label={`${t.personnel_retention_years}: ${categoryLabel(t, category.code, category.file_label)}`}
            value={years[category.code] ?? ""}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setYears((current) => ({ ...current, [category.code]: event.target.value }))}
          />
        ),
      },
      {
        id: "from",
        label: t.personnel_retention_from,
        accessor: (category) =>
          category.retention_from === "employment_end"
            ? t.personnel_retention_from_employment_end
            : t.personnel_retention_from_document,
        filterType: "text",
        sortable: true,
        width: 200,
      },
      {
        id: "legal_basis",
        label: t.personnel_legal_basis,
        accessor: (category) => category.legal_basis,
        filterType: "text",
        minWidth: 260,
        render: (category) => (
          <span className="truncate text-xs text-muted-foreground" title={category.legal_basis}>
            {category.legal_basis}
          </span>
        ),
      },
    ],
    [t, years],
  );

  const dueColumns = useMemo<ColumnDef<DueDocument>[]>(
    () => [
      {
        id: "employee",
        label: t.personnel_employee,
        accessor: (document) => document.employee_name,
        filterType: "text",
        sortable: true,
        required: true,
        width: 220,
        render: (document) => (
          <StaffLink
            to={`/personnel/${document.employee_id}`}
            className="truncate text-xs font-medium text-foreground hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {document.employee_name}
          </StaffLink>
        ),
      },
      {
        id: "category",
        label: t.personnel_category,
        accessor: (document) => categoryLabel(t, document.category, document.category_label),
        filterType: "text",
        sortable: true,
        width: 190,
      },
      {
        id: "period",
        label: t.personnel_period,
        accessor: (document) => documentSortKey(document),
        sortable: true,
        width: 110,
        render: (document) => (
          <span className="font-mono text-xs tabular-nums">{formatDocumentPeriod(document)}</span>
        ),
      },
      {
        id: "archive_file_name",
        label: t.personnel_will_be_archived_as,
        accessor: (document) => document.archive_file_name,
        filterType: "text",
        sortable: true,
        width: 340,
        render: (document) => (
          <span className="truncate font-mono text-xs" title={document.archive_file_name}>
            {document.archive_file_name}
          </span>
        ),
      },
      {
        id: "retention_until",
        label: t.personnel_retention_until,
        accessor: (document) => document.retention_until ?? "",
        filterType: "date",
        sortable: true,
        width: 130,
        render: (document) => (
          <span className="text-xs tabular-nums">
            {document.retention_until ? formatAppDate(document.retention_until) : "—"}
          </span>
        ),
      },
      {
        id: "legal_hold",
        label: t.personnel_legal_hold,
        accessor: (document) => (document.legal_hold ? t.personnel_legal_hold : ""),
        sortable: true,
        width: 150,
        render: (document) =>
          document.legal_hold ? (
            <StatusBadge tone="brand">{t.personnel_legal_hold}</StatusBadge>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [t],
  );

  if (!settings && !error) return <TabLoader />;

  return (
    <div className="space-y-6">
      {error ? <Banner tone="error">{error}</Banner> : null}

      {settings ? (
        <Section title={t.personnel_settings_archive} className="max-w-2xl">
          <Field label={t.personnel_late_days} htmlFor="personnel-late-days">
            <Input
              id="personnel-late-days"
              type="number"
              min={0}
              max={60}
              className="w-28"
              aria-invalid={!lateDaysValid}
              value={form.late_days}
              onChange={(event) => setForm((current) => ({ ...current, late_days: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">{t.personnel_late_days_hint}</p>
          </Field>
          <Field label={t.personnel_tsa_url} htmlFor="personnel-tsa-url">
            <Input
              id="personnel-tsa-url"
              type="url"
              placeholder="https://"
              value={form.tsa_url}
              onChange={(event) => setForm((current) => ({ ...current, tsa_url: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">{t.personnel_tsa_url_hint}</p>
          </Field>
          <Banner tone="warning">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={form.deletion_enabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, deletion_enabled: event.target.checked }))
                }
              />
              {t.personnel_deletion_enabled}
            </label>
            <p className="mt-1 text-xs">{t.personnel_deletion_warning}</p>
          </Banner>
          <div>
            <Button
              type="button"
              className="h-9 gap-1.5 rounded-lg px-3.5"
              onClick={() => void saveSettings()}
              disabled={!settingsChanged || !lateDaysValid || saving !== null}
            >
              {saving === "settings" ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {t.common_save}
            </Button>
          </div>
        </Section>
      ) : null}

      <AdminTableCard title={t.personnel_retention_periods} count={categories.length}>
        <p className="px-1 text-xs text-muted-foreground">{t.personnel_retention_periods_hint}</p>
        <DataTableSurface
          rows={categories}
          columns={retentionColumns}
          rowId={(category) => category.code}
          defaultDensity="comfortable"
          dictionary={tr}
          storageKey="personnel-retention-periods"
          disableRowHover
          rowActions={(category) => (
            <RowIconAction
              icon={Save}
              label={t.common_save}
              busy={saving === category.code}
              disabled={years[category.code] === String(category.retention_years) || saving !== null}
              onClick={() => void saveYears(category)}
            />
          )}
          rowActionsAlwaysVisible
          mobilePrimaryColumnId="category"
          mobileDetailColumnIds={["years", "from", "legal_basis"]}
          emptyState={<EmptyCell>{t.common_no_results}</EmptyCell>}
        />
      </AdminTableCard>

      <AdminTableCard title={t.personnel_retention_due} count={due?.documents.length ?? 0}>
        {due && !due.deletion_enabled ? (
          <p className="px-1 text-xs text-muted-foreground">{t.personnel_retention_due_disabled}</p>
        ) : null}
        <DataTableSurface
          rows={due?.documents ?? []}
          columns={dueColumns}
          rowId={(document) => document.id}
          defaultDensity="comfortable"
          dictionary={tr}
          storageKey="personnel-retention-due"
          rowActions={(document) => (
            <RowIconAction
              icon={Trash2}
              label={!due?.deletion_enabled ? t.personnel_retention_due_disabled : t.personnel_delete}
              destructive
              disabled={!due?.deletion_enabled || document.legal_hold}
              onClick={() => setDeleting(document)}
            />
          )}
          rowActionsAlwaysVisible
          mobilePrimaryColumnId="employee"
          mobileDetailColumnIds={["category", "period", "archive_file_name", "retention_until", "legal_hold"]}
          pagination={{ pageSize: 50 }}
          emptyState={<EmptyCell>{t.personnel_retention_due_empty}</EmptyCell>}
        />
      </AdminTableCard>

      <ReasonDialog
        open={Boolean(deleting)}
        title={t.personnel_delete_title}
        description={
          deleting
            ? formatUiText(t.personnel_delete_description, { name: deleting.archive_file_name })
            : undefined
        }
        confirmLabel={t.personnel_delete}
        destructive
        onConfirm={async (reason) => {
          if (!deleting) return;
          await personnelApi.deleteDocument(deleting.id, reason);
          toast.success(t.personnel_deleted_toast);
          load();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
