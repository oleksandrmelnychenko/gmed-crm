import { startTransition, useEffect, useMemo, useState, type FormEvent } from "react";
import { Building2, LoaderCircle, RefreshCw, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  InfoRow,
  inputClass,
  ListItem,
  PageHeader,
  Section,
  StatCard,
  SuccessBanner,
  TabLoader,
  textareaClass,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  cancelPortalService,
  createPortalServiceRequest,
  fetchPortalServices,
} from "@/pages/patients/data/portal-api";
import {
  conciergeServiceKindLabel,
  conciergeServiceSourceLabel,
  conciergeServiceStatusTone,
  formatPortalCurrency,
  formatPortalDateTime,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type { PortalConciergeServiceItem } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

type ServiceRequestFormState = {
  serviceKind: string;
  title: string;
  vendorName: string;
  vendorContact: string;
  startsAt: string;
  endsAt: string;
  costEstimate: string;
  serviceNotes: string;
};

function blankServiceRequestForm(): ServiceRequestFormState {
  return {
    serviceKind: "hotel",
    title: "",
    vendorName: "",
    vendorContact: "",
    startsAt: "",
    endsAt: "",
    costEstimate: "",
    serviceNotes: "",
  };
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

const PORTAL_SERVICE_REALTIME_EVENTS = [
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
] as const;

export function PatientServicesPage() {
  const { t } = useLang();
  const [services, setServices] = useState<PortalConciergeServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [cancelBusyId, setCancelBusyId] = useState("");
  const [form, setForm] = useState<ServiceRequestFormState>(blankServiceRequestForm());
  const [version, setVersion] = useState(0);

  useRealtimeSubscription(PORTAL_SERVICE_REALTIME_EVENTS, () => {
    clearApiCache("/me/concierge-services");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await fetchPortalServices();
        if (cancelled) return;
        startTransition(() => {
          setServices(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t.services_failed_load);
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
  }, [loading, version, t.services_failed_load]);

  const openItems = useMemo(
    () => services.filter((item) => !["completed", "cancelled"].includes(item.status)),
    [services],
  );
  const bookedItems = useMemo(
    () => services.filter((item) => ["booked", "confirmed", "in_service"].includes(item.status)),
    [services],
  );
  const completedItems = useMemo(
    () => services.filter((item) => item.status === "completed"),
    [services],
  );
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestBusy(true);
    setRequestError("");
    setNotice("");

    try {
      await createPortalServiceRequest({
        service_kind: form.serviceKind,
        title: form.title,
        vendor_name: form.vendorName || undefined,
        vendor_contact: form.vendorContact || undefined,
        starts_at: toIsoDateTime(form.startsAt),
        ends_at: toIsoDateTime(form.endsAt),
        cost_estimate: form.costEstimate ? Number(form.costEstimate) : undefined,
        service_notes: form.serviceNotes || undefined,
      });
      setNotice(t.services_notice_created);
      setForm(blankServiceRequestForm());
      setVersion((value) => value + 1);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : t.services_error_create);
    } finally {
      setRequestBusy(false);
    }
  }

  async function handleCancel(serviceId: string) {
    setCancelBusyId(serviceId);
    setError("");
    setNotice("");

    try {
      await cancelPortalService(serviceId);
      setNotice(t.services_notice_cancelled);
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.services_error_cancel);
    } finally {
      setCancelBusyId("");
    }
  }

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
        title={t.services_title}
        description={t.services_description}
        actions={
          <Button
            variant="outline"
            className="h-9 rounded-lg"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {t.common_refresh}
          </Button>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={t.services_open_requests} value={String(openItems.length)} />
        <StatCard label={t.services_booked_or_in_service} value={String(bookedItems.length)} />
        <StatCard label={t.services_completed} value={String(completedItems.length)} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4">
          <Section
            title={t.services_history_title}
            accessory={<CountBadge>{services.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">{t.services_history_description}</p>

            {services.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">{t.services_empty_title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t.services_empty_description}</p>
              </EmptyCell>
            ) : (
              services.map((item) => (
                <ListItem key={item.id} className="space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className={cn("rounded-full", conciergeServiceStatusTone(item.status))}>
                          {portalStatusLabel(item.status)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-border bg-muted/30 text-muted-foreground">
                          {conciergeServiceKindLabel(item.service_kind)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-border bg-muted/30 text-muted-foreground">
                          {conciergeServiceSourceLabel(item.request_source)}
                        </Badge>
                      </div>
                      <h2 className="mt-3 text-base font-semibold text-foreground">{item.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {[item.provider_name, item.assigned_concierge_name, item.appointment_title].filter(Boolean).join(" / ") || t.services_care_team_pending}
                      </p>
                    </div>
                    <Building2 className="size-5 text-muted-foreground" />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoRow label={t.services_preferred_start} value={formatPortalDateTime(item.starts_at)} />
                    <InfoRow label={t.services_preferred_end} value={formatPortalDateTime(item.ends_at)} />
                    <InfoRow label={t.services_vendor} value={item.vendor_name || t.common_not_set} />
                    <InfoRow
                      label={t.services_estimate}
                      value={item.cost_estimate ? formatPortalCurrency(item.cost_estimate) : t.common_not_set}
                    />
                    <InfoRow label={t.services_booking_reference} value={item.booking_reference || t.common_not_set} />
                    <InfoRow label={t.services_created_at} value={formatPortalDateTime(item.created_at)} />
                  </div>

                  {item.service_notes ? (
                    <div className="rounded-lg border border-border/50 bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
                      {item.service_notes}
                    </div>
                  ) : null}

                  {item.can_cancel ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 rounded-lg"
                        disabled={cancelBusyId === item.id}
                        onClick={() => void handleCancel(item.id)}
                      >
                        {cancelBusyId === item.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {t.services_cancel_request}
                      </Button>
                    </div>
                  ) : null}
                </ListItem>
              ))
            )}
          </Section>
        </section>

        <Section
          title={t.services_request_title}
          accessory={<Send className="size-4 text-muted-foreground" />}
        >
          <p className="text-sm text-muted-foreground">{t.services_request_description}</p>

          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            <Field label={t.services_form_service_type}>
              <NativeComboboxSelect
                value={form.serviceKind}


                onChange={(event) => setForm((current) => ({
                    ...current,
                    serviceKind: event.target.value ?? "hotel",
                  }))} className={cn("w-full", inputClass)}>
                  <option value="hotel">{t.services_type_hotel}</option>
                  <option value="transfer">{t.services_type_transfer}</option>
                  <option value="vip_terminal">{t.services_type_vip_terminal}</option>
                  <option value="flight">{t.services_type_flight}</option>
                  <option value="chauffeur">{t.services_type_chauffeur}</option>
                  <option value="translation_support">{t.services_type_translation_support}</option>
                  <option value="other">{t.services_type_other}</option>
                </NativeComboboxSelect>
            </Field>

            <Field label={t.services_form_title} htmlFor="portal-service-title">
              <Input
                id="portal-service-title"
                value={form.title}
                onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                placeholder={t.services_form_title_placeholder}
                className={inputClass}
                required
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t.services_form_preferred_vendor}
                htmlFor="portal-service-vendor"
              >
                <Input
                  id="portal-service-vendor"
                  value={form.vendorName}
                  onChange={(event) => setForm((current) => ({ ...current, vendorName: event.target.value }))}
                  placeholder={t.services_form_preferred_vendor_placeholder}
                  className={inputClass}
                />
              </Field>
              <Field
                label={t.services_form_vendor_contact}
                htmlFor="portal-service-vendor-contact"
              >
                <Input
                  id="portal-service-vendor-contact"
                  value={form.vendorContact}
                  onChange={(event) => setForm((current) => ({ ...current, vendorContact: event.target.value }))}
                  placeholder={t.services_form_vendor_contact_placeholder}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.services_preferred_start}>
                <Input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label={t.services_preferred_end}>
                <Input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))}
                  className={inputClass}
                />
              </Field>
            </div>

            <Field label={t.services_form_budget} htmlFor="portal-service-budget">
              <Input
                id="portal-service-budget"
                type="number"
                min="0"
                step="0.01"
                value={form.costEstimate}
                onChange={(event) => setForm((current) => ({ ...current, costEstimate: event.target.value }))}
                placeholder="250.00"
                className={inputClass}
              />
            </Field>

            <Field label={t.services_form_notes} htmlFor="portal-service-notes">
              <textarea
                id="portal-service-notes"
                value={form.serviceNotes}
                onChange={(event) => setForm((current) => ({ ...current, serviceNotes: event.target.value }))}
                placeholder={t.services_form_notes_placeholder}
                className={cn(textareaClass, "min-h-[132px]")}
              />
            </Field>

            {requestError ? <Banner tone="error">{requestError}</Banner> : null}

            <Button type="submit" className="h-9 w-full rounded-lg" disabled={requestBusy}>
              {requestBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t.services_submit}
            </Button>
          </form>
        </Section>
      </section>
    </div>
  );
}
