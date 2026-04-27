import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner } from "@/components/ui-shell";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import {
  appointmentSelectControlClassName,
  appointmentSlateInputClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import { useDebouncedValue } from "@/pages/appointments/data/use-debounced-value";
import { buildConflictQuery } from "@/pages/appointments/model/query-builders";
import {
  buildEditAppointmentForm,
} from "@/pages/appointments/model/form-factories";
import {
  appointmentText,
  carePathKindLabel,
  doctorLabel,
  normalizeCarePathKindForAppointmentType,
  roleLabel,
} from "@/pages/appointments/model/labels";
import {
  buildLocalScheduleWarnings,
  buildScheduleNotice,
} from "@/pages/appointments/model/schedule-warnings";
import { parsePositiveIntegerInput } from "@/pages/appointments/model/workflow-helpers";
import {
  recurrenceFrequencyLabel,
} from "@/pages/appointments/model/recurrence";
import type {
  AppointmentCarePathKind,
  AppointmentDetail,
  AppointmentFormState,
  AppointmentListItem,
  AppointmentRecurrenceFrequency,
  AppointmentRecurringActionScope,
  ConflictSummary,
  DoctorOption,
  InterpreterOption,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import { CARE_PATH_KIND_OPTIONS } from "@/pages/appointments/model/constants";
import { Field } from "@/pages/appointments/ui/shared/workspace-primitives";
import {
  ConflictPanel,
  ScheduleWarningsPanel,
} from "@/pages/appointments/ui/shared/schedule-panels";

type EditAppointmentSectionProps = {
  detail: AppointmentDetail;
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  onSaved: (notice: string) => void;
};

const selectClassName = appointmentSelectControlClassName;
const inputClassName = appointmentSlateInputClassName;

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /[.…]$/u.test(normalized) ? normalized : `${normalized}…`;
}

function EditAppointmentSection({
  detail,
  appointments,
  providers,
  staff,
  interpreters,
  onSaved,
}: EditAppointmentSectionProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("Dolmetscher", "Переводчик", "Interpreter");
  const [form, setForm] = useState<AppointmentFormState>(() =>
    buildEditAppointmentForm(detail),
  );
  const [recurrenceScope, setRecurrenceScope] =
    useState<AppointmentRecurringActionScope>("single");
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [conflicts, setConflicts] = useState<ConflictSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(buildEditAppointmentForm(detail));
    setRecurrenceScope("single");
    setDoctors([]);
    setConflicts(null);
    setError("");
    setBusy(false);
  }, [detail]);

  const scheduleWarningLabels = useMemo(
    () => ({
      patients_assign_owner: tr.patients_assign_owner,
      common_doctor: tr.common_doctor,
      common_provider: tr.common_provider,
    }),
    [tr.common_doctor, tr.common_provider, tr.patients_assign_owner],
  );
  const localWarnings = useMemo(
    () =>
      buildLocalScheduleWarnings(
        appointments,
        {
          appointmentId: detail.id,
          date: form.date,
          timeStart: form.timeStart,
          timeEnd: form.timeEnd,
          ownerUserId: form.ownerUserId || detail.owner_user_id || null,
          providerId: form.providerId || null,
          doctorId: form.doctorId || null,
        },
        scheduleWarningLabels,
      ),
    [
      appointments,
      detail.id,
      detail.owner_user_id,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.ownerUserId,
      form.providerId,
      form.doctorId,
      scheduleWarningLabels,
    ],
  );
  const conflictQuery = useMemo(() => {
    if (!detail.patient_id || !form.date) return "";
    return buildConflictQuery(
      detail.patient_id,
      detail.id,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
    );
  }, [
    detail.id,
    detail.patient_id,
    form.date,
    form.timeStart,
    form.timeEnd,
    form.interpreterId,
  ]);
  const debouncedConflictQuery = useDebouncedValue(conflictQuery);

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
      const applyRecurrenceRule =
        Boolean(detail.recurrence_frequency) && recurrenceScope !== "single";
      const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
      const repeatCount = parsePositiveIntegerInput(form.repeatCount);
      if (applyRecurrenceRule) {
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
        ok: boolean;
        conflicts?: ConflictSummary;
      }>(`/appointments/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify({
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: form.ownerUserId || null,
          interpreter_id: form.interpreterId || null,
          care_path_kind: normalizeCarePathKindForAppointmentType(
            detail.type,
            form.carePathKind,
          ),
          title: form.title.trim(),
          date: form.date,
          time_start: form.timeStart || null,
          time_end: form.timeEnd || null,
          location: form.location.trim() || null,
          recurrence_frequency: applyRecurrenceRule ? form.repeatFrequency : null,
          recurrence_interval: applyRecurrenceRule ? repeatInterval : null,
          recurrence_count: applyRecurrenceRule ? repeatCount : null,
          recurrence_until:
            applyRecurrenceRule && form.repeatUntil ? form.repeatUntil : null,
          recurrence_scope: detail.recurrence_frequency
            ? recurrenceScope
            : "single",
        }),
      });
      onSaved(buildScheduleNotice(result.conflicts, localWarnings));
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : appointmentText(
              "Terminplan konnte nicht gespeichert werden.",
              "Не удалось сохранить расписание приёма.",
              "Failed to save schedule",
            ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl p-3.5 border border-border/50 bg-card/40">
      <h3 className="text-sm font-semibold text-foreground">
        {t.appointments_title}
      </h3>
      {error ? (
        <div className="mt-4">
          <Banner tone="error" withIcon>{error}</Banner>
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <Field label={t.appointments_title_col}>
          <Input
            value={form.title}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            className={inputClassName}
          />
        </Field>
        <Field
          label={appointmentText(
            "Versorgungspfad",
            "Траектория лечения",
            "Care path",
          )}
        >
          <NativeComboboxSelect
            value={form.carePathKind}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                carePathKind: event.target.value as AppointmentCarePathKind,
              }))
            }
            className={selectClassName}
            disabled={detail.type !== "medical"}
          >
            {CARE_PATH_KIND_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {carePathKindLabel(value)}
              </option>
            ))}
          </NativeComboboxSelect>
        </Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t.appointments_date}>
            <Input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  date: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
          <Field label={t.appointments_time}>
            <Input
              type="time"
              value={form.timeStart}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeStart: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
          <Field label={t.appointments_time}>
            <Input
              type="time"
              value={form.timeEnd}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeEnd: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.common_provider}>
            <NativeComboboxSelect
              value={form.providerId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  providerId: event.target.value,
                  doctorId: "",
                }))
              }
              className={selectClassName}
              disabled={detail.type === "internal"}
            >
              <option value="">{t.common_not_set}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={t.common_doctor}>
            <NativeComboboxSelect
              value={form.doctorId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  doctorId: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.providerId}
            >
              <option value="">{t.common_not_set}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctorLabel(doctor)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.ownerUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  ownerUserId: event.target.value,
                }))
              }
              className={selectClassName}
            >
              <option value="">{t.common_not_set}</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={interpreterFieldLabel}>
            <NativeComboboxSelect
              value={form.interpreterId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  interpreterId: event.target.value,
                }))
              }
              className={selectClassName}
            >
              <option value="">{t.common_not_set}</option>
              {interpreters.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
        </div>
        <Field label={t.appointments_location}>
          <Input
            value={form.location}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                location: event.target.value,
              }))
            }
            className={inputClassName}
          />
        </Field>
        {detail.recurrence_frequency ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3">
            <Field label={t.appointments_scope_apply_schedule}>
              <NativeComboboxSelect
                value={recurrenceScope}
                onChange={(event) =>
                  setRecurrenceScope(
                    event.target.value as AppointmentRecurringActionScope,
                  )
                }
                className={selectClassName}
              >
                <option value="single">{t.appointments_scope_single}</option>
                <option value="following">
                  {t.appointments_scope_following}
                </option>
                <option value="series">{t.appointments_scope_series}</option>
              </NativeComboboxSelect>
            </Field>
            <p className="mt-2 text-xs text-sky-800">
              {t.appointments_scope_following_hint}
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field
                label={appointmentText(
                  "Wiederholungsrhythmus",
                  "Частота повторения",
                  "Repeat frequency",
                )}
              >
                <NativeComboboxSelect
                  value={form.repeatFrequency}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatFrequency:
                        event.target.value as AppointmentRecurrenceFrequency,
                    }))
                  }
                  className={selectClassName}
                  disabled={recurrenceScope === "single"}
                >
                  <option value="daily">{recurrenceFrequencyLabel("daily")}</option>
                  <option value="weekly">
                    {recurrenceFrequencyLabel("weekly")}
                  </option>
                  <option value="monthly">
                    {recurrenceFrequencyLabel("monthly")}
                  </option>
                </NativeComboboxSelect>
              </Field>
              <Field
                label={appointmentText(
                  "Wiederholen alle",
                  "Повторять каждые",
                  "Repeat every",
                )}
              >
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.repeatInterval}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatInterval: event.target.value,
                    }))
                  }
                  className={inputClassName}
                  disabled={recurrenceScope === "single"}
                />
              </Field>
              <Field
                label={appointmentText(
                  "Anzahl Termine",
                  "Всего повторов",
                  "Total occurrences",
                )}
              >
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.repeatCount}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      repeatCount: event.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder={withEllipsis(
                    appointmentText(
                      "Optional, wenn ein Enddatum gesetzt ist",
                      "Необязательно, если указана дата окончания",
                      "Optional when repeat-until is set",
                    ),
                  )}
                  disabled={recurrenceScope === "single"}
                />
              </Field>
              <Field
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
                  className={inputClassName}
                  disabled={recurrenceScope === "single"}
                />
              </Field>
            </div>
            <p className="mt-3 text-xs text-sky-800">
              Recurrence rule edits only apply when you target
              <span className="font-semibold"> this and following</span> or the{" "}
              <span className="font-semibold">whole series</span>. Single-
              occurrence updates keep the current slot detached from rule
              changes.
            </p>
          </div>
        ) : null}
        <ConflictPanel conflicts={conflicts} />
        <ScheduleWarningsPanel warnings={localWarnings} />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={busy}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {busy ? t.patients_saving : t.common_save}
          </Button>
        </div>
      </form>
    </section>
  );
}

export const MemoizedEditAppointmentSection = memo(EditAppointmentSection);
