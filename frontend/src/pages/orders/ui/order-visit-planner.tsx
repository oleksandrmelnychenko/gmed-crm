import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui-shell";
import { ApiRequestError, apiFetch } from "@/lib/api";
import { addDaysToDateKey, appDateKey } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { appointmentSelectControlClassName } from "@/pages/appointments/appearance/surface-appearance";
import {
  assignableInterpreterOptions,
  type InterpreterOption,
} from "@/pages/appointments/model/types";

import type { PlanningDoctor } from "../model/order-planned-appointments";
import { plannedDayLabel } from "../model/order-planned-appointments";
import {
  GRID_DAY_COUNT,
  GRID_END_MINUTES,
  GRID_START_MINUTES,
  GRID_STEP_MINUTES,
  VISIT_DURATIONS,
  batchFailureText,
  batchPayload,
  doctorKeyOf,
  draftConflicts,
  gridDays,
  gridSlots,
  minutesToTime,
  newDraft,
  scopesLabel,
  timeToMinutes,
  type BatchFailure,
  type BusySlot,
  type DraftVisit,
} from "../model/order-visit-planner";
import { PlanningDoctorPicker } from "./order-appointment-entry";

const ROW_PX = 26;
const INTERPRETER_META_TTL_MS = 120_000;
const DRY_RUN_DELAY_MS = 500;

/** Doctor colours, in the order the doctors are listed. */
const DOCTOR_TONES = [
  "border-sky-500 bg-sky-50 dark:bg-sky-950/40",
  "border-violet-500 bg-violet-50 dark:bg-violet-950/40",
  "border-teal-500 bg-teal-50 dark:bg-teal-950/40",
  "border-amber-500 bg-amber-50 dark:bg-amber-950/40",
  "border-rose-500 bg-rose-50 dark:bg-rose-950/40",
  "border-lime-600 bg-lime-50 dark:bg-lime-950/40",
];
const DOCTOR_SWATCHES = ["bg-sky-500", "bg-violet-500", "bg-teal-500", "bg-amber-500", "bg-rose-500", "bg-lime-600"];

type OrderVisitPlannerProps = {
  orderId: string;
  lang: string;
  doctors: PlanningDoctor[];
  onAddDoctor: (doctor: PlanningDoctor) => void;
  /** The day the grid opens on: the order's next planned day, else today. */
  firstDay?: string;
  /** Visits were created: the plan reloads. */
  onCreated: (count: number) => void;
};

type DragPayload = { kind: "doctor"; key: string } | { kind: "draft"; key: string };

function failuresOf(error: unknown): BatchFailure[] | null {
  if (!(error instanceof ApiRequestError)) return null;
  const failures = (error.body as { failures?: unknown } | null | undefined)?.failures;
  return Array.isArray(failures) ? (failures as BatchFailure[]) : null;
}

/**
 * Planning grid (stage 6, owner request 2026-11-13): the order's doctors on
 * the left, days and hours on the right. A doctor clicked or dragged into a
 * slot becomes a draft visit; «Создать все приёмы» creates every draft in one
 * all-or-nothing request after the server's dry run found no conflict.
 */
