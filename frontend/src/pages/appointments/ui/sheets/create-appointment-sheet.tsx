import {
  memo,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { Plus, LoaderCircle } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Banner,
  inputClass,
  textareaClass,
} from "@/components/ui-shell";
import {
  CARE_PATH_KIND_OPTIONS,
  RECURRENCE_FREQUENCY_OPTIONS,
  TYPE_OPTIONS,
} from "@/pages/appointments/model/constants";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import { useDebouncedValue } from "@/pages/appointments/data/use-debounced-value";
import {
  appointmentText,
  appointmentTypeLabel,
  carePathKindLabel,
  doctorLabel,
  normalizeCarePathKindForAppointmentType,
  patientName,
  providerLabel,
  recurrenceFrequencyLabel,
  staffLabel,
} from "@/pages/appointments/model/labels";
import { buildConflictQuery } from "@/pages/appointments/model/query-builders";
import { buildLocalScheduleWarnings, buildScheduleNotice } from "@/pages/appointments/model/schedule-warnings";
import type {
  AppointmentCarePathKind,
  AppointmentFormState,
  AppointmentKind,
  AppointmentListItem,
  AppointmentRecurrenceFrequency,
  ConflictSummary,
  DoctorOption,
  InterpreterOption,
  PatientSummary,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import { parsePositiveIntegerInput } from "@/pages/appointments/model/workflow-helpers";
import {
  AppointmentEditorSheet,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";
import {
  ConflictPanel,
  ScheduleWarningsPanel,
} from "@/pages/appointments/ui/shared/schedule-panels";

const createSheetInputClassName = inputClass;
const createSheetTextareaClassName = textareaClass;

export type CreateAppointmentSheetProps = {
  open: boolean;
  title: string;
  seed: AppointmentFormState;
  appointments: AppointmentListItem[];
  patients: PatientSummary[];
  providers: ProviderSummary[];
  interpreters: InterpreterOption[];
  staff: StaffOption[];
  userId?: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { id: string; notice: string }) => void;
};

function CreateAppointmentSheet({
  open,
  title,
  seed,
  appointments,
  patients,
  providers,
  interpreters,
  staff,
  userId,
  onOpenChange,
  onCreated,
}: CreateAppointmentSheetProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("Dolmetscher", "Переводчик", "Interpreter");
  const [form, setForm] = useState<AppointmentFormState>(seed);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [conflicts, setConflicts] = useState<ConflictSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(seed);
    setDoctors([]);
    setConflicts(null);
    setError("");
    setBusy(false);
  }, [open, seed]);

  const scheduleWarningLabels = useMemo(
    () => ({
      patients_assign_owner: tr.patients_assign_owner,
      common_doctor: tr.common_doctor,
      common_provider: tr.common_provider,
    }),
    [tr.common_doctor, tr.common_provider, tr.patients_assign_owner],
  );
  const patientLabelIndex = useMemo(
    () =>
      new Map(
        patients.map((item) => [
          item.id,
          `${item.patient_id} · ${patientName(item)}`,
        ]),
      ),
    [patients],
  );
  const providerLabelIndex = useMemo(
    () => new Map(providers.map((item) => [item.id, providerLabel(item)])),
    [providers],
  );
  const doctorLabelIndex = useMemo(
    () => new Map(doctors.map((item) => [item.id, doctorLabel(item)])),
    [doctors],
  );
  const staffLabelIndex = useMemo(
    () => new Map(staff.map((item) => [item.id, staffLabel(item)])),
    [staff],
  );
  const interpreterLabelIndex = useMemo(
    () => new Map(interpreters.map((item) => [item.id, staffLabel(item)])),
    [interpreters],
  );
  const localWarnings = useMemo(
    () =>
      buildLocalScheduleWarnings(
        appointments,
        {
          date: form.date,
          timeStart: form.timeStart,
          timeEnd: form.timeEnd,
          ownerUserId: form.ownerUserId || userId || null,
          providerId: form.providerId || null,
          doctorId: form.doctorId || null,
        },
        scheduleWarningLabels,
      ),
    [
      appointments,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.ownerUserId,
      form.providerId,
      form.doctorId,
      scheduleWarningLabels,
      userId,
    ],
  );
  const conflictQuery = useMemo(() => {
    if (!open || !form.patientId || !form.date) return "";
    return buildConflictQuery(
      form.patientId,
      "",
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
    );
  }, [
    open,
    form.patientId,
    form.date,
    form.timeStart,
    form.timeEnd,
    form.interpreterId,
  ]);
  const debouncedConflictQuery = useDebouncedValue(conflictQuery);
  const selectedPatientLabel =
    (form.patientId ? patientLabelIndex.get(form.patientId) : undefined) ??
    t.orders_patient;
  const selectedProviderLabel =
    (form.providerId ? providerLabelIndex.get(form.providerId) : undefined) ??
    t.common_not_set;
  const selectedDoctorLabel =
    (form.doctorId ? doctorLabelIndex.get(form.doctorId) : undefined) ??
    t.common_not_set;
  const selectedOwnerLabel =
    (form.ownerUserId ? staffLabelIndex.get(form.ownerUserId) : undefined) ??
    t.common_not_set;
  const selectedInterpreterLabel =
    (form.interpreterId
      ? interpreterLabelIndex.get(form.interpreterId)
      : undefined) ?? t.common_not_set;

  useEffect(() => {
    if (!form.providerId) {
      setDoctors([]);
      setForm((current) =>
        current.doctorId ? { ...current, doctorId: "" } : current,
      );
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) setDoctors(rows);
      })
      .catch(() => {
        if (active) setDoctors([]);
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      setConflicts(null);
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) setConflicts(value);
      })
      .catch(() => {
        if (active) setConflicts(null);
      });
    return () => {
      active = false;
    };
  }, [debouncedConflictQuery]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!form.patientId) {
        setError(`${t.orders_patient}: ${t.cf_required}`);
        return;
      }
      const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
      const repeatCount = parsePositiveIntegerInput(form.repeatCount);
      if (form.repeatEnabled) {
        if (!repeatInterval) {
          setError(t.appointments_repeat_interval_error);
          return;
        }
        if (!repeatCount && !form.repeatUntil) {
          setError(t.appointments_repeat_require_end_error);
          return;
        }
      }
      const result = await apiFetch<{
        id: string;
        conflicts?: ConflictSummary;
        series_created_count?: number;
      }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: form.patientId,
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: form.ownerUserId || null,
          interpreter_id: form.interpreterId || null,
          appointment_type: form.appointmentType,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            form.appointmentType,
            form.carePathKind,
          ),
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          category: form.category.trim() || null,
          notes: form.notes.trim() || null,
          recurrence_frequency: form.repeatEnabled
            ? form.repeatFrequency
            : null,
          recurrence_interval: form.repeatEnabled ? repeatInterval : null,
          recurrence_count: form.repeatEnabled ? repeatCount : null,
          recurrence_until:
            form.repeatEnabled && form.repeatUntil ? form.repeatUntil : null,
        }),
      });
      const notice = buildScheduleNotice(result.conflicts, localWarnings);
      onOpenChange(false);
      onCreated({ id: result.id, notice });
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : appointmentText(
              "Termin konnte nicht erstellt werden.",
              "Не удалось создать приём.",
              "Failed to create appointment",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  function sectionTitle(label: string) {
    return (
      <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
        <span>{label}</span>
      </h3>
    );
  }

  return (
    <AppointmentEditorSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      maxWidthClassName="sm:max-w-[760px]"
      onSubmit={handleSubmit}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg"
            onClick={() => onOpenChange(false)}
          >
            {tr.common_cancel}
          </Button>
          <Button
            type="submit"
            size="sm"
            className="h-8 rounded-lg gap-1.5 px-3.5"
            disabled={busy}
          >
            {busy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {busy ? t.patients_creating : t.appointments_new}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Banner tone="error" withIcon>{error}</Banner> : null}
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                {sectionTitle(appointmentText("Termin und Zeit", "Прием и время", "Appointment and timing"))}
                <div className="grid gap-4 md:grid-cols-3">
                  <Field compact label={t.orders_patient}>
                    <ShadSelect
                      value={form.patientId}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          patientId: value ?? "",
                        }))
                      }
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>{selectedPatientLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{t.orders_patient}</SelectItem>
                        {patients.map((patient) => (
                          <SelectItem key={patient.id} value={patient.id}>
                            {patient.patient_id} · {patientName(patient)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                  <Field compact label={t.appointments_type}>
                    <ShadSelect
                      value={form.appointmentType}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          appointmentType:
                            (value as AppointmentKind) ?? current.appointmentType,
                          carePathKind:
                            value === "medical" ? current.carePathKind : "regular",
                          providerId: value === "internal" ? "" : current.providerId,
                          doctorId: value === "internal" ? "" : current.doctorId,
                        }))
                      }
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>
                          {appointmentTypeLabel(form.appointmentType, tr)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {TYPE_OPTIONS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {appointmentTypeLabel(value, tr)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                  <Field
                    compact
                    label={appointmentText(
                      "Versorgungspfad",
                      "Траектория лечения",
                      "Care path",
                    )}
                  >
                    <ShadSelect
                      value={form.carePathKind}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          carePathKind:
                            (value as AppointmentCarePathKind) ?? current.carePathKind,
                        }))
                      }
                      disabled={form.appointmentType !== "medical"}
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>{carePathKindLabel(form.carePathKind)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {CARE_PATH_KIND_OPTIONS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {carePathKindLabel(value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                </div>
                <Field compact label={t.appointments_title_col}>
                  <Input
                    value={form.title}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        title: event.target.value,
                      }))
                    }
                    required
                    className={createSheetInputClassName}
                  />
                </Field>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field compact label={t.appointments_date}>
                    <Input
                      type="date"
                      value={form.date}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          date: event.target.value,
                        }))
                      }
                      required
                      className={createSheetInputClassName}
                    />
                  </Field>
                  <Field compact label={t.appointments_time}>
                    <Input
                      type="time"
                      value={form.timeStart}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          timeStart: event.target.value,
                        }))
                      }
                      className={createSheetInputClassName}
                    />
                  </Field>
                  <Field compact label={t.appointments_time}>
                    <Input
                      type="time"
                      value={form.timeEnd}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          timeEnd: event.target.value,
                        }))
                      }
                      className={createSheetInputClassName}
                    />
                  </Field>
                </div>
                <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
                  <label className="flex items-start gap-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={form.repeatEnabled}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          repeatEnabled: event.target.checked,
                          repeatInterval: current.repeatInterval || "1",
                          repeatCount:
                            event.target.checked && !current.repeatCount
                              ? "4"
                              : current.repeatCount,
                        }))
                      }
                      className="mt-0.5 size-4 rounded border-input bg-card text-[var(--brand)]"
                    />
                    <span>
                      <span className="block font-medium text-foreground">
                        {t.appointments_repeat_this}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {t.appointments_repeat_hint}
                      </span>
                    </span>
                  </label>
                  {form.repeatEnabled ? (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <Field compact label="Frequency">
                        <ShadSelect
                          value={form.repeatFrequency}
                          onValueChange={(value) =>
                            setForm((current) => ({
                              ...current,
                              repeatFrequency:
                                (value as AppointmentRecurrenceFrequency) ??
                                current.repeatFrequency,
                            }))
                          }
                        >
                          <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                            <SelectValue>
                              {recurrenceFrequencyLabel(form.repeatFrequency)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {RECURRENCE_FREQUENCY_OPTIONS.map((value) => (
                              <SelectItem key={value} value={value}>
                                {recurrenceFrequencyLabel(value)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </ShadSelect>
                      </Field>
                      <Field compact label="Every">
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={form.repeatInterval}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              repeatInterval: event.target.value,
                            }))
                          }
                          className={createSheetInputClassName}
                        />
                      </Field>
                      <Field
                        compact
                        label={appointmentText(
                          "Anzahl Termine",
                          "Всего повторов",
                          "Total occurrences",
                        )}
                      >
                        <Input
                          type="number"
                          min="2"
                          step="1"
                          value={form.repeatCount}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              repeatCount: event.target.value,
                            }))
                          }
                          className={createSheetInputClassName}
                        />
                      </Field>
                      <Field
                        compact
                        label={appointmentText(
                          "Wiederholen bis",
                          "Повторять до",
                          "Repeat until",
                        )}
                      >
                        <Input
                          type="date"
                          value={form.repeatUntil}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              repeatUntil: event.target.value,
                            }))
                          }
                          className={createSheetInputClassName}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                {sectionTitle(appointmentText("Provider und Arzt", "Провайдер и врач", "Provider and doctor"))}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field compact label={t.common_provider}>
                    <ShadSelect
                      value={form.providerId}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          providerId: value ?? "",
                          doctorId: "",
                        }))
                      }
                      disabled={form.appointmentType === "internal"}
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>{selectedProviderLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{t.common_not_set}</SelectItem>
                        {providers.map((provider) => (
                          <SelectItem key={provider.id} value={provider.id}>
                            {providerLabel(provider)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                  <Field compact label={t.common_doctor}>
                    <ShadSelect
                      value={form.doctorId}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          doctorId: value ?? "",
                        }))
                      }
                      disabled={!form.providerId}
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>{selectedDoctorLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{t.common_not_set}</SelectItem>
                        {doctors.map((doctor) => (
                          <SelectItem key={doctor.id} value={doctor.id}>
                            {doctorLabel(doctor)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                </div>
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                {sectionTitle(appointmentText("Koordination und Notizen", "Координация и заметки", "Coordination and notes"))}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field compact label={t.patients_assign_owner}>
                    <ShadSelect
                      value={form.ownerUserId}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          ownerUserId: value ?? "",
                        }))
                      }
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>{selectedOwnerLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{t.common_not_set}</SelectItem>
                        {staff.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {staffLabel(member)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                  <Field compact label={interpreterFieldLabel}>
                    <ShadSelect
                      value={form.interpreterId}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          interpreterId: value ?? "",
                        }))
                      }
                    >
                      <SelectTrigger className={cn("w-full", createSheetInputClassName)}>
                        <SelectValue>{selectedInterpreterLabel}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="">{tr.common_not_set}</SelectItem>
                        {interpreters.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {staffLabel(member)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </ShadSelect>
                  </Field>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field compact label={t.appointments_location}>
                    <Input
                      value={form.location}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          location: event.target.value,
                        }))
                      }
                      className={createSheetInputClassName}
                    />
                  </Field>
                  <Field compact label={tr.documents_category}>
                    <Input
                      value={form.category}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          category: event.target.value,
                        }))
                      }
                      className={createSheetInputClassName}
                    />
                  </Field>
                </div>
                <Field compact label={t.patients_notes}>
                  <textarea
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                    className={createSheetTextareaClassName}
                    rows={4}
                  />
                </Field>
        </section>
        <ConflictPanel conflicts={conflicts} />
        <ScheduleWarningsPanel warnings={localWarnings} />
      </div>
    </AppointmentEditorSheet>
  );
}

export const MemoizedCreateAppointmentSheet = memo(
  CreateAppointmentSheet,
  (prev, next) =>
    prev.open === next.open &&
    prev.seed === next.seed &&
    prev.appointments === next.appointments &&
    prev.patients === next.patients &&
    prev.providers === next.providers &&
    prev.interpreters === next.interpreters &&
    prev.staff === next.staff &&
    prev.userId === next.userId,
);
