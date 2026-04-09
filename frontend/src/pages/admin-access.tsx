import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  Zap,
  Lock,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Policy {
  role: string;
  field_name: string;
  access_level: string;
  condition_type: string | null;
  is_system_locked: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

function nextAccessLevel(current: string): string {
  const idx = ACCESS_CYCLE.indexOf(current as (typeof ACCESS_CYCLE)[number]);
  return ACCESS_CYCLE[(idx + 1) % ACCESS_CYCLE.length];
}

// ---------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------

const labels = {
  de: {
    title: "Zugriffsmatrix",
    subtitle: "Feldzugriff pro Rolle und Entität konfigurieren",
    field: "Feld",
    reset: "Zurücksetzen",
    full: "Vollzugriff",
    masked: "Maskiert",
    hidden: "Ausgeblendet",
    conditional: "Bedingt",
    systemLocked: "Systemregel",
    loading: "Laden…",
    clickToChange: "Klicken zum Ändern",
    roles: {
      patient_manager: "Patienten\u00ADmanager",
      teamlead_interpreter: "TL Dolmetscher",
      interpreter: "Dolmetscher",
      concierge: "Concierge",
      billing: "Abrechnung",
      sales: "Vertrieb",
      patient: "Patient",
    } as Record<string, string>,
    fields: {
      name: "Name",
      birth_date: "Geburtsdatum",
      phone: "Telefon",
      email: "E-Mail",
      nationality: "Nationalitat",
      languages: "Sprachen",
      insurance: "Versicherung",
      diagnosis: "Diagnosen",
      medications: "Medikamente",
      allergies: "Allergien",
      vitals: "Vitalwerte",
      internal_notes: "Interne Notizen",
      travel_data: "Reisedaten",
    } as Record<string, string>,
  },
  ru: {
    title: "Матрица доступа",
    subtitle: "Настройка доступа к полям по ролям и сущностям",
    field: "Поле",
    reset: "Сбросить",
    full: "Полный",
    masked: "Маскировано",
    hidden: "Скрыто",
    conditional: "Условный",
    systemLocked: "Системное",
    loading: "Загрузка…",
    clickToChange: "Нажмите для изменения",
    roles: {
      patient_manager: "Менеджер пациентов",
      teamlead_interpreter: "ТЛ переводчиков",
      interpreter: "Переводчик",
      concierge: "Консьерж",
      billing: "Бухгалтерия",
      sales: "Продажи",
      patient: "Пациент",
    } as Record<string, string>,
    fields: {
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
      internal_notes: "Вн. заметки",
      travel_data: "Данные поездки",
    } as Record<string, string>,
  },
};

// ---------------------------------------------------------------------------
// Level config (icon, colors, label key)
// ---------------------------------------------------------------------------

const LEVEL_CONFIG: Record<
  string,
  {
    icon: typeof Check;
    bg: string;
    text: string;
    ring: string;
  }
> = {
  full: {
    icon: Check,
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-200 dark:ring-emerald-800",
  },
  masked: {
    icon: Eye,
    bg: "bg-amber-100 dark:bg-amber-900/40",
    text: "text-amber-700 dark:text-amber-300",
    ring: "ring-amber-200 dark:ring-amber-800",
  },
  hidden: {
    icon: EyeOff,
    bg: "bg-red-100 dark:bg-red-900/40",
    text: "text-red-600 dark:text-red-300",
    ring: "ring-red-200 dark:ring-red-800",
  },
  conditional: {
    icon: Zap,
    bg: "bg-violet-100 dark:bg-violet-900/40",
    text: "text-violet-700 dark:text-violet-300",
    ring: "ring-violet-200 dark:ring-violet-800",
  },
  locked: {
    icon: Lock,
    bg: "bg-neutral-100 dark:bg-neutral-800/40",
    text: "text-neutral-400 dark:text-neutral-500",
    ring: "ring-neutral-200 dark:ring-neutral-700",
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AdminAccessPage() {
  const { lang } = useLang();
  const t = labels[lang as "de" | "ru"];

  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Policy[]>("/access-policies?entity_type=patient");
      setPolicies(data);
    } catch {
      setPolicies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  const onCellClick = (role: string, field: string) => {
    const idx = policies.findIndex(
      (p) => p.role === role && p.field_name === field
    );
    if (idx === -1 || policies[idx].is_system_locked) return;

    const newLevel = nextAccessLevel(policies[idx].access_level);
    const condition = newLevel === "conditional" ? "freigegeben" : null;

    const updated = [...policies];
    updated[idx] = { ...updated[idx], access_level: newLevel, condition_type: condition };
    setPolicies(updated);

    void apiFetch("/access-policies/update", {
      method: "POST",
      body: JSON.stringify({
        role,
        entity_type: "patient",
        field_name: field,
        access_level: newLevel,
        condition_type: condition,
      }),
    }).catch(() => void loadPolicies());
  };

  const onReset = () => {
    void apiFetch("/access-policies/reset", {
      method: "POST",
      body: JSON.stringify({ entity_type: "patient" }),
    })
      .then(() => void loadPolicies())
      .catch(() => {});
  };

  const levelLabel = (level: string, locked: boolean) => {
    if (locked) return t.systemLocked;
    switch (level) {
      case "full": return t.full;
      case "masked": return t.masked;
      case "hidden": return t.hidden;
      case "conditional": return t.conditional;
      default: return level;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-10 rounded-xl bg-primary/10 text-primary">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t.title}</h1>
            <p className="text-muted-foreground text-sm">{t.subtitle}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={onReset} className="gap-2">
          <RotateCcw className="size-3.5" />
          {t.reset}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <div className="flex flex-col items-center gap-3">
            <div className="size-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm">{t.loading}</span>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
          {/* Matrix grid */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              {/* Column headers — roles */}
              <thead>
                <tr className="bg-neutral-50 dark:bg-neutral-900/50">
                  <th className="sticky left-0 z-20 bg-neutral-50 dark:bg-neutral-900/50 min-w-[180px] px-5 py-4 text-left">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t.field}
                    </span>
                  </th>
                  {ROLE_KEYS.map((role) => (
                    <th key={role} className="px-2 py-4 text-center min-w-[100px]">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground leading-tight">
                        {t.roles[role] ?? role}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {FIELD_KEYS.map((field, fi) => (
                  <tr
                    key={field}
                    className={`border-t border-neutral-100 dark:border-neutral-800 transition-colors hover:bg-neutral-50/50 dark:hover:bg-white/[0.02] ${
                      fi % 2 === 1 ? "bg-neutral-50/30 dark:bg-white/[0.01]" : ""
                    }`}
                  >
                    {/* Field name */}
                    <td className="sticky left-0 z-10 bg-white dark:bg-neutral-950 px-5 py-3 border-r border-neutral-100 dark:border-neutral-800">
                      <span className="text-sm font-medium">{t.fields[field] ?? field}</span>
                    </td>

                    {/* Access cells */}
                    {ROLE_KEYS.map((role) => {
                      const policy = policies.find(
                        (p) => p.role === role && p.field_name === field
                      );
                      const level = policy?.access_level ?? "hidden";
                      const locked = policy?.is_system_locked ?? false;
                      const cfg = locked ? LEVEL_CONFIG.locked : (LEVEL_CONFIG[level] ?? LEVEL_CONFIG.hidden);
                      const Icon = cfg.icon;
                      const tooltipText = locked
                        ? t.systemLocked
                        : `${levelLabel(level, false)} — ${t.clickToChange}`;

                      return (
                        <td key={role} className="px-2 py-3 text-center">
                          <Tooltip>
                            <TooltipTrigger
                              onClick={() => onCellClick(role, field)}
                              disabled={locked}
                              className={`
                                inline-flex items-center justify-center
                                size-10 rounded-xl
                                ring-1 ${cfg.ring}
                                ${cfg.bg} ${cfg.text}
                                transition-all duration-200
                                ${locked
                                  ? "cursor-not-allowed opacity-60"
                                  : "cursor-pointer hover:scale-110 hover:shadow-md hover:ring-2 active:scale-95"
                                }
                              `}
                            >
                              <Icon className="size-[18px]" />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              {tooltipText}
                            </TooltipContent>
                          </Tooltip>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend bar */}
          <div className="flex flex-wrap items-center gap-4 px-5 py-3.5 border-t bg-neutral-50/50 dark:bg-neutral-900/30">
            {(
              [
                ["full", t.full],
                ["masked", t.masked],
                ["hidden", t.hidden],
                ["conditional", t.conditional],
                ["locked", t.systemLocked],
              ] as const
            ).map(([key, label]) => {
              const cfg = LEVEL_CONFIG[key];
              const Icon = cfg.icon;
              return (
                <Badge
                  key={key}
                  variant="outline"
                  className={`gap-1.5 py-1 px-2.5 font-normal ${cfg.text} border-transparent ${cfg.bg}`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
