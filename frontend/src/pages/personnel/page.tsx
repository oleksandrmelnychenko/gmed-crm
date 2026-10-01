import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  FileArchive,
  Grid3x3,
  Inbox,
  Plus,
  Settings,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { Banner, PageHeader, TabShell } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";
import { useStaffNavigate } from "@/lib/use-staff-navigate";

import { personnelApi, type PersonnelCategory } from "./api";
import { CompletenessTab } from "./completeness-tab";
import { EmployeeDialog } from "./employee-dialog";
import { EmployeesTab } from "./employees-tab";
import { ExportTab } from "./export-tab";
import { IntakeTab, IntakeUploadButton } from "./intake-tab";
import { IntegrityTab } from "./integrity-tab";
import { resolvePersonnelTab, type PersonnelTab } from "./model";
import { errorMessage } from "./personnel-ui";
import { SettingsTab } from "./settings-tab";

const TAB_ICONS: Record<PersonnelTab, LucideIcon> = {
  employees: UsersRound,
  completeness: Grid3x3,
  intake: Inbox,
  export: FileArchive,
  integrity: ShieldCheck,
  settings: Settings,
};

/**
 * Personnel files (Personalakte): one append-only archive per employee for
 * the documents § 8 BVV requires to be kept digitally from 01.01.2027.
 * Tabs follow the capabilities `personnel.*`; the server checks them again.
 */
export function PersonnelPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<PersonnelCategory[]>([]);
  const [categoriesError, setCategoriesError] = useState("");
  const [creating, setCreating] = useState(false);
  const [intakeVersion, setIntakeVersion] = useState(0);

  const can = useMemo(
    () => ({
      upload: hasCapability(user, "personnel.upload"),
      manage: hasCapability(user, "personnel.manage"),
      export: hasCapability(user, "personnel.export"),
      retention: hasCapability(user, "personnel.retention"),
    }),
    [user],
  );

  const tabs = useMemo(() => {
    const allowed: PersonnelTab[] = ["employees", "completeness"];
    if (can.upload) allowed.push("intake");
    if (can.export) allowed.push("export");
    allowed.push("integrity");
    if (can.retention) allowed.push("settings");
    return allowed;
  }, [can]);
  const tab = resolvePersonnelTab(searchParams.get("tab"), tabs);

  const openTab = useCallback(
    (next: PersonnelTab) => {
      setSearchParams(next === "employees" ? {} : { tab: next }, { replace: true });
    },
    [setSearchParams],
  );

  const loadCategories = useCallback(() => {
    personnelApi
      .categories()
      .then((rows) => {
        setCategories(rows);
        setCategoriesError("");
      })
      .catch((reason: unknown) => setCategoriesError(errorMessage(reason, t.common_failed_load)));
  }, [t.common_failed_load]);

  useEffect(() => loadCategories(), [loadCategories]);

  const labels: Record<PersonnelTab, string> = {
    employees: t.personnel_tab_employees,
    completeness: t.personnel_tab_completeness,
    intake: t.personnel_tab_intake,
    export: t.personnel_tab_export,
    integrity: t.personnel_tab_integrity,
    settings: t.personnel_tab_settings,
  };

  const headerActions =
    tab === "employees" && can.manage ? (
      <Button type="button" className="h-9 gap-1.5 rounded-lg px-3.5" onClick={() => setCreating(true)}>
        <Plus className="size-4" />
        {t.personnel_employee_new}
      </Button>
    ) : tab === "intake" && can.upload ? (
      <IntakeUploadButton onUploaded={() => setIntakeVersion((version) => version + 1)} />
    ) : null;

  return (
    <div className="space-y-4">
      <PageHeader title={t.nav_personnel} description={t.personnel_page_intro} actions={headerActions} />
      {categoriesError ? <Banner tone="error">{categoriesError}</Banner> : null}

      <div className="-mx-2.5 overflow-x-auto overflow-y-hidden px-2.5 pb-1 sm:mx-0 sm:px-0">
        <nav aria-label={t.nav_personnel} className="flex w-max min-w-full justify-center gap-1">
          {tabs.map((entry) => {
            const Icon = TAB_ICONS[entry];
            const active = entry === tab;
            return (
              <Button
                key={entry}
                type="button"
                size="sm"
                variant={active ? "default" : "ghost"}
                aria-current={active ? "page" : undefined}
                className="h-9 min-w-0 rounded-md px-3 text-xs sm:h-8"
                onClick={() => openTab(entry)}
              >
                <Icon className="size-4" aria-hidden />
                {labels[entry]}
              </Button>
            );
          })}
        </nav>
      </div>

      <TabShell className="mt-0">
        {tab === "employees" ? (
          <EmployeesTab onOpenIntake={() => openTab("intake")} />
        ) : null}
        {tab === "completeness" ? <CompletenessTab /> : null}
        {tab === "intake" && can.upload ? (
          <IntakeTab categories={categories} reloadKey={intakeVersion} />
        ) : null}
        {tab === "export" && can.export ? <ExportTab /> : null}
        {tab === "integrity" ? <IntegrityTab canManage={can.manage} /> : null}
        {tab === "settings" && can.retention ? (
          <SettingsTab categories={categories} onCategoriesChanged={loadCategories} />
        ) : null}
      </TabShell>

      {can.manage ? (
        <EmployeeDialog
          open={creating}
          onClose={() => setCreating(false)}
          onSaved={(employee) => staffGo(`/personnel/${employee.id}`)}
        />
      ) : null}
    </div>
  );
}
