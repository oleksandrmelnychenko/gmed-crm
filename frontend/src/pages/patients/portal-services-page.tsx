import {
  startTransition,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { Building2, LoaderCircle, RefreshCw, Send } from "lucide-react";

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
  selectClass,
  StatCard,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang, type Lang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  cancelPortalService,
  createPortalServiceRequest,
  fetchPortalServices,
} from "@/pages/patients/data/portal-api";
import {
  conciergeServiceKindLabel,
  conciergeServiceSourceLabel,
  formatPortalCurrency,
  formatPortalDateTime,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type { PortalConciergeServiceItem } from "@/pages/patients/model/portal-shared";
import { fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { cn } from "@/lib/utils";

type ServiceRequestFormState = {
  serviceKind: string;
  taxonomyNodeId: string;
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
    taxonomyNodeId: "",
    title: "",
    vendorName: "",
    vendorContact: "",
    startsAt: "",
    endsAt: "",
    costEstimate: "",
    serviceNotes: "",
  };
}

type PatientServicesState = {
  services: PortalConciergeServiceItem[];
  taxonomyLeaves: ProviderTaxonomyNode[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  notice: string;
  requestBusy: boolean;
  requestError: string;
  cancelBusyId: string;
  form: ServiceRequestFormState;
  version: number;
};

type PatientServicesPatch =
  | Partial<PatientServicesState>
  | ((current: PatientServicesState) => Partial<PatientServicesState>);

function patientServicesReducer(
  state: PatientServicesState,
  patch: PatientServicesPatch,
): PatientServicesState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createPatientServicesState(): PatientServicesState {
  return {
    services: [],
    taxonomyLeaves: [],
    loading: true,
    refreshing: false,
    error: "",
    notice: "",
    requestBusy: false,
    requestError: "",
    cancelBusyId: "",
    form: blankServiceRequestForm(),
    version: 0,
  };
}

function toIsoDateTime(value: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function serviceStatusBadgeTone(status: string): StatusTone {
  if (status === "completed") return "success";
  if (status === "booked" || status === "confirmed" || status === "in_service") {
    return "info";
  }
  if (status === "cancelled") return "error";
  return "warning";
}

function taxonomyNodeLabel(node: ProviderTaxonomyNode, lang: Lang) {
  if (lang === "ru") {
    return node.name_ru || node.name_de || node.name_en || node.code;
  }
  return node.name_de || node.name_en || node.name_ru || node.code;
}

function portalServiceTaxonomyLabel(item: PortalConciergeServiceItem, lang: Lang) {
  if (lang === "ru") {
    return item.taxonomy_node_name_ru || item.taxonomy_node_name_de || item.taxonomy_node_code || "";
  }
  return item.taxonomy_node_name_de || item.taxonomy_node_name_ru || item.taxonomy_node_code || "";
}

const PORTAL_SERVICE_REALTIME_EVENTS = [
  "concierge_service.created",
  "concierge_service.updated",
  "concierge_service.cancelled",
  "concierge_service.billing_ready",
] as const;

type PatientServicesRequestSectionProps = {
  form: ServiceRequestFormState;
  lang: Lang;
  taxonomyLeaves: ProviderTaxonomyNode[];
  requestBusy: boolean;
  requestError: string;
  t: Record<string, string>;
  onFormChange: Dispatch<SetStateAction<ServiceRequestFormState>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function PatientServicesRequestSection({
  form,
  lang,
  taxonomyLeaves,
  requestBusy,
  requestError,
  t,
  onFormChange,
  onSubmit,
}: PatientServicesRequestSectionProps) {
  return (
    <Section
      title={t.services_request_title}
      accessory={<Send className="size-4 text-muted-foreground" />}
    >
      <p className="text-sm text-muted-foreground">{t.services_request_description}</p>

      <form className="space-y-4" onSubmit={(event) => void onSubmit(event)}>
        <Field label={t.services_form_service_type}>
          <NativeComboboxSelect
            value={form.serviceKind}
            onChange={(event) =>
              onFormChange((current) => ({
                ...current,
                serviceKind: event.target.value ?? "hotel",
              }))
            }
            className={selectClass}
          >
            <option value="hotel">{t.services_type_hotel}</option>
            <option value="transfer">{t.services_type_transfer}</option>
            <option value="vip_terminal">{t.services_type_vip_terminal}</option>
            <option value="flight">{t.services_type_flight}</option>
            <option value="chauffeur">{t.services_type_chauffeur}</option>
            <option value="translation_support">{t.services_type_translation_support}</option>
            <option value="other">{t.services_type_other}</option>
          </NativeComboboxSelect>
        </Field>

        <Field label={t.services_category}>
          <NativeComboboxSelect
            value={form.taxonomyNodeId}
            onChange={(event) =>
              onFormChange((current) => ({
                ...current,
                taxonomyNodeId: event.target.value ?? "",
              }))
            }
            className={selectClass}
          >
            <option value="">{t.common_not_set}</option>
            {taxonomyLeaves.map((node) => (
              <option key={node.id} value={node.id}>
                {taxonomyNodeLabel(node, lang)}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>

        <Field label={t.services_form_title} htmlFor="portal-service-title">
          <Input
            id="portal-service-title"
            value={form.title}
            onChange={(event) => onFormChange((current) => ({ ...current, title: event.target.value }))}
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
              onChange={(event) => onFormChange((current) => ({ ...current, vendorName: event.target.value }))}
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
              onChange={(event) => onFormChange((current) => ({ ...current, vendorContact: event.target.value }))}
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
              onChange={(event) => onFormChange((current) => ({ ...current, startsAt: event.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field label={t.services_preferred_end}>
            <Input
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => onFormChange((current) => ({ ...current, endsAt: event.target.value }))}
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
            onChange={(event) => onFormChange((current) => ({ ...current, costEstimate: event.target.value }))}
            placeholder="250.00"
            className={inputClass}
          />
        </Field>

        <Field label={t.services_form_notes} htmlFor="portal-service-notes">
          <textarea
            id="portal-service-notes"
            value={form.serviceNotes}
            onChange={(event) => onFormChange((current) => ({ ...current, serviceNotes: event.target.value }))}
            placeholder={t.services_form_notes_placeholder}
            className={cn(textareaClass, "min-h-[132px]")}
          />
        </Field>

        {requestError ? <Banner tone="error">{requestError}</Banner> : null}

        <Button type="submit" className={cn("w-full", tokens.control.primaryButton)} disabled={requestBusy}>
          {requestBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          {t.services_submit}
        </Button>
      </form>
    </Section>
  );
}

export function PatientServicesPage() {
  const { lang, t } = useLang();
  const [pageState, dispatchPageState] = useReducer(
    patientServicesReducer,
    undefined,
    createPatientServicesState,
  );
  const {
    services,
    taxonomyLeaves,
    loading,
    refreshing,
    error,
    notice,
    requestBusy,
    requestError,
    cancelBusyId,
    form,
    version,
  } = pageState;
  const setVersion: Dispatch<SetStateAction<number>> = (nextValue) => {
    dispatchPageState((current) => ({
      version:
        typeof nextValue === "function"
          ? nextValue(current.version)
          : nextValue,
    }));
  };
  const setForm: Dispatch<SetStateAction<ServiceRequestFormState>> = (nextValue) => {
    dispatchPageState((current) => ({
      form:
        typeof nextValue === "function"
          ? nextValue(current.form)
          : nextValue,
    }));
  };

  useRealtimeSubscription(PORTAL_SERVICE_REALTIME_EVENTS, () => {
    clearApiCache("/me/concierge-services");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;
    const initialLoad = loading;

    async function load() {
      dispatchPageState({ refreshing: !initialLoad });

      try {
        const [rows, taxonomy] = await Promise.all([
          fetchPortalServices(),
          fetchProviderTaxonomy("non_medical"),
        ]);
        if (cancelled) return;
        startTransition(() => {
          dispatchPageState({
            services: rows,
            taxonomyLeaves: taxonomy.leaves.filter((node) => node.is_active && node.is_assignable),
            error: "",
            loading: false,
            refreshing: false,
          });
        });
      } catch (err) {
        if (cancelled) return;
        dispatchPageState({
          error: err instanceof Error ? err.message : t.services_failed_load,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [version, t.services_failed_load]);

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
    dispatchPageState({
      requestBusy: true,
      requestError: "",
      notice: "",
    });

    try {
      await createPortalServiceRequest({
        service_kind: form.serviceKind,
        taxonomy_node_id: form.taxonomyNodeId || undefined,
        title: form.title,
        vendor_name: form.vendorName || undefined,
        vendor_contact: form.vendorContact || undefined,
        starts_at: toIsoDateTime(form.startsAt),
        ends_at: toIsoDateTime(form.endsAt),
        cost_estimate: form.costEstimate ? Number(form.costEstimate) : undefined,
        service_notes: form.serviceNotes || undefined,
      });
      dispatchPageState((current) => ({
        notice: t.services_notice_created,
        form: blankServiceRequestForm(),
        version: current.version + 1,
        requestBusy: false,
      }));
    } catch (err) {
      dispatchPageState({
        requestError: err instanceof Error ? err.message : t.services_error_create,
        requestBusy: false,
      });
    }
  }

  async function handleCancel(serviceId: string) {
    dispatchPageState({
      cancelBusyId: serviceId,
      error: "",
      notice: "",
    });

    try {
      await cancelPortalService(serviceId);
      dispatchPageState((current) => ({
        notice: t.services_notice_cancelled,
        version: current.version + 1,
        cancelBusyId: "",
      }));
    } catch (err) {
      dispatchPageState({
        error: err instanceof Error ? err.message : t.services_error_cancel,
        cancelBusyId: "",
      });
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
            className={tokens.control.primaryButton}
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
                        <StatusBadge status={item.status} tone={serviceStatusBadgeTone(item.status)}>
                          {portalStatusLabel(item.status)}
                        </StatusBadge>
                        <CountBadge>
                          {conciergeServiceKindLabel(item.service_kind)}
                        </CountBadge>
                        {portalServiceTaxonomyLabel(item, lang) ? (
                          <CountBadge>
                            {portalServiceTaxonomyLabel(item, lang)}
                          </CountBadge>
                        ) : null}
                        <CountBadge>
                          {conciergeServiceSourceLabel(item.request_source)}
                        </CountBadge>
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
                    <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                      {item.service_notes}
                    </div>
                  ) : null}

                  {item.can_cancel ? (
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        className={tokens.control.accessoryButton}
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

        <PatientServicesRequestSection
          form={form}
          lang={lang}
          taxonomyLeaves={taxonomyLeaves}
          requestBusy={requestBusy}
          requestError={requestError}
          t={t as unknown as Record<string, string>}
          onFormChange={setForm}
          onSubmit={handleSubmit}
        />
      </section>
    </div>
  );
}
