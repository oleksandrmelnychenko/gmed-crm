import { PortalInfoRow as InfoRow, PortalListItem as ListItem, PortalDateChip, PortalSection as Section, PortalSummary } from "./ui/portal-page-layout";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";
import {
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardPen,
  History,
  LoaderCircle,
  MapPin,
  Milestone,
  Plus,
  RefreshCw,
  Send,
  Stethoscope,
  UserRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  PageHeader,
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
import { appDateKey } from "@/lib/app-time-zone";
import { useAuth } from "@/lib/auth";
import { usePortalPatientId } from "@/lib/portal-patient-context";
import { isPortalSubscriptionPaused } from "@/lib/portal-subscription";
import { formatPluralCount, uiText, useLang, useLanguageBound } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  createPortalAppointmentRequest,
  fetchPortalAppointmentsWorkspace,
  withdrawPortalAppointmentRequest,
} from "@/pages/patients/data/portal-api";
import {
  appointmentRequestStatusTone,
  appointmentStatusTone,
  followupStatusTone,
  PORTAL_REQUEST_DATE_PROBLEM_KEYS,
  portalPreferredDateRange,
  portalOrderPhaseLabel as sharedPortalOrderPhaseLabel,
  portalRequestDateProblem,
  usePortalLabels,
} from "@/pages/patients/model/portal-shared";
import { isUpcomingPortalAppointment } from "@/pages/appointments/model/portal-appointment-visibility";
import type {
  PortalAppointmentItem,
  PortalAppointmentRequestItem,
  PortalFollowupMilestoneItem,
} from "@/pages/patients/model/portal-shared";
import { PatientSheetScaffold } from "@/pages/patients/ui/shared/patient-sheet-scaffold";
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
  requestSheetOpen: boolean;
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
    requestSheetOpen: false,
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
  "appointment_request.cancelled",
  "order.phase_changed",
  "order.followup_flow_updated",
  "order.external_invoice_overdue",
] as const;

function portalOrderPhaseLabel(
  value: string | null | undefined,
) {
  return sharedPortalOrderPhaseLabel(value);
}

/**
 * Withdraws an open appointment request (asks once more before doing it).
 * The server cancels it and tells the care team.
 */
