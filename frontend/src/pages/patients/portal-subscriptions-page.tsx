import { useEffect, useMemo, useState } from "react";
import { CalendarRange, LoaderCircle, PackageCheck, ReceiptText, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Banner,
  CountBadge,
  EmptyCell,
  InfoRow,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  TabLoader,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { fetchPortalSubscriptions } from "@/pages/patients/data/portal-api";
import {
  formatPortalCurrency,
  formatPortalDate,
  portalStatusLabel,
  type PortalSubscriptionFinancial,
  type PortalSubscriptionItem,
  type PortalSubscriptionService,
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
  const { t } = useLang();
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
    <div className="space-y-4">
      <PageHeader
        title={t.portal_subscriptions_title}
        description={t.portal_subscriptions_subtitle}
        actions={
          <>
            <CountBadge>{t.portal_subscriptions_eyebrow}</CountBadge>
            <Button
              type="button"
              variant="outline"
              className={tokens.control.primaryButton}
              onClick={() => staffGo("/invoices")}
            >
              <ReceiptText className="size-4" />
              {t.portal_subscriptions_open_invoices}
            </Button>
            <Button
              type="button"
              variant="outline"
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

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard
          label={t.portal_subscriptions_total}
          value={String(subscriptions.length)}
          description={`${grouped.active.length} ${t.portal_subscriptions_active.toLocaleLowerCase()}`}
        />
        <StatCard
          label={t.portal_subscriptions_included_services}
          value={String(serviceCount)}
        />
        <StatCard
          label={t.portal_subscriptions_payment_attention}
          value={String(paymentAttentionCount)}
        />
      </section>

      <SubscriptionSection
        title={t.portal_subscriptions_active}
        subscriptions={grouped.active}
        emptyDescription={t.portal_subscriptions_empty_description}
      />
      <SubscriptionSection
        title={t.portal_subscriptions_upcoming}
        subscriptions={grouped.upcoming}
        emptyDescription={t.portal_subscriptions_empty_description}
      />
      <SubscriptionSection
        title={t.portal_subscriptions_completed}
        subscriptions={grouped.completed}
        emptyDescription={t.portal_subscriptions_empty_description}
      />
    </div>
  );
}

function SubscriptionSection({
  title,
  subscriptions,
  emptyDescription,
}: {
  title: string;
  subscriptions: PortalSubscriptionItem[];
  emptyDescription: string;
}) {
  const { t } = useLang();

  return (
    <Section
      title={title}
      accessory={<CountBadge>{subscriptions.length}</CountBadge>}
    >
      {subscriptions.length === 0 ? (
        <EmptyCell>
          <p className="text-base font-semibold text-foreground">
            {t.portal_subscriptions_empty_title}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{emptyDescription}</p>
        </EmptyCell>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {subscriptions.map((subscription) => (
            <SubscriptionCard key={subscription.id} subscription={subscription} />
          ))}
        </div>
      )}
    </Section>
  );
}

function SubscriptionCard({ subscription }: { subscription: PortalSubscriptionItem }) {
  const { t } = useLang();
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
  const lifecycleLabel = {
    active: t.portal_subscriptions_active,
    upcoming: t.portal_subscriptions_upcoming,
    completed: t.portal_subscriptions_completed,
  }[subscription.lifecycle];
  const balanceValue =
    subscription.financial.balance_disclosure === "visible"
      ? formatPortalCurrency(subscription.financial.balance_due)
      : subscription.financial.balance_disclosure === "shared_order"
        ? t.portal_subscriptions_balance_shared_order
        : t.portal_subscriptions_amount_hidden;

  return (
    <article className={cn("space-y-5 rounded-xl p-4", tokens.surface.card)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={tokens.text.eyebrow}>{lifecycleLabel}</div>
          <h2 className="mt-2 text-lg font-semibold text-foreground">
            {subscription.package_name}
          </h2>
          {subscription.description ? (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
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

      <div className="grid gap-3 sm:grid-cols-2">
        <InfoRow
          className={cn("rounded-lg px-3 py-2", tokens.surface.mutedCard)}
          label={t.portal_subscriptions_period}
          value={period}
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

      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ReceiptText className="size-3.5" />
        {replaceCount(
          t.portal_subscriptions_invoice_count,
          subscription.financial.visible_invoice_count,
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <PackageCheck className="size-4 text-primary" />
            {t.portal_subscriptions_usage}
          </h3>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarRange className="size-3.5" />
            {period}
          </span>
        </div>
        {subscription.services.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
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
  const { t } = useLang();
  const included = Number(service.included_quantity);
  const used = Number(service.used_quantity);
  const progress = included > 0 ? Math.min(100, Math.max(0, (used / included) * 100)) : 0;
  const unit = subscriptionUnitLabel(service.unit_label, t);

  return (
    <div className="rounded-lg border border-border/70 bg-background/60 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{service.name}</div>
          {service.description && service.description !== service.name ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {service.description}
            </p>
          ) : null}
        </div>
        <div className="text-right font-mono text-xs tabular-nums text-muted-foreground">
          {quantity(service.used_quantity)} / {quantity(service.included_quantity)} {unit}
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <UsageMetric
          label={t.portal_subscriptions_included}
          value={`${quantity(service.included_quantity)} ${unit}`}
        />
        <UsageMetric
          label={t.portal_subscriptions_used}
          value={`${quantity(service.used_quantity)} ${unit}`}
        />
        <UsageMetric
          label={t.portal_subscriptions_remaining}
          value={`${quantity(service.remaining_quantity)} ${unit}`}
        />
      </div>
      {Number(service.overage_quantity) > 0 || Number(service.pending_overage_quantity) > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {Number(service.overage_quantity) > 0 ? (
            <StatusBadge tone="warning">
              {t.portal_subscriptions_overage}: {quantity(service.overage_quantity)} {unit}
            </StatusBadge>
          ) : null}
          {Number(service.pending_overage_quantity) > 0 ? (
            <StatusBadge tone="info">
              {t.portal_subscriptions_pending_approval}: {quantity(service.pending_overage_quantity)} {unit}
            </StatusBadge>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function UsageMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-2 py-1.5">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-mono font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function subscriptionUnitLabel(
  rawUnit: string,
  t: ReturnType<typeof useLang>["t"],
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
  if (["trip", "trips", "fahrt", "fahrten", "поездка", "поездки"].includes(normalized)) {
    return t.portal_subscriptions_trips;
  }
  if (["night", "nights", "nacht", "nächte", "ночь", "ночи"].includes(normalized)) {
    return t.portal_subscriptions_nights;
  }
  if (["appointment", "appointments", "termin", "termine", "приём", "прием"].includes(normalized)) {
    return t.portal_subscriptions_appointments;
  }
  return rawUnit || t.portal_subscriptions_units;
}
