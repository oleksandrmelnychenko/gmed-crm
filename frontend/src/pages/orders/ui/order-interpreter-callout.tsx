import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

import {
  appointmentWorkflowHref,
  interpreterAppointmentToReview,
  interpreterAssignmentState,
} from "../model/interpreter-assignment";
import type { OrderPipeline, OrderPipelineAppointment } from "../model/order-pipeline";
import type { OrderPlanningPreparation } from "../model/types";

type OrderInterpreterCalloutProps = {
  orderId: string;
  patientId: string | null;
  lang: string;
  reloadNonce: number;
  planning: Pick<
    OrderPlanningPreparation,
    "interpreter_required" | "interpreter_assigned" | "interpreter_confirmed"
  >;
  /** Appointment calendar of the order, used while no interpreter is assigned. */
  appointmentsHref: string;
  onNavigate: (href: string) => void;
};

/**
 * Planning hint for the interpreter: asks to assign one, points to the
 * assignment that still waits for the interpreter's answer, and turns neutral
 * once every assignment is accepted.
 */
export function OrderInterpreterCallout({
  orderId,
  patientId,
  lang,
  reloadNonce,
  planning,
  appointmentsHref,
  onNavigate,
}: OrderInterpreterCalloutProps) {
  const de = lang === "de";
  const state = interpreterAssignmentState(planning);
  const needsAppointment = state === "awaiting_acceptance" || state === "accepted";
  const [appointments, setAppointments] = useState<{
    orderId: string;
    items: OrderPipelineAppointment[];
  } | null>(null);

  useEffect(() => {
    if (!needsAppointment) return;
    let cancelled = false;
    apiFetch<OrderPipeline>(`/orders/${orderId}/pipeline`)
      .then((pipeline) => {
        if (!cancelled) setAppointments({ orderId, items: pipeline.appointments });
      })
      .catch(() => {
        // The calendar link below stays available without the appointment list.
      });
    return () => {
      cancelled = true;
    };
  }, [needsAppointment, orderId, reloadNonce]);

  if (state === "not_required") return null;

  const target =
    appointments?.orderId === orderId ? interpreterAppointmentToReview(appointments.items) : null;
  const href = target ? appointmentWorkflowHref(target.id, patientId) : appointmentsHref;
  const accepted = state === "accepted";

  const title =
    state === "unassigned"
      ? de ? "Dolmetscher einem Termin zuweisen" : "Назначить переводчика"
      : state === "awaiting_acceptance"
        ? de ? "Dolmetscher hat noch nicht zugesagt" : "Переводчик ещё не принял назначение"
        : de ? "Dolmetscher ist zugewiesen und hat zugesagt" : "Переводчик назначен и принял назначение";
  const description =
    state === "unassigned"
      ? de
        ? "Der Dolmetscher wird einem konkreten Termin dieses Auftrags zugewiesen."
        : "Переводчик назначается на конкретный приём этого заказа."
      : state === "awaiting_acceptance"
        ? de
          ? "Öffnen Sie den Termin, um Zuweisung und Rückmeldung des Dolmetschers zu prüfen."
          : "Откройте приём, чтобы проверить назначение и ответ переводчика."
        : de
          ? "Der Termin mit dem Dolmetscher lässt sich hier öffnen."
          : "Приём с переводчиком можно открыть отсюда.";
  const actionLabel =
    state === "unassigned"
      ? de ? "Termin öffnen" : "Открыть приёмы"
      : state === "awaiting_acceptance"
        ? de ? "Zuweisung prüfen" : "Проверить назначение"
        : de ? "Termin öffnen" : "Открыть приём";

  return (
    <div
      data-testid="order-interpreter-callout"
      data-state={state}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3",
        accepted ? "border-border/70 bg-muted/30" : "border-orange-200 bg-orange-50/60",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        {accepted ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : null}
        <div className="min-w-0">
          <p className={cn("text-sm font-semibold", accepted ? "text-foreground" : "text-orange-950")}>
            {title}
          </p>
          <p
            className={cn(
              "mt-0.5 text-xs leading-5",
              accepted ? "text-muted-foreground" : "text-orange-900/75",
            )}
          >
            {description}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant={accepted ? "outline" : "default"}
        className="h-8 shrink-0 rounded-lg"
        onClick={() => onNavigate(href)}
      >
        <CalendarClock className="size-3.5" />
        {actionLabel}
      </Button>
    </div>
  );
}