export function OrderVisitPlanner({
  orderId,
  lang,
  doctors,
  onAddDoctor,
  firstDay,
  onCreated,
}: OrderVisitPlannerProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [startDay, setStartDay] = useState(() => firstDay ?? appDateKey());
  const [drafts, setDrafts] = useState<DraftVisit[]>([]);
  const [selectedDoctorKey, setSelectedDoctorKey] = useState<string | null>(
    doctors[0] ? doctorKeyOf(doctors[0]) : null,
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [busyNonce, setBusyNonce] = useState(0);
  const [interpreters, setInterpreters] = useState<InterpreterOption[]>([]);
  const [serverFailures, setServerFailures] = useState<BatchFailure[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nextKey = useRef(1);
  const savingRef = useRef(false);
  const dragRef = useRef<DragPayload | null>(null);

  const days = useMemo(() => gridDays(startDay), [startDay]);
  const slots = useMemo(() => gridSlots(), []);
  const doctorIndex = useMemo(
    () => new Map(doctors.map((doctor, index) => [doctorKeyOf(doctor), index])),
    [doctors],
  );
  const selectedDoctor =
    doctors.find((doctor) => doctorKeyOf(doctor) === selectedDoctorKey) ?? doctors[0] ?? null;
  const doctorIds = useMemo(
    () => [...new Set(doctors.map((doctor) => doctor.doctorId).filter(Boolean))].sort().join(","),
    [doctors],
  );
  const interpreterIds = useMemo(
    () => [...new Set(drafts.map((draft) => draft.interpreterId).filter(Boolean))].sort().join(","),
    [drafts],
  );

  useEffect(() => {
    let cancelled = false;
    apiFetch<InterpreterOption[]>("/appointments/meta/interpreters", {
      cacheTtlMs: INTERPRETER_META_TTL_MS,
    })
      .then((rows) => {
        if (!cancelled) setInterpreters(rows);
      })
      .catch(() => {
        // The visit can still be planned without choosing an interpreter.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      from: days[0],
      to: days[days.length - 1],
      doctor_ids: doctorIds,
      interpreter_ids: interpreterIds,
    });
    apiFetch<{ items: BusySlot[] }>(`/orders/${orderId}/appointments/busy?${params.toString()}`)
      .then((result) => {
        if (!cancelled) setBusy(Array.isArray(result?.items) ? result.items : []);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, days, doctorIds, interpreterIds, busyNonce]);

  // The server's dry run: the same checks as the save, nothing written.
  useEffect(() => {
    if (drafts.length === 0) {
      setServerFailures([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setChecking(true);
      apiFetch<{ ok: boolean; failures: BatchFailure[] }>(
        `/orders/${orderId}/appointments/batch`,
        { method: "POST", body: JSON.stringify(batchPayload(drafts, true)) },
      )
        .then((result) => {
          if (!cancelled) setServerFailures(Array.isArray(result?.failures) ? result.failures : []);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          const failures = failuresOf(reason);
          if (failures) setServerFailures(failures);
          else setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          if (!cancelled) setChecking(false);
        });
    }, DRY_RUN_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [drafts, orderId]);

  const localConflicts = useMemo(() => draftConflicts(drafts, busy), [drafts, busy]);
  const failureByKey = useMemo(() => {
    const map = new Map<string, BatchFailure>();
    for (const failure of serverFailures) {
      const draft = drafts[failure.index];
      if (draft && !map.has(draft.key)) map.set(draft.key, failure);
    }
    return map;
  }, [drafts, serverFailures]);
  const missingTitle = drafts.some((draft) => !draft.title.trim());
  const blocked =
    drafts.length === 0 ||
    localConflicts.size > 0 ||
    failureByKey.size > 0 ||
    missingTitle ||
    checking ||
    saving;

  const placeDraft = (doctor: PlanningDoctor | null, date: string, start: number) => {
    if (!doctor || saving) return;
    const key = `draft-${nextKey.current++}`;
    setDrafts((current) => [...current, newDraft(key, doctor, date, start)]);
    setActiveKey(key);
    setNotice(null);
  };
  const moveDraft = (key: string, date: string, start: number) => {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key
          ? { ...draft, date, start, duration: Math.min(draft.duration, GRID_END_MINUTES - start) }
          : draft,
      ),
    );
    setActiveKey(key);
  };
  const updateDraft = (key: string, patch: Partial<DraftVisit>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };
  const removeDraft = (key: string) => {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setActiveKey(null);
  };

  const onDrop = (event: DragEvent<HTMLElement>, date: string, start: number) => {
    event.preventDefault();
    const payload = dragRef.current;
    dragRef.current = null;
    if (!payload) return;
    if (payload.kind === "draft") {
      moveDraft(payload.key, date, start);
      return;
    }
    const doctor = doctors.find((item) => doctorKeyOf(item) === payload.key) ?? null;
    if (doctor) setSelectedDoctorKey(payload.key);
    placeDraft(doctor, date, start);
  };

  const createAll = () => {
    if (blocked || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const count = drafts.length;
    apiFetch<{ created: Array<{ index: number; id: string }> }>(
      `/orders/${orderId}/appointments/batch`,
      { method: "POST", body: JSON.stringify(batchPayload(drafts, false)) },
    )
      .then(() => {
        setDrafts([]);
        setActiveKey(null);
        setServerFailures([]);
        setNotice(
          tx(
            `Создано приёмов: ${count}. Пациент увидит их после «Показать план пациенту».`,
            `Termine angelegt: ${count}. Der Patient sieht sie nach «Plan dem Patienten zeigen».`,
          ),
        );
        setBusyNonce((value) => value + 1);
        onCreated(count);
      })
      .catch((reason: unknown) => {
        const failures = failuresOf(reason);
        if (failures) setServerFailures(failures);
        else setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };

  const active = drafts.find((draft) => draft.key === activeKey) ?? null;
  const interpreterOptions = assignableInterpreterOptions(interpreters, active?.interpreterId);
  const conflictLines = drafts.flatMap((draft) => {
    const label = `${plannedDayLabel(draft.date, lang)} ${minutesToTime(draft.start)} ${
      draft.doctor.doctorName ?? draft.doctor.providerName
    }`;
    const lines: Array<{ key: string; text: string; title?: string }> = [];
    const local = localConflicts.get(draft.key);
    if (local) {
      lines.push({
        key: `${draft.key}-local`,
        text: `${label}: ${tx("накладка", "Überschneidung")} (${scopesLabel(local, lang)})`,
      });
    }
    const failure = failureByKey.get(draft.key);
    if (failure && !local) {
      lines.push({
        key: `${draft.key}-server`,
        text: `${label}: ${batchFailureText(failure, lang)}`,
        title: failure.message,
      });
    }
    return lines;
  });

  const totalHeight = slots.length * ROW_PX;
  const toneOf = (doctor: PlanningDoctor) =>
    DOCTOR_TONES[(doctorIndex.get(doctorKeyOf(doctor)) ?? 0) % DOCTOR_TONES.length];

  return (
    <div data-testid="order-visit-planner" className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)_15rem]">
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {tx(
              "Выберите врача и кликните время в сетке (или перетащите врача).",
              "Arzt wählen und Uhrzeit im Raster anklicken (oder Arzt hineinziehen).",
            )}
          </p>
          <div className="space-y-1.5" role="listbox" aria-label={tx("Врачи заказа", "Ärzte des Auftrags")}>
            {doctors.map((doctor, index) => {
              const key = doctorKeyOf(doctor);
              const selected = selectedDoctor ? doctorKeyOf(selectedDoctor) === key : false;
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  draggable
                  data-testid="order-visit-planner-doctor"
                  onDragStart={() => {
                    dragRef.current = { kind: "doctor", key };
                  }}
                  onClick={() => setSelectedDoctorKey(key)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg border border-border/70 bg-card px-2 py-1.5 text-left text-[13px]",
                    selected && "ring-2 ring-orange-500",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn("h-7 w-1.5 shrink-0 rounded", DOCTOR_SWATCHES[index % DOCTOR_SWATCHES.length])}
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{doctor.doctorName ?? doctor.providerName}</span>
                    {doctor.doctorName ? (
                      <span className="block truncate text-xs text-muted-foreground">{doctor.providerName}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            {doctors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {tx("В заказе ещё нет врачей.", "Im Auftrag sind noch keine Ärzte.")}
              </p>
            ) : null}
          </div>
          <PlanningDoctorPicker lang={lang} onAdd={onAddDoctor} />
        </div>

        <div className="min-w-0 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              aria-label={tx("Предыдущие дни", "Vorherige Tage")}
              onClick={() => setStartDay((day) => addDaysToDateKey(day, -GRID_DAY_COUNT))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {plannedDayLabel(days[0], lang)} – {plannedDayLabel(days[days.length - 1], lang)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              aria-label={tx("Следующие дни", "Nächste Tage")}
              onClick={() => setStartDay((day) => addDaysToDateKey(day, GRID_DAY_COUNT))}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
          <div className="max-h-[34rem] overflow-auto rounded-lg border border-border/70">
            <div
              className="grid min-w-[40rem]"
              style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(7.5rem, 1fr))` }}
            >
              <div className="sticky top-0 z-20 border-b border-border/70 bg-card" />
              {days.map((day) => (
                <div
                  key={day}
                  className="sticky top-0 z-20 border-b border-l border-border/70 bg-card px-1 py-1.5 text-center text-xs font-semibold"
                >
                  {plannedDayLabel(day, lang)}
                </div>
              ))}
              <div className="relative" style={{ height: totalHeight }}>
                {slots.map((minutes, index) =>
                  minutes % 60 === 0 ? (
                    <div
                      key={minutes}
                      className="absolute right-1 text-[11px] text-muted-foreground tabular-nums"
                      style={{ top: index * ROW_PX - 1 }}
                    >
                      {minutesToTime(minutes)}
                    </div>
                  ) : null,
                )}
              </div>
              {days.map((day) => (
                <div
                  key={day}
                  data-testid="order-visit-planner-day"
                  data-date={day}
                  className="relative border-l border-border/70"
                  style={{ height: totalHeight }}
                >
                  {slots.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      data-slot-time={minutesToTime(minutes)}
                      aria-label={`${plannedDayLabel(day, lang)} ${minutesToTime(minutes)}`}
                      onClick={() => placeDraft(selectedDoctor, day, minutes)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => onDrop(event, day, minutes)}
                      className={cn(
                        "block w-full border-b border-border/40 hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none dark:hover:bg-orange-950/30",
                        minutes % 60 === 30 && "border-dashed",
                      )}
                      style={{ height: ROW_PX }}
                    />
                  ))}
                  {busy
                    .filter((slot) => slot.date === day)
                    .map((slot, index) => {
                      const start = Math.max(timeToMinutes(slot.time_start) ?? GRID_START_MINUTES, GRID_START_MINUTES);
                      const end = Math.min(timeToMinutes(slot.time_end) ?? GRID_END_MINUTES, GRID_END_MINUTES);
                      if (end <= start) return null;
                      const own = slot.scopes.includes("patient");
                      const text = own
                        ? slot.title ?? tx("Приём пациента", "Termin des Patienten")
                        : `${tx("Занято", "Belegt")}: ${scopesLabel(slot.scopes, lang)}`;
                      return (
                        <div
                          key={`busy-${index}`}
                          data-testid="order-visit-planner-busy"
                          title={`${slot.time_start ?? ""}–${slot.time_end ?? ""} ${text}`}
                          className="pointer-events-none absolute inset-x-0.5 z-0 overflow-hidden rounded border border-border bg-[repeating-linear-gradient(135deg,var(--color-muted)_0_6px,transparent_6px_10px)] px-1 text-[11px] leading-4 text-muted-foreground"
                          style={{
                            top: ((start - GRID_START_MINUTES) / GRID_STEP_MINUTES) * ROW_PX + 1,
                            height: ((end - start) / GRID_STEP_MINUTES) * ROW_PX - 2,
                          }}
                        >
                          {`${slot.time_start ?? ""} ${text}`}
                        </div>
                      );
                    })}
                  {drafts
                    .filter((draft) => draft.date === day)
                    .map((draft) => {
                      const conflicted = localConflicts.has(draft.key) || failureByKey.has(draft.key);
                      return (
                        <button
                          key={draft.key}
                          type="button"
                          draggable
                          data-testid="order-visit-planner-draft"
                          onDragStart={() => {
                            dragRef.current = { kind: "draft", key: draft.key };
                          }}
                          onClick={() => setActiveKey(draft.key)}
                          className={cn(
                            "absolute inset-x-0.5 z-10 overflow-hidden rounded border border-dashed px-1 text-left text-[11px] leading-4 text-foreground",
                            toneOf(draft.doctor),
                            conflicted && "ring-2 ring-rose-500",
                            activeKey === draft.key && "ring-2 ring-orange-500",
                          )}
                          style={{
                            top: ((draft.start - GRID_START_MINUTES) / GRID_STEP_MINUTES) * ROW_PX + 1,
                            height: (draft.duration / GRID_STEP_MINUTES) * ROW_PX - 2,
                          }}
                        >
                          <span className="font-semibold tabular-nums">
                            {minutesToTime(draft.start)}–{minutesToTime(draft.start + draft.duration)}
                          </span>{" "}
                          {draft.doctor.doctorName ?? draft.doctor.providerName}
                          {draft.title && draft.title !== (draft.doctor.doctorName ?? draft.doctor.providerName)
                            ? ` · ${draft.title}`
                            : ""}
                          {draft.interpreterNeeded ? ` · ${tx("переводчик", "Dolmetscher")}` : ""}
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 text-[13px]" data-testid="order-visit-planner-inspector">
          {active ? (
            <>
              <div>
                <div className="font-semibold">{active.doctor.doctorName ?? active.doctor.providerName}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {plannedDayLabel(active.date, lang)}, {minutesToTime(active.start)}–
                  {minutesToTime(active.start + active.duration)}
                </div>
              </div>
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>{tx("Название приёма", "Bezeichnung des Termins")}</span>
                <Input
                  value={active.title}
                  aria-label={tx("Название приёма", "Bezeichnung des Termins")}
                  onChange={(event) => updateDraft(active.key, { title: event.target.value })}
                  className="h-8 text-[13px]"
                />
              </label>
              <div className="space-y-1 text-xs text-muted-foreground">
                <span>{tx("Длительность", "Dauer")}</span>
                <div className="flex flex-wrap gap-1" role="group" aria-label={tx("Длительность", "Dauer")}>
                  {VISIT_DURATIONS.map((minutes) => (
                    <Button
                      key={minutes}
                      type="button"
                      size="sm"
                      variant={active.duration === minutes ? "default" : "outline"}
                      aria-pressed={active.duration === minutes}
                      disabled={active.start + minutes > GRID_END_MINUTES}
                      className="h-7 px-2 text-xs"
                      onClick={() => updateDraft(active.key, { duration: minutes })}
                    >
                      {minutes} {tx("мин", "Min.")}
                    </Button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={active.interpreterNeeded}
                  onChange={(event) =>
                    updateDraft(active.key, {
                      interpreterNeeded: event.target.checked,
                      interpreterId: event.target.checked ? active.interpreterId : "",
                    })
                  }
                />
                {tx("Нужен переводчик", "Dolmetscher benötigt")}
              </label>
              {active.interpreterNeeded ? (
                <NativeComboboxSelect
                  aria-label={tx("Переводчик", "Dolmetscher")}
                  value={active.interpreterId}
                  onChange={(event) => updateDraft(active.key, { interpreterId: event.target.value })}
                  className={appointmentSelectControlClassName}
                >
                  <option value="">{tx("Назначить позже", "Später zuweisen")}</option>
                  {interpreterOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </NativeComboboxSelect>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {tx(
                  "Переводчик получит одно уведомление на все приёмы сразу.",
                  "Der Dolmetscher erhält eine Benachrichtigung für alle Termine.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 gap-1.5"
                onClick={() => removeDraft(active.key)}
              >
                <Trash2 className="size-3.5" />
                {tx("Убрать из плана", "Aus dem Plan entfernen")}
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {tx(
                "Кликните блок в сетке: длительность, название и переводчик.",
                "Block im Raster anklicken: Dauer, Bezeichnung und Dolmetscher.",
              )}
            </p>
          )}
        </div>
      </div>

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? (
        <p
          role="status"
          data-testid="order-visit-planner-notice"
          className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
        >
          {notice}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border/60 pt-3">
        <div className="min-w-0 flex-1 space-y-1 text-xs" data-testid="order-visit-planner-conflicts" aria-live="polite">
          {conflictLines.map((line) => (
            <p key={line.key} title={line.title} className="text-rose-700 dark:text-rose-400">
              {line.text}
            </p>
          ))}
          {drafts.length > 0 && conflictLines.length === 0 && !checking ? (
            <p className="text-emerald-700 dark:text-emerald-400">{tx("Накладок нет", "Keine Überschneidungen")}</p>
          ) : null}
          {missingTitle ? (
            <p className="text-rose-700">{tx("У приёма нет названия", "Ein Termin hat keine Bezeichnung")}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {drafts.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8"
              disabled={saving}
              onClick={() => {
                setDrafts([]);
                setActiveKey(null);
              }}
            >
              {tx("Очистить", "Leeren")}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5"
            data-testid="order-visit-planner-create"
            disabled={blocked}
            onClick={createAll}
          >
            {saving || checking ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {tx(`Создать все приёмы (${drafts.length})`, `Alle Termine anlegen (${drafts.length})`)}
          </Button>
        </div>
      </div>
    </div>
  );
}
