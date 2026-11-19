import { useEffect, useMemo, useRef, useState } from "react";
import { Stethoscope, CalendarDays, Clock3, Info, LayoutGrid, LoaderCircle, TriangleAlert } from "lucide-react";

import { SectionHeading } from "@/components/ui/section-heading";
import { buttonVariants } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { StaffLink } from "@/components/staff-link";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";

import {
  groupAppointmentsByDay,
  groupAppointmentsByDoctor,
  isShownToPatient,
  planningDoctorsFromCareTeam,
  plannedDayLabel,
  plannedTimeLabel,
  unreleasedPlanCount,
  type PlanningDoctor,
} from "../model/order-planned-appointments";
import {
  ORDER_APPOINTMENT_STATUS,
  localizePipelineAppointments,
  type OrderPipeline,
  type OrderPipelineAppointment,
  type OrderPipelineCareTeamMember,
} from "../model/order-pipeline";
import { AppointmentEntryRow, PlanningDoctorPicker } from "./order-appointment-entry";
import { storedPlannerDraftCount } from "../model/order-visit-planner";
import { OrderVisitPlanner } from "./order-visit-planner";
import { appDateKey } from "@/lib/app-time-zone";
import { formatCount } from "@/lib/i18n/plural";

type OrderPlannedAppointmentsProps = {
  orderId: string;
  lang: string;
  reloadNonce: number;
  /** Calendar of the order; carries the patient and the way back to the order. */
  appointmentsHref: string;
  /** The viewer plans this order and may show the plan to the patient. */
  canReleasePlan?: boolean;
  /** The viewer may add appointments under the doctors (plan stage 3). */
  canPlan?: boolean;
  /**
   * A lead's order (no patient yet): the planner lays the doctors out on the
   * grid as a draft that becomes visits once the order has its patient.
   */
  canDraft?: boolean;
  /** The order's lead: its requested specializations lead the doctor picker. */
  leadId?: string | null;
  patientId?: string | null;
  /** An appointment was added: the other planning blocks reload. */
  onChanged?: () => void;
  /** «Добавить в смету» for a visit whose doctor the signed estimate lacks. */
  onAddToEstimate?: (appointment: OrderPipelineAppointment) => void;
};

type GroupBy = "grid" | "day" | "doctor";

type PlanReleaseButtonProps = {
  count: number;
  busy: boolean;
  lang: string;
  onRelease: () => void;
  /** Grid visits not created yet: the release waits for them (bug 77). */
  pendingDrafts?: number;
  /** «Сначала создайте приёмы (N)» opens the grid. */
  onShowDrafts?: () => void;
};

/**
 * «Показать план пациенту (N)»: the planned appointments the portal does not
 * show yet become visible to the patient at once (owner decision 2026-11-02).
 * While the grid holds visits not created yet, the release is held with the
 * blocker that names them: it would show the patient a plan without them.
 */
export function PlanReleaseButton({
  count,
  busy,
  lang,
  onRelease,
  pendingDrafts = 0,
  onShowDrafts,
}: PlanReleaseButtonProps) {
  if (count <= 0 && pendingDrafts <= 0) return null;
  const label = lang === "de" ? "Plan dem Patienten zeigen" : "Показать план пациенту";
  const held = pendingDrafts > 0;
  return (
    <>
      {held ? (
        <button
          type="button"
          data-testid="order-plan-release-blocker"
          onClick={onShowDrafts}
          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {lang === "de"
            ? `Erst Termine anlegen (${pendingDrafts})`
            : `Сначала создайте приёмы (${pendingDrafts})`}
        </button>
      ) : null}
      <button
        type="button"
        data-testid="order-plan-release"
        disabled={busy || held}
        onClick={onRelease}
        data-slot="button" data-variant="default" data-size="sm" className={buttonVariants({ size: "sm" })}
      >
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
        {count > 0 ? `${label} (${count})` : label}
      </button>
    </>
  );
}

