import { formatPortalTimeWindow } from "@/lib/portal-datetime";
import { PortalInfoRow as InfoRow, PortalListItem as ListItem, PortalDateChip, PortalSection as Section, PortalSummary } from "./ui/portal-page-layout";
import {
  startTransition,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { Building2, ConciergeBell, LoaderCircle, Plus, RefreshCw, Send } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { AdminDialogScaffold } from "@/components/admin-dialog-scaffold";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  inputClass,
  PageHeader,
  selectClass,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  textareaClass,
  tokens,
  type StatusTone,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { appDateKey, berlinLocalInputToIso } from "@/lib/app-time-zone";
import { uiText, useLang, type Lang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  cancelPortalService,
  createPortalServiceRequest,
  fetchPortalServices,
} from "@/pages/patients/data/portal-api";
import {
  usePortalLabels,
} from "@/pages/patients/model/portal-shared";
import type { PortalConciergeServiceItem } from "@/pages/patients/model/portal-shared";
import { fetchProviderTaxonomy } from "@/pages/providers/data/provider-api";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderTaxonomyCascadeSelect } from "@/pages/providers/ui/provider-taxonomy-cascade-select";
import { cn } from "@/lib/utils";
import { formatMoneyLabel } from "@/lib/money";
import { portalServiceContext } from "./model/portal-service-context";
import { portalServiceNotes } from "./model/portal-service-notes";

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
  return berlinLocalInputToIso(value) ?? undefined;
}

function serviceStatusBadgeTone(status: string): StatusTone {
  if (status === "completed") return "success";
  if (status === "booked" || status === "confirmed" || status === "in_service") {
    return "info";
  }
  if (status === "cancelled") return "error";
  return "warning";
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
  taxonomyLeaves: ProviderTaxonomyNode[];
  requestBusy: boolean;
  requestError: string;
  t: Record<string, string>;
  onFormChange: Dispatch<SetStateAction<ServiceRequestFormState>>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
};

