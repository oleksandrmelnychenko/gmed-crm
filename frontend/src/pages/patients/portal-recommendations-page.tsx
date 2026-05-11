import { startTransition, useCallback, useEffect, useMemo, useReducer, type FormEvent, type ReactNode, type SetStateAction } from "react";
import { CalendarPlus, CheckCircle2, LoaderCircle, MessageCircle, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Banner,
  CountBadge,
  EmptyCell,
  Field,
  InfoRow,
  ListItem,
  PageHeader,
  Section,
  StatusBadge,
  TabLoader,
  TabShell,
  SuccessBanner,
  checkboxClass,
  inputClass,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { apiFetch, clearApiCache } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { useRealtimeSubscription } from "@/lib/realtime";
import {
  decidePortalRecommendation,
  fetchPortalRecommendations,
  requestRecommendationAppointment,
} from "@/pages/patients/data/portal-api";
import {
  documentCategoryLabel,
  formatPortalDateTime,
  portalOrderPhaseLabel,
  recommendationDecisionLabel,
  recommendationPriorityLabel,
  portalStatusLabel,
  recommendationTypeLabel,
  recommendationStatusTone,
} from "@/pages/patients/model/portal-shared";
import type { PortalRecommendationItem } from "@/pages/patients/model/portal-shared";
import { cn } from "@/lib/utils";

const PORTAL_RECOMMENDATION_REALTIME_EVENTS = [
  "recommendation.created",
  "recommendation.updated",
  "recommendation.patient_decision",
  "recommendation.appointment_requested",
  "appointment_request.created",
] as const;

interface PatientRecommendationsState {
  recommendations: PortalRecommendationItem[];
  loading: boolean;
  refreshing: boolean;
  busyId: string | null;
  error: string;
  notice: string;
  version: number;
}

type PatientRecommendationsAction =
  | Partial<PatientRecommendationsState>
  | ((current: PatientRecommendationsState) => Partial<PatientRecommendationsState>);

const INITIAL_PATIENT_RECOMMENDATIONS_STATE: PatientRecommendationsState = {
  recommendations: [],
  loading: true,
  refreshing: false,
  busyId: null,
  error: "",
  notice: "",
  version: 0,
};

function patientRecommendationsReducer(
  current: PatientRecommendationsState,
  action: PatientRecommendationsAction,
): PatientRecommendationsState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

export function PatientRecommendationsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const [recommendationsState, dispatchRecommendationsState] = useReducer(
    patientRecommendationsReducer,
    INITIAL_PATIENT_RECOMMENDATIONS_STATE,
  );
  const {
    busyId,
    error,
    loading,
    notice,
    recommendations,
    refreshing,
    version,
  } = recommendationsState;
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const isPatientPortalUser = user?.role === "patient";

  useRealtimeSubscription(PORTAL_RECOMMENDATION_REALTIME_EVENTS, () => {
    clearApiCache("/me/recommendations");
    clearApiCache("/me/next-actions");
    dispatchRecommendationsState((current) => ({ version: current.version + 1 }));
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isPatientPortalUser) {
        dispatchRecommendationsState({
          recommendations: [],
          error: "",
          loading: false,
          refreshing: false,
        });
        return;
      }

      dispatchRecommendationsState((current) => ({
        refreshing: !current.loading,
        error: "",
      }));

      try {
        const rows = await fetchPortalRecommendations();
        if (cancelled) return;
        startTransition(() =>
          dispatchRecommendationsState({
            recommendations: rows,
            error: "",
            loading: false,
            refreshing: false,
          }),
        );
      } catch (err) {
        if (cancelled) return;
        dispatchRecommendationsState({
          error: err instanceof Error ? err.message : l("Empfehlungen konnten nicht geladen werden.", "Не удалось загрузить рекомендации.", "Failed to load recommendations."),
          loading: false,
          refreshing: false,
        });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [isPatientPortalUser, version, l]);

  const activeCount = useMemo(
    () => recommendations.filter((item) => item.status === "active").length,
    [recommendations],
  );

  async function handleDecision(recommendationId: string, decision: string) {
    if (!isPatientPortalUser) {
      return;
    }

    dispatchRecommendationsState({
      busyId: `${recommendationId}:${decision}`,
      error: "",
      notice: "",
    });

    try {
      const successNotice =
        decision === "schedule"
          ? l("Terminanfrage wurde aus der Empfehlung erstellt.", "Запрос на визит создан из рекомендации.", "Appointment request created from the recommendation.")
          : l("Ihre Entscheidung wurde gespeichert.", "Ваше решение сохранено.", "Your decision was saved.");
      if (decision === "schedule") {
        await requestRecommendationAppointment(recommendationId, {});
      } else {
        await decidePortalRecommendation(recommendationId, { decision });
      }
      clearApiCache("/me/recommendations");
      clearApiCache("/me/next-actions");
      dispatchRecommendationsState((current) => ({
        busyId: null,
        notice: successNotice,
        version: current.version + 1,
      }));
    } catch (err) {
      dispatchRecommendationsState({
        busyId: null,
        error: err instanceof Error ? err.message : l("Aktion konnte nicht gespeichert werden.", "Не удалось сохранить действие.", "Failed to save action."),
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

  if (!isPatientPortalUser) {
    return <StaffRecommendationsWorkspace />;
  }

  return (
    <TabShell className="mt-0 min-h-0">
      <PageHeader
        title={l("Meine Empfehlungen", "Мои рекомендации", "My recommendations")}
        description={l("Hier sehen Sie freigegebene Empfehlungen Ihres Betreuungsteams und können die nächste Entscheidung dokumentieren.", "Здесь отображаются опубликованные рекомендации команды сопровождения, по которым можно выбрать следующее действие.", "Review released care-team recommendations and record the next decision.")}
        actions={
          <>
            <CountBadge>{l("Patientenportal", "Портал пациента", "Patient portal")}</CountBadge>
            <CountBadge>{l("Aktiv", "Активно", "Active")}: {activeCount}</CountBadge>
            <Button variant="outline" className={tokens.control.primaryButton} onClick={() => dispatchRecommendationsState((current) => ({ version: current.version + 1 }))}>
              <RefreshCw className={cn("size-4", refreshing && "animate-spin")} />
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}

      {recommendations.length === 0 ? (
        <EmptyCell>
          <p className="text-base font-semibold text-foreground">
            {l("Noch keine Empfehlungen", "Пока нет рекомендаций", "No recommendations yet")}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {l("Sobald Ihr Team eine Empfehlung freigibt, erscheint sie hier.", "Когда команда опубликует рекомендацию, она появится здесь.", "Released recommendations from your care team will appear here.")}
          </p>
        </EmptyCell>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {recommendations.map((item) => {
            const recommendationId = item.recommendation_id || item.id;
            const disabled = busyId?.startsWith(`${recommendationId}:`) ?? false;
            const isClosed = ["completed", "declined", "cancelled", "superseded"].includes(item.status);

            return (
              <ListItem key={recommendationId} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge status={item.status} className={recommendationStatusTone(item.status)}>
                        {portalStatusLabel(item.status)}
                      </StatusBadge>
                      <CountBadge>
                        {recommendationTypeLabel(item.recommendation_type)}
                      </CountBadge>
                    </div>
                    <h2 className="mt-3 text-xl font-semibold text-foreground">{item.title}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {[item.source_doctor_name, item.source_appointment_title, item.source_document_name, item.source_order_number]
                        .filter(Boolean)
                        .join(" / ") || l("Betreuungsteam", "Команда сопровождения", "Care team")}
                    </p>
                  </div>
                  {item.due_at ? (
                    <CountBadge>{l("Fällig", "Срок", "Due")} {formatPortalDateTime(item.due_at)}</CountBadge>
                  ) : null}
                </div>

                {item.description ? (
                  <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                    {item.description}
                  </div>
                ) : null}

                {item.patient_decision ? (
                  <InfoRow
                    label={l("Ihre Entscheidung", "Ваше решение", "Your decision")}
                    value={`${recommendationDecisionLabel(item.patient_decision)}${item.appointment_request_status ? ` / ${portalStatusLabel(item.appointment_request_status)}` : ""}`}
                  />
                ) : null}

                {!isClosed ? (
                  <div className="flex flex-wrap gap-3">
                    <ActionButton
                      busy={busyId === `${recommendationId}:schedule`}
                      disabled={disabled || Boolean(item.appointment_request_id)}
                      icon={<CalendarPlus className="size-4" />}
                      label={item.appointment_request_id ? l("Terminanfrage erstellt", "Запрос создан", "Request created") : l("Termin planen", "Запланировать визит", "Schedule")}
                      onClick={() => void handleDecision(recommendationId, "schedule")}
                    />
                    <ActionButton
                      busy={busyId === `${recommendationId}:already_done`}
                      disabled={disabled}
                      icon={<CheckCircle2 className="size-4" />}
                      label={l("Schon erledigt", "Уже выполнено", "Already done")}
                      onClick={() => void handleDecision(recommendationId, "already_done")}
                    />
                    <ActionButton
                      busy={busyId === `${recommendationId}:need_consultation`}
                      disabled={disabled}
                      icon={<MessageCircle className="size-4" />}
                      label={l("Beratung nötig", "Нужна консультация", "Need consultation")}
                      onClick={() => void handleDecision(recommendationId, "need_consultation")}
                    />
                    <ActionButton
                      busy={busyId === `${recommendationId}:declined`}
                      disabled={disabled}
                      icon={<XCircle className="size-4" />}
                      label={l("Ablehnen", "Отклонить", "Decline")}
                      onClick={() => void handleDecision(recommendationId, "declined")}
                    />
                  </div>
                ) : null}
              </ListItem>
            );
          })}
        </section>
      )}
    </TabShell>
  );
}

type StaffPatientOption = {
  id: string;
  patient_id: string;
  first_name?: string | null;
  last_name?: string | null;
};

type StaffDoctorOption = {
  id: string;
  provider_id: string;
  provider_name: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
};

type StaffOrderOption = {
  id: string;
  order_number: string;
  phase?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type StaffAppointmentOption = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  status?: string | null;
  provider_name?: string | null;
  doctor_name?: string | null;
};

type StaffDocumentOption = {
  id: string;
  filename?: string | null;
  auto_name?: string | null;
  category?: string | null;
  status?: string | null;
  created_at?: string | null;
};

type RecommendationFormState = {
  id: string;
  title: string;
  description: string;
  recommendation_type: string;
  priority: string;
  status: string;
  due_at: string;
  portal_visible: boolean;
  source_doctor_id: string;
  source_appointment_id: string;
  source_document_id: string;
  source_order_id: string;
};

const RECOMMENDATION_TYPE_OPTIONS = [
  "follow_up",
  "consultation",
  "lab_test",
  "imaging",
  "document",
  "medication_review",
  "other",
] as const;

const RECOMMENDATION_PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const;
const RECOMMENDATION_STATUS_OPTIONS = [
  "active",
  "completed",
  "declined",
  "cancelled",
  "superseded",
] as const;

function emptyRecommendationForm(): RecommendationFormState {
  return {
    id: "",
    title: "",
    description: "",
    recommendation_type: "follow_up",
    priority: "normal",
    status: "active",
    due_at: "",
    portal_visible: false,
    source_doctor_id: "",
    source_appointment_id: "",
    source_document_id: "",
    source_order_id: "",
  };
}

interface StaffRecommendationsState {
  patients: StaffPatientOption[];
  doctors: StaffDoctorOption[];
  selectedPatientId: string;
  recommendations: PortalRecommendationItem[];
  orders: StaffOrderOption[];
  appointments: StaffAppointmentOption[];
  documents: StaffDocumentOption[];
  form: RecommendationFormState;
  lookupLoading: boolean;
  patientLoading: boolean;
  saving: boolean;
  busyId: string;
  error: string;
  notice: string;
  version: number;
}

type StaffRecommendationsAction =
  | Partial<StaffRecommendationsState>
  | ((current: StaffRecommendationsState) => Partial<StaffRecommendationsState>);

function createStaffRecommendationsState(): StaffRecommendationsState {
  return {
    patients: [],
    doctors: [],
    selectedPatientId: "",
    recommendations: [],
    orders: [],
    appointments: [],
    documents: [],
    form: emptyRecommendationForm(),
    lookupLoading: true,
    patientLoading: false,
    saving: false,
    busyId: "",
    error: "",
    notice: "",
    version: 0,
  };
}

function staffRecommendationsReducer(
  current: StaffRecommendationsState,
  action: StaffRecommendationsAction,
): StaffRecommendationsState {
  const patch = typeof action === "function" ? action(current) : action;
  return {
    ...current,
    ...patch,
  };
}

function resolveStaffRecommendationsStateAction<T>(action: SetStateAction<T>, current: T): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function useStaffRecommendationsWorkspaceContent() {
  const { user } = useAuth();
  const { t } = useLang();
  const [staffState, dispatchStaffState] = useReducer(
    staffRecommendationsReducer,
    undefined,
    createStaffRecommendationsState,
  );
  const {
    appointments,
    busyId,
    doctors,
    documents,
    error,
    form,
    lookupLoading,
    notice,
    orders,
    patientLoading,
    patients,
    recommendations,
    saving,
    selectedPatientId,
    version,
  } = staffState;
  const setSelectedPatientId = (nextValue: SetStateAction<string>) =>
    dispatchStaffState((current) => ({ selectedPatientId: resolveStaffRecommendationsStateAction(nextValue, current.selectedPatientId) }));
  const setForm = (nextValue: SetStateAction<RecommendationFormState>) =>
    dispatchStaffState((current) => ({ form: resolveStaffRecommendationsStateAction(nextValue, current.form) }));
  const setSaving = (nextValue: SetStateAction<boolean>) =>
    dispatchStaffState((current) => ({ saving: resolveStaffRecommendationsStateAction(nextValue, current.saving) }));
  const setBusyId = (nextValue: SetStateAction<string>) =>
    dispatchStaffState((current) => ({ busyId: resolveStaffRecommendationsStateAction(nextValue, current.busyId) }));
  const setError = (nextValue: SetStateAction<string>) =>
    dispatchStaffState((current) => ({ error: resolveStaffRecommendationsStateAction(nextValue, current.error) }));
  const setNotice = (nextValue: SetStateAction<string>) =>
    dispatchStaffState((current) => ({ notice: resolveStaffRecommendationsStateAction(nextValue, current.notice) }));
  const setVersion = (nextValue: SetStateAction<number>) =>
    dispatchStaffState((current) => ({ version: resolveStaffRecommendationsStateAction(nextValue, current.version) }));
  const canEdit = user?.role === "ceo" || user?.role === "patient_manager";

  useEffect(() => {
    let cancelled = false;
    if (!canEdit) {
      dispatchStaffState({ lookupLoading: false });
      return () => {
        cancelled = true;
      };
    }
    dispatchStaffState({ lookupLoading: true, error: "" });

    Promise.all([
      apiFetch<StaffPatientOption[]>("/patients?active_only=true", { cacheTtlMs: 60_000 }),
      apiFetch<StaffDoctorOption[]>("/cases/meta/doctors", { cacheTtlMs: 60_000 }).catch(() => []),
    ])
      .then(([patientRows, doctorRows]) => {
        if (cancelled) return;
        startTransition(() => {
          dispatchStaffState((current) => ({
            patients: patientRows,
            doctors: doctorRows,
            selectedPatientId:
              patientRows.length === 1
                ? current.selectedPatientId || patientRows[0].id
                : current.selectedPatientId,
          }));
        });
      })
      .catch((err) => {
        if (cancelled) return;
        dispatchStaffState({
          error: err instanceof Error ? err.message : t.patient_recommendations_staff_lookup_failed,
        });
      })
      .finally(() => {
        if (!cancelled) dispatchStaffState({ lookupLoading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [canEdit, t.patient_recommendations_staff_lookup_failed]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedPatientId || !canEdit) {
      dispatchStaffState({
        recommendations: [],
        orders: [],
        appointments: [],
        documents: [],
        patientLoading: false,
      });
      return;
    }

    dispatchStaffState({ patientLoading: true, error: "" });

    Promise.all([
      apiFetch<PortalRecommendationItem[]>(`/patients/${selectedPatientId}/recommendations`, {
        forceFresh: true,
      }),
      apiFetch<StaffOrderOption[]>(`/patients/${selectedPatientId}/orders`).catch(() => []),
      apiFetch<StaffAppointmentOption[]>(`/patients/${selectedPatientId}/appointments`).catch(() => []),
      apiFetch<StaffDocumentOption[]>(`/patients/${selectedPatientId}/documents`).catch(() => []),
    ])
      .then(([recommendationRows, orderRows, appointmentRows, documentRows]) => {
        if (cancelled) return;
        startTransition(() => {
          dispatchStaffState({
            recommendations: recommendationRows,
            orders: orderRows,
            appointments: appointmentRows,
            documents: documentRows,
          });
        });
      })
      .catch((err) => {
        if (cancelled) return;
        dispatchStaffState({
          error: err instanceof Error ? err.message : t.patient_recommendations_staff_load_failed,
        });
      })
      .finally(() => {
        if (!cancelled) dispatchStaffState({ patientLoading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [canEdit, selectedPatientId, t.patient_recommendations_staff_load_failed, version]);

  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === selectedPatientId) ?? null,
    [patients, selectedPatientId],
  );
  const activeCount = useMemo(
    () => recommendations.filter((item) => item.status === "active").length,
    [recommendations],
  );
  const releasedCount = useMemo(
    () => recommendations.filter((item) => item.portal_visible).length,
    [recommendations],
  );

  function resetForm() {
    setForm(emptyRecommendationForm());
  }

  function clearRecommendationCaches(patientId: string) {
    clearApiCache(`/patients/${patientId}/recommendations`);
    clearApiCache("/me/recommendations");
    clearApiCache("/me/next-actions");
  }

  async function handleSubmitRecommendation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPatientId || !canEdit) return;
    if (!form.title.trim()) {
      setError(t.patient_recommendations_staff_title_required);
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      recommendation_type: form.recommendation_type,
      priority: form.priority,
      due_at: form.due_at || null,
      portal_visible: form.portal_visible,
      source_doctor_id: form.source_doctor_id || null,
      source_appointment_id: form.source_appointment_id || null,
      source_document_id: form.source_document_id || null,
      source_order_id: form.source_order_id || null,
    };
    if (form.id) {
      payload.status = form.status;
    }

    try {
      await apiFetch<PortalRecommendationItem>(
        form.id
          ? `/patients/${selectedPatientId}/recommendations/${form.id}/update`
          : `/patients/${selectedPatientId}/recommendations`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
      clearRecommendationCaches(selectedPatientId);
      resetForm();
      setNotice(form.id ? t.patient_recommendations_staff_updated : t.patient_recommendations_staff_created);
      setVersion((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.patient_recommendations_staff_save_failed);
    } finally {
      setSaving(false);
    }
  }

  function handleEditRecommendation(item: PortalRecommendationItem) {
    setForm({
      id: item.id || item.recommendation_id,
      title: item.title ?? "",
      description: item.description ?? "",
      recommendation_type: item.recommendation_type || "follow_up",
      priority: item.priority || "normal",
      status: item.status || "active",
      due_at: formatDateInput(item.due_at),
      portal_visible: Boolean(item.portal_visible),
      source_doctor_id: item.source_doctor_id ?? "",
      source_appointment_id: item.source_appointment_id ?? "",
      source_document_id: item.source_document_id ?? "",
      source_order_id: item.source_order_id ?? "",
    });
  }

  async function handleTogglePortalVisibility(item: PortalRecommendationItem) {
    if (!selectedPatientId || !canEdit) return;
    const recommendationId = item.id || item.recommendation_id;
    setBusyId(`${recommendationId}:visibility`);
    setError("");
    setNotice("");

    try {
      await apiFetch<PortalRecommendationItem>(
        `/patients/${selectedPatientId}/recommendations/${recommendationId}/update`,
        {
          method: "POST",
          body: JSON.stringify({ portal_visible: !item.portal_visible }),
        },
      );
      clearRecommendationCaches(selectedPatientId);
      setNotice(
        item.portal_visible
          ? t.patient_recommendations_staff_hidden
          : t.patient_recommendations_staff_released,
      );
      setVersion((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.patient_recommendations_staff_visibility_failed);
    } finally {
      setBusyId("");
    }
  }

  if (!canEdit) {
    return (
      <TabShell className="mt-0 min-h-0">
        <PageHeader
          title={t.patient_recommendations_staff_title}
          description={t.patient_recommendations_staff_forbidden_description}
        />
        <EmptyCell>{t.patient_recommendations_staff_forbidden_empty}</EmptyCell>
      </TabShell>
    );
  }

  if (lookupLoading) {
    return (
      <Section title={t.patient_recommendations_staff_title}>
        <TabLoader />
      </Section>
    );
  }

  return (
    <TabShell className="mt-0 min-h-0">
      <PageHeader
        title={t.patient_recommendations_staff_title}
        description={t.patient_recommendations_staff_description}
        actions={
          <Button
            type="button"
            variant="outline"
            className="rounded-lg"
            disabled={!selectedPatientId || patientLoading}
            onClick={() => setVersion((current) => current + 1)}
          >
            <RefreshCw className={cn("size-4", patientLoading && "animate-spin")} />
            {t.patient_recommendations_staff_refresh}
          </Button>
        }
      />

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}

      <Section
        title={t.patient_recommendations_staff_patient_context}
        accessory={
          <div className="flex flex-wrap gap-2">
            <CountBadge>{activeCount} {t.patient_recommendations_staff_active_suffix}</CountBadge>
            <CountBadge>{releasedCount} {t.patient_recommendations_staff_released_suffix}</CountBadge>
          </div>
        }
      >
        <Field label={t.patient_recommendations_staff_patient}>
          <NativeComboboxSelect
            value={selectedPatientId}
            onChange={(event) => {
              setSelectedPatientId(event.target.value);
              resetForm();
            }}
          >
            <option value="">{t.patient_recommendations_staff_select_patient}</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {formatPatientOption(patient)}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
        {selectedPatient ? (
          <p className="text-xs text-muted-foreground">
            {t.patient_recommendations_staff_editing_for} {formatPatientOption(selectedPatient)}.
          </p>
        ) : null}
      </Section>

      {selectedPatientId ? (
        <form onSubmit={handleSubmitRecommendation}>
          <Section
            title={form.id ? t.patient_recommendations_staff_edit : t.patient_recommendations_staff_create}
            accessory={
              form.id
                ? <CountBadge>{t.patient_recommendations_staff_editing_badge}</CountBadge>
                : <CountBadge>{t.patient_recommendations_staff_draft_badge}</CountBadge>
            }
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t.patient_recommendations_staff_field_title}>
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className={cn(inputClass, "w-full border border-input px-3 text-sm")}
                  placeholder={t.patient_recommendations_staff_title_placeholder}
                />
              </Field>
              <Field label={t.patient_recommendations_staff_field_due_date}>
                <input
                  type="date"
                  value={form.due_at}
                  onChange={(event) => setForm((current) => ({ ...current, due_at: event.target.value }))}
                  className={cn(inputClass, "w-full border border-input px-3 text-sm")}
                />
              </Field>
              <Field label={t.patient_recommendations_staff_field_type}>
                <NativeComboboxSelect
                  value={form.recommendation_type}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, recommendation_type: event.target.value }))
                  }
                >
                  {RECOMMENDATION_TYPE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {recommendationTypeLabel(value)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={t.patient_recommendations_staff_field_priority}>
                <NativeComboboxSelect
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                >
                  {RECOMMENDATION_PRIORITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {recommendationPriorityLabel(value)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              {form.id ? (
                <Field label={t.patient_recommendations_staff_field_status}>
                  <NativeComboboxSelect
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                  >
                    {RECOMMENDATION_STATUS_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {portalStatusLabel(value)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
                </Field>
              ) : null}
              <Field label={t.patient_recommendations_staff_field_source_doctor}>
                <NativeComboboxSelect
                  value={form.source_doctor_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_doctor_id: event.target.value }))
                  }
                >
                  <option value="">{t.patient_recommendations_staff_no_doctor_link}</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {formatDoctorOption(doctor)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={t.patient_recommendations_staff_field_source_order}>
                <NativeComboboxSelect
                  value={form.source_order_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_order_id: event.target.value }))
                  }
                >
                  <option value="">{t.patient_recommendations_staff_no_order_link}</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number} {order.phase ? `/ ${portalOrderPhaseLabel(order.phase)}` : ""}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={t.patient_recommendations_staff_field_source_appointment}>
                <NativeComboboxSelect
                  value={form.source_appointment_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_appointment_id: event.target.value }))
                  }
                >
                  <option value="">{t.patient_recommendations_staff_no_appointment_link}</option>
                  {appointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {formatAppointmentOption(appointment)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
              <Field label={t.patient_recommendations_staff_field_source_document}>
                <NativeComboboxSelect
                  value={form.source_document_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_document_id: event.target.value }))
                  }
                >
                  <option value="">{t.patient_recommendations_staff_no_document_link}</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {formatDocumentOption(document)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>
            <Field label={t.patient_recommendations_staff_field_description}>
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className={textareaClass}
                placeholder={t.patient_recommendations_staff_description_placeholder}
              />
            </Field>
            <label className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.portal_visible}
                onChange={(event) =>
                  setForm((current) => ({ ...current, portal_visible: event.target.checked }))
                }
                className={checkboxClass}
              />
              {t.patient_recommendations_staff_release_to_portal}
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="rounded-lg" disabled={saving || patientLoading}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {form.id
                  ? t.patient_recommendations_staff_save_recommendation
                  : t.patient_recommendations_staff_create_recommendation}
              </Button>
              {form.id ? (
                <Button type="button" variant="outline" className="rounded-lg" onClick={resetForm}>
                  {t.patient_recommendations_staff_cancel_edit}
                </Button>
              ) : null}
            </div>
          </Section>
        </form>
      ) : null}

      <Section title={t.patient_recommendations_staff_patient_recommendations} accessory={<CountBadge>{recommendations.length}</CountBadge>}>
        {!selectedPatientId ? (
          <EmptyCell>{t.patient_recommendations_staff_select_patient_empty}</EmptyCell>
        ) : patientLoading ? (
          <TabLoader />
        ) : recommendations.length === 0 ? (
          <EmptyCell>{t.patient_recommendations_staff_no_recommendations}</EmptyCell>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {recommendations.map((item) => {
              const recommendationId = item.id || item.recommendation_id;
              return (
                <ListItem key={recommendationId}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge status={item.status} className={recommendationStatusTone(item.status)}>
                          {portalStatusLabel(item.status)}
                        </StatusBadge>
                        <CountBadge>{recommendationPriorityLabel(item.priority || "normal")}</CountBadge>
                        {item.portal_visible ? (
                          <StatusBadge tone="success">{t.patient_recommendations_staff_portal_badge}</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">{t.patient_recommendations_staff_staff_only_badge}</StatusBadge>
                        )}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-foreground">{item.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {[
                          item.source_doctor_name,
                          item.source_order_number,
                          item.source_appointment_title,
                          item.source_document_name,
                        ]
                          .filter(Boolean)
                          .join(" / ") || t.patient_recommendations_staff_no_linked_source}
                      </p>
                      {item.patient_decision ? (
                        <p className="mt-2 text-xs text-sky-700">
                          {t.patient_recommendations_staff_patient_decision}: {recommendationDecisionLabel(item.patient_decision)}
                          {item.appointment_request_status
                            ? ` / ${portalStatusLabel(item.appointment_request_status)}`
                            : ""}
                        </p>
                      ) : null}
                      {item.due_at ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.patient_recommendations_staff_due} {formatPortalDateTime(item.due_at)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => handleEditRecommendation(item)}
                      >
                        {t.patient_recommendations_staff_edit_action}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        disabled={busyId === `${recommendationId}:visibility`}
                        onClick={() => void handleTogglePortalVisibility(item)}
                      >
                        {busyId === `${recommendationId}:visibility` ? (
                          <LoaderCircle className="size-3.5 animate-spin" />
                        ) : null}
                        {item.portal_visible
                          ? t.patient_recommendations_staff_hide_action
                          : t.patient_recommendations_staff_release_action}
                      </Button>
                    </div>
                  </div>
                </ListItem>
              );
            })}
          </div>
        )}
      </Section>
    </TabShell>
  );
}

function StaffRecommendationsWorkspace(...args: Parameters<typeof useStaffRecommendationsWorkspaceContent>) {
  return useStaffRecommendationsWorkspaceContent(...args);
}

function formatPatientOption(patient: StaffPatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ");
  return [patient.patient_id, name].filter(Boolean).join(" / ") || patient.id;
}

function formatDoctorOption(doctor: StaffDoctorOption) {
  return [doctor.title, doctor.name, doctor.provider_name, doctor.fachbereich]
    .filter(Boolean)
    .join(" / ");
}

function formatAppointmentOption(appointment: StaffAppointmentOption) {
  return [
    appointment.title,
    formatStaffDate(appointment.date),
    appointment.time_start,
    appointment.doctor_name,
    appointment.provider_name,
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatDocumentOption(document: StaffDocumentOption) {
  return [
    document.auto_name || document.filename || document.id,
    document.category ? documentCategoryLabel(document.category) : "",
    formatStaffDate(document.created_at),
  ]
    .filter(Boolean)
    .join(" / ");
}

function formatDateInput(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function formatStaffDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function ActionButton({
  busy,
  disabled,
  icon,
  label,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={tokens.control.primaryButton}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {label}
    </Button>
  );
}