/**
 * A doctor outside the signed quote may be planned (owner decision
 * 2026-11-02, question 5); completing the visit then adds an invoice line.
 */
export function outsideQuoteWhy(lang: string) {
  return lang === "de"
    ? "Der Patient hat einen KV ohne diesen Arzt unterschrieben: nach dem Termin entsteht eine Rechnungszeile über die unterschriebene Summe hinaus. In den KV aufnehmen und die neue Version unterschreiben lassen."
    : "Клиент подписал смету без этого врача: после приёма появится строка счёта сверх подписанной суммы. Добавьте врача в смету и дайте подписать новую версию.";
}

export function OutsideQuoteWarning({
  lang,
  compact = false,
  onAdd,
}: {
  lang: string;
  /** Several visits share it: a small marker, the explanation sits in the summary above. */
  compact?: boolean;
  /** «Добавить в смету»: the order's service sheet, prefilled for this doctor. */
  onAdd?: () => void;
}) {
  const addLabel = lang === "de" ? "In den KV aufnehmen" : "Добавить в смету";
  const addButton = onAdd ? (
    <button
      type="button"
      data-testid="order-planned-appointment-add-to-estimate"
      onClick={onAdd}
      className="shrink-0 rounded-md border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100"
    >
      {addLabel}
    </button>
  ) : null;
  if (compact) {
    return (
      <span
        data-testid="order-planned-appointment-outside-quote"
        title={outsideQuoteWhy(lang)}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900"
      >
        <Info aria-hidden="true" className="size-3" />
        {lang === "de" ? "außerhalb des KV" : "вне сметы"}
        {addButton}
      </span>
    );
  }
  return (
    <div
      data-testid="order-planned-appointment-outside-quote"
      title={outsideQuoteWhy(lang)}
      className="mt-2 flex flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900"
    >
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
      {lang === "de"
        ? "Arzt nicht im unterschriebenen KV – beim Abschluss des Termins entsteht eine neue Rechnungszeile"
        : "Врача нет в подписанном КВ — при завершении приёма появится новая строка счёта"}</span>
      {addButton}
    </div>
  );
}

/** "не видно пациенту" next to an appointment the patient does not see yet. */
export function HiddenFromPatientMarker({ lang }: { lang: string }) {
  return (
    <span
      data-testid="order-planned-appointment-hidden"
      className="rounded-full border border-border/70 px-1.5 py-px text-[11px] font-medium text-muted-foreground"
    >
      {lang === "de" ? "für Patienten nicht sichtbar" : "не видно пациенту"}
    </span>
  );
}

/**
 * The order's appointments right in the planning section, by day or by doctor,
 * so the plan can be read without going to the calendar.
 */
