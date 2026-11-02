import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { fetchInterpreterSuggestions, type InterpreterSuggestion } from "@/lib/api/clinical";
import { useAuth } from "@/lib/auth";
import { hasCapability } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { appointmentSelectControlClassName } from "@/pages/appointments/appearance/surface-appearance";
import { buildConflictQuery } from "@/pages/appointments/model/query-builders";
import { useScheduleWarnings } from "@/pages/appointments/model/schedule-warnings";
import {
  assignableInterpreterOptions,
  type ConflictSummary,
  type InterpreterOption,
} from "@/pages/appointments/model/types";
import { InterpreterSuggestionsPanel } from "@/pages/appointments/ui/sections/interpreter-suggestions-panel";
import { AppointmentEditorSheet, Field } from "@/pages/appointments/ui/shared/workspace-primitives";

import {
  batchFailureMessage,
  batchFailures,
  canTakeInterpreter,
  defaultDaySelection,
  interpreterDays,
  needsInterpreter,
  type InterpreterDay,
} from "../model/order-interpreters-by-day";
import type { OrderPipeline, OrderPipelineAppointment } from "../model/order-pipeline";
import { plannedDayLabel, plannedTimeLabel } from "../model/order-planned-appointments";

const INTERPRETER_META_TTL_MS = 60_000;

const RESPONSE_LABELS: Record<string, { ru: string; de: string; tone: "neutral" | "info" | "warning" | "success" }> = {
  pending: { ru: "ждёт ответа", de: "Antwort offen", tone: "warning" },
  accepted: { ru: "принял", de: "zugesagt", tone: "success" },
  declined: { ru: "отказался", de: "abgelehnt", tone: "neutral" },
  discussion_requested: { ru: "уточнение", de: "Rückfrage", tone: "info" },
};

type OrderInterpretersByDayProps = {
  orderId: string;
  patientId: string | null;
  lang: string;
  reloadNonce: number;
  /** Order still locked (lead order etc.): the table is shown, nothing is assigned. */
  locked?: boolean;
  /** Called after a batch was saved, so the planning readiness reloads. */
  onChanged?: () => void;
  /**
   * Whether the block hides itself because the order has no appointment yet;
   * the page then keeps its older interpreter hint in its place.
   */
  onEmptyChange?: (empty: boolean) => void;
};

type DaySheet = {
  date: string;
  selected: string[];
  interpreterId: string;
};

/**
 * «Переводчики по дням»: the order's appointments by day with the booked
 * interpreter, and one step to book an interpreter for a whole day (planning
 * stage 5). Only for users who may assign interpreters today.
 */
