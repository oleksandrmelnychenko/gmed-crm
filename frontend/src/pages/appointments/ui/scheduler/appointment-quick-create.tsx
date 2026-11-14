import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PlanningDoctorPicker } from "@/pages/orders/ui/order-appointment-entry";
import type { PlanningDoctor } from "@/pages/orders/model/order-planned-appointments";

import { appointmentSelectControlClassName } from "../../appearance/surface-appearance";
import { usePatientOrderOptionsState } from "../../data/use-patient-order-options";
import {
  buildCreateAppointmentPayload,
  validateCreateAppointmentForm,
} from "../../model/create-payload";
import { useAppointmentLabels } from "../../model/labels";
import {
  QUICK_DURATIONS,
  namedConflictLines,
  quickCreateDuration,
  quickCreateEnd,
  quickCreatePopoverPosition,
} from "../../model/quick-create";
import { useScheduleWarnings } from "../../model/schedule-warnings";
import type { AppointmentFormState, ConflictSummary, PatientSummary } from "../../model/types";

type AppointmentQuickCreateProps = {
  /** The form as the full sheet would start it: patient/order context, date and time. */
  seed: AppointmentFormState;
  /** Where the click was (viewport pixels): the popover opens next to it. */
  anchor: { x: number; y: number };
  patients: PatientSummary[];
  lang: string;
  onClose: () => void;
  /** Created: the calendar reloads and shows the notice (conflict warnings, if any). */
  onCreated: (notice: string) => void;
  /** «Больше полей…»: the full sheet, with everything chosen here filled in. */
  onMore: (form: AppointmentFormState) => void;
};

function patientLabel(patient: PatientSummary) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ");
  return name ? `${patient.patient_id} · ${name}` : patient.patient_id;
}

/**
 * Quick visit from the calendar (owner 2026-11-14: «клікнув і робиш туди
 * прийомчик»): patient, specialization → clinic → doctor, duration chips,
 * «Нужен переводчик», the patient's order; the clash with an existing visit
 * is named before saving; «Сохранить» creates it without the big sheet.
 */
