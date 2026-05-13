import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type SetStateAction,
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

type EditAppointmentSectionState = {
  form: AppointmentFormState;
  recurrenceScope: AppointmentRecurringActionScope;
  doctors: DoctorOption[];
  conflicts: ConflictSummary | null;
  error: string;
  busy: boolean;
};

type EditAppointmentSectionAction =
  | { type: "patch"; value: Partial<EditAppointmentSectionState> }
  | {
      type: "update";
      updater: (state: EditAppointmentSectionState) => EditAppointmentSectionState;
    };

function createEditAppointmentSectionState(
  detail: AppointmentDetail,
): EditAppointmentSectionState {
  return {
    form: buildEditAppointmentForm(detail),
    recurrenceScope: "single",
    doctors: [],
    conflicts: null,
    error: "",
    busy: false,
  };
}

function editAppointmentSectionReducer(
  state: EditAppointmentSectionState,
  action: EditAppointmentSectionAction,
): EditAppointmentSectionState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    default:
      return state;
  }
}

function createEditAppointmentFieldAction<K extends keyof EditAppointmentSectionState>(
  field: K,
  value: SetStateAction<EditAppointmentSectionState[K]>,
): EditAppointmentSectionAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (
              current: EditAppointmentSectionState[K],
            ) => EditAppointmentSectionState[K])(currentValue)
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

const selectClassName = appointmentSelectControlClassName;
const inputClassName = appointmentSlateInputClassName;

function withEllipsis(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return "";
  return /[.…]$/u.test(normalized) ? normalized : `${normalized}…`;
}

function EditAppointmentSection(props: EditAppointmentSectionProps) {
  const resetKey = useMemo(() => JSON.stringify(props.detail), [props.detail]);
  return <EditAppointmentSectionContent key={resetKey} {...props} />;
}

function useEditAppointmentSectionContentContent({
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
    appointmentText("appointments_interpreter");
  const [{ form, recurrenceScope, doctors, conflicts, error, busy }, dispatchEditState] =
    useReducer(
      editAppointmentSectionReducer,
      detail,
      createEditAppointmentSectionState,
    );
  const setForm = (value: SetStateAction<AppointmentFormState>) =>
    dispatchEditState(createEditAppointmentFieldAction("form", value));
  const setRecurrenceScope = (
    value: SetStateAction<AppointmentRecurringActionScope>,
  ) => dispatchEditState(createEditAppointmentFieldAction("recurrenceScope", value));
  const setDoctors = (value: SetStateAction<DoctorOption[]>) =>
    dispatchEditState(createEditAppointmentFieldAction("doctors", value));
  const setConflicts = (value: SetStateAction<ConflictSummary | null>) =>
    dispatchEditState(createEditAppointmentFieldAction("conflicts", value));
  const setError = (value: SetStateAction<string>) =>
    dispatchEditState(createEditAppointmentFieldAction("error", value));
  const setBusy = (value: SetStateAction<boolean>) =>
    dispatchEditState(createEditAppointmentFieldAction("busy", value));

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

  const clearProviderDoctors = () => {
    setDoctors([]);
    setForm((current) =>
        current.doctorId ? { ...current, doctorId: "" } : current,
    );
  };

  const applyProviderDoctors = (rows: Awaited<ReturnType<typeof getProviderDoctors>>) => {
    setDoctors(rows);
  };

  const clearDoctors = () => {
    setDoctors([]);
  };

  const clearConflicts = () => {
    setConflicts(null);
  };

  const applyConflicts = (value: ConflictSummary) => {
    setConflicts(value);
  };

  useEffect(() => {
    if (!form.providerId) {
      clearProviderDoctors();
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) applyProviderDoctors(rows);
      })
      .catch(() => {
        if (active) clearDoctors();
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      clearConflicts();
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) applyConflicts(value);
      })
      .catch(() => {
        if (active) clearConflicts();
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
          : appointmentText("appointments_failed_to_save_schedule"),
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
          label={appointmentText("appointments_care_path")}
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
                label={appointmentText("appointments_repeat_frequency")}
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
                label={appointmentText("appointments_repeat_every")}
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
                label={appointmentText("appointments_total_occurrences")}
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
                    appointmentText("appointments_optional_when_repeat_until_is_set"),
                  )}
                  disabled={recurrenceScope === "single"}
                />
              </Field>
              <Field
                label={appointmentText("appointments_repeat_until")}
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
              {t.appointments_edit_recurrence_rule_guidance}
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

function EditAppointmentSectionContent(...args: Parameters<typeof useEditAppointmentSectionContentContent>) {
  return useEditAppointmentSectionContentContent(...args);
}

export const MemoizedEditAppointmentSection = memo(EditAppointmentSection);
