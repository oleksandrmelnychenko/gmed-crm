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
  ShieldCheck,
  Zap,
} from "lucide-react";

import { AdminGuideButton, GuideSection } from "@/components/admin-guide";
import {
  AdminInlineMetric,
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
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
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
    functional_labels: "Funktionslabels",
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
    functional_labels: "Функциональные метки",
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

type UnknownTranslations = Pick<Translations, "common_unknown" | "common_unknown_value">;

function roleLabel(role: string, dictionary: Record<string, string>, translations: UnknownTranslations) {
  return dictionary[`role_${role}`] ?? formatUnknownValue(role, translations);
}

export function AdminAccessPage() {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const ui = ACCESS_UI_LABELS[lang];
  const fieldLabels = ACCESS_FIELD_LABELS[lang];
  const closeUnsavedConfirmMessage =
    t.common_discard_unsaved_confirm;

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveBusyToken, setSaveBusyToken] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [selectedField, setSelectedField] = useState<AccessFieldKey | null>(null);

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

  const accessRows = useMemo<AccessMatrixRow[]>(
    () => FIELD_KEYS.map((field) => ({ field, label: fieldLabels[field] })),
    [fieldLabels],
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
            {ui.fieldWorkspace}
          </div>
        </button>
      ),
    },
    ...ROLE_KEYS.map<ColumnDef<AccessMatrixRow>>((role) => ({
      id: `role:${role}`,
      label: roleLabel(role, tr, t),
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
                  : `${levelLabel(level, false)} - ${ui.clickToChange}`
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
    saveBusyToken,
    t,
    tr,
    ui.clickToChange,
    ui.fieldWorkspace,
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
                title={lang === "de" ? "Zugriffsstufen — Anleitung" : "Уровни доступа — гайд"}
                description={
                  lang === "de"
                    ? "So funktionieren die Felder, Buttons und Symbole auf dieser Seite."
                    : "Как работают поля, кнопки и иконки на этой странице."
                }
              >
                <GuideSection title={lang === "de" ? "Zugriffsstufen" : "Уровни доступа"}>
                  <ul className="space-y-2">
                    {(
                      [
                        ["full", t.access_full, lang === "de" ? "Volle Sichtbarkeit und Bearbeitung." : "Полная видимость и редактирование."],
                        ["masked", t.access_masked, lang === "de" ? "Wert nur teilweise sichtbar (z. B. ****)." : "Значение видно частично (например, ****)."],
                        ["hidden", t.access_hidden, lang === "de" ? "Feld komplett ausgeblendet." : "Поле полностью скрыто."],
                        ["conditional", t.access_conditional, lang === "de" ? "Sichtbar nur unter bestimmten Bedingungen (z. B. nach Freigabe)." : "Видно только при выполнении условий (например, после одобрения)."],
                        ["locked", t.access_system_locked, lang === "de" ? "Vom System gesperrt — kann nicht geändert werden." : "Заблокировано системой — менять нельзя."],
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

                <GuideSection title={lang === "de" ? "Wie ändern" : "Как менять"}>
                  <p>
                    {lang === "de"
                      ? "Eine Zeile in der Tabelle anklicken → rechts öffnet sich der Workspace. Im Block „Permissions“ auf den Stufen-Button neben einer Rolle klicken — die Stufe wechselt im Zyklus:"
                      : "Кликни строку в таблице — справа откроется рабочая область. В блоке «Permissions» жми кнопку рядом с ролью — уровень меняется по циклу:"}
                  </p>
                  <p className="mt-1 rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[12px] text-foreground">
                    {t.access_full} → {t.access_masked} → {t.access_hidden} → {t.access_conditional} → {t.access_full}
                  </p>
                  <p className="mt-1 text-[12px]">
                    {lang === "de" ? "Gesperrte Felder (Schloss-Symbol) sind vom System fixiert." : "Заблокированные поля (иконка замка) фиксируются системой."}
                  </p>
                </GuideSection>

                <GuideSection title={lang === "de" ? "Reset" : "Сброс"}>
                  {lang === "de"
                    ? "Die orange Schaltfläche oben rechts (Reset) setzt alle Stufen auf den Standardzustand zurück."
                    : "Оранжевая кнопка вверху (Reset) возвращает все уровни к дефолтным."}
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
          <StatusBadge tone="info">{`${t.access_entity}: ${ui.entityPatient}`}</StatusBadge>
        </div>

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
            title={selectedField ? fieldLabels[selectedField] : t.access_title}
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
                    <h3 className="text-[13px] font-semibold tracking-tight text-foreground">
                      Permissions
                    </h3>
                    <p className="text-[11px] text-muted-foreground">
                      {ui.clickToChange} — {t.access_full} → {t.access_masked} → {t.access_hidden} → {t.access_conditional}.
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
                        className="rounded-lg border border-border/50 bg-card/60 px-3 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[13px] font-semibold text-foreground">
                            {roleLabel(role, tr, t)}
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
                                : `${ui.clickToChange} → ${levelLabel(nextLevel ?? level, false)}`
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
                  <h3 className="text-[13px] font-semibold tracking-tight text-foreground">{t.access_audit_note}</h3>
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
