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
import {
  Banner,
  checkboxClass,
} from "@/components/ui-shell";
import { formatUiText, useLang } from "@/lib/i18n";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  appointmentElevatedSectionCardClassName,
  appointmentSelectControlClassName,
  appointmentSlateInputClassName,
  appointmentTextareaControlClassName,
  appointmentToggleCardClassName,
} from "@/pages/appointments/appearance/surface-appearance";
import { shiftLocalDateTime } from "@/pages/appointments/model/date-time";
import { formatAppointmentSlotLabel as slotLabel } from "@/pages/appointments/model/runtime-formatters";
import { buildConflictQuery } from "@/pages/appointments/model/query-builders";
import {
  buildFollowUpVisitForm,
  defaultAppointmentOwnerUserId,
} from "@/pages/appointments/model/form-factories";
import {
  providerSelectionFitsAppointmentScope,
} from "@/pages/appointments/model/provider-taxonomy";
import {
  appointmentText as appointmentTextBase,
  carePathKindLabel,
  doctorLabel,
  followUpPresetLabel,
  followUpPresetTitle,
  normalizeCarePathKindForAppointmentType,
  roleLabel,
} from "@/pages/appointments/model/labels";
import {
  buildLocalScheduleWarnings,
  buildScheduleNotice,
} from "@/pages/appointments/model/schedule-warnings";
import {
  appointmentAnchorDateTime,
  toRfc3339,
} from "@/pages/appointments/model/workflow-helpers";
import { filterAppointmentOwnerOptions } from "@/pages/appointments/model/staff-roles";
import type {
  AppointmentCarePathKind,
  AppointmentDetail,
  AppointmentListItem,
  ConflictSummary,
  DoctorOption,
  FollowUpVisitFormState,
  InterpreterOption,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
import {
  CARE_PATH_KIND_OPTIONS,
  FOLLOW_UP_PRESETS,
} from "@/pages/appointments/model/constants";
import { getProviderDoctors } from "@/pages/appointments/data/provider-doctors";
import { useDebouncedValue } from "@/pages/appointments/data/use-debounced-value";
import { AppointmentSectionHeading, Field } from "@/pages/appointments/ui/shared/workspace-primitives";
import {
  ConflictPanel,
  ScheduleWarningsPanel,
} from "@/pages/appointments/ui/shared/schedule-panels";

type AppointmentFollowUpVisitSectionProps = {
  detail: AppointmentDetail;
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  taxonomyNodes: ProviderTaxonomyNode[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  defaultReminderUserId: string;
  currentUserId?: string;
  currentUserRole?: string;
  onCreated: (result: { id?: string; notice: string }) => void;
};

const sectionCardClass = appointmentElevatedSectionCardClassName;
const selectClassName = appointmentSelectControlClassName;
const textareaClassName = appointmentTextareaControlClassName;

function withEllipsis(text: string) {
  return text.trim().endsWith("...") ? text : `${text.trim()}...`;
}

type FollowUpVisitSectionState = {
  form: FollowUpVisitFormState;
  doctors: DoctorOption[];
  conflicts: ConflictSummary | null;
  error: string;
  busy: boolean;
};

type FollowUpVisitSectionPatch =
  | Partial<FollowUpVisitSectionState>
  | ((current: FollowUpVisitSectionState) => Partial<FollowUpVisitSectionState>);

function followUpVisitSectionReducer(
  state: FollowUpVisitSectionState,
  patch: FollowUpVisitSectionPatch,
): FollowUpVisitSectionState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function useAppointmentFollowUpVisitSectionContent({
  detail,
  appointments,
  providers,
  taxonomyNodes,
  staff,
  interpreters,
  defaultReminderUserId,
  currentUserId,
  currentUserRole,
  onCreated,
}: AppointmentFollowUpVisitSectionProps) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const appointmentText = (key: string) => t.uiText[key] ?? appointmentTextBase(key);
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("appointments_interpreter");
  const scheduleWarningLabels = useMemo(
    () => ({
      patients_assign_owner: tr.patients_assign_owner,
      common_doctor: tr.common_doctor,
      common_provider: tr.common_provider,
    }),
    [tr.common_doctor, tr.common_provider, tr.patients_assign_owner],
  );
  const defaultOwnerUserId =
    currentUserRole === "it_admin"
      ? defaultAppointmentOwnerUserId(currentUserId, currentUserRole)
      : detail.owner_user_id ?? "";
  const [sectionState, dispatchSectionState] = useReducer(
    followUpVisitSectionReducer,
    undefined,
    () => ({
      form: buildFollowUpVisitForm(
        detail,
        defaultReminderUserId,
        tr.phase_followup,
        defaultOwnerUserId,
      ),
      doctors: [],
      conflicts: null,
      error: "",
      busy: false,
    }),
  );
  const { form, doctors, conflicts, error, busy } = sectionState;
  const setForm = (nextValue: SetStateAction<FollowUpVisitFormState>) => {
    dispatchSectionState((current) => ({
      form:
        typeof nextValue === "function"
          ? nextValue(current.form)
          : nextValue,
    }));
  };

  useEffect(() => {
    dispatchSectionState({
      form: buildFollowUpVisitForm(
        detail,
        defaultReminderUserId,
        tr.phase_followup,
        defaultOwnerUserId,
      ),
      doctors: [],
      conflicts: null,
      error: "",
      busy: false,
    });
  }, [defaultOwnerUserId, defaultReminderUserId, detail, tr.phase_followup]);

  useEffect(() => {
    if (
      providerSelectionFitsAppointmentScope(
        providers,
        form.providerId,
        form.appointmentType,
        form.providerTaxonomyNodeId,
      )
    ) {
      return;
    }

    setForm((current) => ({
      ...current,
      providerId: "",
      doctorId: "",
    }));
  }, [
    form.appointmentType,
    form.providerId,
    form.providerTaxonomyNodeId,
    providers,
  ]);

  useEffect(() => {
    if (!form.providerId) {
      dispatchSectionState({ doctors: [] });
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) dispatchSectionState({ doctors: rows });
      })
      .catch(() => {
        if (active) dispatchSectionState({ doctors: [] });
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  const conflictQuery = useMemo(() => {
    if (!detail.patient_id || !form.date) return "";
    return buildConflictQuery(
      detail.patient_id,
      "",
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
    );
  }, [
    detail.patient_id,
    form.date,
    form.interpreterId,
    form.timeEnd,
    form.timeStart,
  ]);
  const debouncedConflictQuery = useDebouncedValue(conflictQuery);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      dispatchSectionState({ conflicts: null });
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) dispatchSectionState({ conflicts: value });
      })
      .catch(() => {
        if (active) dispatchSectionState({ conflicts: null });
      });
    return () => {
      active = false;
    };
  }, [debouncedConflictQuery]);

  const localWarnings = useMemo(() => {
    if (!detail.id || !form.date) return [];
    return buildLocalScheduleWarnings(
      appointments,
      {
        date: form.date,
        timeStart: form.timeStart,
        timeEnd: form.timeEnd,
        ownerUserId: form.ownerUserId || detail.owner_user_id,
        providerId: form.providerId || null,
        doctorId: form.doctorId || null,
      },
      scheduleWarningLabels,
    );
  }, [
    appointments,
    detail.id,
    detail.owner_user_id,
    form.date,
    form.doctorId,
    form.ownerUserId,
    form.providerId,
    form.timeEnd,
    form.timeStart,
    scheduleWarningLabels,
  ]);
  const ownerOptions = useMemo(
    () => filterAppointmentOwnerOptions(staff, currentUserRole, currentUserId),
    [currentUserId, currentUserRole, staff],
  );

  function applyPreset(preset: (typeof FOLLOW_UP_PRESETS)[number]) {
    const anchor = appointmentAnchorDateTime(detail);
    const shifted = shiftLocalDateTime(anchor, {
      days: "offsetDays" in preset ? preset.offsetDays : undefined,
      months: "offsetMonths" in preset ? preset.offsetMonths : undefined,
    });
    if (!shifted) return;
    const nextReminderAt = shiftLocalDateTime(shifted, { days: -3 });
    setForm((current) => ({
      ...current,
      date: shifted.slice(0, 10),
      timeStart: shifted.slice(11, 16),
      timeEnd: current.timeEnd
        ? shiftLocalDateTime(
            `${detail.date}T${detail.time_end?.slice(0, 5) ?? current.timeEnd}`,
            {
              days: "offsetDays" in preset ? preset.offsetDays : undefined,
              months:
                "offsetMonths" in preset ? preset.offsetMonths : undefined,
            },
          ).slice(11, 16)
        : current.timeEnd,
      title:
        current.title.trim() === "" || current.title.startsWith(t.phase_followup)
          ? followUpPresetTitle(preset.id)
          : current.title,
      reminderAt: nextReminderAt || current.reminderAt,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchSectionState({
      busy: true,
      error: "",
    });
    try {
      const result = await apiFetch<{
        id: string;
        conflicts?: ConflictSummary;
      }>("/appointments", {
        method: "POST",
        body: JSON.stringify({
          patient_id: detail.patient_id,
          provider_id: form.providerId || null,
          doctor_id: form.doctorId || null,
          owner_user_id: form.ownerUserId || null,
          interpreter_id: form.interpreterId || null,
          order_id: form.linkOrder ? detail.order_id : null,
          appointment_type: form.appointmentType,
          skip_medical_provider_binding:
            form.appointmentType === "medical" && !form.providerId,
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
        }),
      });

      if (result.id && form.createReminder && form.reminderUserId && form.reminderAt) {
        const followUpTitle = form.title.trim();
        await apiFetch<{ id: string }>(`/appointments/${result.id}/reminders`, {
          method: "POST",
          body: JSON.stringify({
            user_id: form.reminderUserId,
            remind_at: toRfc3339(form.reminderAt),
            title: formatUiText(t.appointments_follow_up_visit_reminder_title, {
              title: followUpTitle,
            }),
            description: formatUiText(
              t.appointments_follow_up_visit_reminder_description,
              {
                patientPid: detail.patient_pid,
                title: detail.title,
                slot: slotLabel(detail),
              },
            ),
          }),
        });
      }

      const notice = result.conflicts
        ? `${buildScheduleNotice(result.conflicts, localWarnings)} ${t.appointments_follow_up_visit_created}`
        : tr.common_active;
      dispatchSectionState({
        form: buildFollowUpVisitForm(
          detail,
          form.reminderUserId,
          tr.phase_followup,
          defaultOwnerUserId,
        ),
        busy: false,
      });
      onCreated({ id: result.id, notice });
    } catch (submitError) {
      dispatchSectionState({
        error:
          submitError instanceof Error
            ? submitError.message
            : tr.common_failed_create,
        busy: false,
      });
    }
  }

  return (
    <section className={sectionCardClass}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <AppointmentSectionHeading
          title={t.appointments_follow_up_visit_title}
          description={t.appointments_follow_up_visit_description}
        />
        <div className="flex flex-wrap gap-2">
          {FOLLOW_UP_PRESETS.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => applyPreset(preset)}
            >
              {followUpPresetLabel(preset.id)}
            </Button>
          ))}
        </div>
      </div>
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
              setForm((current) => ({ ...current, title: event.target.value }))
            }
            className={appointmentSlateInputClassName}
            required
          />
        </Field>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t.appointments_date}>
            <Input
              type="date"
              value={form.date}
              onChange={(event) =>
                setForm((current) => ({ ...current, date: event.target.value }))
              }
              className={appointmentSlateInputClassName}
              required
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
              className={appointmentSlateInputClassName}
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
              className={appointmentSlateInputClassName}
            />
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label={t.common_provider} className="md:col-span-2">
            <ProviderSelectWithTaxonomyFilter
              value={form.providerId}
              providers={providers}
              taxonomyNodes={taxonomyNodes}
              providerType={
                form.appointmentType === "medical" || form.appointmentType === "non_medical"
                  ? form.appointmentType
                  : ""
              }
              taxonomyValue={form.providerTaxonomyNodeId}
              providerPlaceholder={t.common_not_set}
              taxonomyPlaceholder={t.appointments_provider_category}
              taxonomyAllLabel={t.providers_all}
              taxonomySelectClassName={selectClassName}
              providerSelectClassName={selectClassName}
              providerLabel={(provider) => provider.name}
              onTaxonomyChange={(providerTaxonomyNodeId) => {
                setForm((current) => ({
                  ...current,
                  providerTaxonomyNodeId,
                }));
              }}
              onChange={(providerId) =>
                setForm((current) => ({
                  ...current,
                  providerId,
                  doctorId: "",
                }))
              }
              disabled={form.appointmentType === "internal"}
            />
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
                  {doctorLabel(doctor, lang)}
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
              {ownerOptions.map((member) => (
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
        <div className="grid gap-4 md:grid-cols-2">
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
              disabled={form.appointmentType !== "medical"}
            >
              {CARE_PATH_KIND_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {carePathKindLabel(value)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={t.appointments_location}>
            <Input
              value={form.location}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              className={appointmentSlateInputClassName}
            />
          </Field>
          <Field label={tr.documents_category}>
            <Input
              value={form.category}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              className={appointmentSlateInputClassName}
            />
          </Field>
        </div>
        <Field label={t.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setForm((current) => ({ ...current, notes: event.target.value }))
            }
            className={textareaClassName}
            rows={4}
            placeholder={withEllipsis(tr.patients_notes)}
          />
        </Field>
        {detail.order_id ? (
          <label className={appointmentToggleCardClassName}>
            <input
              type="checkbox"
              checked={form.linkOrder}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  linkOrder: event.target.checked,
                }))
              }
              className={cn(checkboxClass, "mt-0.5")}
            />
            <span>{tr.providers_linked_patients}</span>
          </label>
        ) : null}
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <label className={appointmentToggleCardClassName}>
            <input
              type="checkbox"
              checked={form.createReminder}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  createReminder: event.target.checked,
                }))
              }
              className={cn(checkboxClass, "mt-0.5")}
            />
            <span>{t.appointments_follow_up_visit_create_reminder}</span>
          </label>
          <Field label={tr.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.reminderUserId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderUserId: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!form.createReminder}
            >
              <option value="">{tr.common_not_set}</option>
              {staff.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name} · {roleLabel(member.role)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
        </div>
        {form.createReminder ? (
          <Field label={tr.appointments_date}>
            <Input
              type="datetime-local"
              value={form.reminderAt}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  reminderAt: event.target.value,
                }))
              }
              className={appointmentSlateInputClassName}
            />
          </Field>
        ) : null}
        <ConflictPanel conflicts={conflicts} />
        <ScheduleWarningsPanel warnings={localWarnings} />
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={busy || !form.title.trim()}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {appointmentText("appointments_create_follow_up_visit")}
          </Button>
        </div>
      </form>
    </section>
  );
}

function AppointmentFollowUpVisitSection(...args: Parameters<typeof useAppointmentFollowUpVisitSectionContent>) {
  return useAppointmentFollowUpVisitSectionContent(...args);
}

const MemoizedAppointmentFollowUpVisitSection = memo(
  AppointmentFollowUpVisitSection,
);

export { MemoizedAppointmentFollowUpVisitSection };
