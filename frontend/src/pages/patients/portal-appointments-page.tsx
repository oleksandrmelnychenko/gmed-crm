import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { startTransition, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
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
import { formatUnknownValue, useLang } from "@/lib/i18n";
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
  l: (de: string, ru: string, en: string) => string,
  translations: { common_unknown: string; common_unknown_value: string },
) {
  switch (value) {
    case "discovery":
      return l("Discovery", "Диагностика потребности", "Discovery");
    case "intake":
      return l("Aufnahme", "Интейк", "Intake");
    case "execution":
      return l("Ausfuhrung", "Исполнение", "Execution");
    case "closure":
      return l("Abschluss", "Закрытие", "Closure");
    case "followup":
      return l("Nachbetreuung", "Наблюдение", "Follow-up");
    default:
      return formatUnknownValue(value, translations);
  }
}

export function PatientAppointmentsPage() {
  const { t, lang } = useLang();
  const [appointments, setAppointments] = useState<PortalAppointmentItem[]>([]);
  const [requests, setRequests] = useState<PortalAppointmentRequestItem[]>([]);
  const [followupMilestones, setFollowupMilestones] = useState<PortalFollowupMilestoneItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestForm, setRequestForm] = useState<RequestFormState>(blankRequestForm());
  const [version, setVersion] = useState(0);
  const l = useCallback(
    (de: string, ru: string, en: string) =>
      lang === "de" ? de : lang === "ru" ? ru : en,
    [lang],
  );

  useRealtimeSubscription(PORTAL_APPOINTMENT_REALTIME_EVENTS, () => {
    clearApiCache("/me/appointments");
    clearApiCache("/me/appointment-requests");
    clearApiCache("/me/followup-milestones");
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
        const workspace = await fetchPortalAppointmentsWorkspace();

        if (cancelled) return;
        startTransition(() => {
          setAppointments(workspace.appointments);
          setRequests(workspace.requests);
          setFollowupMilestones(workspace.followupMilestones);
          setError("");
        });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : l("Terminbereich konnte nicht geladen werden.", "Не удалось загрузить раздел записей.", "Failed to load appointment workspace."));
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
  }, [loading, version, l]);

  const upcomingAppointments = useMemo(
    () => appointments.filter((item) => item.date >= new Date().toISOString().slice(0, 10)),
    [appointments],
  );
  const openRequests = useMemo(
    () => requests.filter((item) => !["rejected", "converted", "cancelled"].includes(item.status)),
    [requests],
  );
  const nextAppointment = useMemo(
    () =>
      upcomingAppointments
        .slice()
        .sort((left, right) => `${left.date}${left.time_start ?? ""}`.localeCompare(`${right.date}${right.time_start ?? ""}`))[0] ?? null,
    [upcomingAppointments],
  );

  async function handleSubmitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRequestBusy(true);
    setRequestError("");
    setNotice("");

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
      setNotice(l("Terminanfrage wurde an das Betreuungsteam gesendet.", "Запрос на запись отправлен команде сопровождения.", "Appointment request sent to the care team."));
      setRequestForm(blankRequestForm());
      setVersion((value) => value + 1);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : l("Terminanfrage konnte nicht gesendet werden.", "Не удалось отправить запрос на запись.", "Failed to send appointment request."));
    } finally {
      setRequestBusy(false);
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
        title={l("Meine Termine", "Мои записи", "My appointments")}
        description={l(
                "Prüfen Sie geplante Termine und senden Sie neue Terminwünsche an das Betreuungsteam zur Prüfung und Buchung.",
                "Просматривайте запланированные визиты и отправляйте новые запросы на запись для обработки и бронирования командой сопровождения.",
                "Review scheduled visits and send new appointment requests for the care team to triage and book.",
              )}
        actions={
          <>
            <CountBadge>{l("Patientenportal", "Портал пациента", "Patient portal")}</CountBadge>
            <Button
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => setVersion((value) => value + 1)}
            >
              {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {l("Aktualisieren", "Обновить", "Refresh")}
            </Button>
          </>
        }
      />

      {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}

      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label={l("Kommende Termine", "Предстоящие визиты", "Upcoming visits")} value={String(upcomingAppointments.length)} />
        <StatCard label={l("Offene Anfragen", "Открытые запросы", "Open requests")} value={String(openRequests.length)} />
        <StatCard
          label={l("Nächster Termin", "Следующий слот", "Next slot")}
          value={nextAppointment ? formatPortalDate(nextAppointment.date) : l("Nicht festgelegt", "Не указано", "Not set")}
          description={nextAppointment ? nextAppointment.title : l("Keine bevorstehenden Termine", "Нет предстоящих визитов", "No upcoming visits")}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
        <section className="space-y-4">
          <Section
            title={l("Geplante Termine", "Запланированные визиты", "Scheduled visits")}
            accessory={<CountBadge>{appointments.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {l("Ihre derzeit mit dem Patientenprofil verknüpften extern sichtbaren Termine.", "Ваши не внутренние записи, привязанные к профилю пациента.", "Your non-internal appointments currently linked to the patient record.")}
            </p>

            {appointments.length === 0 ? (
              <EmptyCell>
                <p className="text-base font-semibold text-foreground">{l("Noch keine Termine", "Пока нет записей", "No appointments yet")}</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {l("Sobald das Betreuungsteam einen Termin plant, erscheint er hier.", "Как только команда сопровождения запланирует визит, он появится здесь.", "Once a visit is scheduled by the care team, it will appear here.")}
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
                        label={l("Datum", "Дата", "Date")}
                        value={formatPortalDate(item.date)}
                      />
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={l("Zeit", "Время", "Time")}
                        value={[item.time_start, item.time_end].filter(Boolean).join(" - ") || l("Nicht festgelegt", "Не указано", "Not set")}
                      />
                    </div>
                  </ListItem>
                ))}
              </div>
            )}
          </Section>

          <Section
            title={l("Nachsorge-Meilensteine", "Этапы последующего наблюдения", "Follow-up milestones")}
            accessory={<CountBadge>{followupMilestones.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {l("Meilensteine nach der Behandlung, die mit Ihren aktuellen Aufträgen verknüpft sind, auch wenn daraus noch keine konkreten Termine entstanden sind.", "Этапы после лечения, связанные с вашими текущими заказами, даже если команда еще не превратила их в конкретные визиты.", "Post-care milestones linked to your current orders, even when the team has not yet converted them into concrete visits.")}
            </p>

            {followupMilestones.length === 0 ? (
              <EmptyCell>
                {l("Noch keine sichtbaren Nachsorge-Meilensteine.", "Пока нет видимых этапов последующего наблюдения.", "No follow-up milestones are visible yet.")}
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {followupMilestones.map((item) => {
                  const milestoneRows = [
                    {
                      label: l("Ärztlich angeordnet", "По назначению врача", "Doctor-directed"),
                      value: portalStatusLabel(item.doctor_followup_status),
                      tone: followupStatusTone(item.doctor_followup_status),
                    },
                    {
                      label: l("1 Woche", "1 неделя", "1-week"),
                      value: portalStatusLabel(item.followup_1w_status),
                      tone: followupStatusTone(item.followup_1w_status),
                      hint: formatPortalDateTime(item.recommended_followup_1w_at),
                    },
                    {
                      label: l("1 Monat", "1 месяц", "1-month"),
                      value: portalStatusLabel(item.followup_1m_status),
                      tone: followupStatusTone(item.followup_1m_status),
                      hint: formatPortalDateTime(item.recommended_followup_1m_at),
                    },
                    {
                      label: l("6 Monate", "6 месяцев", "6-month"),
                      value: portalStatusLabel(item.followup_6m_status),
                      tone: followupStatusTone(item.followup_6m_status),
                      hint: formatPortalDateTime(item.recommended_followup_6m_at),
                    },
                    {
                      label: l("Paketende", "Завершение пакета", "Package end"),
                      value: portalStatusLabel(item.package_end_status),
                      tone: followupStatusTone(item.package_end_status),
                      hint: formatPortalDate(item.package_end_date ?? item.suggested_package_end_date),
                    },
                    {
                      label: l("Ergebnisübergabe", "Передача результатов", "Results handoff"),
                      value: portalStatusLabel(item.results_handoff_status),
                      tone: followupStatusTone(item.results_handoff_status),
                      hint: l(`${item.results_portal_shares} geteilte Dokumente`, `${item.results_portal_shares} переданных документов`, `${item.results_portal_shares} shared document(s)`),
                    },
                  ];

                  return (
                    <ListItem key={item.order_id} className="space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground">
                            {item.order_number} / {portalOrderPhaseLabel(item.phase, l, t)}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {l("Abschlussanker", "Точка закрытия", "Closure anchor")} {formatPortalDateTime(item.closure_anchor_at)}
                          </p>
                        </div>
                        <StatusBadge tone={item.followup_ready ? "success" : "warning"}>
                          {item.followup_ready ? l("bereit", "готово", "ready") : l("in Bearbeitung", "в работе", "in progress")}
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
            title={l("Anfrageverlauf", "История запросов", "Request history")}
            accessory={<CountBadge>{requests.length}</CountBadge>}
          >
            <p className="text-sm text-muted-foreground">
              {l("Terminwünsche aus dem Portal und ihr Bearbeitungsstatus.", "Запросы на запись из портала и их статус рассмотрения.", "Portal appointment requests and their review status.")}
            </p>

            {requests.length === 0 ? (
              <EmptyCell>
                {l("Noch keine Anfragen gesendet.", "Запросы еще не отправлялись.", "No requests submitted yet.")}
              </EmptyCell>
            ) : (
              <div className="space-y-3">
                {requests.map((item) => (
                  <ListItem key={item.id} className="space-y-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground">
                          {appointmentTypeLabel(item.appointment_type)} {l("Anfrage", "запрос", "request")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {appointmentCarePathKindLabel(item.care_path_kind)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {l("Angefragt", "Запрошено", "Requested")} {formatPortalDateTime(item.requested_at)}
                        </p>
                      </div>
                      <StatusBadge status={item.status} className={appointmentRequestStatusTone(item.status)}>
                        {portalStatusLabel(item.status)}
                      </StatusBadge>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={l("Bevorzugt ab", "Предпочтительно с", "Preferred from")}
                        value={formatPortalDate(item.preferred_date_from)}
                      />
                      <InfoRow
                        className={cn("rounded-lg p-3", tokens.surface.mutedCard)}
                        label={l("Zeitfenster", "Временное окно", "Time window")}
                        value={appointmentTimeOfDayLabel(item.preferred_time_of_day)}
                      />
                    </div>
                    {item.reason ? <p className="text-sm text-muted-foreground">{item.reason}</p> : null}
                    {item.review_note ? (
                      <div className={cn("rounded-lg px-4 py-3 text-sm text-muted-foreground", tokens.surface.mutedCard)}>
                        {l("Prüfnotiz", "Комментарий по рассмотрению", "Review note")}: {item.review_note}
                      </div>
                    ) : null}
                    {item.converted_appointment_id ? (
                      <SuccessBanner>
                        {l("Eingeplant als", "Назначено как", "Scheduled as")} {item.converted_appointment_title || l("Termin", "запись", "appointment")} {l("am", "на", "on")} {formatPortalDate(item.converted_appointment_date)}
                      </SuccessBanner>
                    ) : null}
                  </ListItem>
                ))}
              </div>
            )}
          </Section>
        </section>

        <Section
          title={l("Termin anfragen", "Запросить запись", "Request a visit")}
          accessory={<Stethoscope className="size-4 text-muted-foreground" />}
        >
          <p className="text-sm text-muted-foreground">
            {l("Senden Sie bevorzugte Termine und Kontext. Das Betreuungsteam prüft die Anfrage und wandelt sie in einen echten Termin um.", "Отправьте предпочтительные даты и контекст. Команда сопровождения рассмотрит запрос и превратит его в реальную запись.", "Send preferred dates and context. The care team reviews and converts the request into a real appointment.")}
          </p>
          <form className="space-y-4" onSubmit={(event) => void handleSubmitRequest(event)}>
            <Field label={l("Typ", "Тип", "Type")} htmlFor="portal-appointment-type">
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
                <option value="medical">{l("Medizinisch", "Медицинский", "Medical")}</option>
                <option value="non_medical">{l("Nicht medizinisch", "Немедицинский", "Non-medical")}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={l("Versorgungspfad", "Траектория сопровождения", "Care path")} htmlFor="portal-appointment-care-path">
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
                <option value="regular">{l("Regulär", "Обычный", "Regular")}</option>
                <option value="preventive">{l("Präventiv", "Профилактический", "Preventive")}</option>
                <option value="control">{l("Kontrolle", "Контрольный", "Control")}</option>
                <option value="followup">{l("Nachsorge", "Последующее наблюдение", "Follow-up")}</option>
              </NativeComboboxSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={l("Bevorzugt ab", "Предпочтительно с", "Preferred from")} htmlFor="portal-appointment-preferred-from">
                <Input
                  id="portal-appointment-preferred-from"
                  type="date"
                  value={requestForm.preferredDateFrom}
                  onChange={(event) => setRequestForm((current) => ({ ...current, preferredDateFrom: event.target.value }))}
                  className={inputClass}
                />
              </Field>
              <Field label={l("Bevorzugt bis", "Предпочтительно до", "Preferred to")} htmlFor="portal-appointment-preferred-to">
                <Input
                  id="portal-appointment-preferred-to"
                  type="date"
                  value={requestForm.preferredDateTo}
                  onChange={(event) => setRequestForm((current) => ({ ...current, preferredDateTo: event.target.value }))}
                  className={inputClass}
                />
              </Field>
            </div>
            <Field label={l("Zeitfenster", "Временное окно", "Time window")} htmlFor="portal-appointment-time-window">
              <NativeComboboxSelect
                id="portal-appointment-time-window"
                value={requestForm.preferredTimeOfDay}
                onChange={(event) => setRequestForm((current) => ({ ...current, preferredTimeOfDay: event.target.value }))}
                className={selectClass}
              >
                <option value="flexible">{l("Flexibel", "Гибко", "Flexible")}</option>
                <option value="morning">{l("Morgens", "Утром", "Morning")}</option>
                <option value="midday">{l("Mittags", "Днем", "Midday")}</option>
                <option value="afternoon">{l("Nachmittags", "После обеда", "Afternoon")}</option>
                <option value="evening">{l("Abends", "Вечером", "Evening")}</option>
              </NativeComboboxSelect>
            </Field>
            <Field label={l("Fachgebiet oder Thema", "Специальность или тема", "Specialty or topic")} htmlFor="portal-appointment-specialty">
              <input
                id="portal-appointment-specialty"
                value={requestForm.specialty}
                onChange={(event) => setRequestForm((current) => ({ ...current, specialty: event.target.value }))}
                placeholder={l("Kardiologie, Diagnostik, Transfer, Hotel usw.", "Кардиология, диагностика, трансфер, отель и т. д.", "Cardiology, diagnostics, transfer, hotel, etc.")}
                className={cn(inputClass, "w-full border border-input px-3 text-sm")}
              />
            </Field>
            <Field label={l("Ortpräferenz", "Предпочтительное место", "Location preference")} htmlFor="portal-appointment-location">
              <input
                id="portal-appointment-location"
                value={requestForm.location}
                onChange={(event) => setRequestForm((current) => ({ ...current, location: event.target.value }))}
                placeholder={l("Klinik, Stadt oder Remote-Anfrage", "Клиника, город или удаленный формат", "Clinic, city or remote request")}
                className={cn(inputClass, "w-full border border-input px-3 text-sm")}
              />
            </Field>
            <Field label={l("Anlass", "Причина", "Reason")} htmlFor="portal-appointment-reason">
              <textarea
                id="portal-appointment-reason"
                value={requestForm.reason}
                onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder={l("Was benötigen Sie und was sollte das Team berücksichtigen?", "Что вам нужно и что команде следует учесть?", "What do you need and what should the team consider?")}
                className={cn(textareaClass, "min-h-[120px]")}
              />
            </Field>
            <Field label={l("Zusätzliche Notiz", "Дополнительная заметка", "Additional note")} htmlFor="portal-appointment-notes">
              <textarea
                id="portal-appointment-notes"
                value={requestForm.notes}
                onChange={(event) => setRequestForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={l("Optionaler logistischer oder klinischer Kontext.", "Необязательный логистический или клинический контекст.", "Optional logistical or clinical context.")}
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
              {l("Terminanfrage senden", "Отправить запрос на запись", "Send appointment request")}
            </Button>
          </form>
        </Section>
      </section>
    </TabShell>
  );
}
