import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  groupAppointmentsByDay,
  groupAppointmentsByDoctor,
  isShownToPatient,
  plannedDayLabel,
  plannedTimeLabel,
  unreleasedPlanCount,
} from "../model/order-planned-appointments";
import {
  ORDER_APPOINTMENT_STATUS,
  type OrderPipeline,
  type OrderPipelineAppointment,
} from "../model/order-pipeline";

type OrderPlannedAppointmentsProps = {
  orderId: string;
  lang: string;
  reloadNonce: number;
  /** Calendar of the order; carries the patient and the way back to the order. */
  appointmentsHref: string;
  /** The viewer plans this order and may show the plan to the patient. */
  canReleasePlan?: boolean;
};

type GroupBy = "day" | "doctor";

type PlanReleaseButtonProps = {
  count: number;
  busy: boolean;
  lang: string;
  onRelease: () => void;
};

/**
 * «Показать план пациенту (N)»: the planned appointments the portal does not
 * show yet become visible to the patient at once (owner decision 2026-11-02).
 */
export function PlanReleaseButton({ count, busy, lang, onRelease }: PlanReleaseButtonProps) {
  if (count <= 0) return null;
  const label = lang === "de" ? "Plan dem Patienten zeigen" : "Показать план пациенту";
  return (
    <button
      type="button"
      data-testid="order-plan-release"
      disabled={busy}
      onClick={onRelease}
      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
    >
      {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
      {`${label} (${count})`}
    </button>
  );
}

/**
 * A doctor outside the signed quote may be planned (owner decision
 * 2026-11-02, question 5); completing the visit then adds an invoice line.
 */
export function OutsideQuoteWarning({ lang }: { lang: string }) {
  return (
    <div data-testid="order-planned-appointment-outside-quote" className="mt-0.5 text-xs text-amber-700">
      {lang === "de"
        ? "Arzt nicht im unterschriebenen KV – beim Abschluss des Termins entsteht eine neue Rechnungszeile"
        : "Врача нет в подписанном КВ — при завершении приёма появится новая строка счёта"}
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
}: OrderPlannedAppointmentsProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [groupBy, setGroupBy] = useState<GroupBy>("day");
  const [loaded, setLoaded] = useState<{
    orderId: string;
    items: OrderPipelineAppointment[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [releaseNonce, setReleaseNonce] = useState(0);
  const [releasing, setReleasing] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const releasingRef = useRef(false);

  const releasePlan = () => {
    setConfirmRelease(false);
    if (releasingRef.current) return;
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
        if (!cancelled) setLoaded({ orderId, items: pipeline.appointments });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, reloadNonce, releaseNonce]);

  const appointments = loaded?.orderId === orderId ? loaded.items : null;
  const unreleased = appointments ? unreleasedPlanCount(appointments) : 0;
  const groups = useMemo(() => {
    if (!appointments) return [];
    return groupBy === "day"
      ? groupAppointmentsByDay(appointments)
      : groupAppointmentsByDoctor(appointments);
  }, [appointments, groupBy]);

  const groupTitle = (group: (typeof groups)[number]) => {
    if (group.date) return plannedDayLabel(group.date, lang);
    return group.doctorName ?? group.providerName ?? tx("Без врача", "Ohne Arzt");
  };
  const groupHint = (group: (typeof groups)[number]) =>
    group.doctorName ? group.providerName : null;

  return (
    <div data-testid="order-planned-appointments" className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-foreground">
          {tx("Приёмы заказа", "Termine des Auftrags")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canReleasePlan ? (
            <PlanReleaseButton
              count={unreleased}
              busy={releasing}
              lang={lang}
              onRelease={() => setConfirmRelease(true)}
            />
          ) : null}
          <DirtyDismissConfirmDialog
            open={confirmRelease && unreleased > 0}
            title={tx("Показать план пациенту?", "Plan dem Patienten zeigen?")}
            message={tx(
              `Пациент увидит в портале приёмы плана (${unreleased}) и получит уведомление.`,
              `Der Patient sieht die Termine des Plans (${unreleased}) im Portal und wird benachrichtigt.`,
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
                ["day", tx("По дням", "Nach Tagen")],
                ["doctor", tx("По врачам", "Nach Ärzten")],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={groupBy === value}
                onClick={() => setGroupBy(value)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs font-medium transition-colors",
                  groupBy === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-3">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!error && !appointments ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {tx("Загружаем приёмы…", "Termine werden geladen…")}
          </div>
        ) : null}
        {appointments && groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tx("В плане ещё нет приёмов.", "Im Plan sind noch keine Termine.")}
          </p>
        ) : null}
        {groups.map((group) => (
          <section key={group.key}>
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-foreground">
              {groupTitle(group)}
              {groupHint(group) ? (
                <span className="font-normal text-muted-foreground">{groupHint(group)}</span>
              ) : null}
            </h3>
            <ul className="mt-1 divide-y divide-border/60 rounded-md border border-border/60">
              {group.appointments.map((appointment) => {
                const status = ORDER_APPOINTMENT_STATUS[appointment.status];
                const time = plannedTimeLabel(appointment);
                return (
                  <li
                    key={appointment.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <StaffLink
                        to={`${appointmentsHref}&appointment=${encodeURIComponent(appointment.id)}`}
                        className="font-semibold text-foreground hover:underline"
                      >
                        {appointment.title}
                      </StaffLink>
                      <div className="text-xs text-muted-foreground">
                        {[
                          groupBy === "doctor" ? plannedDayLabel(appointment.date, lang) : null,
                          time,
                          groupBy === "day" ? appointment.doctor_name : null,
                          groupBy === "day" ? appointment.provider_name : null,
                          appointment.interpreter_name
                            ? `${tx("Переводчик", "Dolmetscher")}: ${appointment.interpreter_name}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                      {appointment.outside_signed_quote ? <OutsideQuoteWarning lang={lang} /> : null}
                    </div>
                    <div className="flex items-center gap-1.5">
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
          </section>
        ))}
      </div>
    </div>
  );
}