function WithdrawRequestButton({
  requestId,
  onWithdrawn,
  onError,
}: {
  requestId: string;
  onWithdrawn: () => void;
  onError: (message: string) => void;
}) {
  const { lang } = useLang();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  async function withdraw() {
    setBusy(true);
    try {
      await withdrawPortalAppointmentRequest(requestId);
      onWithdrawn();
    } catch {
      onError(uiText("portal_request_withdraw_failed", lang));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }
  return (
    <div className="flex justify-end">
      <Button
        type="button"
        size="sm"
        variant={confirming ? "destructive" : "outline"}
        className="h-8 rounded-lg"
        disabled={busy}
        onClick={() => (confirming ? void withdraw() : setConfirming(true))}
      >
        {busy ? <LoaderCircle className="mr-2 size-3.5 animate-spin" /> : null}
        {confirming
          ? uiText("portal_request_withdraw_confirm", lang)
          : uiText("portal_request_withdraw", lang)}
      </Button>
    </div>
  );
}

function usePatientAppointmentsPageContent() {
  const {
    appointmentCarePathKindLabel,
    appointmentTimeOfDayLabel,
    appointmentTypeLabel,
    formatPortalDate,
    portalStatusLabel,
  } = usePortalLabels();
  const { portalOrderPhaseLabel } = useLanguageHelpers();
  const { lang, t } = useLang();
  const { user } = useAuth();
  // A paused subscription shows what is agreed, read-only: no new request
  // and no change to an open one (owner decision 2026-11-10).
  const subscriptionPaused = isPortalSubscriptionPaused(user ?? null, usePortalPatientId(user?.id));
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
    requestSheetOpen,
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
  const setRequestSheetOpen = (open: boolean) => {
    dispatchPageState(
      open
        ? { requestSheetOpen: true, requestError: "" }
        : {
            requestSheetOpen: false,
            requestBusy: false,
            requestError: "",
            requestForm: blankRequestForm(),
          },
    );
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
    () => appointments.filter((item) => isUpcomingPortalAppointment(item)),
    [appointments],
  );
  const openRequests = useMemo(
    () => requests.filter((item) => !["rejected", "converted", "cancelled"].includes(item.status)),
    [requests],
  );
  // A cancelled visit stays in the list with its status but is not counted
  // as scheduled (global QA 2026-11-10). Nor is a past one: the badge counts
  // what «Мои визиты» on the home page counts (QA 2026-11-12, B S3-4).
  const scheduledCount = upcomingAppointments.length;
  const appointmentsById = useMemo(
    () => new Map(appointments.map((item) => [item.id, item])),
    [appointments],
  );
  const firstPastVisitIndex = useMemo(() => {
    const today = appDateKey();
    return appointments.findIndex((item) => item.date < today);
  }, [appointments]);
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
    // Said in the portal's language before sending; the server refuses the
    // same with a code (global QA 2026-11-10: past dates were accepted, an
    // inverted period came back as an English sentence).
    const dateProblem = portalRequestDateProblem(
      requestForm.preferredDateFrom,
      requestForm.preferredDateTo,
      appDateKey(),
    );
    if (dateProblem) {
      dispatchPageState({ requestError: uiText(PORTAL_REQUEST_DATE_PROBLEM_KEYS[dateProblem], lang) });
      return;
    }
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
        requestSheetOpen: false,
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
    <TabShell className="mt-0 w-full min-w-0 max-w-none space-y-3">
      <PageHeader
        // A paused subscription keeps the agreed visits readable; new requests are closed.
        pageAction={subscriptionPaused ? undefined : <Button onClick={() => setRequestSheetOpen(true)}><Plus className="size-4" />{t.portal_appointments_send_appointment_request}</Button>}
        title={t.portal_appointments_my_appointments}
        description={t.portal_appointments_review_scheduled_visits_and_send_new_appointment_requests_for_th}
        actions={
          <>

            <Button
              variant="default"
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

      {subscriptionPaused ? (
        <Banner tone="warning" withIcon>
          <span data-testid="portal-appointments-paused">{uiText("portal_paused_appointments_note", lang)}</span>
        </Banner>
      ) : null}

      <PortalSummary items={[
        { label: t.portal_appointments_upcoming_visits, value: upcomingAppointments.length, visible: upcomingAppointments.length > 0 },
        { label: t.portal_appointments_open_requests, value: openRequests.length, visible: openRequests.length > 0 },
        { label: t.portal_appointments_next_slot, value: nextAppointment ? <PortalDateChip>{formatPortalDate(nextAppointment.date)}</PortalDateChip> : "", visible: Boolean(nextAppointment) },
      ]} />

      <section className="space-y-3">
        <section className="space-y-3">
          <Section
            icon={CalendarDays} title={t.portal_appointments_scheduled_visits}
            accessory={scheduledCount > 0 ? <CountBadge>{scheduledCount}</CountBadge> : undefined}
          >

            {appointments.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">{t.portal_appointments_no_appointments_yet}</p>
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {appointments.map((item, index) => (
                  <Fragment key={item.id}>
                  {/* The list is the server's: today's and coming visits first, in date order, then
                      the past ones, newest first. The line says where the past ones begin — without
                      it the list read as out of date order (verification 2026-11-10). */}
                  {index > 0 && index === firstPastVisitIndex ? (
                    <p className="pt-1 text-xs font-semibold text-muted-foreground" data-testid="portal-appointments-past-heading">
                      {lang === "de" ? "Vergangene Termine" : "Прошедшие визиты"}
                    </p>
                  ) : null}
                  <ListItem className="space-y-2.5">
                    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                      <h2 className="min-w-0 text-base font-semibold leading-snug text-foreground">{item.title}</h2>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={item.status} className={appointmentStatusTone(item.status)}>
                          {portalStatusLabel(item.status)}
                        </StatusBadge>
                        {item.appointment_type && <StatusBadge tone="neutral" className="normal-case tracking-normal">{appointmentTypeLabel(item.appointment_type)}</StatusBadge>}
                        {item.care_path_kind && <StatusBadge tone="brand" className="normal-case tracking-normal">{appointmentCarePathKindLabel(item.care_path_kind)}</StatusBadge>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-medium tabular-nums" data-slot="visit-schedule">
                      <PortalDateChip><time dateTime={item.date}>{formatPortalDate(item.date)}</time>{item.time_start ? " · " + item.time_start.slice(0, 5) + (item.time_end ? "–" + item.time_end.slice(0, 5) : "") : item.time_end ? " · " + t.appointments_until + " " + item.time_end.slice(0, 5) : ""}</PortalDateChip>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-foreground">
                      {item.doctor_name ? <span className="inline-flex min-w-0 items-center gap-1.5"><UserRound aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{item.doctor_name}</span> : null}
                      {item.provider_name && !item.location?.toLocaleLowerCase().includes(item.provider_name.toLocaleLowerCase()) ? <span className="inline-flex min-w-0 items-center gap-1.5"><Building2 aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />{item.provider_name}</span> : null}
                      {item.location ? (
                        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground"><MapPin aria-hidden="true" className="size-4 shrink-0" />{item.location}</span>
                      ) : null}
                    </div>
                  </ListItem>
                  </Fragment>
                ))}
              </div>
            )}
          </Section>

          {followupMilestones.length > 0 ? (
          <Section
            icon={Milestone} title={t.portal_appointments_follow_up_milestones}
            accessory={<CountBadge>{followupMilestones.length}</CountBadge>}
          >

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
                      date: item.recommended_followup_1w_at,
                    },
                    {
                      label: t.portal_appointments_1_month,
                      value: portalStatusLabel(item.followup_1m_status),
                      tone: followupStatusTone(item.followup_1m_status),
                      date: item.recommended_followup_1m_at,
                    },
                    {
                      label: t.portal_appointments_6_month,
                      value: portalStatusLabel(item.followup_6m_status),
                      tone: followupStatusTone(item.followup_6m_status),
                      date: item.recommended_followup_6m_at,
                    },
                    {
                      label: t.portal_appointments_package_end,
                      value: portalStatusLabel(item.package_end_status),
                      tone: followupStatusTone(item.package_end_status),
                      date: item.package_end_date ?? item.suggested_package_end_date,
                    },
                    {
                      label: t.portal_appointments_results_handoff,
                      value: portalStatusLabel(item.results_handoff_status),
                      tone: followupStatusTone(item.results_handoff_status),
                      hint: formatPluralCount(lang, item.results_portal_shares, {
                        one: t.portal_appointments_shared_documents_count_one,
                        few: t.portal_appointments_shared_documents_count_few,
                        many: t.portal_appointments_shared_documents_count_many,
                      }),
                    },
                  ];

                  return (
                    <ListItem key={item.order_id} className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {item.order_number} / {portalOrderPhaseLabel(item.phase)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t.portal_appointments_closure_anchor} <PortalDateChip timestamp={item.closure_anchor_at} />
                          </p>
                        </div>
                        <StatusBadge tone={item.followup_ready ? "success" : "warning"}>
                          {item.followup_ready ? t.portal_appointments_ready : t.portal_appointments_in_progress}
                        </StatusBadge>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {milestoneRows.map((milestone) => (
                            <InfoRow
                              key={milestone.label}
                              label={milestone.label}
                              value={
                                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <StatusBadge className={milestone.tone}>{milestone.value}</StatusBadge>
                                  {milestone.date ? <PortalDateChip timestamp={milestone.date} /> : milestone.hint ? <span className="text-xs text-muted-foreground">{milestone.hint}</span> : null}
                                </span>
                              }
                            />
                        ))}
                      </div>

                      {item.followup_summary ? (
                        <div className={cn("rounded-lg px-3 py-2 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                          {item.followup_summary}
                        </div>
                      ) : null}
                    </ListItem>
                  );
                })}
              </div>
            )}
          </Section>
          ) : null}

          {requests.length > 0 ? (
          <Section
            icon={History} title={t.portal_appointments_request_history}
            accessory={<CountBadge>{requests.length}</CountBadge>}
          >

            {requests.length === 0 ? (
              <EmptyCell>
                {t.portal_appointments_no_requests_submitted_yet}
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {requests.map((item) => {
                  const preferredDates = portalPreferredDateRange(
                    item.preferred_date_from,
                    item.preferred_date_to,
                  );
                  // The visit made from the request was cancelled later: the
                  // card no longer says "scheduled as …".
                  const convertedVisitCancelled =
                    Boolean(item.converted_appointment_id) &&
                    appointmentsById.get(item.converted_appointment_id ?? "")?.status === "cancelled";
                  // What the patient wrote, to read again (global QA 2026-11-10).
                  const writtenDetails = [
                    { label: t.portal_appointments_specialty_or_topic, value: item.specialty },
                    { label: t.portal_appointments_location_preference, value: item.location },
                    { label: t.portal_appointments_reason, value: item.reason },
                    { label: t.portal_appointments_additional_note, value: item.notes },
                  ].filter((detail) => detail.value?.trim());
                  return (
                    <ListItem key={item.id} className="space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {item.appointment_type === "non_medical"
                              ? uiText("portal_appointment_request_title_non_medical", lang)
                              : uiText("portal_appointment_request_title_medical", lang)}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span>{appointmentCarePathKindLabel(item.care_path_kind)}</span>
                            <span>{t.portal_appointments_requested} <PortalDateChip timestamp={item.requested_at} /></span>
                          </div>
                        </div>
                        {convertedVisitCancelled ? (
                          <StatusBadge status="cancelled" className={appointmentRequestStatusTone("cancelled")}>
                            {uiText("portal_request_visit_cancelled_badge", lang)}
                          </StatusBadge>
                        ) : (
                          <StatusBadge status={item.status} className={appointmentRequestStatusTone(item.status)}>
                            {portalStatusLabel(item.status)}
                          </StatusBadge>
                        )}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={
                            preferredDates.kind === "period"
                              ? t.portal_appointments_preferred_period
                              : preferredDates.kind === "to"
                                ? t.portal_appointments_preferred_to
                                : t.portal_appointments_preferred_from
                          }
                          value={preferredDates.value ? <PortalDateChip>{preferredDates.value}</PortalDateChip> : t.common_not_set}
                        />
                        <InfoRow
                          className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                          label={t.portal_appointments_time_window}
                          value={appointmentTimeOfDayLabel(item.preferred_time_of_day)}
                        />
                      </div>
                      {writtenDetails.length > 0 ? (
                        <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2" data-testid="portal-request-written-details">
                          {writtenDetails.map((detail) => (
                            <div key={detail.label} className="min-w-0">
                              <dt className="text-xs text-muted-foreground">{detail.label}</dt>
                              <dd className="whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">{detail.value}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {item.review_note ? (
                        <div className={cn("rounded-lg px-3 py-2 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                          {t.portal_appointments_review_note}: {item.review_note}
                        </div>
                      ) : null}
                      {item.status === "cancelled" && item.cancellation_reason ? (
                        <div className={cn("rounded-lg px-3 py-2 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                          {uiText("portal_request_cancelled_reason", lang)}: {item.cancellation_reason}
                        </div>
                      ) : null}
                      {!subscriptionPaused && (item.status === "requested" || item.status === "approved") ? (
                        <WithdrawRequestButton
                          requestId={item.id}
                          onWithdrawn={() => {
                            clearApiCache("/me/appointment-requests");
                            dispatchPageState((current) => ({
                              notice: uiText("portal_request_withdrawn_notice", lang),
                              version: current.version + 1,
                            }));
                          }}
                          onError={(message) => dispatchPageState({ error: message })}
                        />
                      ) : null}
                      {item.converted_appointment_id && convertedVisitCancelled ? (
                        <div
                          className={cn("rounded-lg px-3 py-2 text-sm text-muted-foreground", tokens.surface.mutedCard)}
                          data-testid="portal-request-visit-cancelled"
                        >
                          {uiText("portal_request_visit_cancelled_note", lang, {
                            title: item.converted_appointment_title || t.portal_appointments_appointment,
                            date: formatPortalDate(item.converted_appointment_date),
                          })}
                        </div>
                      ) : item.converted_appointment_id ? (
                        <SuccessBanner>
                          {t.portal_appointments_scheduled_as} {item.converted_appointment_title || t.portal_appointments_appointment} {t.portal_appointments_on} {formatPortalDate(item.converted_appointment_date)}
                        </SuccessBanner>
                      ) : null}
                    </ListItem>
                  );
                })}
              </div>
            )}
          </Section>
          ) : null}
        </section>

        <PatientSheetScaffold
          open={requestSheetOpen}
          onOpenChange={setRequestSheetOpen}
          title={t.portal_appointments_request_a_visit}
          description={t.portal_appointments_send_preferred_dates_and_context_the_care_team_reviews_and_conve}
          width="form-heavy"
          presentation="dialog"
          bodyClassName="bg-card"
          bodyWrapperClassName="portal-request-form"
          onSubmit={(event) => void handleSubmitRequest(event)}
          footer={
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto min-h-9 max-w-full whitespace-normal rounded-lg"
                onClick={() => setRequestSheetOpen(false)}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                size="sm"
                className="h-auto min-h-9 max-w-full whitespace-normal rounded-lg gap-1.5"
                disabled={requestBusy}
              >
                {requestBusy ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <Send className="size-3.5" />
                )}
                {t.portal_appointments_send_appointment_request}
              </Button>
            </>
          }
        >
          <Section icon={ClipboardPen} title={t.portal_appointments_group_request_details}>
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
          </Section>
          <Section icon={CalendarClock} title={t.portal_appointments_group_schedule_preferences}>
            <div className="grid gap-3 sm:grid-cols-3">
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
            </div>
          </Section>
          <Section icon={Stethoscope} title={t.portal_appointments_group_visit_context}>
            <div className="grid gap-3 sm:grid-cols-2">
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
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t.portal_appointments_reason} htmlFor="portal-appointment-reason">
                <textarea
                  id="portal-appointment-reason"
                  value={requestForm.reason}
                  onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))}
                  placeholder={t.portal_appointments_what_do_you_need_and_what_should_the_team_consider}
                  className={cn(textareaClass, "min-h-[80px]")}
                />
              </Field>
              <Field label={t.portal_appointments_additional_note} htmlFor="portal-appointment-notes">
                <textarea
                  id="portal-appointment-notes"
                  value={requestForm.notes}
                  onChange={(event) => setRequestForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder={t.portal_appointments_optional_logistical_or_clinical_context}
                  className={cn(textareaClass, "min-h-[80px]")}
                />
              </Field>
            </div>
          </Section>
            {requestError ? <Banner tone="error">{requestError}</Banner> : null}
        </PatientSheetScaffold>
      </section>
    </TabShell>
  );
}

export function PatientAppointmentsPage(...args: Parameters<typeof usePatientAppointmentsPageContent>) {
  return usePatientAppointmentsPageContent(...args);
}

/**
 * The helpers of this file that read the UI language themselves; its
 * components take them from `useLanguageHelpers()` (bound to the current language).
 */
const LANGUAGE_HELPERS = {
  portalOrderPhaseLabel,
};

function useLanguageHelpers() {
  return useLanguageBound(LANGUAGE_HELPERS);
}
