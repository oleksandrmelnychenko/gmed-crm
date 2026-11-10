import { PortalInfoRow as InfoRow, PortalStatCard as StatCard, PortalSection as Section, PortalDateChip } from "./ui/portal-page-layout";
import { useEffect, useMemo, useState } from "react";
import { Archive, CalendarClock, CircleCheck, Layers, LoaderCircle, PackageCheck, ReceiptText, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  PageHeader,
  StatusBadge,
  TabLoader,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { uiText, useLang, type Lang } from "@/lib/i18n";
import { pluralWord, type PluralWords } from "@/lib/i18n/plural";
import { useRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { fetchPortalSubscriptions } from "@/pages/patients/data/portal-api";
import {
  type PortalSubscriptionFinancial,
  type PortalSubscriptionItem,
  type PortalSubscriptionService,
  usePortalLabels,
} from "@/pages/patients/model/portal-shared";

const SUBSCRIPTION_REALTIME_EVENTS = [
  "service_package.assigned",
  "service_package.consumed",
  "service_package.overage_updated",
  "invoice.created",
  "invoice.status_changed",
  "invoice.prepayment_applied",
  "invoice.prepayment_released",
] as const;

// «1 активные» (global QA 2026-11-10): the word follows the count.
const COUNTED_ACTIVE: PluralWords = { ru: ["активная", "активные", "активных"], de: ["aktiv", "aktiv"] };

/** The state of one subscription; the section titles («Активные») are plural. */
const LIFECYCLE_BADGE: Record<PortalSubscriptionItem["lifecycle"], { ru: string; de: string }> = {
  active: { ru: "Активна", de: "Aktiv" },
  upcoming: { ru: "Предстоит", de: "Bevorstehend" },
  completed: { ru: "Завершена", de: "Abgeschlossen" },
};

function financialTone(status: PortalSubscriptionFinancial["status"]): StatusTone {
  if (status === "paid") return "success";
  if (status === "overdue") return "error";
  if (status === "partially_paid") return "warning";
  if (status === "open") return "info";
  return "neutral";
}

function subscriptionTone(lifecycle: PortalSubscriptionItem["lifecycle"]): StatusTone {
  if (lifecycle === "active") return "success";
  if (lifecycle === "upcoming") return "info";
  return "neutral";
}

function replaceCount(template: string, count: number) {
  return template.replace("{count}", String(count));
}

function quantity(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(parsed);
}

export function PatientSubscriptionsPage() {
  const { lang, t } = useLang();
  const { staffGo } = useStaffNavigate();
  const [subscriptions, setSubscriptions] = useState<PortalSubscriptionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useRealtimeSubscription(SUBSCRIPTION_REALTIME_EVENTS, () => {
    clearApiCache("/me/subscriptions");
    setVersion((current) => current + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setRefreshing(!loading);
      setError("");
      try {
        const response = await fetchPortalSubscriptions();
        if (cancelled) return;
        setSubscriptions(response.items);
      } catch (loadError) {
        if (cancelled) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t.portal_subscriptions_load_failed,
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [version, t.portal_subscriptions_load_failed]);

  const grouped = useMemo(
    () => ({
      active: subscriptions.filter((item) => item.lifecycle === "active"),
      upcoming: subscriptions.filter((item) => item.lifecycle === "upcoming"),
      completed: subscriptions.filter((item) => item.lifecycle === "completed"),
    }),
    [subscriptions],
  );
  const serviceCount = useMemo(
    () => subscriptions.reduce((sum, item) => sum + item.services.length, 0),
    [subscriptions],
  );
  const paymentAttentionCount = useMemo(
    () =>
      subscriptions.filter((item) =>
        ["open", "partially_paid", "overdue"].includes(item.financial.status),
      ).length,
    [subscriptions],
  );

  if (loading) {
    return (
      <div className="min-h-[320px]">
        <TabLoader />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      <PageHeader
        title={t.portal_subscriptions_title}
        description={t.portal_subscriptions_subtitle}
        actions={
          <>

            <Button
              type="button"
              variant="default"
              className={tokens.control.primaryButton}
              onClick={() => staffGo("/invoices")}
            >
              <ReceiptText className="size-4" />
              {t.portal_subscriptions_open_invoices}
            </Button>
            <Button
              type="button"
              variant="default"
              className={tokens.control.primaryButton}
              disabled={refreshing}
              onClick={() => {
                clearApiCache("/me/subscriptions");
                setVersion((current) => current + 1);
              }}
            >
              {refreshing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {t.portal_subscriptions_refresh}
            </Button>
          </>
        }
      />

      {error ? <Banner tone="error">{error}</Banner> : null}
      {subscriptions.some((item) => item.status === "paused") ? (
        // Said in plain words on the page that stays open during a pause.
        <Banner tone="warning" withIcon>
          <span data-testid="portal-subscriptions-paused">{uiText("portal_paused_subscriptions_note", lang)}</span>
        </Banner>
      ) : null}

      {subscriptions.length === 0 ? (
        <Section title={t.portal_subscriptions_title} icon={Layers}>
          <p className="text-sm text-muted-foreground">{t.portal_subscriptions_empty_title}</p>
        </Section>
      ) : <>
        <section className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={t.portal_subscriptions_total}
            value={String(subscriptions.length)}
            description={`${grouped.active.length} ${pluralWord(lang, grouped.active.length, COUNTED_ACTIVE)}`}
          />
          <StatCard label={t.portal_subscriptions_included_services} value={String(serviceCount)} />
          <StatCard label={t.portal_subscriptions_payment_attention} value={String(paymentAttentionCount)} />
        </section>
        {([
          [t.portal_subscriptions_active, CircleCheck, grouped.active],
          [t.portal_subscriptions_upcoming, CalendarClock, grouped.upcoming],
          [t.portal_subscriptions_completed, Archive, grouped.completed],
        ] as const).map(([title, icon, items]) => items.length > 0 && (
          <Section key={title} title={title} icon={icon} accessory={<CountBadge>{items.length}</CountBadge>}>
            <div className={cn("grid gap-3", items.length > 1 && "xl:grid-cols-2")}>
              {items.map(subscription => <SubscriptionCard key={subscription.id} subscription={subscription} />)}
            </div>
          </Section>
        ))}
      </>}
    </div>
  );
}

function SubscriptionCard({ subscription }: { subscription: PortalSubscriptionItem }) {
  const { formatPortalCurrency, formatPortalDate, portalStatusLabel } = usePortalLabels();
  const { lang, t } = useLang();
  const period = subscription.starts_on
    ? `${t.portal_subscriptions_from} ${formatPortalDate(subscription.starts_on)} · ${
        subscription.ends_on
          ? `${t.portal_subscriptions_until} ${formatPortalDate(subscription.ends_on)}`
          : t.portal_subscriptions_ongoing
      }`
    : subscription.ends_on
      ? `${t.portal_subscriptions_until} ${formatPortalDate(subscription.ends_on)}`
      : t.portal_subscriptions_ongoing;
  const financialLabel = {
    not_invoiced: t.portal_subscriptions_financial_not_invoiced,
    open: t.portal_subscriptions_financial_open,
    partially_paid: t.portal_subscriptions_financial_partially_paid,
    paid: t.portal_subscriptions_financial_paid,
    overdue: t.portal_subscriptions_financial_overdue,
  }[subscription.financial.status];
  const lifecycleLabel = LIFECYCLE_BADGE[subscription.lifecycle][lang === "de" ? "de" : "ru"];
  const balanceValue =
    subscription.financial.balance_disclosure === "visible"
      ? formatPortalCurrency(subscription.financial.balance_due)
      : subscription.financial.balance_disclosure === "shared_order"
        ? t.portal_subscriptions_balance_shared_order
        : t.portal_subscriptions_amount_hidden;

  return (
    <article className={cn("portal-subscription-card min-w-0 space-y-3 rounded-xl p-3 shadow-none [overflow-wrap:anywhere]", tokens.surface.card)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">
            {subscription.package_name}
          </h2>
          {subscription.description ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">
              {subscription.description}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={subscriptionTone(subscription.lifecycle)}>
            {lifecycleLabel}
          </StatusBadge>
          {subscription.status === "paused" ? (
            <StatusBadge status={subscription.status}>
              {portalStatusLabel(subscription.status)}
            </StatusBadge>
          ) : null}
        </div>
      </div>

      <div className="portal-subscription-details grid gap-2 sm:grid-cols-2">
        <InfoRow
          className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
          label={t.portal_subscriptions_period}
          value={<PortalDateChip>{period}</PortalDateChip>}
        />
        <InfoRow
          className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
          label={t.portal_subscriptions_order}
          value={subscription.order_number || t.common_not_set}
        />
        <InfoRow
          className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
          label={t.portal_subscriptions_financial_status}
          value={
            <StatusBadge tone={financialTone(subscription.financial.status)}>
              {financialLabel}
            </StatusBadge>
          }
        />
        <InfoRow
          className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
          label={t.portal_subscriptions_balance_due}
          value={balanceValue}
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PackageCheck className="size-4 text-primary" />
            {t.portal_subscriptions_usage}
          </h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ReceiptText aria-hidden="true" className="size-4 shrink-0" />
            {replaceCount(t.portal_subscriptions_invoice_count, subscription.financial.visible_invoice_count)}
          </span>
        </div>
        {subscription.services.length === 0 ? (
          <p className="text-sm leading-5 text-muted-foreground">
            {t.portal_subscriptions_no_services}
          </p>
        ) : (
          subscription.services.map((service) => (
            <ServiceUsage key={service.id} service={service} />
          ))
        )}
      </div>
    </article>
  );
}

function ServiceUsage({ service }: { service: PortalSubscriptionService }) {
  const { t, lang } = useLang();
  const included = Number(service.included_quantity);
  const used = Number(service.used_quantity);
  const progress = included > 0 ? Math.min(100, Math.max(0, (used / included) * 100)) : 0;
  const unit = (count: string | null | undefined) =>
    subscriptionUnitLabel(service.unit_label, t, lang, Number(count));

  return (
    <div className="border-t border-border/60 pt-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{service.name}</div>
          {service.description && service.description !== service.name ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {service.description}
            </p>
          ) : null}
        </div>
        <div className="text-right font-mono text-xs tabular-nums text-muted-foreground">
          {quantity(service.used_quantity)} / {quantity(service.included_quantity)} {unit(service.included_quantity)}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <UsageMetric
          label={t.portal_subscriptions_included}
          value={`${quantity(service.included_quantity)} ${unit(service.included_quantity)}`}
        />
        <UsageMetric
          label={t.portal_subscriptions_used}
          value={`${quantity(service.used_quantity)} ${unit(service.used_quantity)}`}
        />
        <UsageMetric
          label={t.portal_subscriptions_remaining}
          value={`${quantity(service.remaining_quantity)} ${unit(service.remaining_quantity)}`}
        />
      </div>
      {Number(service.overage_quantity) > 0 ||
      Number(service.pending_overage_quantity) > 0 ||
      Number(service.declined_overage_quantity ?? 0) > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Number(service.overage_quantity) > 0 ? (
            <StatusBadge tone="warning">
              {t.portal_subscriptions_overage}: {quantity(service.overage_quantity)} {unit(service.overage_quantity)}
            </StatusBadge>
          ) : null}
          {Number(service.pending_overage_quantity) > 0 ? (
            <StatusBadge tone="info">
              {t.portal_subscriptions_pending_approval}: {quantity(service.pending_overage_quantity)} {unit(service.pending_overage_quantity)}
            </StatusBadge>
          ) : null}
          {Number(service.declined_overage_quantity ?? 0) > 0 ? (
            <StatusBadge tone="neutral">
              {t.portal_subscriptions_declined}: {quantity(service.declined_overage_quantity ?? "0")} {unit(service.declined_overage_quantity ?? "0")}
            </StatusBadge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-mono font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

// «1 поездок» (QA 2026-11-01, X3 NEW-6): the word follows the count.
const COUNTED_TRIPS: PluralWords = { ru: ["поездка", "поездки", "поездок"], de: ["Fahrt", "Fahrten"] };
const COUNTED_NIGHTS: PluralWords = { ru: ["ночь", "ночи", "ночей"], de: ["Nacht", "Nächte"] };
const COUNTED_APPOINTMENTS: PluralWords = { ru: ["визит", "визита", "визитов"], de: ["Termin", "Termine"] };

function subscriptionUnitLabel(
  rawUnit: string,
  t: ReturnType<typeof useLang>["t"],
  lang: Lang,
  count: number,
) {
  const normalized = rawUnit.trim().toLowerCase();
  if (["unit", "units", "einheit", "einheiten", "шт", "ед"].includes(normalized)) {
    return t.portal_subscriptions_units;
  }
  if (["hour", "hours", "stunde", "stunden", "час", "часы"].includes(normalized)) {
    return t.portal_subscriptions_hours;
  }
  if (["day", "days", "tag", "tage", "день", "дни"].includes(normalized)) {
    return t.portal_subscriptions_days;
  }
  if (["trip", "trips", "ride", "rides", "fahrt", "fahrten", "поездка", "поездки"].includes(normalized)) {
    return pluralWord(lang, count, COUNTED_TRIPS);
  }
  if (["night", "nights", "nacht", "nächte", "ночь", "ночи"].includes(normalized)) {
    return pluralWord(lang, count, COUNTED_NIGHTS);
  }
  if (["appointment", "appointments", "termin", "termine", "приём", "прием"].includes(normalized)) {
    return pluralWord(lang, count, COUNTED_APPOINTMENTS);
  }
  return rawUnit || t.portal_subscriptions_units;
}
