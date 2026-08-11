import { useEffect, useMemo, useState, type ElementType } from "react";
import {
  Activity,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Gauge,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang, type Lang } from "@/lib/i18n";
import { listStaffNavItems } from "@/lib/staff-route-access";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

import { greetingFor } from "./model/staff-dashboard-formatters";
import {
  roleDashboardDefinition,
  type RoleDashboardMetric,
} from "./model/role-dashboard-config";

type RoleKpiResponse = {
  section: string;
  kpi: Record<string, unknown> | null;
};

const KPI_ICONS: ElementType[] = [Users, ClipboardCheck, Clock3, TrendingUp];

function numberValue(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatMetric(metric: RoleDashboardMetric, value: unknown, lang: Lang): string {
  const numeric = numberValue(value);
  if (numeric === null) return "—";

  switch (metric.format) {
    case "currency":
      return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(numeric);
    case "percent":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)}%`;
    case "hours":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)} ${lang === "de" ? "Std." : "ч"}`;
    case "days":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)} ${lang === "de" ? "Tage" : "дн."}`;
    case "score":
      return `${new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric)} / 5`;
    default:
      return new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
        maximumFractionDigits: 1,
      }).format(numeric);
  }
}

function MetricCard({
  icon: Icon,
  metric,
  value,
  lang,
  loading,
}: {
  icon: ElementType;
  metric: RoleDashboardMetric;
  value: unknown;
  lang: Lang;
  loading: boolean;
}) {
  return (
    <article className="relative min-h-32 overflow-hidden rounded-lg border border-border/70 bg-card p-4">
      <span className="absolute left-0 top-4 h-8 w-0.5 rounded-r-full bg-[var(--brand)]" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] text-muted-foreground">{metric.label}</p>
          {loading ? (
            <div className="mt-3 h-7 w-24 animate-pulse rounded bg-muted" />
          ) : (
            <p className="mt-2 truncate text-[24px] font-semibold leading-none tracking-tight text-foreground">
              {formatMetric(metric, value, lang)}
            </p>
          )}
          <p className="mt-2 text-[11px] leading-4 text-muted-foreground">{metric.hint}</p>
        </div>
        <Icon className="size-[18px] shrink-0 text-muted-foreground" />
      </div>
    </article>
  );
}

export function RoleDashboardPage({ role, preview = false }: { role: string; preview?: boolean }) {
  const { user } = useAuth();
  const { lang, t } = useLang();
  const { staffGo } = useStaffNavigate();
  const tr = t as unknown as Record<string, string>;
  const definition = useMemo(() => roleDashboardDefinition(role, lang), [lang, role]);
  const [kpi, setKpi] = useState<Record<string, unknown> | null>(
    preview ? definition.preview : null,
  );
  const [loading, setLoading] = useState(!preview);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (preview) {
      setKpi(definition.preview);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void apiFetch<RoleKpiResponse>("/stats/my-kpis", { forceFresh: true })
      .then((response) => {
        if (!cancelled) setKpi(response.kpi ?? {});
      })
      .catch(() => {
        if (!cancelled) {
          setKpi({});
          setFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [definition, preview]);

  const greeting = greetingFor(user?.name ?? "", tr);
  const roleTitle = tr[`role_${role}`] ?? role;
  const quickLinks = listStaffNavItems(role).filter((item) => item.to !== "/").slice(0, 4);
  const secondaryMetrics = definition.metrics.slice(4);
  const copy = lang === "de"
    ? {
        priorities: "Fokus heute",
        prioritiesHint: "Die wichtigsten nächsten Schritte",
        details: "Weitere Kennzahlen",
        detailsHint: "Zusätzlicher Kontext für Ihre Arbeit",
        quick: "Schnellzugriff",
        quickHint: "Nur für Ihre Rolle freigegebene Bereiche",
        unavailable: "Aktuelle Kennzahlen konnten nicht geladen werden.",
      }
    : {
        priorities: "Фокус на сегодня",
        prioritiesHint: "Главные следующие действия",
        details: "Дополнительные показатели",
        detailsHint: "Контекст для вашей ежедневной работы",
        quick: "Быстрый доступ",
        quickHint: "Только разрешённые для вашей роли разделы",
        unavailable: "Актуальные показатели пока не удалось загрузить.",
      };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-[var(--brand)]" />
            {definition.eyebrow}
          </div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-foreground">
            {greeting}
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-5 text-muted-foreground">
            {definition.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card px-3 py-2 text-[12px] text-muted-foreground">
          <ShieldCheck className="size-4 text-[var(--brand)]" />
          {roleTitle}
        </div>
      </header>

      {failed ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
          {copy.unavailable}
        </div>
      ) : null}

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {definition.metrics.slice(0, 4).map((metricItem, index) => (
          <MetricCard
            key={metricItem.key}
            icon={KPI_ICONS[index] ?? Gauge}
            lang={lang}
            loading={loading}
            metric={metricItem}
            value={kpi?.[metricItem.key]}
          />
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <article className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted-foreground" />
              <h2 className="text-[14px] font-semibold text-foreground">{copy.details}</h2>
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{copy.detailsHint}</p>
          </div>
          <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            {(secondaryMetrics.length > 0 ? secondaryMetrics : definition.metrics.slice(0, 2)).map(
              (metricItem, index) => {
                const icons = [CircleDollarSign, Gauge];
                const Icon = icons[index] ?? Sparkles;
                return (
                  <div key={metricItem.key} className="flex items-center gap-3 px-4 py-4">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30">
                      <Icon className="size-4 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11.5px] text-muted-foreground">{metricItem.label}</p>
                      <p className="mt-0.5 truncate text-[17px] font-semibold text-foreground">
                        {loading ? "—" : formatMetric(metricItem, kpi?.[metricItem.key], lang)}
                      </p>
                    </div>
                  </div>
                );
              },
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <CalendarClock className="size-4 text-muted-foreground" />
              <h2 className="text-[14px] font-semibold text-foreground">{copy.priorities}</h2>
            </div>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">{copy.prioritiesHint}</p>
          </div>
          <div className="divide-y divide-border">
            {definition.focus.map((item, index) => (
              <div key={item} className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-semibold text-muted-foreground">
                  {index + 1}
                </div>
                <p className="text-[12.5px] leading-5 text-foreground">{item}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      {quickLinks.length > 0 ? (
        <section>
          <div className="mb-2 px-1">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {copy.quick}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-foreground">{copy.quickHint}</p>
          </div>
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {quickLinks.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => staffGo(item.to)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/70 bg-card px-4 py-3 text-left",
                  "transition-colors hover:border-foreground/30",
                )}
              >
                <CheckCircle2 className="size-4 text-[var(--brand)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                  {tr[item.labelKey] ?? item.id}
                </span>
                <ArrowRight className="size-3.5 text-muted-foreground" />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
