import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  startTransition,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import { CalendarClock, LoaderCircle, RefreshCw, Send, Stethoscope } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  InfoRow,
  ListItem,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
  SuccessBanner,
  TabLoader,
  TabShell,
  inputClass,
  selectClass,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { clearApiCache } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  createPortalAppointmentRequest,
  fetchPortalAppointmentsWorkspace,
} from "@/pages/patients/data/portal-api";
import {
  appointmentCarePathKindLabel,
  appointmentRequestStatusTone,
  appointmentStatusTone,
  appointmentTimeOfDayLabel,
  appointmentTypeLabel,
  followupStatusTone,
  formatPortalDate,
  formatPortalDateTime,
  portalOrderPhaseLabel as sharedPortalOrderPhaseLabel,
  portalStatusLabel,
} from "@/pages/patients/model/portal-shared";
import type {
  PortalAppointmentItem,
  PortalAppointmentRequestItem,
  PortalFollowupMilestoneItem,
} from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

type RequestFormState = {
  appointmentType: "medical" | "non_medical";
  carePathKind: "regular" | "preventive" | "control" | "followup";
  preferredDateFrom: string;
  preferredDateTo: string;
  preferredTimeOfDay: string;
  specialty: string;
  location: string;
  reason: string;
  notes: string;
};

function blankRequestForm(): RequestFormState {
  return {
    appointmentType: "medical",
    carePathKind: "regular",
    preferredDateFrom: "",
    preferredDateTo: "",
    preferredTimeOfDay: "flexible",
    specialty: "",
    location: "",
    reason: "",
    notes: "",
  };
}

type PatientAppointmentsState = {
  appointments: PortalAppointmentItem[];
  requests: PortalAppointmentRequestItem[];
  followupMilestones: PortalFollowupMilestoneItem[];
  loading: boolean;
  refreshing: boolean;
  error: string;
  notice: string;
  requestBusy: boolean;
  requestError: string;
  requestForm: RequestFormState;
  version: number;
};

type PatientAppointmentsPatch =
  | Partial<PatientAppointmentsState>
  | ((current: PatientAppointmentsState) => Partial<PatientAppointmentsState>);

function patientAppointmentsReducer(
  state: PatientAppointmentsState,
  patch: PatientAppointmentsPatch,
): PatientAppointmentsState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function createPatientAppointmentsState(): PatientAppointmentsState {
  return {
    appointments: [],
    requests: [],
    followupMilestones: [],
    loading: true,
    refreshing: false,
    error: "",
    notice: "",
    requestBusy: false,
    requestError: "",
    requestForm: blankRequestForm(),
    version: 0,
  };
}

const PORTAL_APPOINTMENT_REALTIME_EVENTS = [
  "appointment.created",
  "appointment.updated",
  "appointment.status_changed",
  "appointment_request.created",
  "appointment_request.reviewed",
  "appointment_request.converted",
  "order.phase_changed",
  "order.followup_flow_updated",
  "order.external_invoice_overdue",
] as const;

function portalOrderPhaseLabel(
  value: string | null | undefined,
) {
  return sharedPortalOrderPhaseLabel(value);
}

function formatPortalCountLabel(template: string, count: number) {
  return template.replace("{count}", String(count));
}