function PatientServicesRequestSection({
  form,
  taxonomyLeaves,
  requestBusy,
  requestError,
  t,
  onFormChange,
  onSubmit,
}: PatientServicesRequestSectionProps) {
  return (
    <AdminDialogScaffold
      title={t.services_request_title}
      description={t.services_request_description}
      bodyClassName="bg-card [&_label]:font-mono [&_label]:text-xs"
      onSubmit={(event) => void onSubmit(event)}
      footer={
        <div className="flex justify-end px-4 py-3">
          <Button type="submit" className="h-auto min-h-9 max-w-full whitespace-normal" disabled={requestBusy}>
            {requestBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            {t.services_submit}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <Field label={t.services_category}>
          <ProviderTaxonomyCascadeSelect
            value={form.taxonomyNodeId}
            nodes={taxonomyLeaves}
            providerType="non_medical"
            mode="leaf"
            placeholder={t.common_not_set}
            containerClassName="grid gap-2 sm:grid-cols-2"
            selectClassName={selectClass}
            onChange={(taxonomyNodeId) =>
              onFormChange((current) => ({
                ...current,
                taxonomyNodeId,
              }))
            }
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
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

        <div className="grid gap-3 sm:grid-cols-2">
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

        <Field label={t.services_form_budget} htmlFor="portal-service-budget" className="max-w-xs">
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
            className={cn(textareaClass, "min-h-24")}
          />
        </Field>

        {requestError ? <Banner tone="error">{requestError}</Banner> : null}

      </div>
    </AdminDialogScaffold>
  );
}

export function PatientServicesPage() {
  const [requestOpen, setRequestOpen] = useState(false);
  const {
    conciergeServiceKindLabel,
    conciergeServiceSourceLabel,
    portalStatusLabel,
  } = usePortalLabels();
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
            taxonomyLeaves: taxonomy.nodes.filter((node) => node.is_active),
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
    // Said in the portal's language before sending; the server refuses the
    // same with a code (global QA 2026-11-10: "ends_at must be later …").
    // A start on a day that has passed was taken and planned (QA 2026-11-11 V-17); today counts.
    if (form.startsAt && form.startsAt.slice(0, 10) < appDateKey()) {
      dispatchPageState({ requestError: uiText("api_portal_service_start_in_past", lang), notice: "" });
      return;
    }
    if (form.startsAt && form.endsAt && form.endsAt <= form.startsAt) {
      dispatchPageState({ requestError: uiText("api_portal_service_period_inverted", lang), notice: "" });
      return;
    }
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
        // The patient's own budget: shown back to the patient, never replaced by staff.
        patient_budget: form.costEstimate ? Number(form.costEstimate) : undefined,
        // Stored as the patient's own note; staff never overwrite it.
        patient_note: form.serviceNotes || undefined,
      });
      setRequestOpen(false);
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
    <div className="w-full min-w-0 max-w-none space-y-3">
      <PageHeader
        pageAction={<Button onClick={() => setRequestOpen(true)}><Plus className="size-4" />{t.services_request_title}</Button>}
        title={t.services_title}
        description={t.services_description}
        actions={
          <Button
            variant="default"
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

      <PortalSummary items={[
        { label: t.services_open_requests, value: openItems.length, visible: openItems.length > 0 },
        { label: t.services_booked_or_in_service, value: bookedItems.length, visible: bookedItems.length > 0 },
        { label: t.services_completed, value: completedItems.length, visible: completedItems.length > 0 },
      ]} />

      <section className="space-y-3">
        <section className="space-y-3">
          <Section
            icon={ConciergeBell} title={t.services_history_title}
            accessory={services.length > 0 ? <CountBadge>{services.length}</CountBadge> : undefined}
          >

            {services.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">{t.services_empty_title}</p>
                <p className="mt-2 text-sm text-muted-foreground">{t.services_empty_description}</p>
              </EmptyCell>
            ) : (
              services.map((item) => {
                const contextParts = [item.provider_name, item.assigned_concierge_name, item.appointment_title]
                  .filter((value): value is string => Boolean(value?.trim()));
                const context = portalServiceContext(item);
                const { starts_at: start, ends_at: end } = item;
                const period = formatPortalTimeWindow(start, end);
                return (
                  <ListItem key={item.id} className="portal-service-card space-y-3">
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
                          {item.request_source && item.request_source !== "patient_portal" && <CountBadge>{conciergeServiceSourceLabel(item.request_source)}</CountBadge>}
                        </div>
                        <h2 className="mt-2 text-base font-semibold text-foreground">{item.title}</h2>
                        {context || contextParts.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">
                          {context || t.services_care_team_pending}
                        </p> : null}
                      </div>
                      <Building2 className="size-5 text-muted-foreground" />
                    </div>

                    {period && <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{start && end ? t.portal_appointments_time_window : start ? t.services_preferred_start : t.services_preferred_end}</span>
                      <PortalDateChip>{period}</PortalDateChip>
                    </div>}
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {item.vendor_name && <InfoRow label={t.services_vendor} value={item.vendor_name} />}
                      {item.booking_reference && <InfoRow label={t.services_booking_reference} value={item.booking_reference} />}
                      {item.patient_budget != null && item.patient_budget !== "" ? (
                        <InfoRow label={t.services_your_budget} value={formatMoneyLabel(item.patient_budget, item.currency)} />
                      ) : null}
                      <InfoRow label={t.services_created_at} value={<PortalDateChip timestamp={item.created_at} />} />
                    </div>

                    {portalServiceNotes(item).map((note) => (
                      <div key={note.kind} className={cn("rounded-lg px-3 py-2 text-sm leading-6 text-foreground", tokens.surface.mutedCard)}>
                        <p className="text-xs font-medium text-muted-foreground">
                          {note.kind === "own" ? t.services_own_note : t.services_care_team_note}
                        </p>
                        <p className="whitespace-pre-wrap">{note.text}</p>
                      </div>
                    ))}

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
                );
              })
            )}
          </Section>
        </section>

        <Dialog open={requestOpen} onOpenChange={(open) => {
          if (requestBusy) return;
          setRequestOpen(open);
          if (!open) dispatchPageState({ form: blankServiceRequestForm(), requestError: "" });
        }}>
        <PatientServicesRequestSection
          form={form}
          taxonomyLeaves={taxonomyLeaves}
          requestBusy={requestBusy}
          requestError={requestError}
          t={t as unknown as Record<string, string>}
          onFormChange={setForm}
          onSubmit={handleSubmit}
        />
        </Dialog>
      </section>
    </div>
  );
}
