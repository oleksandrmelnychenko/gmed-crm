import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Check, ChevronLeft, ChevronRight, LoaderCircle, Trash2, TriangleAlert } from "lucide-react";

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
  draftSavePayload,
  draftsFromSaved,
  gridDays,
  gridRangeLabel,
  gridSlots,
  minutesToTime,
  newDraft,
  scopesLabel,
  timeToMinutes,
  type BatchFailure,
  type BusySlot,
  type DraftVisit,
  type SavedVisitDraft,
} from "../model/order-visit-planner";
import { PlanningDoctorPicker } from "./order-appointment-entry";

const ROW_PX = 28;
/** Room the popover needs below its slot before it opens higher up. */
const POPOVER_HEIGHT_PX = 330;
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
  /**
   * "draft" for a lead's order: no patient yet, so the grid is saved as a
   * draft that becomes visits once the order has its patient.
   */
  mode?: "create" | "draft";
  /** The request's specialization codes: «Добавить врача» starts on them. */
  preferredSpecialtyCodes?: readonly string[];
};

type DragPayload = { kind: "draft"; key: string };

/** What the popover next to the grid shows: «Какой врач?» for a slot, or a visit's settings. */
type Popover = { kind: "slot"; date: string; start: number } | { kind: "draft"; key: string } | null;

function failuresOf(error: unknown): BatchFailure[] | null {
  if (!(error instanceof ApiRequestError)) return null;
  const failures = (error.body as { failures?: unknown } | null | undefined)?.failures;
  return Array.isArray(failures) ? (failures as BatchFailure[]) : null;
}

/**
 * Planning grid (stage 6, owner request 2026-11-13; reworked after the
 * owner's «нема UX нормального»): click a time, pick the doctor in the
 * popover next to it, adjust the visit right there; the plan is listed under
 * the grid and «Создать все приёмы» creates every visit in one
 * all-or-nothing request after the server's dry run found no conflict.
 */