function usePatientAppointmentsPageContent() {
  const { t } = useLang();
  const [pageState, dispatchPageState] = useReducer(
    patientAppointmentsReducer,
    undefined,
    createPatientAppointmentsState,
  );
  const {
    appointments,
    requests,
    followupMilestones,
    loading,
    refreshing,
    error,
    notice,
    requestBusy,
    requestError,
    requestForm,
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
  const setRequestForm: Dispatch<SetStateAction<RequestFormState>> = (nextValue) => {
    dispatchPageState((current) => ({
      requestForm:
        typeof nextValue === "function"
          ? nextValue(current.requestForm)
          : nextValue,
    }));
  };

  useRealtimeSubscription(PORTAL_APPOINTMENT_REALTIME_EVENTS, () => {
    clearApiCache("/me/appointments");
    clearApiCache("/me/appointment-requests");
    clearApiCache("/me/followup-milestones");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;
    const initialLoad = loading;

    async function load() {
      dispatchPageState({ refreshing: !initialLoad });

      try {
        const workspace = await fetchPortalAppointmentsWorkspace();

        if (cancelled) return;
        startTransition(() => {
          dispatchPageState({
            appointments: workspace.appointments,
            requests: workspace.requests,
            followupMilestones: workspace.followupMilestones,
            error: "",
            loading: false,
            refreshing: false,
          });
        });
      } catch (err) {
        if (cancelled) return;
        dispatchPageState({
          error:
            err instanceof Error
              ? err.message
              : t.portal_appointments_failed_to_load_appointment_workspace,
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [t.portal_appointments_failed_to_load_appointment_workspace, version]);

  const upcomingAppointments = useMemo(
    () => appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10)),
    [appointments],
  );
  const openRequests = useMemo(
    () => requests.filter((item) => !["rejected", "converted", "cancelled"].includes(item.status)),
    [requests],
  );
  const nextAppointment = useMemo(
    () => {
      let next: PortalAppointmentItem | null = null;
      for (const appointment of upcomingAppointments) {
        if (
          !next ||
          `${appointment.date}${appointment.time_start ?? ""}`.localeCompare(
            `${next.date}${next.time_start ?? ""}`,
          ) < 0
        ) {
          next = appointment;
        }
      }
      return next;
    },
    [upcomingAppointments],
  );

  async function handleSubmitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchPageState({
      requestBusy: true,
      requestError: "",
      notice: "",
    });

    try {
      await createPortalAppointmentRequest({
        appointment_type: requestForm.appointmentType,
        care_path_kind:
          requestForm.appointmentType === "medical"
            ? requestForm.carePathKind
            : "regular",
        preferred_date_from: requestForm.preferredDateFrom || undefined,
        preferred_date_to: requestForm.preferredDateTo || undefined,
        preferred_time_of_day: requestForm.preferredTimeOfDay || undefined,
        specialty: requestForm.specialty || undefined,
        location: requestForm.location || undefined,
        reason: requestForm.reason || undefined,
        notes: requestForm.notes || undefined,
      });
      dispatchPageState((current) => ({
        notice: t.portal_appointments_appointment_request_sent_to_the_care_team,
        requestForm: blankRequestForm(),
        version: current.version + 1,
        requestBusy: false,
      }));
    } catch (err) {
      dispatchPageState({
        requestError:
          err instanceof Error
            ? err.message
            : t.portal_appointments_failed_to_send_appointment_request,
        requestBusy: false,
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
    <TabShell className="mt-0 space-y-6">
      <PageHeader
        title={t.portal_appointments_my_appointments}
        description={t.portal_appointments_review_scheduled_visits_and_send_new_appointment_requests_for_th}
        actions={
          <>
            <CountBadge>{t.portal_appointments_patient_portal}</CountBadge>
            <Button
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {t.portal_appointments_refresh}
            </Button>
          </>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={t.portal_appointments_upcoming_visits} value={String(upcomingAppointments.length)} />
        <StatCard label={t.portal_appointments_open_requests} value={String(openRequests.length)} />
        <StatCard
          label={t.portal_appointments_next_slot}
          value={nextAppointment ? formatPortalDate(nextAppointment.date) : t.portal_appointments_not_set}
          description={nextAppointment ? nextAppointment.title : t.portal_appointments_no_upcoming_visits}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
        <section className="space-y-4">
          <Section
            title={t.portal_appointments_scheduled_visits}
            accessory={<CountBadge>{appointments.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {t.portal_appointments_your_non_internal_appointments_currently_linked_to_the_patient_r}
            </p>

            {appointments.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">{t.portal_appointments_no_appointments_yet}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {t.portal_appointments_once_a_visit_is_scheduled_by_the_care_team_it_will_appear_here}
                </p>
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {appointments.map((item) => (
                  <ListItem key={item.id} className="space-y-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap gap-2">
                          <StatusBadge status={item.status} className={appointmentStatusTone(item.status)}>
                            {portalStatusLabel(item.status)}
                          </StatusBadge>
                          <StatusBadge tone="neutral" className="normal-case tracking-normal">
                            {appointmentTypeLabel(item.appointment_type)}
                          </StatusBadge>
                          <StatusBadge tone="brand" className="normal-case tracking-normal">
                            {appointmentCarePathKindLabel(item.care_path_kind)}
                          </StatusBadge>
                        </div>
                        <h2 className="mt-3 text-base font-semibold text-foreground">{item.title}</h2>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {[item.provider_name, item.doctor_name, item.location].filter(Boolean).join(" / ")}
                        </p>
                      </div>
                      <CalendarClock className="size-5 text-muted-foreground" />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={t.portal_appointments_date}
                        value={formatPortalDate(item.date)}
                      />
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={t.portal_appointments_time}
                        value={[item.time_start, item.time_end].filter(Boolean).join(" - ") || t.portal_appointments_not_set}
                      />
                    </div>
                  </ListItem>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={t.portal_appointments_follow_up_milestones}
            accessory={<CountBadge>{followupMilestones.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {t.portal_appointments_post_care_milestones_linked_to_your_current_orders_even_when_the}
            </p>

            {followupMilestones.length === 0 ? (
              <EmptyCell>
                {t.portal_appointments_no_follow_up_milestones_are_visible_yet}
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {followupMilestones.map((item) => {
                  const milestoneRows = [
                    {
                      label: t.portal_appointments_doctor_directed,
                      value: portalStatusLabel(item.doctor_followup_status),
                      tone: followupStatusTone(item.doctor_followup_status),
                    },
                    {
                      label: t.portal_appointments_1_week,
                      value: portalStatusLabel(item.followup_1w_status),
                      tone: followupStatusTone(item.followup_1w_status),
                      hint: formatPortalDateTime(item.recommended_followup_1w_at),
                    },
                    {
                      label: t.portal_appointments_1_month,
                      value: portalStatusLabel(item.followup_1m_status),
                      tone: followupStatusTone(item.followup_1m_status),
                      hint: formatPortalDateTime(item.recommended_followup_1m_at),
                    },
                    {
                      label: t.portal_appointments_6_month,
                      value: portalStatusLabel(item.followup_6m_status),
                      tone: followupStatusTone(item.followup_6m_status),
                      hint: formatPortalDateTime(item.recommended_followup_6m_at),
                    },
                    {
                      label: t.portal_appointments_package_end,
                      value: portalStatusLabel(item.package_end_status),
                      tone: followupStatusTone(item.package_end_status),
                      hint: formatPortalDate(item.package_end_date ?? item.suggested_package_end_date),
                    },
                    {
                      label: t.portal_appointments_results_handoff,
                      value: portalStatusLabel(item.results_handoff_status),
                      tone: followupStatusTone(item.results_handoff_status),
                      hint: formatPortalCountLabel(t.portal_appointments_shared_documents_count, item.results_portal_shares),
                    },
                  ];

                  return (
                    <ListItem key={item.order_id} className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {item.order_number} / {portalOrderPhaseLabel(item.phase)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t.portal_appointments_closure_anchor} {formatPortalDateTime(item.closure_anchor_at)}
                          </p>
                        </div>
                        <StatusBadge tone={item.followup_ready ? "success" : "warning"}>
                          {item.followup_ready ? t.portal_appointments_ready : t.portal_appointments_in_progress}
                        </StatusBadge>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {milestoneRows.map((milestone) => (
                          <div key={milestone.label} className={cn("rounded-lg p-3", tokens.surface.mutedCard)}>
                            <InfoRow
                              label={milestone.label}
                              value={
                                <span className="flex flex-col items-start gap-2">
                                  <StatusBadge className={milestone.tone}>{milestone.value}</StatusBadge>
                                  {milestone.hint ? <span className="text-xs text-muted-foreground">{milestone.hint}</span> : null}
                                </span>
                              }
                            />
                          </div>
                        ))}
                      </div>

                      {item.followup_summary ? (
                        <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                          {item.followup_summary}
                        </div>
                      ) : null}
                    </ListItem>
                  );
                })}
              </div>
            )}
          </Section>

          <Section
            title={t.portal_appointments_request_history}
            accessory={<CountBadge>{requests.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {t.portal_appointments_portal_appointment_requests_and_their_review_status}
            </p>

            {requests.length === 0 ? (
              <EmptyCell>
                {t.portal_appointments_no_requests_submitted_yet}
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {requests.map((item) => (
                  <ListItem key={item.id} className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {appointmentTypeLabel(item.appointment_type)} {t.portal_appointments_request}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {appointmentCarePathKindLabel(item.care_path_kind)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.portal_appointments_requested} {formatPortalDateTime(item.requested_at)}
                        </p>
                      </div>
                      <StatusBadge status={item.status} className={appointmentRequestStatusTone(item.status)}>
                        {portalStatusLabel(item.status)}
                      </StatusBadge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={t.portal_appointments_preferred_from}
                        value={formatPortalDate(item.preferred_date_from)}
                      />
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={t.portal_appointments_time_window}
                        value={appointmentTimeOfDayLabel(item.preferred_time_of_day)}
                      />
                    </div>
                    {item.reason ? <p className="text-sm text-muted-foreground">{item.reason}</p> : null}
                    {item.review_note ? (
                      <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                        {t.portal_appointments_review_note}: {item.review_note}
                      </div>
                    ) : null}
                    {item.converted_appointment_id ? (
                      <SuccessBanner>
                        {t.portal_appointments_scheduled_as} {item.converted_appointment_title || t.portal_appointments_appointment} {t.portal_appointments_on} {formatPortalDate(item.converted_appointment_date)}
                      </SuccessBanner>
                    ) : null}
                  </ListItem>
                ))}
              </div>
            )}
          </Section>
        </section>

        <Section
          title={t.portal_appointments_request_a_visit}
          accessory={<Stethoscope className="size-4 text-muted-foreground" />}
        >
          <p className="text-sm text-muted-foreground">
            {t.portal_appointments_send_preferred_dates_and_context_the_care_team_reviews_and_conve}
          </p>
          <form className="space-y-4" onSubmit={(event) => void handleSubmitRequest(event)}>
            <Field label={t.portal_appointments_type} htmlFor="portal-appointment-type">
              <NativeComboboxSelect
                id="portal-appointment-type"
                value={requestForm.appointmentType}
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    appointmentType: event.target.value as "medical" | "non_medical",
                    carePathKind:
                      event.target.value === "medical" ? current.carePathKind : "regular",
                  }))
                }
                className={selectClass}
              >
                <option value="medical">{t.portal_appointments_medical}</option>
                <option value="non_medical">{t.portal_appointments_non_medical}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={t.portal_appointments_care_path} htmlFor="portal-appointment-care-path">
              <NativeComboboxSelect
                id="portal-appointment-care-path"
                value={requestForm.carePathKind}
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    carePathKind: event.target.value as "regular" | "preventive" | "control" | "followup",
                  }))
                }
                disabled={requestForm.appointmentType !== "medical"}
                className={selectClass}
              >
                <option value="regular">{t.portal_appointments_regular}</option>
                <option value="preventive">{t.portal_appointments_preventive}</option>
                <option value="control">{t.portal_appointments_control}</option>
                <option value="followup">{t.portal_appointments_follow_up}</option>
              </NativeComboboxSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t.portal_appointments_preferred_from} htmlFor="portal-appointment-preferred-from">
                <Input
                  id="portal-appointment-preferred-from"
                  type="date"
                  value={requestForm.preferredDateFrom}
                  onChange={(event) => setRequestForm((current) => ({ ...current, preferredDateFrom: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label={t.portal_appointments_preferred_to} htmlFor="portal-appointment-preferred-to">
                <Input
                  id="portal-appointment-preferred-to"
                  type="date"
                  value={requestForm.preferredDateTo}
                  onChange={(event) => setRequestForm((current) => ({ ...current, preferredDateTo: event.target.value }))}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={t.portal_appointments_time_window} htmlFor="portal-appointment-time-window">
              <NativeComboboxSelect
                id="portal-appointment-time-window"
                value={requestForm.preferredTimeOfDay}
                onChange={(event) => setRequestForm((current) => ({ ...current, preferredTimeOfDay: event.target.value }))}
                className={selectClass}
              >
                <option value="flexible">{t.portal_appointments_flexible}</option>
                <option value="morning">{t.portal_appointments_morning}</option>
                <option value="midday">{t.portal_appointments_midday}</option>
                <option value="afternoon">{t.portal_appointments_afternoon}</option>
                <option value="evening">{t.portal_appointments_evening}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={t.portal_appointments_specialty_or_topic} htmlFor="portal-appointment-specialty">
              <input
                id="portal-appointment-specialty"
                value={requestForm.specialty}
                onChange={(event) => setRequestForm((current) => ({ ...current, specialty: event.target.value }))}
                placeholder={t.portal_appointments_cardiology_diagnostics_transfer_hotel_etc}
                className={cn(inputClass, "w-full border border-input px-3 text-sm")}
              />
            </Field>
            <Field label={t.portal_appointments_location_preference} htmlFor="portal-appointment-location">
              <input
                id="portal-appointment-location"
                value={requestForm.location}
                onChange={(event) => setRequestForm((current) => ({ ...current, location: event.target.value }))}
                placeholder={t.portal_appointments_clinic_city_or_remote_request}
                className={cn(inputClass, "w-full border border-input px-3 text-sm")}
              />
            </Field>
            <Field label={t.portal_appointments_reason} htmlFor="portal-appointment-reason">
              <textarea
                id="portal-appointment-reason"
                value={requestForm.reason}
                onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder={t.portal_appointments_what_do_you_need_and_what_should_the_team_consider}
                className={cn(textareaClass, "min-h-[120px]")}
              />
            </Field>
            <Field label={t.portal_appointments_additional_note} htmlFor="portal-appointment-notes">
              <textarea
                id="portal-appointment-notes"
                value={requestForm.notes}
                onChange={(event) => setRequestForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={t.portal_appointments_optional_logistical_or_clinical_context}
                className={cn(textareaClass, "min-h-[100px]")}
              />
            </Field>
            {requestError ? <Banner tone="error">{requestError}</Banner> : null}
            <Button
              type="submit"
              className="h-9 w-full rounded-lg"
              disabled={requestBusy}
            >
              {requestBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {t.portal_appointments_send_appointment_request}
            </Button>
          </form>
        </Section>
      </section>
    </TabShell>
  );
}

export function PatientAppointmentsPage(...args: Parameters<typeof usePatientAppointmentsPageContent>) {
  return usePatientAppointmentsPageContent(...args);
}
