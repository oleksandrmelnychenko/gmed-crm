import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Banner, PageHeader } from "@/components/ui-shell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { hasCapability } from "@/lib/permissions";

import { personnelApi, type PersonnelCategory } from "./api";
import { CompletenessTab } from "./completeness-tab";
import { EmployeesTab } from "./employees-tab";
import { ExportTab } from "./export-tab";
import { IntakeTab } from "./intake-tab";
import { IntegrityTab } from "./integrity-tab";
import { resolvePersonnelTab, type PersonnelTab } from "./model";
import { errorMessage } from "./personnel-ui";
import { SettingsTab } from "./settings-tab";

/**
 * Personnel files (Personalakte): one append-only archive per employee for
 * the documents § 8 BVV requires to be kept digitally from 01.01.2027.
 * Tabs follow the capabilities `personnel.*`; the server checks them again.
 */
export function PersonnelPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [categories, setCategories] = useState<PersonnelCategory[]>([]);
  const [categoriesError, setCategoriesError] = useState("");

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

  return (
    <div className="space-y-4">
      <PageHeader title={t.nav_personnel} />
      <p className="max-w-4xl text-sm text-muted-foreground">{t.personnel_page_intro}</p>
      {categoriesError ? <Banner tone="error">{categoriesError}</Banner> : null}
      <Tabs value={tab} onValueChange={(value) => openTab(value as PersonnelTab)}>
        <div className="max-w-full overflow-x-auto">
          <TabsList>
            {tabs.map((entry) => (
              <TabsTrigger key={entry} value={entry}>
                {labels[entry]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="employees" className="pt-2">
          {tab === "employees" ? (
            <EmployeesTab canManage={can.manage} onOpenIntake={() => openTab("intake")} />
          ) : null}
        </TabsContent>
        <TabsContent value="completeness" className="pt-2">
          {tab === "completeness" ? <CompletenessTab /> : null}
        </TabsContent>
        {can.upload ? (
          <TabsContent value="intake" className="pt-2">
            {tab === "intake" ? <IntakeTab categories={categories} /> : null}
          </TabsContent>
        ) : null}
        {can.export ? (
          <TabsContent value="export" className="pt-2">
            {tab === "export" ? <ExportTab /> : null}
          </TabsContent>
        ) : null}
        <TabsContent value="integrity" className="pt-2">
          {tab === "integrity" ? <IntegrityTab canManage={can.manage} /> : null}
        </TabsContent>
        {can.retention ? (
          <TabsContent value="settings" className="pt-2">
            {tab === "settings" ? (
              <SettingsTab categories={categories} onCategoriesChanged={loadCategories} />
            ) : null}
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
