import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Check,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  RefreshCcw,
  RotateCcw,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";

import {
  AdminInlineMetric,
  AdminSheetScaffold,
  SheetActionsFooter,
  AdminToolbar,
  AdminTableCard,
} from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useSheetDirtyGuard } from "@/hooks/use-sheet-dirty-guard";
import { useLang } from "@/lib/i18n";
import {
  Banner,
  EmptyCell,
  PageHeader,
  StatusBadge,
  TabLoader,
  tokens,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

interface Policy {
  role: string;
  field_name: string;
  access_level: string;
  condition_type: string | null;
  is_system_locked: boolean;
}

const ROLE_KEYS = [
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
] as const;

const ACCESS_CYCLE = ["full", "masked", "hidden", "conditional"] as const;

const ACCESS_FIELD_LABELS = {
  de: {
    name: "Name",
    birth_date: "Geburtsdatum",
    phone: "Telefon",
    email: "E-Mail",
    nationality: "Nationalitaet",
    languages: "Sprachen",
    insurance: "Versicherung",
    diagnosis: "Diagnosen",
    medications: "Medikamente",
    allergies: "Allergien",
    vitals: "Vitalwerte",
    internal_notes: "Interne Notizen",
    travel_data: "Reisedaten",
  },
  ru: {
    name: "Имя",
    birth_date: "Дата рождения",
    phone: "Телефон",
    email: "Email",
    nationality: "Гражданство",
    languages: "Языки",
    insurance: "Страхование",
    diagnosis: "Диагнозы",
    medications: "Медикаменты",
    allergies: "Аллергии",
    vitals: "Показатели",
    internal_notes: "Внутренние заметки",
    travel_data: "Данные поездки",
  },
} as const;

const ACCESS_UI_LABELS = {
  de: {
    clickToChange: "Klicken zum Aendern",
    entityPatient: "Patient",
    fieldWorkspace: "Feld-Workspace",
  },
  ru: {
    clickToChange: "Нажмите для изменения",
    entityPatient: "Пациент",
    fieldWorkspace: "Рабочая область поля",
  },
} as const;

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

function roleLabel(role: string, dictionary: Record<string, string>) {
  return dictionary[`role_${role}`] ?? role.replaceAll("_", " ");
}

export function AdminAccessPage() {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const ui = ACCESS_UI_LABELS[lang];
  const fieldLabels = ACCESS_FIELD_LABELS[lang];
  const closeUnsavedConfirmMessage =
    tr.common_discard_unsaved_confirm ?? "Discard unsaved changes?";

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [saveBusyToken, setSaveBusyToken] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [selectedField, setSelectedField] =
    useState<(typeof FIELD_KEYS)[number] | null>(null);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch<Policy[]>("/access-policies?entity_type=patient");
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

  const visibleFields = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return FIELD_KEYS;
    return FIELD_KEYS.filter((field) =>
      fieldLabels[field].toLowerCase().includes(needle),
    );
  }, [fieldLabels, search]);

  const metrics = useMemo(() => {
    const relevantPolicies = policies.filter((policy) =>
      visibleFields.includes(policy.field_name as (typeof FIELD_KEYS)[number]),
    );
    return {
      fields: visibleFields.length,
      roles: ROLE_KEYS.length,
      conditional: relevantPolicies.filter(
        (policy) => policy.access_level === "conditional" && !policy.is_system_locked,
      ).length,
      locked: relevantPolicies.filter((policy) => policy.is_system_locked).length,
    };
  }, [policies, visibleFields]);

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
        return level;
    }
  }, [t.access_conditional, t.access_full, t.access_hidden, t.access_masked, t.access_system_locked]);

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
      await apiFetch("/access-policies/update", {
        method: "POST",
        body: JSON.stringify({
          role,
          entity_type: "patient",
          field_name: field,
          access_level: newLevel,
          condition_type: condition,
        }),
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
      await apiFetch("/access-policies/reset", {
        method: "POST",
        body: JSON.stringify({ entity_type: "patient" }),
      });
      await loadPolicies();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : t.common_error);
    } finally {
      setResetBusy(false);
    }
  }, [loadPolicies, t.common_error]);

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
                variant="outline"
                className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                disabled={resetBusy}
                onClick={() => void resetPolicies()}
              >
                <RotateCcw className="size-3.5" />
                {t.access_reset}
              </Button>
            </>
          )}
        />

        <AdminToolbar>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t.common_search}
              className="h-8 w-[240px] rounded-lg bg-card pl-8 text-[13px]"
            />
          </div>
          <StatusBadge tone="info">{`${t.access_entity}: ${ui.entityPatient}`}</StatusBadge>
        </AdminToolbar>

        <div className="flex flex-wrap gap-x-8 gap-y-4">
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
            description={ui.entityPatient}
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
            description={t.access_subtitle}
            count={visibleFields.length}
          >
            {visibleFields.length === 0 ? (
              <div className="p-4">
                <EmptyCell>{t.access_field}</EmptyCell>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead className="bg-muted/40">
                      <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="sticky left-0 z-20 min-w-[200px] bg-muted/40 px-4 py-2.5 font-medium">
                          {t.access_field}
                        </th>
                        {ROLE_KEYS.map((role) => (
                          <th key={role} className="px-2 py-2.5 text-center min-w-[108px] font-medium">
                            {roleLabel(role, tr)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleFields.map((field, rowIndex) => (
                        <tr
                          key={field}
                          className={cn(
                            "border-t border-border transition-colors hover:bg-muted/30",
                            rowIndex % 2 === 1 && "bg-muted/[0.12]",
                          )}
                        >
                          <td className="sticky left-0 z-10 border-r border-border bg-card px-4 py-3">
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => setSelectedField(field)}
                            >
                              <div className="font-medium text-foreground">{fieldLabels[field]}</div>
                              <div className="mt-1 text-[11.5px] text-muted-foreground">
                                {ui.fieldWorkspace}
                              </div>
                            </button>
                          </td>

                          {ROLE_KEYS.map((role) => {
                            const policy = policies.find(
                              (item) => item.role === role && item.field_name === field,
                            );
                            const level = policy?.access_level ?? "hidden";
                            const locked = policy?.is_system_locked ?? false;
                            const cfg = locked
                              ? LEVEL_CONFIG.locked
                              : LEVEL_CONFIG[level] ?? LEVEL_CONFIG.hidden;
                            const Icon = cfg.icon;
                            const busy = saveBusyToken === `${role}:${field}`;

                            return (
                              <td key={role} className="px-2 py-3 text-center">
                                <button
                                  type="button"
                                  title={
                                    locked
                                      ? t.access_system_locked
                                      : `${levelLabel(level, false)} - ${ui.clickToChange}`
                                  }
                                  disabled={locked || busy}
                                  onClick={() => void updatePolicy(role, field)}
                                  className={cn(
                                    "inline-flex size-10 items-center justify-center rounded-xl border transition-all",
                                    cfg.buttonClass,
                                    locked
                                      ? "cursor-not-allowed opacity-60"
                                      : "hover:scale-105 hover:shadow-sm active:scale-95",
                                  )}
                                >
                                  {busy ? (
                                    <LoaderCircle className="size-4 animate-spin" />
                                  ) : (
                                    <Icon className="size-[18px]" />
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

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
            title={selectedField ? fieldLabels[selectedField] : t.access_title}
            description={selectedField ? ui.fieldWorkspace : t.access_subtitle}
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
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">Meta</h3>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone="info">{`${t.access_entity}: ${ui.entityPatient}`}</StatusBadge>
                    <StatusBadge tone="neutral">{fieldLabels[selectedField]}</StatusBadge>
                    <StatusBadge tone="brand">{`${t.users_role}: ${ROLE_KEYS.length}`}</StatusBadge>
                  </div>
                </section>

                <section className={cn("space-y-3 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">Permissions</h3>
                  {selectedFieldPolicies.map(({ role, policy }) => {
                    const level = policy?.access_level ?? "hidden";
                    const locked = policy?.is_system_locked ?? false;
                    const busy = saveBusyToken === `${role}:${selectedField}`;
                    return (
                      <div
                        key={role}
                        className="rounded-lg border border-border/50 bg-card/60 px-3 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold text-foreground">
                              {roleLabel(role, tr)}
                            </p>
                            <p className="mt-1 text-[12px] text-muted-foreground">
                              {levelLabel(level, locked)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg"
                            disabled={locked || busy}
                            onClick={() => void updatePolicy(role, selectedField)}
                          >
                            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                            {locked ? t.access_system_locked : ui.clickToChange}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </section>

                <section className={cn("space-y-2 rounded-xl p-3.5", tokens.surface.softCard)}>
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">Audit note</h3>
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