export function OrderVisitPlanner({
  orderId,
  lang,
  doctors,
  onAddDoctor,
  firstDay,
  onCreated,
  mode = "create",
  preferredSpecialtyCodes = [],
}: OrderVisitPlannerProps) {
  const draftMode = mode === "draft";
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const [startDay, setStartDay] = useState(() => firstDay ?? appDateKey());
  const [drafts, setDrafts] = useState<DraftVisit[]>([]);
  const [popover, setPopover] = useState<Popover>(null);
  const [busy, setBusy] = useState<BusySlot[]>([]);
  const [busyNonce, setBusyNonce] = useState(0);
  const [interpreters, setInterpreters] = useState<InterpreterOption[]>([]);
  const [serverFailures, setServerFailures] = useState<BatchFailure[]>([]);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The grid as last saved as a draft; differs from the grid while unsaved. */
  const [savedDraft, setSavedDraft] = useState(() => JSON.stringify(draftSavePayload([])));
  const nextKey = useRef(1);
  const savingRef = useRef(false);
  const onAddDoctorRef = useRef(onAddDoctor);
  onAddDoctorRef.current = onAddDoctor;
  const knownDoctorKeys = useRef(new Set<string>());
  knownDoctorKeys.current = new Set(doctors.map(doctorKeyOf));

  // The order's saved draft (laid out while it was a lead's order).
  useEffect(() => {
    let cancelled = false;
    apiFetch<{ items: SavedVisitDraft[] }>(`/orders/${orderId}/visit-drafts`)
      .then((result) => {
        if (cancelled || !Array.isArray(result?.items) || result.items.length === 0) return;
        const restored = draftsFromSaved(result.items);
        setDrafts(restored);
        setSavedDraft(JSON.stringify(draftSavePayload(restored)));
        const added = new Set<string>();
        for (const draft of restored) {
          const key = doctorKeyOf(draft.doctor);
          if (!knownDoctorKeys.current.has(key) && !added.has(key)) {
            added.add(key);
            onAddDoctorRef.current(draft.doctor);
          }
        }
        if (restored[0]) setStartDay(restored.map((draft) => draft.date).sort()[0]);
      })
      .catch(() => {
        // No draft, or the viewer may not read it: the grid starts empty.
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);
  const dragRef = useRef<DragPayload | null>(null);

  const days = useMemo(() => gridDays(startDay), [startDay]);
  const slots = useMemo(() => gridSlots(), []);
  const doctorIndex = useMemo(
    () => new Map(doctors.map((doctor, index) => [doctorKeyOf(doctor), index])),
    [doctors],
  );
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
    // A lead's order cannot hold visits yet: nothing to dry-run.
    if (drafts.length === 0 || draftMode) {
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
  }, [drafts, draftMode, orderId]);

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
  const draftDirty = JSON.stringify(draftSavePayload(drafts)) !== savedDraft;
  const saveDraft = () => {
    if (!draftDirty || missingTitle || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const payload = draftSavePayload(drafts);
    apiFetch(`/orders/${orderId}/visit-drafts`, { method: "POST", body: JSON.stringify(payload) })
      .then(() => {
        setSavedDraft(JSON.stringify(payload));
        setNotice(
          tx(
            `Черновик сохранён: ${drafts.length}. Приёмы создадутся из него, когда у заказа появится пациент.`,
            `Entwurf gespeichert: ${drafts.length}. Die Termine werden daraus angelegt, sobald der Auftrag einen Patienten hat.`,
          ),
        );
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };
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
    setPopover({ kind: "draft", key });
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
    setPopover(null);
  };
  const updateDraft = (key: string, patch: Partial<DraftVisit>) => {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };
  const removeDraft = (key: string) => {
    setDrafts((current) => current.filter((draft) => draft.key !== key));
    setPopover(null);
  };

  useEffect(() => {
    if (!popover) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPopover(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popover]);

  const onDrop = (event: DragEvent<HTMLElement>, date: string, start: number) => {
    event.preventDefault();
    const payload = dragRef.current;
    dragRef.current = null;
    if (!payload) return;
    moveDraft(payload.key, date, start);
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
        setPopover(null);
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

  const conflictText = (draft: DraftVisit): { text: string; title?: string } | null => {
    const local = localConflicts.get(draft.key);
    if (local) return { text: `${tx("накладка", "Überschneidung")}: ${scopesLabel(local, lang)}` };
    const failure = failureByKey.get(draft.key);
    if (failure) return { text: batchFailureText(failure, lang), title: failure.message };
    return null;
  };
  const conflictCount = drafts.filter((draft) => conflictText(draft)).length;
  const sortedDrafts = [...drafts].sort((a, b) =>
    `${a.date} ${minutesToTime(a.start)}`.localeCompare(`${b.date} ${minutesToTime(b.start)}`),
  );
  const doctorName = (doctor: PlanningDoctor) => doctor.doctorName ?? doctor.providerName;

  const totalHeight = slots.length * ROW_PX;
  const toneOf = (doctor: PlanningDoctor) =>
    DOCTOR_TONES[(doctorIndex.get(doctorKeyOf(doctor)) ?? 0) % DOCTOR_TONES.length];
  const swatchOf = (doctor: PlanningDoctor) =>
    DOCTOR_SWATCHES[(doctorIndex.get(doctorKeyOf(doctor)) ?? 0) % DOCTOR_SWATCHES.length];
  const topOf = (minutes: number) => ((minutes - GRID_START_MINUTES) / GRID_STEP_MINUTES) * ROW_PX;

  const step = drafts.length > 0 ? 3 : popover?.kind === "slot" ? 2 : 1;
  const steps = [
    tx("Кликните время в сетке", "Uhrzeit im Raster anklicken"),
    tx("Выберите врача", "Arzt wählen"),
    draftMode
      ? tx("Сохраните черновик", "Entwurf speichern")
      : tx("Создайте все приёмы", "Alle Termine anlegen"),
  ];

  const activeDraft =
    popover?.kind === "draft" ? drafts.find((draft) => draft.key === popover.key) ?? null : null;
  const popoverDate = popover?.kind === "slot" ? popover.date : activeDraft?.date ?? null;
  const popoverStart = popover?.kind === "slot" ? popover.start : activeDraft?.start ?? null;
  const interpreterOptions = assignableInterpreterOptions(interpreters, activeDraft?.interpreterId);

  const renderPopover = (day: string, dayIndex: number) => {
    if (!popover || popoverDate !== day || popoverStart === null) return null;
    const top = Math.max(0, Math.min(topOf(popoverStart), totalHeight - POPOVER_HEIGHT_PX));
    const side = dayIndex < Math.ceil(days.length / 2) ? "left-full ml-1.5" : "right-full mr-1.5";
    const shell = cn(
      "absolute z-30 w-72 space-y-2 rounded-xl border border-border bg-card p-3 text-[13px] shadow-xl",
      side,
    );
    if (popover.kind === "slot") {
      return (
        <div data-testid="order-visit-planner-choose" className={shell} style={{ top }}>
          <div className="font-semibold">
            {tx("Какой врач?", "Welcher Arzt?")}{" "}
            <span className="font-normal text-muted-foreground tabular-nums">
              {plannedDayLabel(day, lang)}, {minutesToTime(popover.start)}
            </span>
          </div>
          {doctors.length > 0 ? (
            <div className="space-y-1">
              {doctors.map((doctor) => (
                <button
                  key={doctorKeyOf(doctor)}
                  type="button"
                  data-testid="order-visit-planner-doctor"
                  onClick={() => placeDraft(doctor, popover.date, popover.start)}
                  className="flex w-full items-center gap-2 rounded-lg border border-border/70 px-2 py-1.5 text-left hover:border-orange-400 hover:bg-orange-50 dark:hover:bg-orange-950/30"
                >
                  <span aria-hidden="true" className={cn("h-6 w-1.5 shrink-0 rounded", swatchOf(doctor))} />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{doctorName(doctor)}</span>
                    {doctor.doctorName ? (
                      <span className="block truncate text-xs text-muted-foreground">{doctor.providerName}</span>
                    ) : null}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {tx("В заказе ещё нет врачей — добавьте:", "Noch keine Ärzte im Auftrag – hinzufügen:")}
            </p>
          )}
          <PlanningDoctorPicker
            lang={lang}
            stacked
            preferredSpecialtyCodes={preferredSpecialtyCodes}
            onAdd={(doctor) => {
              onAddDoctor(doctor);
              placeDraft(doctor, popover.date, popover.start);
            }}
          />
          <Button type="button" variant="outline" size="sm" className="h-7 w-full" onClick={() => setPopover(null)}>
            {tx("Отмена", "Abbrechen")}
          </Button>
        </div>
      );
    }
    if (!activeDraft) return null;
    return (
      <div data-testid="order-visit-planner-editor" className={shell} style={{ top }}>
        <div>
          <div className="font-semibold">{doctorName(activeDraft.doctor)}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {plannedDayLabel(activeDraft.date, lang)}, {minutesToTime(activeDraft.start)}–
            {minutesToTime(activeDraft.start + activeDraft.duration)}
          </div>
        </div>
        <Input
          value={activeDraft.title}
          aria-label={tx("Название приёма", "Bezeichnung des Termins")}
          placeholder={tx("Название приёма", "Bezeichnung des Termins")}
          onChange={(event) => updateDraft(activeDraft.key, { title: event.target.value })}
          className="h-8 text-[13px]"
        />
        <div className="flex flex-wrap gap-1" role="group" aria-label={tx("Длительность", "Dauer")}>
          {VISIT_DURATIONS.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              size="sm"
              variant={activeDraft.duration === minutes ? "default" : "outline"}
              aria-pressed={activeDraft.duration === minutes}
              disabled={activeDraft.start + minutes > GRID_END_MINUTES}
              className="h-7 px-2 text-xs"
              onClick={() => updateDraft(activeDraft.key, { duration: minutes })}
            >
              {minutes} {tx("мин", "Min.")}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={activeDraft.interpreterNeeded}
            onChange={(event) =>
              updateDraft(activeDraft.key, {
                interpreterNeeded: event.target.checked,
                interpreterId: event.target.checked ? activeDraft.interpreterId : "",
              })
            }
          />
          {tx("Нужен переводчик", "Dolmetscher benötigt")}
        </label>
        {activeDraft.interpreterNeeded ? (
          <NativeComboboxSelect
            aria-label={tx("Переводчик", "Dolmetscher")}
            value={activeDraft.interpreterId}
            onChange={(event) => updateDraft(activeDraft.key, { interpreterId: event.target.value })}
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
        <div className="flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1"
            onClick={() => removeDraft(activeDraft.key)}
          >
            <Trash2 className="size-3.5" />
            {tx("Убрать", "Entfernen")}
          </Button>
          <Button type="button" size="sm" className="h-7" onClick={() => setPopover(null)}>
            {tx("Готово", "Fertig")}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div data-testid="order-visit-planner" data-mode={mode} className="space-y-3">
      {draftMode ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200">
          {tx(
            "Заказ лида: пациента ещё нет, поэтому сохраняем черновик. Когда лид станет пациентом, блоки будут ждать здесь — останется нажать «Создать все приёмы».",
            "Auftrag eines Leads: noch kein Patient, daher wird ein Entwurf gespeichert. Sobald der Lead Patient ist, stehen die Blöcke hier bereit – dann «Alle Termine anlegen».",
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ol className="flex flex-wrap gap-1.5" data-testid="order-visit-planner-steps">
          {steps.map((label, index) => {
            const number = index + 1;
            const done = number < step;
            const current = number === step;
            return (
              <li
                key={label}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
                  current ? "border-orange-500 text-foreground" : "border-border/70 text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                    done ? "bg-emerald-600 text-white" : current ? "bg-orange-500 text-white" : "bg-muted",
                  )}
                >
                  {done ? <Check className="size-3" /> : number}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
        <div className="flex items-center gap-1.5">
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
          <span className="min-w-[8.5rem] text-center text-xs font-medium tabular-nums" data-testid="order-visit-planner-range">
            {gridRangeLabel(days)}
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
      </div>

      <div className="max-h-[36rem] overflow-auto rounded-lg border border-border/70">
        <div
          className="grid min-w-[40rem]"
          style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(7rem, 1fr))` }}
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
          {days.map((day, dayIndex) => (
            <div
              key={day}
              data-testid="order-visit-planner-day"
              data-date={day}
              className={cn("relative border-l border-border/70", popoverDate === day && "z-10")}
              style={{ height: totalHeight }}
            >
              {slots.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  data-slot-time={minutesToTime(minutes)}
                  aria-label={`${plannedDayLabel(day, lang)} ${minutesToTime(minutes)} — ${tx("добавить приём", "Termin hinzufügen")}`}
                  onClick={() => {
                    if (!saving) setPopover({ kind: "slot", date: day, start: minutes });
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => onDrop(event, day, minutes)}
                  className={cn(
                    "group block w-full border-b border-border/40 text-left hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:outline-none dark:hover:bg-orange-950/30",
                    minutes % 60 === 30 && "border-dashed",
                    popover?.kind === "slot" &&
                      popover.date === day &&
                      popover.start === minutes &&
                      "bg-orange-100 dark:bg-orange-950/50",
                  )}
                  style={{ height: ROW_PX }}
                >
                  <span className="hidden pl-1.5 text-[11px] font-semibold text-orange-600 group-hover:inline group-focus-visible:inline">
                    + {tx("приём", "Termin")}
                  </span>
                </button>
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
                      style={{ top: topOf(start) + 1, height: ((end - start) / GRID_STEP_MINUTES) * ROW_PX - 2 }}
                    >
                      {`${slot.time_start ?? ""} ${text}`}
                    </div>
                  );
                })}
              {drafts
                .filter((draft) => draft.date === day)
                .map((draft) => (
                  <button
                    key={draft.key}
                    type="button"
                    draggable
                    data-testid="order-visit-planner-draft"
                    onDragStart={() => {
                      dragRef.current = { kind: "draft", key: draft.key };
                    }}
                    onClick={() => setPopover({ kind: "draft", key: draft.key })}
                    className={cn(
                      "absolute inset-x-0.5 z-[5] overflow-hidden rounded border px-1 text-left text-[11px] leading-4 text-foreground",
                      toneOf(draft.doctor),
                      conflictText(draft) && "ring-2 ring-rose-500",
                      popover?.kind === "draft" && popover.key === draft.key && "ring-2 ring-orange-500",
                    )}
                    style={{ top: topOf(draft.start) + 1, height: (draft.duration / GRID_STEP_MINUTES) * ROW_PX - 2 }}
                  >
                    <span className="font-semibold tabular-nums">{minutesToTime(draft.start)}</span>{" "}
                    {doctorName(draft.doctor)}
                    {draft.title && draft.title !== doctorName(draft.doctor) ? ` · ${draft.title}` : ""}
                    {draft.interpreterNeeded ? ` · ${tx("переводчик", "Dolmetscher")}` : ""}
                  </button>
                ))}
              {renderPopover(day, dayIndex)}
            </div>
          ))}
        </div>
      </div>

      <div data-testid="order-visit-planner-plan" className="overflow-hidden rounded-lg border border-border/70">
        {sortedDrafts.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-muted-foreground">
            {tx(
              "План пуст. Кликните свободное время в сетке, чтобы поставить первый приём.",
              "Der Plan ist leer. Klicken Sie auf eine freie Uhrzeit im Raster, um den ersten Termin zu setzen.",
            )}
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-semibold">{tx("День", "Tag")}</th>
                <th className="px-3 py-1.5 font-semibold">{tx("Время", "Zeit")}</th>
                <th className="px-3 py-1.5 font-semibold">{tx("Врач", "Arzt")}</th>
                <th className="px-3 py-1.5 font-semibold">{tx("Название", "Bezeichnung")}</th>
                <th className="px-3 py-1.5 font-semibold">{tx("Переводчик", "Dolmetscher")}</th>
                <th className="px-3 py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sortedDrafts.map((draft) => {
                const problem = conflictText(draft);
                return (
                  <tr
                    key={draft.key}
                    data-testid="order-visit-planner-plan-row"
                    onClick={() => setPopover({ kind: "draft", key: draft.key })}
                    className="cursor-pointer border-t border-border/60 hover:bg-muted/30"
                  >
                    <td className="px-3 py-1.5">{plannedDayLabel(draft.date, lang)}</td>
                    <td className="px-3 py-1.5 tabular-nums">
                      {minutesToTime(draft.start)}–{minutesToTime(draft.start + draft.duration)}
                    </td>
                    <td className="px-3 py-1.5">{doctorName(draft.doctor)}</td>
                    <td className="px-3 py-1.5">{draft.title || "—"}</td>
                    <td className="px-3 py-1.5">{draft.interpreterNeeded ? tx("нужен", "benötigt") : "—"}</td>
                    <td className="px-3 py-1.5 text-xs" title={problem?.title}>
                      {problem ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400">
                          <TriangleAlert className="size-3.5" />
                          {problem.text}
                        </span>
                      ) : (
                        <Check className="size-4 text-emerald-600" aria-label={tx("без накладок", "keine Überschneidung")} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1 text-xs" data-testid="order-visit-planner-conflicts" aria-live="polite">
          {conflictCount > 0 ? (
            <span className="text-rose-700 dark:text-rose-400">
              {tx(
                `Накладки: ${conflictCount}. Перетащите блок или измените время.`,
                `Überschneidungen: ${conflictCount}. Block verschieben oder Zeit ändern.`,
              )}
            </span>
          ) : drafts.length > 0 && !checking ? (
            <span className="text-emerald-700 dark:text-emerald-400">{tx("Накладок нет", "Keine Überschneidungen")}</span>
          ) : null}
          {missingTitle ? (
            <span className="ml-2 text-rose-700">{tx("У приёма нет названия", "Ein Termin hat keine Bezeichnung")}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {drafts.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9"
              disabled={saving}
              onClick={() => {
                setDrafts([]);
                setPopover(null);
              }}
            >
              {tx("Очистить", "Leeren")}
            </Button>
          ) : null}
          {draftMode ? (
            <Button
              type="button"
              className="h-9 gap-1.5"
              data-testid="order-visit-planner-save-draft"
              disabled={!draftDirty || missingTitle || saving}
              onClick={saveDraft}
            >
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {tx(`Сохранить черновик (${drafts.length})`, `Entwurf speichern (${drafts.length})`)}
            </Button>
          ) : (
            <Button
              type="button"
              className="h-9 gap-1.5"
              data-testid="order-visit-planner-create"
              disabled={blocked}
              onClick={createAll}
            >
              {saving || checking ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {tx(`Создать все приёмы (${drafts.length})`, `Alle Termine anlegen (${drafts.length})`)}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
