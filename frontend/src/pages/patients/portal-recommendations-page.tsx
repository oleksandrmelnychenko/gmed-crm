import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CalendarPlus, CheckCircle2, LoaderCircle, MessageCircle, RefreshCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
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
  selectClass,
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
  formatPortalDateTime,
  portalStatusLabel,
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

export function PatientRecommendationsPage() {
  const { user } = useAuth();
  const { lang } = useLang();
  const [recommendations, setRecommendations] = useState<PortalRecommendationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );
  const isPatientPortalUser = user?.role === "patient";

  useRealtimeSubscription(PORTAL_RECOMMENDATION_REALTIME_EVENTS, () => {
    clearApiCache("/me/recommendations");
    clearApiCache("/me/next-actions");
    setVersion((value) => value + 1);
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!isPatientPortalUser) {
        setRecommendations([]);
        setError("");
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const rows = await fetchPortalRecommendations();
        if (cancelled) return;
        startTransition(() => {
          setRecommendations(rows);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Empfehlungen konnten nicht geladen werden.", "Не удалось загрузить рекомендации.", "Failed to load recommendations."));
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
  }, [isPatientPortalUser, loading, version, l]);

  const activeCount = useMemo(
    () => recommendations.filter((item) => item.status === "active").length,
    [recommendations],
  );

  async function handleDecision(recommendationId: string, decision: string) {
    if (!isPatientPortalUser) {
      return;
    }

    setBusyId(`${recommendationId}:${decision}`);
    setError("");
    setNotice("");

    try {
      if (decision === "schedule") {
        await requestRecommendationAppointment(recommendationId, {});
        setNotice(l("Terminanfrage wurde aus der Empfehlung erstellt.", "Запрос на визит создан из рекомендации.", "Appointment request created from the recommendation."));
      } else {
        await decidePortalRecommendation(recommendationId, { decision });
        setNotice(l("Ihre Entscheidung wurde gespeichert.", "Ваше решение сохранено.", "Your decision was saved."));
      }
      clearApiCache("/me/recommendations");
      clearApiCache("/me/next-actions");
      setVersion((value) => value + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : l("Aktion konnte nicht gespeichert werden.", "Не удалось сохранить действие.", "Failed to save action."));
    } finally {
      setBusyId(null);
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
            <Button variant="outline" className={tokens.control.primaryButton} onClick={() => setVersion((value) => value + 1)}>
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
                        {item.recommendation_type.replaceAll("_", " ")}
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
                    value={`${item.patient_decision.replaceAll("_", " ")}${item.appointment_request_status ? ` / ${portalStatusLabel(item.appointment_request_status)}` : ""}`}
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

function StaffRecommendationsWorkspace() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<StaffPatientOption[]>([]);
  const [doctors, setDoctors] = useState<StaffDoctorOption[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [recommendations, setRecommendations] = useState<PortalRecommendationItem[]>([]);
  const [orders, setOrders] = useState<StaffOrderOption[]>([]);
  const [appointments, setAppointments] = useState<StaffAppointmentOption[]>([]);
  const [documents, setDocuments] = useState<StaffDocumentOption[]>([]);
  const [form, setForm] = useState<RecommendationFormState>(() => emptyRecommendationForm());
  const [lookupLoading, setLookupLoading] = useState(true);
  const [patientLoading, setPatientLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [version, setVersion] = useState(0);
  const canEdit = user?.role === "ceo" || user?.role === "patient_manager";

  useEffect(() => {
    let cancelled = false;
    if (!canEdit) {
      setLookupLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLookupLoading(true);
    setError("");

    Promise.all([
      apiFetch<StaffPatientOption[]>("/patients?active_only=true", { cacheTtlMs: 60_000 }),
      apiFetch<StaffDoctorOption[]>("/cases/meta/doctors", { cacheTtlMs: 60_000 }).catch(() => []),
    ])
      .then(([patientRows, doctorRows]) => {
        if (cancelled) return;
        startTransition(() => {
          setPatients(patientRows);
          setDoctors(doctorRows);
          if (patientRows.length === 1) {
            setSelectedPatientId((current) => current || patientRows[0].id);
          }
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load patient recommendation lookups.");
      })
      .finally(() => {
        if (!cancelled) setLookupLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canEdit]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedPatientId || !canEdit) {
      setRecommendations([]);
      setOrders([]);
      setAppointments([]);
      setDocuments([]);
      setPatientLoading(false);
      return;
    }

    setPatientLoading(true);
    setError("");

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
          setRecommendations(recommendationRows);
          setOrders(orderRows);
          setAppointments(appointmentRows);
          setDocuments(documentRows);
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load patient recommendations.");
      })
      .finally(() => {
        if (!cancelled) setPatientLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canEdit, selectedPatientId, version]);

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
      setError("Recommendation title is required.");
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
      setNotice(form.id ? "Recommendation updated." : "Recommendation created.");
      setVersion((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recommendation.");
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
      setNotice(item.portal_visible ? "Recommendation hidden from portal." : "Recommendation released to portal.");
      setVersion((current) => current + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update portal visibility.");
    } finally {
      setBusyId("");
    }
  }

  if (!canEdit) {
    return (
      <TabShell className="mt-0 min-h-0">
        <PageHeader
          title="Recommendations"
          description="This staff view is limited to CEO and patient manager roles."
        />
        <EmptyCell>Open a patient workspace to review recommendations with your current role.</EmptyCell>
      </TabShell>
    );
  }

  if (lookupLoading) {
    return (
      <Section title="Recommendations">
        <TabLoader />
      </Section>
    );
  }

  return (
    <TabShell className="mt-0 min-h-0">
      <PageHeader
        title="Recommendations"
        description="Create patient recommendations, link their source context, and control portal release."
        actions={
          <Button
            type="button"
            variant="outline"
            className="rounded-lg"
            disabled={!selectedPatientId || patientLoading}
            onClick={() => setVersion((current) => current + 1)}
          >
            <RefreshCw className={cn("size-4", patientLoading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}

      <Section
        title="Patient context"
        accessory={
          <div className="flex flex-wrap gap-2">
            <CountBadge>{activeCount} active</CountBadge>
            <CountBadge>{releasedCount} released</CountBadge>
          </div>
        }
      >
        <Field label="Patient">
          <select
            value={selectedPatientId}
            onChange={(event) => {
              setSelectedPatientId(event.target.value);
              resetForm();
            }}
            className={selectClass}
          >
            <option value="">Select a patient</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {formatPatientOption(patient)}
              </option>
            ))}
          </select>
        </Field>
        {selectedPatient ? (
          <p className="text-xs text-muted-foreground">
            Editing recommendations for {formatPatientOption(selectedPatient)}.
          </p>
        ) : null}
      </Section>

      {selectedPatientId ? (
        <form onSubmit={handleSubmitRecommendation}>
          <Section
            title={form.id ? "Edit recommendation" : "Create recommendation"}
            accessory={form.id ? <CountBadge>Editing</CountBadge> : <CountBadge>Draft</CountBadge>}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Title">
                <input
                  value={form.title}
                  onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
                  className={cn(inputClass, "w-full border border-input px-3 text-sm")}
                  placeholder="What should the patient do next?"
                />
              </Field>
              <Field label="Due date">
                <input
                  type="date"
                  value={form.due_at}
                  onChange={(event) => setForm((current) => ({ ...current, due_at: event.target.value }))}
                  className={cn(inputClass, "w-full border border-input px-3 text-sm")}
                />
              </Field>
              <Field label="Type">
                <select
                  value={form.recommendation_type}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, recommendation_type: event.target.value }))
                  }
                  className={selectClass}
                >
                  {RECOMMENDATION_TYPE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatOptionLabel(value)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Priority">
                <select
                  value={form.priority}
                  onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
                  className={selectClass}
                >
                  {RECOMMENDATION_PRIORITY_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatOptionLabel(value)}
                    </option>
                  ))}
                </select>
              </Field>
              {form.id ? (
                <Field label="Status">
                  <select
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                    className={selectClass}
                  >
                    {RECOMMENDATION_STATUS_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {formatOptionLabel(value)}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              <Field label="Source doctor">
                <select
                  value={form.source_doctor_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_doctor_id: event.target.value }))
                  }
                  className={selectClass}
                >
                  <option value="">No doctor link</option>
                  {doctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {formatDoctorOption(doctor)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source order">
                <select
                  value={form.source_order_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_order_id: event.target.value }))
                  }
                  className={selectClass}
                >
                  <option value="">No order link</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number} {order.phase ? `/ ${formatOptionLabel(order.phase)}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source appointment">
                <select
                  value={form.source_appointment_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_appointment_id: event.target.value }))
                  }
                  className={selectClass}
                >
                  <option value="">No appointment link</option>
                  {appointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {formatAppointmentOption(appointment)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Source document">
                <select
                  value={form.source_document_id}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, source_document_id: event.target.value }))
                  }
                  className={selectClass}
                >
                  <option value="">No document link</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {formatDocumentOption(document)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                className={textareaClass}
                placeholder="Add context, instructions, or patient-safe rationale."
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
              Release to patient portal
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="rounded-lg" disabled={saving || patientLoading}>
                {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {form.id ? "Save recommendation" : "Create recommendation"}
              </Button>
              {form.id ? (
                <Button type="button" variant="outline" className="rounded-lg" onClick={resetForm}>
                  Cancel edit
                </Button>
              ) : null}
            </div>
          </Section>
        </form>
      ) : null}

      <Section title="Patient recommendations" accessory={<CountBadge>{recommendations.length}</CountBadge>}>
        {!selectedPatientId ? (
          <EmptyCell>Select a patient to view and manage recommendations.</EmptyCell>
        ) : patientLoading ? (
          <TabLoader />
        ) : recommendations.length === 0 ? (
          <EmptyCell>No recommendations for this patient yet.</EmptyCell>
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
                        <CountBadge>{formatOptionLabel(item.priority || "normal")}</CountBadge>
                        {item.portal_visible ? (
                          <StatusBadge tone="success">Portal</StatusBadge>
                        ) : (
                          <StatusBadge tone="neutral">Staff only</StatusBadge>
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
                          .join(" / ") || "No linked source"}
                      </p>
                      {item.patient_decision ? (
                        <p className="mt-2 text-xs text-sky-700">
                          Patient decision: {formatOptionLabel(item.patient_decision)}
                          {item.appointment_request_status
                            ? ` / ${formatOptionLabel(item.appointment_request_status)}`
                            : ""}
                        </p>
                      ) : null}
                      {item.due_at ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Due {formatPortalDateTime(item.due_at)}
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
                        Edit
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
                        {item.portal_visible ? "Hide" : "Release"}
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
  return [document.auto_name || document.filename || document.id, document.category, formatStaffDate(document.created_at)]
    .filter(Boolean)
    .join(" / ");
}

function formatOptionLabel(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
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
