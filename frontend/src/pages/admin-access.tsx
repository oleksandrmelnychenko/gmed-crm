import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  type SetStateAction,
} from "react";
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { AdminGuideButton, GuideSection } from "@/components/admin-guide";
import {
  AdminInlineMetric,
  AdminSectionTitle,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import {
  formatEnumLabelFromKeys,
  formatUnknownValue,
  useLang,
  type TranslationKey,
} from "@/lib/i18n";
import {
  Banner,
  EmptyCell,
  PageHeader,
  StatusBadge,
  TabLoader,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  fetchAccessPolicies,
  resetAccessPolicies,
  updateAccessPolicy,
} from "@/pages/admin/data/admin-api";

interface Policy {
  role: string;
  field_name: string;
  access_level: string;
  condition_type: string | null;
  is_system_locked: boolean;
}

const ROLE_KEYS = [
  "ceo_assistant",
  "patient_manager",
  "teamlead_interpreter",
  "interpreter",
  "concierge",
  "billing",
  "sales",
  "patient",
] as const;

const FIELD_KEYS = [
  "name",
  "birth_date",
  "phone",
  "email",
  "nationality",
  "languages",
  "insurance",
  "diagnosis",
  "medications",
  "allergies",
  "vitals",
  "internal_notes",
  "travel_data",
  "functional_labels",
] as const;

type AccessFieldKey = (typeof FIELD_KEYS)[number];

type AccessMatrixRow = {
  field: AccessFieldKey;
  label: string;
};

const ACCESS_CYCLE = ["full", "masked", "hidden", "conditional"] as const;

const ACCESS_FIELD_LABEL_KEYS = {
  name: "field_name",
  birth_date: "field_birth_date",
  phone: "field_phone",
  email: "field_email",
  nationality: "field_nationality",
  languages: "field_languages",
  insurance: "field_insurance",
  diagnosis: "field_diagnosis",
  medications: "field_medications",
  allergies: "field_allergies",
  vitals: "field_vitals",
  internal_notes: "field_internal_notes",
  travel_data: "field_travel_data",
  functional_labels: "access_field_functional_labels",
} as const satisfies Partial<Record<string, TranslationKey>>;

const ROLE_LABEL_KEYS = {
  ceo: "role_ceo",
  ceo_assistant: "role_ceo_assistant",
  patient_manager: "role_patient_manager",
  teamlead_interpreter: "role_teamlead_interpreter",
  interpreter: "role_interpreter",
  concierge: "role_concierge",
  billing: "role_billing",
  sales: "role_sales",
  it_admin: "role_it_admin",
  patient: "role_patient",
} as const satisfies Partial<Record<string, TranslationKey>>;

const LEVEL_CONFIG: Record<
  string,
  {
    icon: typeof Check;
    buttonClass: string;
  }
> = {
  full: {
    icon: Check,
    buttonClass: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  masked: {
    icon: Eye,
    buttonClass: "border-amber-200 bg-amber-50 text-amber-700",
  },
  hidden: {
    icon: EyeOff,
    buttonClass: "border-rose-200 bg-rose-50 text-rose-700",
  },
  conditional: {
    icon: Zap,
    buttonClass: "border-violet-200 bg-violet-50 text-violet-700",
  },
  locked: {
    icon: Lock,
    buttonClass: "border-border/60 bg-muted/25 text-muted-foreground",
  },
};

const ADMIN_ACCESS_REALTIME_EVENTS = [
  "access_policy.updated",
  "access_policy.reset",
] as const;

function nextAccessLevel(current: string): string {
  const idx = ACCESS_CYCLE.indexOf(current as (typeof ACCESS_CYCLE)[number]);
  return ACCESS_CYCLE[(idx + 1) % ACCESS_CYCLE.length];
}

function accessTone(level: string, locked: boolean) {
  if (locked) return "neutral" as const;
  switch (level) {
    case "full":
      return "success" as const;
    case "masked":
      return "warning" as const;
    case "hidden":
      return "error" as const;
    case "conditional":
      return "brand" as const;
    default:
      return "neutral" as const;
  }
}

interface AdminAccessState {
  policies: Policy[];
  loading: boolean;
  error: string;
  saveBusyToken: string;
  resetBusy: boolean;
  selectedField: AccessFieldKey | null;
}

type AdminAccessAction =
  | Partial<AdminAccessState>
  | ((current: AdminAccessState) => Partial<AdminAccessState>);

const INITIAL_ADMIN_ACCESS_STATE: AdminAccessState = {
  policies: [],
  loading: true,
  error: "",
  saveBusyToken: "",
  resetBusy: false,
  selectedField: null,
};

function adminAccessReducer(
  current: AdminAccessState,
  action: AdminAccessAction,
): AdminAccessState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function resolveAdminAccessStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function useAdminAccessPageContent() {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const closeUnsavedConfirmMessage =
    t.common_discard_unsaved_confirm;

  const [accessState, dispatchAccessState] = useReducer(
    adminAccessReducer,
    INITIAL_ADMIN_ACCESS_STATE,
  );
  const {
    error,
    loading,
    policies,
    resetBusy,
    saveBusyToken,
    selectedField,
  } = accessState;
  const setPolicies = (nextValue: SetStateAction<Policy[]>) =>
    dispatchAccessState((current) => ({
      policies: resolveAdminAccessStateAction(nextValue, current.policies),
    }));
  const setLoading = (nextValue: SetStateAction<boolean>) =>
    dispatchAccessState((current) => ({
      loading: resolveAdminAccessStateAction(nextValue, current.loading),
    }));
  const setError = (nextValue: SetStateAction<string>) =>
    dispatchAccessState((current) => ({
      error: resolveAdminAccessStateAction(nextValue, current.error),
    }));
  const setSaveBusyToken = (nextValue: SetStateAction<string>) =>
    dispatchAccessState((current) => ({
      saveBusyToken: resolveAdminAccessStateAction(nextValue, current.saveBusyToken),
    }));
  const setResetBusy = (nextValue: SetStateAction<boolean>) =>
    dispatchAccessState((current) => ({
      resetBusy: resolveAdminAccessStateAction(nextValue, current.resetBusy),
    }));
  const setSelectedField = (nextValue: SetStateAction<AccessFieldKey | null>) =>
    dispatchAccessState((current) => ({
      selectedField: resolveAdminAccessStateAction(nextValue, current.selectedField),
    }));

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchAccessPolicies<Policy>();
      startTransition(() => setPolicies(data));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.common_error);
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, [t.common_error]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  useRealtimeSubscription(ADMIN_ACCESS_REALTIME_EVENTS, () => {
    clearApiCache("/access-policies");
    void loadPolicies();
  });

  const fieldLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ACCESS_FIELD_LABEL_KEYS, t),
    [t],
  );
  const roleLabel = useCallback(
    (value: string | null | undefined) =>
      formatEnumLabelFromKeys(value, ROLE_LABEL_KEYS, t),
    [t],
  );

  const accessRows = useMemo<AccessMatrixRow[]>(
    () => FIELD_KEYS.map((field) => ({ field, label: fieldLabel(field) })),
    [fieldLabel],
  );

  const metrics = useMemo(() => {
    const relevantPolicies = policies.filter((policy) =>
      FIELD_KEYS.includes(policy.field_name as (typeof FIELD_KEYS)[number]),
    );
    return {
      fields: FIELD_KEYS.length,
      roles: ROLE_KEYS.length,
      conditional: relevantPolicies.filter(
        (policy) => policy.access_level === "conditional" && !policy.is_system_locked,
      ).length,
      locked: relevantPolicies.filter((policy) => policy.is_system_locked).length,
    };
  }, [policies]);

  const selectedFieldPolicies = useMemo(() => {
    if (!selectedField) return [];
    return ROLE_KEYS.map((role) => {
      const policy = policies.find(
        (item) => item.role === role && item.field_name === selectedField,
      );
      return {
        role,
        policy,
      };
    });
  }, [policies, selectedField]);

  const selectedFieldAuditNote = useMemo(() => {
    if (!selectedField) {
      return "-";
    }
    const conditional = selectedFieldPolicies.filter(
      ({ policy }) =>
        policy?.access_level === "conditional" && !policy?.is_system_locked,
    ).length;
    const locked = selectedFieldPolicies.filter(
      ({ policy }) => policy?.is_system_locked,
    ).length;
    return `${t.access_conditional}: ${conditional} - ${t.access_system_locked}: ${locked}`;
  }, [selectedField, selectedFieldPolicies, t.access_conditional, t.access_system_locked]);

  const levelLabel = useCallback((level: string, locked: boolean) => {
    if (locked) return t.access_system_locked;
    switch (level) {
      case "full":
        return t.access_full;
      case "masked":
        return t.access_masked;
      case "hidden":
        return t.access_hidden;
      case "conditional":
        return t.access_conditional;
      default:
        return formatUnknownValue(level, t);
    }
  }, [t]);

  const updatePolicy = useCallback(async (role: string, field: string) => {
    const existing = policies.find(
      (item) => item.role === role && item.field_name === field,
    );
    if (!existing || existing.is_system_locked) return;

    const newLevel = nextAccessLevel(existing.access_level);
    const condition = newLevel === "conditional" ? "freigegeben" : null;
    const token = `${role}:${field}`;

    setError("");
    setSaveBusyToken(token);
    setPolicies((current) =>
      current.map((policy) =>
        policy.role === role && policy.field_name === field
          ? { ...policy, access_level: newLevel, condition_type: condition }
          : policy,
      ),
    );

    try {
      await updateAccessPolicy({
        role,
        entity_type: "patient",
        field_name: field,
        access_level: newLevel,
        condition_type: condition,
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t.common_error);
      await loadPolicies();
    } finally {
      setSaveBusyToken("");
    }
  }, [loadPolicies, policies, t.common_error]);

  const resetPolicies = useCallback(async () => {
    setResetBusy(true);
    setError("");
    try {
      await resetAccessPolicies();
      await loadPolicies();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t.common_error);
    } finally {
      setResetBusy(false);
    }
  }, [loadPolicies, t.common_error]);

  const accessColumns = useMemo<ColumnDef<AccessMatrixRow>[]>(() => [
    {
      id: "field",
      label: t.access_field,
      accessor: (row) => row.label,
      required: true,
      pinned: "left",
      width: 220,
      searchable: true,
      render: (row) => (
        <button
          type="button"
          className="block min-w-0 text-left"
          onClick={(event) => {
            event.stopPropagation();
            setSelectedField(row.field);
          }}
        >
          <div className="truncate font-medium text-foreground">{row.label}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {t.admin_system_field_workspace}
          </div>
        </button>
      ),
    },
    ...ROLE_KEYS.map<ColumnDef<AccessMatrixRow>>((role) => ({
      id: `role:${role}`,
      label: roleLabel(role),
      accessor: (row) => {
        const policy = policies.find(
          (item) => item.role === role && item.field_name === row.field,
        );
        return levelLabel(
          policy?.access_level ?? "hidden",
          policy?.is_system_locked ?? false,
        );
      },
      width: 116,
      render: (row) => {
        const policy = policies.find(
          (item) => item.role === role && item.field_name === row.field,
        );
        const level = policy?.access_level ?? "hidden";
        const locked = policy?.is_system_locked ?? false;
        const cfg = locked
          ? LEVEL_CONFIG.locked
          : LEVEL_CONFIG[level] ?? LEVEL_CONFIG.hidden;
        const Icon = cfg.icon;
        const busy = saveBusyToken === `${role}:${row.field}`;

        return (
          <div className="flex justify-center">
            <button
              type="button"
              title={
                locked
                  ? t.access_system_locked
                  : `${levelLabel(level, false)} - ${t.admin_system_click_to_change}`
              }
              disabled={locked || busy}
              onClick={(event) => {
                event.stopPropagation();
                void updatePolicy(role, row.field);
              }}
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-xl border transition-all",
                cfg.buttonClass,
                locked
                  ? "cursor-not-allowed opacity-60"
                  : "hover:scale-105 hover:shadow-sm active:scale-95",
              )}
            >
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Icon className="size-[17px]" />
              )}
            </button>
          </div>
        );
      },
    })),
  ], [
    levelLabel,
    policies,
    roleLabel,
    saveBusyToken,
    t,
    updatePolicy,
  ]);

  const handleDetailOpenChange = useSheetDirtyGuard({
    isDirty: saveBusyToken !== "",
    onClose: () => setSelectedField(null),
    confirmMessage: closeUnsavedConfirmMessage,
  });

  return (
    <>
      <div className="space-y-4">
        <PageHeader
          title={t.access_title}
          description={t.access_subtitle}
          actions={(
            <>
              <AdminGuideButton
                title={t.admin_system_access_levels_guide_title}
                description={t.admin_system_access_levels_guide_description}
              >
                <GuideSection title={t.access_title}>
                  <ul className="space-y-2">
                    {(
                      [
                        ["full", t.access_full, t.admin_system_access_level_full_description],
                        ["masked", t.access_masked, t.admin_system_access_level_masked_description],
                        ["hidden", t.access_hidden, t.admin_system_access_level_hidden_description],
                        ["conditional", t.access_conditional, t.admin_system_access_level_conditional_description],
                        ["locked", t.access_system_locked, t.admin_system_access_level_locked_description],
                      ] as const
                    ).map(([key, label, description]) => {
                      const Icon = LEVEL_CONFIG[key].icon;
                      return (
                        <li key={key} className="flex items-start gap-3">
                          <span
                            className={cn(
                              "mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border",
                              LEVEL_CONFIG[key].buttonClass,
                            )}
                          >
                            <Icon className="size-3.5" />
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{label}</p>
                            <p className="text-[12px] text-muted-foreground">{description}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </GuideSection>

                <GuideSection title={t.admin_system_access_how_change_title}>
                  <p>{t.admin_system_access_how_change_body}</p>
                  <p className="mt-1 rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground">
                    {t.access_full} → {t.access_masked} → {t.access_hidden} → {t.access_conditional} → {t.access_full}
                  </p>
                  <p className="mt-1 text-[12px]">
                    {t.admin_system_access_locked_hint}
                  </p>
                </GuideSection>

                <GuideSection title={t.admin_system_access_reset_title}>
                  {t.admin_system_access_reset_body}
                </GuideSection>
              </AdminGuideButton>
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                disabled={loading}
                onClick={() => void loadPolicies()}
              >
                <RefreshCcw className="size-3.5" />
                {t.common_refresh}
              </Button>
              <Button
                type="button"
                variant="default"
                className="h-9 rounded-lg gap-1.5 px-3.5"
                disabled={resetBusy}
                onClick={() => void resetPolicies()}
              >
                <RotateCcw className="size-3.5" />
                {t.access_reset}
              </Button>
            </>
          )}
        />

        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone="info">{`${t.access_entity}: ${t.admin_system_patient_entity}`}</StatusBadge>
        </div>

        <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
          <AdminInlineMetric
            icon={ShieldCheck}
            tone="sky"
            label={t.access_field}
            value={metrics.fields}
            description={t.common_registry}
          />
          <AdminInlineMetric
            icon={Check}
            tone="emerald"
            label={t.users_role}
            value={metrics.roles}
            description={t.admin_system_patient_entity}
          />
          <AdminInlineMetric
            icon={Zap}
            tone="amber"
            label={t.access_conditional}
            value={metrics.conditional}
            description={t.common_monitoring}
          />
          <AdminInlineMetric
            icon={Lock}
            tone="slate"
            label={t.access_system_locked}
            value={metrics.locked}
            description={t.common_monitoring}
          />
        </div>

        {loading ? <TabLoader /> : null}
        {!loading && error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && !error ? (
          <AdminTableCard
            title={t.access_title}
            count={FIELD_KEYS.length}
          >
            {accessRows.length === 0 ? (
              <div className="p-4">
                <EmptyCell>{t.access_field}</EmptyCell>
              </div>
            ) : (
              <>
                <DataTableSurface
                  rows={accessRows}
                  columns={accessColumns}
                  defaultDensity="comfortable"
                  dictionary={tr}
                  defaultFrozenColumns={["field"]}
                  rowId={(row) => row.field}
                  activeRowId={selectedField}
                  onRowClick={(row) => setSelectedField(row.field)}
                  tableClassName="min-h-[560px]"
                />

                <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                  {(
                    [
                      ["full", t.access_full],
                      ["masked", t.access_masked],
                      ["hidden", t.access_hidden],
                      ["conditional", t.access_conditional],
                      ["locked", t.access_system_locked],
                    ] as const
                  ).map(([key, label]) => (
                    <StatusBadge key={key} tone={accessTone(key, key === "locked")}>
                      {label}
                    </StatusBadge>
                  ))}
                </div>
              </>
            )}
          </AdminTableCard>
        ) : null}
      </div>

      <Sheet open={Boolean(selectedField)} onOpenChange={handleDetailOpenChange}>
        <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-[720px]">
          <AdminSheetScaffold
            title={selectedField ? fieldLabel(selectedField) : t.access_title}
            footer={(
              <SheetActionsFooter>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg"
                  onClick={() => setSelectedField(null)}
                >
                  {t.common_cancel}
                </Button>
              </SheetActionsFooter>
            )}
          >
            {selectedField ? (
              <>
                <section className={cn("space-y-3 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <div className="space-y-1">
                    <AdminSectionTitle>{t.admin_system_permissions}</AdminSectionTitle>
                    <p className="text-[11px] text-muted-foreground">
                      {t.admin_system_access_cycle_hint}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(
                      [
                        ["full", t.access_full],
                        ["masked", t.access_masked],
                        ["hidden", t.access_hidden],
                        ["conditional", t.access_conditional],
                        ["locked", t.access_system_locked],
                      ] as const
                    ).map(([key, label]) => {
                      const Icon = LEVEL_CONFIG[key].icon;
                      return (
                        <span
                          key={key}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                            LEVEL_CONFIG[key].buttonClass,
                          )}
                        >
                          <Icon className="size-3" />
                          {label}
                        </span>
                      );
                    })}
                  </div>

                  {selectedFieldPolicies.map(({ role, policy }) => {
                    const level = policy?.access_level ?? "hidden";
                    const locked = policy?.is_system_locked ?? false;
                    const busy = saveBusyToken === `${role}:${selectedField}`;
                    const config = LEVEL_CONFIG[locked ? "locked" : level] ?? LEVEL_CONFIG.hidden;
                    const Icon = config.icon;
                    const nextLevel = locked ? null : nextAccessLevel(level);
                    return (
                      <div
                        key={role}
                        className="rounded-lg border border-border/50 bg-card/60 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[13px] font-semibold text-foreground">
                            {roleLabel(role)}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className={cn("h-8 rounded-lg gap-1.5", config.buttonClass)}
                            disabled={locked || busy}
                            title={
                              locked
                                ? t.access_system_locked
                                : `${t.admin_system_click_to_change} → ${levelLabel(nextLevel ?? level, false)}`
                            }
                            onClick={() => void updatePolicy(role, selectedField)}
                          >
                            {busy ? (
                              <LoaderCircle className="size-3.5 animate-spin" />
                            ) : (
                              <Icon className="size-3.5" />
                            )}
                            {levelLabel(level, locked)}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </section>

                <section className={cn("space-y-2 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <AdminSectionTitle>{t.access_audit_note}</AdminSectionTitle>
                  <p className="text-xs text-muted-foreground">{selectedFieldAuditNote}</p>
                </section>
              </>
            ) : (
              <EmptyCell>{t.access_subtitle}</EmptyCell>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function AdminAccessPage(...args: Parameters<typeof useAdminAccessPageContent>) {
  return useAdminAccessPageContent(...args);
}