export function AppointmentQuickCreate({
  seed,
  anchor,
  patients,
  lang,
  onClose,
  onCreated,
  onMore,
}: AppointmentQuickCreateProps) {
  const de = lang === "de";
  const tx = (ru: string, german: string) => (de ? german : ru);
  const { t } = useLang();
  const { appointmentText } = useAppointmentLabels();
  const { buildScheduleNotice, formatScheduleConflictError } = useScheduleWarnings();
  const [patientId, setPatientId] = useState(seed.patientId);
  const [orderId, setOrderId] = useState(seed.orderId);
  const [doctor, setDoctor] = useState<PlanningDoctor | null>(null);
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [duration, setDuration] = useState(() => quickCreateDuration(seed.timeStart, seed.timeEnd));
  const [interpreterNeeded, setInterpreterNeeded] = useState(false);
  const [conflictLines, setConflictLines] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const { orders, loaded: ordersLoaded } = usePatientOrderOptionsState(patientId);

  // The patient's only open order is taken by default, as in the full sheet.
  useEffect(() => {
    if (!ordersLoaded) return;
    if (orderId && orders.some((order) => order.id === orderId)) return;
    setOrderId(orders.length === 1 ? orders[0].id : "");
  }, [orders, ordersLoaded, orderId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const timeEnd = seed.timeStart ? quickCreateEnd(seed.timeStart, duration) : "";
  const effectiveTitle = titleTouched ? title : doctor?.doctorName ?? doctor?.providerName ?? "";
  const form: AppointmentFormState = useMemo(
    () => ({
      ...seed,
      patientId,
      orderId,
      providerId: doctor?.providerId ?? "",
      doctorId: doctor?.doctorId ?? "",
      appointmentType: "medical",
      title: effectiveTitle,
      timeEnd,
      // The full sheet fills the place from the provider the same way.
      location: doctor?.providerName ?? seed.location,
      // An unticked box leaves the visit to its order's planning.
      interpreterNeeded: interpreterNeeded ? true : null,
    }),
    [seed, patientId, orderId, doctor, effectiveTitle, timeEnd, interpreterNeeded],
  );

  // The server's conflict check for this patient, doctor and time, named
  // before anything is saved.
  useEffect(() => {
    if (!patientId || !seed.date || !seed.timeStart || !timeEnd) {
      setConflictLines([]);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({
      patient_id: patientId,
      date: seed.date,
      time_start: seed.timeStart,
      time_end: timeEnd,
    });
    if (doctor?.doctorId) params.set("doctor_id", doctor.doctorId);
    const timer = window.setTimeout(() => {
      apiFetch<ConflictSummary>(`/appointments/meta/conflicts?${params.toString()}`)
        .then((conflicts) => {
          if (!cancelled) setConflictLines(namedConflictLines(conflicts, lang));
        })
        .catch(() => {
          if (!cancelled) setConflictLines([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [patientId, doctor, seed.date, seed.timeStart, timeEnd, lang]);

  const save = () => {
    if (busyRef.current) return;
    const validation = validateCreateAppointmentForm(form, {
      patientRequired: `${t.orders_patient}: ${t.cf_required}`,
      titleRequired: `${t.appointments_title_col}: ${t.cf_required}`,
      dateRequired: `${t.appointments_date}: ${t.cf_required}`,
      medicalProviderRequired: appointmentText("appointments_medical_provider_required"),
      timePairError: t.appointments_time_pair_error,
      timeRangeError: t.appointments_time_range_error,
      repeatIntervalError: t.appointments_repeat_interval_error,
      repeatRequireEndError: t.appointments_repeat_require_end_error,
    });
    if (validation.error) {
      setError(validation.error);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    apiFetch<{ id: string; conflicts?: ConflictSummary }>("/appointments", {
      method: "POST",
      body: JSON.stringify(
        buildCreateAppointmentPayload(form, validation.repeatInterval, validation.repeatCount),
      ),
    })
      .then((result) => onCreated(buildScheduleNotice(result.conflicts, [])))
      .catch((reason: unknown) =>
        setError(
          formatScheduleConflictError(reason, appointmentText("appointments_failed_to_create_appointment")),
        ),
      )
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const position = quickCreatePopoverPosition(anchor, {
    width: typeof window === "undefined" ? 1280 : window.innerWidth,
    height: typeof window === "undefined" ? 800 : window.innerHeight,
  });

  return (
    <div
      role="dialog"
      aria-label={tx("Новый приём", "Neuer Termin")}
      data-testid="appointment-quick-create"
      className="fixed z-50 w-80 max-w-[calc(100vw-1rem)] space-y-2 rounded-xl border border-border bg-card p-3 text-[13px] shadow-2xl"
      style={{ left: position.left, top: position.top }}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{tx("Новый приём", "Neuer Termin")}</div>
          <div className="text-xs text-muted-foreground tabular-nums">
            {seed.date.split("-").reverse().join(".")}
            {seed.timeStart ? `, ${seed.timeStart}–${timeEnd}` : ""}
          </div>
        </div>
        <button
          type="button"
          aria-label={tx("Закрыть", "Schließen")}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <NativeComboboxSelect
        aria-label={t.orders_patient}
        value={patientId}
        onChange={(event) => setPatientId(event.target.value)}
        className={appointmentSelectControlClassName}
      >
        <option value="">{t.orders_patient}</option>
        {patients.map((patient) => (
          <option key={patient.id} value={patient.id}>
            {patientLabel(patient)}
          </option>
        ))}
      </NativeComboboxSelect>

      <PlanningDoctorPicker lang={lang} inline stacked onChange={setDoctor} />

      <Input
        value={effectiveTitle}
        aria-label={tx("Название приёма", "Bezeichnung des Termins")}
        placeholder={tx("Название приёма", "Bezeichnung des Termins")}
        onChange={(event) => {
          setTitleTouched(true);
          setTitle(event.target.value);
        }}
        className="h-8 text-[13px]"
      />

      {seed.timeStart ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={tx("Длительность", "Dauer")}>
          {QUICK_DURATIONS.map((minutes) => (
            <Button
              key={minutes}
              type="button"
              size="sm"
              variant={duration === minutes ? "default" : "outline"}
              aria-pressed={duration === minutes}
              className="h-7 px-2 text-xs"
              onClick={() => setDuration(minutes)}
            >
              {minutes} {tx("мин", "Min.")}
            </Button>
          ))}
        </div>
      ) : null}

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={interpreterNeeded}
          onChange={(event) => setInterpreterNeeded(event.target.checked)}
        />
        {tx("Нужен переводчик", "Dolmetscher benötigt")}
      </label>

      {patientId && orders.length > 0 ? (
        <NativeComboboxSelect
          aria-label={tx("Заказ", "Auftrag")}
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
          className={appointmentSelectControlClassName}
        >
          <option value="">{tx("Без заказа", "Ohne Auftrag")}</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.order_number}
            </option>
          ))}
        </NativeComboboxSelect>
      ) : null}

      {conflictLines.length > 0 ? (
        <p
          data-testid="appointment-quick-create-conflict"
          className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {conflictLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-rose-700 dark:text-rose-400">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-2 pt-1">
        <button
          type="button"
          className="text-xs font-medium text-orange-600 hover:underline"
          onClick={() => onMore(form)}
        >
          {tx("Больше полей…", "Mehr Felder…")}
        </button>
        <div className="flex gap-1.5">
          <Button type="button" variant="outline" size="sm" className="h-8" onClick={onClose}>
            {tx("Отмена", "Abbrechen")}
          </Button>
          <Button
            type="button"
            size="sm"
            className={cn("h-8 gap-1.5")}
            data-testid="appointment-quick-create-save"
            disabled={busy}
            onClick={save}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {tx("Сохранить", "Speichern")}
          </Button>
        </div>
      </div>
    </div>
  );
}