export function OrderPlannedAppointments({
  orderId,
  lang,
  reloadNonce,
  appointmentsHref,
  canReleasePlan = false,
  canPlan = false,
  canDraft = false,
  leadId = null,
  patientId = null,
  onChanged,
  onAddToEstimate,
}: OrderPlannedAppointmentsProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const planning = canPlan && Boolean(patientId);
  // Planners start with the doctors: visits are added under them.
  // Planners start on the grid (stage 6): doctors laid out on days and hours.
  const drafting = canDraft && !planning;
  const gridAllowed = planning || drafting;
  const [groupBy, setGroupBy] = useState<GroupBy>(gridAllowed ? "grid" : "day");
  const [loaded, setLoaded] = useState<{
    orderId: string;
    items: OrderPipelineAppointment[];
    careTeam: OrderPipelineCareTeamMember[];
  } | null>(null);
  const [addedDoctors, setAddedDoctors] = useState<{
    orderId: string;
    doctors: PlanningDoctor[];
  }>({ orderId, doctors: [] });
  const [entryNotice, setEntryNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [releaseNonce, setReleaseNonce] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const releasingRef = useRef(false);
  // Grid visits of a patient order not created yet (kept in this browser).
  const [pending, setPending] = useState<{ orderId: string; count: number } | null>(null);
  const pendingDrafts = planning
    ? pending?.orderId === orderId
      ? pending.count
      : storedPlannerDraftCount(orderId)
    : 0;

  const releasePlan = () => {
    setConfirmRelease(false);
    if (releasingRef.current || pendingDrafts > 0) return;
    releasingRef.current = true;
    setReleasing(true);
    setError(null);
    apiFetch(`/orders/${orderId}/appointments/release-to-portal`, { method: "POST" })
      .then(() => setReleaseNonce((value) => value + 1))
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        releasingRef.current = false;
        setReleasing(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    setError(null);
    apiFetch<OrderPipeline>(`/orders/${orderId}/pipeline`)
      .then((pipeline) => {
        if (!cancelled) {
          setLoaded({ orderId, items: localizePipelineAppointments(pipeline).appointments, careTeam: pipeline.care_team ?? [] });
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadNonce, releaseNonce]);

  const appointments = loaded?.orderId === orderId ? loaded.items : null;
  const careTeam = loaded?.orderId === orderId ? loaded.careTeam : null;
  const extraDoctors = addedDoctors.orderId === orderId ? addedDoctors.doctors : [];
  const unreleased = appointments ? unreleasedPlanCount(appointments) : 0;
  const outsideQuoteCount = (appointments ?? []).filter(
    (appointment) => appointment.outside_signed_quote && appointment.status !== "cancelled",
  ).length;
  const gridShown = gridAllowed && groupBy === "grid";
  const [requestedSpecialties, setRequestedSpecialties] = useState<{
    leadId: string;
    codes: string[];
  } | null>(null);
  useEffect(() => {
    if (!leadId || !(planning || drafting)) return;
    let cancelled = false;
    apiFetch<{ requested_specialties?: unknown }>(`/leads/${leadId}`)
      .then((lead) => {
        if (cancelled) return;
        const codes = Array.isArray(lead?.requested_specialties)
          ? lead.requested_specialties.filter((code): code is string => typeof code === "string")
          : [];
        setRequestedSpecialties({ leadId, codes });
      })
      .catch(() => {
        // The picker then starts on every specialization.
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, planning, drafting]);
  const preferredSpecialtyCodes =
    requestedSpecialties && requestedSpecialties.leadId === leadId ? requestedSpecialties.codes : [];
  // The grid's doctors: the care team, the doctors already booked, the added ones.
  const gridDoctors = useMemo(() => {
    if (!gridShown || !appointments) return [];
    return groupAppointmentsByDoctor(appointments, [
      ...planningDoctorsFromCareTeam(careTeam ?? []),
      ...extraDoctors,
    ]).flatMap((group) =>
      group.providerId
        ? [
            {
              providerId: group.providerId,
              providerName: group.providerName ?? "",
              doctorId: group.doctorId,
              doctorName: group.doctorName,
            },
          ]
        : [],
    );
  }, [appointments, careTeam, extraDoctors, gridShown]);
  const gridFirstDay = useMemo(() => {
    const today = appDateKey();
    const next = (appointments ?? [])
      .filter((appointment) => appointment.status !== "cancelled" && appointment.date >= today)
      .map((appointment) => appointment.date)
      .sort()[0];
    return next ?? today;
  }, [appointments]);
  const addDoctor = (doctor: PlanningDoctor) =>
    setAddedDoctors((current) => ({
      orderId,
      doctors: [...(current.orderId === orderId ? current.doctors : []), doctor],
    }));

  const groups = useMemo(() => {
    if (!appointments || groupBy === "grid") return [];
    if (groupBy === "day") return groupAppointmentsByDay(appointments);
    return groupAppointmentsByDoctor(
      appointments,
      planning ? [...planningDoctorsFromCareTeam(careTeam ?? []), ...extraDoctors] : [],
    );
  }, [appointments, careTeam, extraDoctors, groupBy, planning]);
  const entriesShown = planning && groupBy === "doctor" && Boolean(appointments);

  const handleCreated = (notice: string) => {
    setEntryNotice(notice);
    if (onChanged) onChanged();
    else setReleaseNonce((value) => value + 1);
  };

  const groupTitle = (group: (typeof groups)[number]) => {
    if (group.date) return plannedDayLabel(group.date, lang);
    return group.doctorName ?? group.providerName ?? tx("Без врача", "Ohne Arzt");
  };
  const groupHint = (group: (typeof groups)[number]) =>
    group.doctorName ? group.providerName : null;

  return (
    <div data-testid="order-planned-appointments" className="rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <SectionHeading icon={CalendarDays}>{tx("Приёмы заказа", "Termine des Auftrags")}</SectionHeading>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReleasePlan ? (
            <PlanReleaseButton
              count={unreleased}
              busy={releasing}
              lang={lang}
              onRelease={() => setConfirmRelease(true)}
              pendingDrafts={pendingDrafts}
              onShowDrafts={() => setGroupBy("grid")}
            />
          ) : null}
          <DirtyDismissConfirmDialog
            open={confirmRelease && unreleased > 0 && pendingDrafts === 0}
            title={tx("Показать план пациенту?", "Plan dem Patienten zeigen?")}
            message={tx(
              `Пациент увидит в портале приёмы плана (${unreleased}) и получит уведомление. Раздел «Мои визиты» открыт в портале только при активном тарифе в заказе.`,
              `Der Patient sieht die Termine des Plans (${unreleased}) im Portal und wird benachrichtigt. Der Bereich «Meine Termine» ist im Portal nur mit einem aktiven Tarif im Auftrag geöffnet.`,
            )}
            cancelLabel={tx("Отмена", "Abbrechen")}
            confirmLabel={tx("Показать", "Zeigen")}
            confirmDisabled={releasing}
            onCancel={() => setConfirmRelease(false)}
            onConfirm={releasePlan}
          />
          <div className="inline-flex rounded-lg border border-border/70 bg-muted/30 p-0.5" role="group">
            {(
              [
                ...(gridAllowed ? ([["grid", tx("Сетка", "Raster"), LayoutGrid]] as const) : []),
                ["day", tx("По дням", "Nach Tagen"), CalendarDays],
                ["doctor", tx("По врачам", "Nach Ärzten"), Stethoscope],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                aria-pressed={groupBy === value}
                onClick={() => setGroupBy(value)}
                data-workspace-tab
                className="inline-flex h-[30px] items-center gap-1.5 rounded-md px-2.5 max-sm:h-10 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                {label}
                {value === "grid" && groupBy !== "grid" && pendingDrafts > 0 ? (
                  <span
                    data-testid="order-planned-appointments-grid-pending"
                    aria-label={tx(`не создано: ${pendingDrafts}`, `nicht angelegt: ${pendingDrafts}`)}
                    className="grid h-4 min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[10px] font-semibold text-white tabular-nums"
                  >
                    {pendingDrafts}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {outsideQuoteCount >= 2 ? (
          <div
            data-testid="order-planned-appointments-outside-quote-summary"
            title={outsideQuoteWhy(lang)}
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-5 text-amber-900"
          >
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {tx(
                `${formatCount("ru", outsideQuoteCount, { ru: ["приём", "приёма", "приёмов"], de: ["Termin", "Termine"] })} вне подписанной сметы — при завершении появятся новые строки счёта. Добавьте их в смету («Добавить в смету» у приёма).`,
                `${formatCount("de", outsideQuoteCount, { ru: ["приём", "приёма", "приёмов"], de: ["Termin", "Termine"] })} außerhalb des unterschriebenen KV – beim Abschluss entstehen neue Rechnungszeilen. Über «In den KV aufnehmen» am Termin ergänzen.`,
              )}
            </span>
          </div>
        ) : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!error && !appointments ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {tx("Загружаем приёмы…", "Termine werden geladen…")}
          </div>
        ) : null}
        {entryNotice ? <Banner tone="warning">{entryNotice}</Banner> : null}
        {gridShown && appointments ? (
          <OrderVisitPlanner
            key={orderId}
            orderId={orderId}
            lang={lang}
            doctors={gridDoctors}
            onAddDoctor={addDoctor}
            firstDay={gridFirstDay}
            onCreated={() => handleCreated("")}
            mode={drafting ? "draft" : "create"}
            preferredSpecialtyCodes={preferredSpecialtyCodes}
            onPendingChange={(count) => setPending({ orderId, count })}
          />
        ) : null}
        {appointments && !gridShown && groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tx("В плане ещё нет приёмов.", "Im Plan sind noch keine Termine.")}
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground">
              <StatusChip tone="info">{group.date ? <CalendarDays aria-hidden="true" /> : null}{groupTitle(group)}</StatusChip>
              {groupHint(group) ? (
                <span className="font-normal text-muted-foreground">{groupHint(group)}</span>
              ) : null}
            </h3>
            <div className="mt-2 overflow-hidden rounded-lg border border-border/60 bg-card">
            {group.appointments.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {group.appointments.map((appointment) => {
                const status = ORDER_APPOINTMENT_STATUS[appointment.status];
                const time = plannedTimeLabel(appointment);
                return (
                  <li
                    key={appointment.id}
                    className="grid items-start gap-2 px-3 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_auto]"
                  >
                    <div className="min-w-0">
                      <StaffLink
                        to={`${appointmentsHref}&appointment=${encodeURIComponent(appointment.id)}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {appointment.title}
                      </StaffLink>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {time ? <StatusChip tone="info" className="tabular-nums"><Clock3 aria-hidden="true" />{time}</StatusChip> : null}
                        <span>{[
                          groupBy === "doctor" ? plannedDayLabel(appointment.date, lang) : null,
                          groupBy === "day" ? appointment.doctor_name : null,
                          groupBy === "day" ? appointment.provider_name : null,
                          appointment.interpreter_name
                            ? `${tx("Переводчик", "Dolmetscher")}: ${appointment.interpreter_name}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}</span>
                      </div>
                      {appointment.outside_signed_quote ? (
                        <OutsideQuoteWarning
                          lang={lang}
                          compact={outsideQuoteCount >= 2}
                          onAdd={onAddToEstimate ? () => onAddToEstimate(appointment) : undefined}
                        />
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                      {isShownToPatient(appointment) ? null : (
                        <HiddenFromPatientMarker lang={lang} />
                      )}
                      <StatusBadge tone={status?.tone ?? "neutral"}>
                        {status ? (de ? status.de : status.ru) : appointment.status}
                      </StatusBadge>
                    </div>
                  </li>
                );
              })}
            </ul>
            ) : null}
            {entriesShown && patientId && group.providerId ? (
              <div className={group.appointments.length > 0 ? "border-t border-border/60" : undefined}>
                <AppointmentEntryRow
                  key={`${orderId}:${group.key}`}
                  orderId={orderId}
                  patientId={patientId}
                  lang={lang}
                  defaultDate={group.appointments.at(-1)?.date}
                  doctor={{
                    providerId: group.providerId,
                    providerName: group.providerName ?? "",
                    doctorId: group.doctorId,
                    doctorName: group.doctorName,
                  }}
                  onCreated={handleCreated}
                />
              </div>
            ) : null}
            </div>
          </section>
        ))}
        {entriesShown ? (
          <PlanningDoctorPicker
            lang={lang}
            onAdd={addDoctor}
            preferredSpecialtyCodes={preferredSpecialtyCodes}
          />
        ) : null}
      </div>
    </div>
  );
}
