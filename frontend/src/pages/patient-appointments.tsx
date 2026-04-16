import { startTransition, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { CalendarClock, LoaderCircle, RefreshCw, Send, Stethoscope } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
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
} from "@/pages/patient-portal.shared";
import type {
  PortalAppointmentItem,
  PortalAppointmentRequestItem,
  PortalFollowupMilestoneItem,
} from "@/pages/patient-portal.shared";
import { cn } from "@/lib/utils";

function shellCard(extra?: string) {
  return cn("rounded-[1.75rem] border border-slate-200 bg-white shadow-sm", extra);
}

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

export function PatientAppointmentsPage() {
  const { lang } = useLang();
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
  const l = (de: string, ru: string, en: string) => (lang === "de" ? de : lang === "ru" ? ru : en);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (loading) {
        setRefreshing(false);
      } else {
        setRefreshing(true);
      }

      try {
        const [appointmentRows, requestRows, followupRows] = await Promise.all([
          apiFetch<PortalAppointmentItem[]>("/me/appointments"),
          apiFetch<PortalAppointmentRequestItem[]>("/me/appointment-requests"),
          apiFetch<PortalFollowupMilestoneItem[]>("/me/followup-milestones").catch(() => []),
        ]);

        if (cancelled) return;
        startTransition(() => {
          setAppointments(appointmentRows);
          setRequests(requestRows);
          setFollowupMilestones(followupRows);
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
  }, [loading, version]);

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
      await apiFetch("/me/appointment-requests", {
        method: "POST",
        body: JSON.stringify({
          appointment_type: requestForm.appointmentType,
          care_path_kind: requestForm.appointmentType === "medical" ? requestForm.carePathKind : "regular",
          preferred_date_from: requestForm.preferredDateFrom || undefined,
          preferred_date_to: requestForm.preferredDateTo || undefined,
          preferred_time_of_day: requestForm.preferredTimeOfDay || undefined,
          specialty: requestForm.specialty || undefined,
          location: requestForm.location || undefined,
          reason: requestForm.reason || undefined,
          notes: requestForm.notes || undefined,
        }),
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
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm text-slate-500 shadow-sm">
          <LoaderCircle className="size-4 animate-spin" />
          {l("Termine werden geladen...", "Загрузка записей...", "Loading appointments...")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className={shellCard("bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_34%),linear-gradient(135deg,#0f172a_0%,#0c4a6e_45%,#134e4a_100%)] px-6 py-6 text-white")}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm uppercase tracking-[0.18em] text-white/60">{l("Patientenportal", "Портал пациента", "Patient portal")}</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">{l("Meine Termine", "Мои записи", "My appointments")}</h1>
            <p className="mt-3 text-sm leading-7 text-white/75">
              {l(
                "Prüfen Sie geplante Termine und senden Sie neue Terminwünsche an das Betreuungsteam zur Prüfung und Buchung.",
                "Просматривайте запланированные визиты и отправляйте новые запросы на запись для обработки и бронирования командой сопровождения.",
                "Review scheduled visits and send new appointment requests for the care team to triage and book.",
              )}
            </p>
          </div>
          <Button
            variant="outline"
            className="border-white/15 bg-white/8 text-white hover:bg-white/12 hover:text-white"
            onClick={() => setVersion((value) => value + 1)}
          >
            {refreshing ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            {l("Aktualisieren", "Обновить", "Refresh")}
          </Button>
        </div>
      </section>

      {notice ? (
        <section className={shellCard("border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700")}>
          {notice}
        </section>
      ) : null}
      {error ? (
        <section className={shellCard("border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700")}>
          {error}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label={l("Kommende Termine", "Предстоящие визиты", "Upcoming visits")} value={String(upcomingAppointments.length)} />
        <MetricCard label={l("Offene Anfragen", "Открытые запросы", "Open requests")} value={String(openRequests.length)} />
        <MetricCard
          label={l("Nächster Termin", "Следующий слот", "Next slot")}
          value={nextAppointment ? formatPortalDate(nextAppointment.date) : l("Nicht festgelegt", "Не указано", "Not set")}
          description={nextAppointment ? nextAppointment.title : l("Keine bevorstehenden Termine", "Нет предстоящих визитов", "No upcoming visits")}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_0.95fr]">
        <section className="space-y-4">
          <section className={shellCard("p-5")}>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Geplante Termine", "Запланированные визиты", "Scheduled visits")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Ihre derzeit mit dem Patientenprofil verknüpften extern sichtbaren Termine.", "Ваши не внутренние записи, привязанные к профилю пациента.", "Your non-internal appointments currently linked to the patient record.")}
              </p>
            </div>
          </section>

          {appointments.length === 0 ? (
            <section className={shellCard("border-dashed px-6 py-12 text-center")}>
              <p className="text-base font-semibold text-slate-950">{l("Noch keine Termine", "Пока нет записей", "No appointments yet")}</p>
              <p className="mt-2 text-sm text-slate-500">
                {l("Sobald das Betreuungsteam einen Termin plant, erscheint er hier.", "Как только команда сопровождения запланирует визит, он появится здесь.", "Once a visit is scheduled by the care team, it will appear here.")}
              </p>
            </section>
          ) : (
            appointments.map((item) => (
              <article key={item.id} className={shellCard("p-5")}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className={cn("rounded-full", appointmentStatusTone(item.status))}>
                          {portalStatusLabel(item.status)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                          {appointmentTypeLabel(item.appointment_type)}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-violet-200 bg-violet-50 text-violet-700">
                          {appointmentCarePathKindLabel(item.care_path_kind)}
                        </Badge>
                      </div>
                    <h2 className="mt-3 text-xl font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {[item.provider_name, item.doctor_name, item.location].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <CalendarClock className="size-5 text-sky-700" />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Detail label={l("Datum", "Дата", "Date")} value={formatPortalDate(item.date)} />
                  <Detail label={l("Zeit", "Время", "Time")} value={[item.time_start, item.time_end].filter(Boolean).join(" - ") || l("Nicht festgelegt", "Не указано", "Not set")} />
                </div>
              </article>
            ))
          )}

          <section className={shellCard("p-5")}>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Nachsorge-Meilensteine", "Этапы последующего наблюдения", "Follow-up milestones")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Meilensteine nach der Behandlung, die mit Ihren aktuellen Aufträgen verknüpft sind, auch wenn daraus noch keine konkreten Termine entstanden sind.", "Этапы после лечения, связанные с вашими текущими заказами, даже если команда еще не превратила их в конкретные визиты.", "Post-care milestones linked to your current orders, even when the team has not yet converted them into concrete visits.")}
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {followupMilestones.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                  {l("Noch keine sichtbaren Nachsorge-Meilensteine.", "Пока нет видимых этапов последующего наблюдения.", "No follow-up milestones are visible yet.")}
                </div>
              ) : (
                followupMilestones.map((item) => (
                  <article key={item.order_id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {item.order_number} · {item.phase.replaceAll("_", " ")}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {l("Abschlussanker", "Точка закрытия", "Closure anchor")} {formatPortalDateTime(item.closure_anchor_at)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-full",
                          item.followup_ready
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {item.followup_ready ? l("bereit", "готово", "ready") : l("in Bearbeitung", "в работе", "in progress")}
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      <MilestoneDetail
                        label={l("Ärztlich angeordnet", "По назначению врача", "Doctor-directed")}
                        value={portalStatusLabel(item.doctor_followup_status)}
                        tone={followupStatusTone(item.doctor_followup_status)}
                      />
                      <MilestoneDetail
                        label={l("1 Woche", "1 неделя", "1-week")}
                        value={portalStatusLabel(item.followup_1w_status)}
                        tone={followupStatusTone(item.followup_1w_status)}
                        hint={formatPortalDateTime(item.recommended_followup_1w_at)}
                      />
                      <MilestoneDetail
                        label={l("1 Monat", "1 месяц", "1-month")}
                        value={portalStatusLabel(item.followup_1m_status)}
                        tone={followupStatusTone(item.followup_1m_status)}
                        hint={formatPortalDateTime(item.recommended_followup_1m_at)}
                      />
                      <MilestoneDetail
                        label={l("6 Monate", "6 месяцев", "6-month")}
                        value={portalStatusLabel(item.followup_6m_status)}
                        tone={followupStatusTone(item.followup_6m_status)}
                        hint={formatPortalDateTime(item.recommended_followup_6m_at)}
                      />
                      <MilestoneDetail
                        label={l("Paketende", "Завершение пакета", "Package end")}
                        value={portalStatusLabel(item.package_end_status)}
                        tone={followupStatusTone(item.package_end_status)}
                        hint={formatPortalDate(item.package_end_date ?? item.suggested_package_end_date)}
                      />
                      <MilestoneDetail
                        label={l("Ergebnisübergabe", "Передача результатов", "Results handoff")}
                        value={portalStatusLabel(item.results_handoff_status)}
                        tone={followupStatusTone(item.results_handoff_status)}
                        hint={l(`${item.results_portal_shares} geteilte Dokumente`, `${item.results_portal_shares} переданных документов`, `${item.results_portal_shares} shared document(s)`)}
                      />
                    </div>

                    {item.followup_summary ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        {item.followup_summary}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>

          <section className={shellCard("p-5")}>
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Anfrageverlauf", "История запросов", "Request history")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Terminwünsche aus dem Portal und ihr Bearbeitungsstatus.", "Запросы на запись из портала и их статус рассмотрения.", "Portal appointment requests and their review status.")}
              </p>
            </div>
            <div className="mt-5 space-y-3">
              {requests.length === 0 ? (
                <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-sm text-slate-500">
                  {l("Noch keine Anfragen gesendet.", "Запросы еще не отправлялись.", "No requests submitted yet.")}
                </div>
              ) : (
                requests.map((item) => (
                  <article key={item.id} className="rounded-[1.35rem] border border-slate-200 bg-slate-50/80 px-4 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">
                          {appointmentTypeLabel(item.appointment_type)} {l("Anfrage", "запрос", "request")}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {appointmentCarePathKindLabel(item.care_path_kind)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {l("Angefragt", "Запрошено", "Requested")} {formatPortalDateTime(item.requested_at)}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("rounded-full", appointmentRequestStatusTone(item.status))}>
                        {portalStatusLabel(item.status)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <Detail label={l("Bevorzugt ab", "Предпочтительно с", "Preferred from")} value={formatPortalDate(item.preferred_date_from)} />
                      <Detail label={l("Zeitfenster", "Временное окно", "Time window")} value={appointmentTimeOfDayLabel(item.preferred_time_of_day)} />
                    </div>
                    {item.reason ? <p className="mt-3 text-sm text-slate-600">{item.reason}</p> : null}
                    {item.review_note ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                        {l("Prüfnotiz", "Комментарий по рассмотрению", "Review note")}: {item.review_note}
                      </div>
                    ) : null}
                    {item.converted_appointment_id ? (
                      <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                        {l("Eingeplant als", "Назначено как", "Scheduled as")} {item.converted_appointment_title || l("Termin", "запись", "appointment")} {l("am", "на", "on")} {formatPortalDate(item.converted_appointment_date)}
                      </div>
                    ) : null}
                  </article>
                ))
              )}
            </div>
          </section>
        </section>

        <section className={shellCard("p-5")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{l("Termin anfragen", "Запросить запись", "Request a visit")}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {l("Senden Sie bevorzugte Termine und Kontext. Das Betreuungsteam prüft die Anfrage und wandelt sie in einen echten Termin um.", "Отправьте предпочтительные даты и контекст. Команда сопровождения рассмотрит запрос и превратит его в реальную запись.", "Send preferred dates and context. The care team reviews and converts the request into a real appointment.")}
              </p>
            </div>
            <Stethoscope className="mt-1 size-5 text-sky-700" />
          </div>
          <form className="mt-5 space-y-4" onSubmit={(event) => void handleSubmitRequest(event)}>
            <Field label={l("Typ", "Тип", "Type")}>
              <select
                value={requestForm.appointmentType}
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    appointmentType: event.target.value as "medical" | "non_medical",
                    carePathKind:
                      event.target.value === "medical" ? current.carePathKind : "regular",
                  }))
                }
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              >
                <option value="medical">{l("Medizinisch", "Медицинский", "Medical")}</option>
                <option value="non_medical">{l("Nicht medizinisch", "Немедицинский", "Non-medical")}</option>
              </select>
            </Field>
            <Field label={l("Versorgungspfad", "Траектория сопровождения", "Care path")}>
              <select
                value={requestForm.carePathKind}
                onChange={(event) =>
                  setRequestForm((current) => ({
                    ...current,
                    carePathKind: event.target.value as "regular" | "preventive" | "control" | "followup",
                  }))
                }
                disabled={requestForm.appointmentType !== "medical"}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              >
                <option value="regular">{l("Regulär", "Обычный", "Regular")}</option>
                <option value="preventive">{l("Präventiv", "Профилактический", "Preventive")}</option>
                <option value="control">{l("Kontrolle", "Контрольный", "Control")}</option>
                <option value="followup">{l("Nachsorge", "Последующее наблюдение", "Follow-up")}</option>
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={l("Bevorzugt ab", "Предпочтительно с", "Preferred from")}>
                <Input
                  type="date"
                  value={requestForm.preferredDateFrom}
                  onChange={(event) => setRequestForm((current) => ({ ...current, preferredDateFrom: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </Field>
              <Field label={l("Bevorzugt bis", "Предпочтительно до", "Preferred to")}>
                <Input
                  type="date"
                  value={requestForm.preferredDateTo}
                  onChange={(event) => setRequestForm((current) => ({ ...current, preferredDateTo: event.target.value }))}
                  className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                />
              </Field>
            </div>
            <Field label={l("Zeitfenster", "Временное окно", "Time window")}>
              <select
                value={requestForm.preferredTimeOfDay}
                onChange={(event) => setRequestForm((current) => ({ ...current, preferredTimeOfDay: event.target.value }))}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              >
                <option value="flexible">{l("Flexibel", "Гибко", "Flexible")}</option>
                <option value="morning">{l("Morgens", "Утром", "Morning")}</option>
                <option value="midday">{l("Mittags", "Днем", "Midday")}</option>
                <option value="afternoon">{l("Nachmittags", "После обеда", "Afternoon")}</option>
                <option value="evening">{l("Abends", "Вечером", "Evening")}</option>
              </select>
            </Field>
            <Field label={l("Fachgebiet oder Thema", "Специальность или тема", "Specialty or topic")}>
              <input
                value={requestForm.specialty}
                onChange={(event) => setRequestForm((current) => ({ ...current, specialty: event.target.value }))}
                placeholder={l("Kardiologie, Diagnostik, Transfer, Hotel usw.", "Кардиология, диагностика, трансфер, отель и т. д.", "Cardiology, diagnostics, transfer, hotel, etc.")}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </Field>
            <Field label={l("Ortpräferenz", "Предпочтительное место", "Location preference")}>
              <input
                value={requestForm.location}
                onChange={(event) => setRequestForm((current) => ({ ...current, location: event.target.value }))}
                placeholder={l("Klinik, Stadt oder Remote-Anfrage", "Клиника, город или удаленный формат", "Clinic, city or remote request")}
                className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </Field>
            <Field label={l("Anlass", "Причина", "Reason")}>
              <textarea
                value={requestForm.reason}
                onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))}
                placeholder={l("Was benötigen Sie und was sollte das Team berücksichtigen?", "Что вам нужно и что команде следует учесть?", "What do you need and what should the team consider?")}
                className="min-h-[120px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </Field>
            <Field label={l("Zusätzliche Notiz", "Дополнительная заметка", "Additional note")}>
              <textarea
                value={requestForm.notes}
                onChange={(event) => setRequestForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder={l("Optionaler logistischer oder klinischer Kontext.", "Необязательный логистический или клинический контекст.", "Optional logistical or clinical context.")}
                className="min-h-[100px] w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
              />
            </Field>
            {requestError ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {requestError}
              </div>
            ) : null}
            <Button
              type="submit"
              className="w-full rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={requestBusy}
            >
              {requestBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
              {l("Terminanfrage senden", "Отправить запрос на запись", "Send appointment request")}
            </Button>
          </form>
        </section>
      </section>
    </div>
  );
}

function MetricCard({ label, value, description }: { label: string; value: string; description?: string }) {
  return (
    <section className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {description ? <p className="mt-2 text-xs text-slate-500">{description}</p> : null}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  );
}

function MilestoneDetail({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <Badge variant="outline" className={cn("mt-3 rounded-full", tone)}>
        {value.replaceAll("_", " ")}
      </Badge>
      {hint ? <p className="mt-3 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