export function OrderInterpretersByDay({
  orderId,
  patientId,
  lang,
  reloadNonce,
  locked = false,
  onChanged,
  onEmptyChange,
}: OrderInterpretersByDayProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const { user } = useAuth();
  const canAssign = hasCapability(user, "appointments.assign_interpreter");
  const enabled = canAssign && Boolean(patientId);

  const [localNonce, setLocalNonce] = useState(0);
  const [loaded, setLoaded] = useState<{ orderId: string; items: OrderPipelineAppointment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [interpreters, setInterpreters] = useState<InterpreterOption[]>([]);
  const [sheet, setSheet] = useState<DaySheet | null>(null);
  const { conflictItemTitle, formatScheduleConflictError } = useScheduleWarnings();
  const [busy, setBusy] = useState(false);
  // Set synchronously, so a double click cannot send the batch twice before
  // the disabled button renders.
  const savingRef = useRef(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [conflictState, setConflicts] = useState<{
    interpreterId: string;
    hints: Record<string, string>;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<{
    key: string;
    items: InterpreterSuggestion[];
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setError(null);
    apiFetch<OrderPipeline>(`/orders/${orderId}/pipeline`)
      .then((pipeline) => {
        if (!cancelled) setLoaded({ orderId, items: pipeline.appointments ?? [] });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, orderId, reloadNonce, localNonce]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    apiFetch<InterpreterOption[]>("/appointments/meta/interpreters", {
      cacheTtlMs: INTERPRETER_META_TTL_MS,
    })
      .then((rows) => {
        if (!cancelled) setInterpreters(rows);
      })
      .catch(() => {
        // The suggestions below still offer interpreters.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const appointments = useMemo(
    () => (loaded?.orderId === orderId ? loaded.items : null),
    [loaded, orderId],
  );
  const days = useMemo(() => (appointments ? interpreterDays(appointments) : []), [appointments]);
  const noDays = Boolean(appointments) && days.length === 0;
  useEffect(() => {
    onEmptyChange?.(noDays);
  }, [noDays, onEmptyChange]);
  const sheetDay = sheet ? days.find((day) => day.date === sheet.date) ?? null : null;
  const suggestionTarget = sheetDay?.appointments.find(
    (appointment) => sheet?.selected.includes(appointment.id),
  );

  // Ranked interpreters (language, history with the patient) for the day.
  useEffect(() => {
    if (!suggestionTarget) return;
    let cancelled = false;
    const key = suggestionTarget.id;
    fetchInterpreterSuggestions(key)
      .then((items) => {
        if (!cancelled) setSuggestions({ key, items });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setSuggestions({
            key,
            items: [],
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [suggestionTarget]);

  // Overlaps of the chosen interpreter, shown beside each row of the day.
  const conflictTargets = useMemo(() => {
    if (!sheet?.interpreterId || !sheetDay || !patientId) return [];
    return sheetDay.appointments.filter((appointment) => sheet.selected.includes(appointment.id));
  }, [patientId, sheet?.interpreterId, sheet?.selected, sheetDay]);
  useEffect(() => {
    if (!sheet?.interpreterId || !patientId || conflictTargets.length === 0) return;
    let cancelled = false;
    const interpreterId = sheet.interpreterId;
    Promise.all(
      conflictTargets.map((appointment) =>
        apiFetch<ConflictSummary>(
          buildConflictQuery(
            patientId,
            appointment.id,
            appointment.date,
            appointment.time_start ?? "",
            appointment.time_end ?? "",
            interpreterId,
          ),
        )
          .then((summary) => [appointment.id, conflictHint(summary, conflictItemTitle)] as const)
          .catch(() => [appointment.id, ""] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setConflicts({
        interpreterId,
        hints: Object.fromEntries(entries.filter(([, hint]) => hint)),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [conflictItemTitle, conflictTargets, patientId, sheet?.interpreterId]);

  // Nothing to staff yet: the appointment list above already says so.
  if (!enabled || noDays) return null;

  const openDay = (day: InterpreterDay) => {
    setSaveError(null);
    setFailures({});
    setConflicts(null);
    setSuggestions(null);
    const booked = day.appointments.find(
      (appointment) => canTakeInterpreter(appointment) && appointment.interpreter_id,
    );
    setSheet({
      date: day.date ?? "",
      selected: defaultDaySelection(day),
      interpreterId: booked?.interpreter_id ?? "",
    });
  };

  // A refusal belongs to the interpreter and rows it was sent with: changing
  // either clears it, so an old conflict is not shown for a new choice.
  const clearRefusal = () => {
    setFailures({});
    setSaveError(null);
  };

  const toggle = (appointmentId: string) => {
    clearRefusal();
    setSheet((current) =>
      current
        ? {
            ...current,
            selected: current.selected.includes(appointmentId)
              ? current.selected.filter((id) => id !== appointmentId)
              : [...current.selected, appointmentId],
          }
        : current,
    );
  };

  const chooseInterpreter = (interpreterId: string) => {
    clearRefusal();
    setSheet((current) => (current ? { ...current, interpreterId } : current));
  };

  const save = async (interpreterId: string | null) => {
    if (!sheet || sheet.selected.length === 0 || savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    setSaveError(null);
    setFailures({});
    try {
      await apiFetch(`/orders/${orderId}/appointments/assign-interpreter`, {
        method: "POST",
        body: JSON.stringify({ interpreter_id: interpreterId, appointment_ids: sheet.selected }),
      });
      setSheet(null);
      setLocalNonce((value) => value + 1);
      onChanged?.();
    } catch (reason) {
      const body = reason instanceof ApiRequestError ? reason.body : null;
      const listed = batchFailures(body);
      setFailures(
        Object.fromEntries(
          listed.map((item) => [
            item.appointment_id,
            batchFailureMessage(item, lang, formatScheduleConflictError),
          ]),
        ),
      );
      setSaveError(
        listed.length > 0
          ? tx(
              "Ни один приём не изменён: исправьте отмеченные строки или снимите их.",
              "Kein Termin geändert: markierte Zeilen korrigieren oder abwählen.",
            )
          : reason instanceof Error
            ? reason.message
            : String(reason),
      );
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sheet?.interpreterId) void save(sheet.interpreterId);
  };

  // Hints of a previously chosen interpreter are not shown for another one.
  const conflicts =
    sheet?.interpreterId && conflictState?.interpreterId === sheet.interpreterId
      ? conflictState.hints
      : {};
  const suggestionItems =
    suggestions && suggestionTarget && suggestions.key === suggestionTarget.id ? suggestions : null;

  return (
    <div data-testid="order-interpreters-by-day" className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
        <Languages className="size-4 text-muted-foreground" />
        {tx("Переводчики по дням", "Dolmetscher nach Tagen")}
      </div>
      <div className="mt-2 space-y-2">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!error && !appointments ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {tx("Загружаем приёмы…", "Termine werden geladen…")}
          </div>
        ) : null}
        {appointments ? (
          <InterpreterDaysTable
            days={days}
            lang={lang}
            locked={locked}
            onAssignDay={openDay}
          />
        ) : null}
      </div>

      <AppointmentEditorSheet
        open={sheet !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setSheet(null);
        }}
        allowImplicitDismissal
        title={tx("Назначить переводчика на день", "Dolmetscher für den Tag zuweisen")}
        description={sheet?.date ? plannedDayLabel(sheet.date, lang) : undefined}
        maxWidthClassName="sm:max-w-[760px]"
        onSubmit={onSubmit}
        footerError={saveError}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              disabled={busy || !sheet || sheet.selected.length === 0}
              onClick={() => setConfirmRemove(true)}
            >
              {tx("Снять переводчика", "Dolmetscher entfernen")}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 gap-1.5 rounded-lg"
              disabled={busy || !sheet?.interpreterId || sheet.selected.length === 0}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {tx("Назначить", "Zuweisen")}
            </Button>
          </>
        }
      >
        {sheet && sheetDay ? (
          <div className="space-y-4">
            <Field compact label={tx("Переводчик", "Dolmetscher")}>
              <NativeComboboxSelect
                value={sheet.interpreterId}
                onChange={(event) => chooseInterpreter(event.target.value)}
                className={appointmentSelectControlClassName}
              >
                <option value="">{tx("Не выбран", "Nicht gewählt")}</option>
                {assignableInterpreterOptions(interpreters, sheet.interpreterId).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>

            <ul className="divide-y divide-border/60 rounded-md border border-border/60">
              {sheetDay.appointments.map((appointment) => {
                const open = canTakeInterpreter(appointment);
                const hint = failures[appointment.id] || conflicts[appointment.id];
                return (
                  <li key={appointment.id} className="flex items-start gap-2 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={appointment.title}
                      disabled={!open || busy}
                      checked={sheet.selected.includes(appointment.id)}
                      onChange={() => toggle(appointment.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-foreground">
                        {[plannedTimeLabel(appointment), appointment.title].filter(Boolean).join(" · ")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {appointment.interpreter_name
                          ? `${tx("Сейчас", "Jetzt")}: ${appointment.interpreter_name}`
                          : tx("Без переводчика", "Ohne Dolmetscher")}
                      </div>
                    </div>
                    {hint ? (
                      <span
                        data-testid="order-interpreter-row-hint"
                        className={cn(
                          "max-w-[45%] text-xs",
                          failures[appointment.id] ? "text-destructive" : "text-amber-700",
                        )}
                      >
                        {failures[appointment.id]
                          ? hint
                          : `${tx("Конфликт", "Konflikt")}: ${hint}`}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <InterpreterSuggestionsPanel
              suggestions={suggestionItems?.items ?? []}
              selectedInterpreterId={sheet.interpreterId}
              loading={!suggestionItems}
              error={suggestionItems?.error}
              onSelect={chooseInterpreter}
            />
          </div>
        ) : null}
      </AppointmentEditorSheet>

      <DirtyDismissConfirmDialog
        open={confirmRemove && sheet !== null}
        title={tx("Снять переводчика?", "Dolmetscher entfernen?")}
        message={tx(
          `Переводчик будет снят с отмеченных приёмов (${sheet?.selected.length ?? 0}); он получит уведомление.`,
          `Der Dolmetscher wird von den markierten Terminen (${sheet?.selected.length ?? 0}) entfernt und benachrichtigt.`,
        )}
        cancelLabel={tx("Отмена", "Abbrechen")}
        confirmLabel={tx("Снять", "Entfernen")}
        destructive
        confirmDisabled={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => {
          setConfirmRemove(false);
          void save(null);
        }}
      />
    </div>
  );
}

function conflictHint(
  summary: ConflictSummary,
  titleOf: (item: ConflictSummary["interpreter_conflicts"][number]) => string,
): string {
  const first = summary.interpreter_conflicts?.[0];
  if (!first) return "";
  const time = [first.time_start?.slice(0, 5), first.time_end?.slice(0, 5)].filter(Boolean).join("–");
  return [titleOf(first), time].filter(Boolean).join(" ");
}

type InterpreterDaysTableProps = {
  days: InterpreterDay[];
  lang: string;
  locked: boolean;
  onAssignDay: (day: InterpreterDay) => void;
};

/** The day table itself, without data loading (rendered by tests as is). */
export function InterpreterDaysTable({ days, lang, locked, onAssignDay }: InterpreterDaysTableProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  if (days.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {tx("В плане ещё нет приёмов.", "Im Plan sind noch keine Termine.")}
      </p>
    );
  }
  return (
    <>
      {days.map((day) => (
        <section key={day.key} data-testid="order-interpreter-day" data-date={day.date ?? ""}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex flex-wrap items-baseline gap-x-2 text-xs font-semibold text-foreground">
              {day.date ? plannedDayLabel(day.date, lang) : null}
              {day.missingCount > 0 ? (
                <span className="font-normal text-amber-700">
                  {tx(
                    `без переводчика: ${day.missingCount}`,
                    `ohne Dolmetscher: ${day.missingCount}`,
                  )}
                </span>
              ) : null}
            </h3>
            {!locked && day.assignableIds.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-7 rounded-lg px-2.5 text-xs"
                onClick={() => onAssignDay(day)}
              >
                {tx("Назначить переводчика на день", "Dolmetscher für den Tag")}
              </Button>
            ) : null}
          </div>
          <ul className="mt-1 divide-y divide-border/60 rounded-md border border-border/60">
            {day.appointments.map((appointment) => {
              const response = appointment.interpreter_response
                ? RESPONSE_LABELS[appointment.interpreter_response]
                : null;
              const missing = needsInterpreter(appointment);
              return (
                <li
                  key={appointment.id}
                  data-testid="order-interpreter-row"
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm"
                >
                  <div className="min-w-0 break-words">
                    <span className="font-medium text-foreground">
                      {[plannedTimeLabel(appointment), appointment.title].filter(Boolean).join(" · ")}
                    </span>
                    {appointment.doctor_name ? (
                      <span className="ml-2 text-xs text-muted-foreground">{appointment.doctor_name}</span>
                    ) : null}
                  </div>
                  {/* Wraps on a phone, so the answer badge stays inside the card. */}
                  <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {appointment.interpreter_name ? (
                      <span className="min-w-0 break-words text-foreground">
                        {appointment.interpreter_name}
                      </span>
                    ) : (
                      <span className={missing ? "text-amber-700" : "text-muted-foreground"}>
                        {missing
                          ? tx("нужен переводчик", "Dolmetscher nötig")
                          : tx("без переводчика", "ohne Dolmetscher")}
                      </span>
                    )}
                    {response && appointment.interpreter_name ? (
                      <StatusBadge
                        tone={response.tone}
                        className="h-auto max-w-full shrink whitespace-normal text-left"
                      >
                        {de ? response.de : response.ru}
                      </StatusBadge>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
