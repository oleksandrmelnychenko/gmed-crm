import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Save, Trash2 } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, Field, TabLoader } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatAppDate } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";
import { StaffLink } from "@/components/staff-link";

import {
  personnelApi,
  type PersonnelCategory,
  type PersonnelRetentionDue,
  type PersonnelSettings,
} from "./api";
import { formatDocumentPeriod } from "./model";
import {
  ArchiveName,
  PERSONNEL_CHECKBOX_CLASS,
  ReasonDialog,
  categoryLabel,
  errorMessage,
} from "./personnel-ui";

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

  const saveYears = async (category: PersonnelCategory) => {
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
  };

  if (!settings && !error) return <TabLoader />;

  return (
    <div className="space-y-6">
      {error ? <Banner tone="error">{error}</Banner> : null}

      {settings ? (
        <section className="max-w-2xl space-y-3">
          <AdminSectionTitle>{t.personnel_settings_archive}</AdminSectionTitle>
          <Field label={t.personnel_late_days} htmlFor="personnel-late-days">
            <Input
              id="personnel-late-days"
              type="number"
              min={0}
              max={60}
              className="w-28"
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
          <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                className={PERSONNEL_CHECKBOX_CLASS}
                checked={form.deletion_enabled}
                onChange={(event) =>
                  setForm((current) => ({ ...current, deletion_enabled: event.target.checked }))
                }
              />
              {t.personnel_deletion_enabled}
            </label>
            <p className="text-xs">{t.personnel_deletion_warning}</p>
          </div>
          <Button
            type="button"
            onClick={() => void saveSettings()}
            disabled={!settingsChanged || !lateDaysValid || saving !== null}
          >
            {saving === "settings" ? <LoaderCircle className="animate-spin" /> : <Save />}
            {t.common_save}
          </Button>
        </section>
      ) : null}

      <section className="space-y-2">
        <AdminSectionTitle>{t.personnel_retention_periods}</AdminSectionTitle>
        <p className="max-w-4xl text-xs text-muted-foreground">{t.personnel_retention_periods_hint}</p>
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t.personnel_category}</th>
                <th className="px-3 py-2 font-medium">{t.personnel_retention_years}</th>
                <th className="px-3 py-2 font-medium">{t.personnel_retention_from}</th>
                <th className="px-3 py-2 font-medium">{t.personnel_legal_basis}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {categories.map((category) => {
                const changed = years[category.code] !== String(category.retention_years);
                return (
                  <tr key={category.code}>
                    <td className="px-3 py-2">
                      {categoryLabel(t, category.code, category.file_label)}
                      {category.monthly ? (
                        <span className="ml-1 text-xs text-muted-foreground">({t.personnel_monthly})</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        min={1}
                        max={50}
                        className="w-20"
                        aria-label={`${t.personnel_retention_years}: ${categoryLabel(t, category.code, category.file_label)}`}
                        value={years[category.code] ?? ""}
                        onChange={(event) =>
                          setYears((current) => ({ ...current, [category.code]: event.target.value }))
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {category.retention_from === "employment_end"
                        ? t.personnel_retention_from_employment_end
                        : t.personnel_retention_from_document}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{category.legal_basis}</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={!changed || saving !== null}
                        onClick={() => void saveYears(category)}
                      >
                        {saving === category.code ? <LoaderCircle className="animate-spin" /> : <Save />}
                        {t.common_save}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <AdminSectionTitle>{t.personnel_retention_due}</AdminSectionTitle>
        {due && !due.deletion_enabled ? (
          <p className="text-xs text-muted-foreground">{t.personnel_retention_due_disabled}</p>
        ) : null}
        {due && due.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.personnel_retention_due_empty}</p>
        ) : null}
        {due && due.documents.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {due.documents.map((document) => (
              <li
                key={document.id}
                className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm">
                    <StaffLink to={`/personnel/${document.employee_id}`} className="font-medium hover:underline">
                      {document.employee_name}
                    </StaffLink>{" "}
                    · {categoryLabel(t, document.category, document.category_label)} ·{" "}
                    {formatDocumentPeriod(document)}
                  </p>
                  <ArchiveName name={document.archive_file_name} />
                  <p className="text-xs text-muted-foreground">
                    {t.personnel_retention_until} {formatAppDate(document.retention_until)}
                    {document.legal_hold ? ` · ${t.personnel_legal_hold}` : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={!due.deletion_enabled || document.legal_hold}
                  title={!due.deletion_enabled ? t.personnel_retention_due_disabled : undefined}
                  onClick={() => setDeleting(document)}
                >
                  <Trash2 />
                  {t.personnel_delete}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

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
