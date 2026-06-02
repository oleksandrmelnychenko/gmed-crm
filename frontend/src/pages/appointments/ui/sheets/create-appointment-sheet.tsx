import {
  memo,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type FormEvent,
  type SetStateAction,
} from "react";

import { Plus, LoaderCircle } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  CONFIRMED_DISMISS_REASON,
  confirmDirtyDismiss,
} from "@/components/ui/dismissal-guard";
import { Input } from "@/components/ui/input";
import {
  Banner,
  checkboxClass,
  inputClass,
  selectClass,
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
import {
  providerSelectionFitsAppointmentScope,
} from "@/pages/appointments/model/provider-taxonomy";
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
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
import { hasAppointmentFormChanges } from "@/pages/appointments/model/form-factories";
import { filterAppointmentOwnerOptions } from "@/pages/appointments/model/staff-roles";
import { parsePositiveIntegerInput } from "@/pages/appointments/model/workflow-helpers";
import {
  AppointmentEditorSheet,
  type AppointmentEditorSheetOpenChangeDetails,
  Field,
} from "@/pages/appointments/ui/shared/workspace-primitives";
import {
  ConflictPanel,
  ScheduleWarningsPanel,
} from "@/pages/appointments/ui/shared/schedule-panels";

const createSheetInputClassName = inputClass;
const createSheetSelectClassName = selectClass;
const createSheetTextareaClassName = textareaClass;

export type CreateAppointmentSheetProps = {
  open: boolean;
  title: string;
  seed: AppointmentFormState;
  draft?: AppointmentFormState | null;
  appointments: AppointmentListItem[];
  patients: PatientSummary[];
  providers: ProviderSummary[];
  providersError?: string;
  providersLoading?: boolean;
  taxonomyNodes: ProviderTaxonomyNode[];
  interpreters: InterpreterOption[];
  staff: StaffOption[];
  userId?: string;
  userRole?: string;
  onOpenChange: (open: boolean) => void;
  onDraftChange?: (draft: AppointmentFormState) => void;
  onDraftDiscard?: () => void;
  onCreated: (result: { id: string; notice: string }) => void;
};

type CreateAppointmentSheetState = {
  form: AppointmentFormState;
  baseline: AppointmentFormState;
  doctors: DoctorOption[];
  conflicts: ConflictSummary | null;
  error: string;
  busy: boolean;
};

function isConfirmedDismiss(
  eventDetails?: AppointmentEditorSheetOpenChangeDetails,
) {
  return (
    (eventDetails as { reason?: string } | undefined)?.reason ===
    CONFIRMED_DISMISS_REASON
  );
}

type CreateAppointmentSheetPatch =
  | Partial<CreateAppointmentSheetState>
  | ((current: CreateAppointmentSheetState) => Partial<CreateAppointmentSheetState>);

function createAppointmentSheetReducer(
  state: CreateAppointmentSheetState,
  patch: CreateAppointmentSheetPatch,
): CreateAppointmentSheetState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function resolveStateAction<T>(value: SetStateAction<T>, current: T) {
  return typeof value === "function"
    ? (value as (currentValue: T) => T)(current)
    : value;
}

function useCreateAppointmentSheetContent({
  open,
  title,
  seed,
  draft,
  appointments,
  patients,
  providers,
  providersError = "",
  providersLoading = false,
  taxonomyNodes,
  interpreters,
  staff,
  userId,
  userRole,
  onOpenChange,
  onDraftChange,
  onDraftDiscard,
  onCreated,
}: CreateAppointmentSheetProps) {
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const interpreterFieldLabel =
    tr.role_interpreter ??
    appointmentText("appointments_interpreter");
  const [sheetState, dispatchSheetState] = useReducer(
    createAppointmentSheetReducer,
    undefined,
    () => ({
      form: draft ?? seed,
      baseline: draft ?? seed,
      doctors: [],
      conflicts: null,
      error: "",
      busy: false,
    }),
  );
  const { form, baseline, doctors, conflicts, error, busy } = sheetState;
  const latestDraftRef = useRef<AppointmentFormState | null>(draft ?? null);
  const wasOpenRef = useRef(false);
  const setForm = (nextValue: SetStateAction<AppointmentFormState>) => {
    dispatchSheetState((current) => ({
      form: resolveStateAction(nextValue, current.form),
      conflicts: current.conflicts ? null : current.conflicts,
      error: current.error ? "" : current.error,
    }));
  };
  const isDirty = useMemo(
    () => hasAppointmentFormChanges(form, baseline),
    [baseline, form],
  );

  useEffect(() => {
    latestDraftRef.current = draft ?? null;
  }, [draft]);

  useEffect(() => {
    if (open) {
      onDraftChange?.(form);
    }
  }, [form, onDraftChange, open]);

  function requestClose() {
    if (confirmDirtyDismiss(isDirty, t.common_overlay_dismiss_blocked)) {
      onDraftDiscard?.();
      onOpenChange(false);
    }
  }

  function handleEditorOpenChange(
    nextOpen: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) {
    if (!nextOpen && isConfirmedDismiss(eventDetails)) {
      onDraftDiscard?.();
    }

    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const nextForm = latestDraftRef.current ?? seed;
      dispatchSheetState({
        form: nextForm,
        baseline: nextForm,
        doctors: [],
        conflicts: null,
        error: "",
        busy: false,
      });
    }
    wasOpenRef.current = open;
  }, [open, seed]);

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
  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === form.providerId) ?? null,
    [form.providerId, providers],
  );
  const ownerOptions = useMemo(
    () => {
      const filtered = filterAppointmentOwnerOptions(staff, userRole, userId);

      if (
        !form.ownerUserId ||
        filtered.some((member) => member.id === form.ownerUserId)
      ) {
        return filtered;
      }

      const currentOwner = staff.find((member) => member.id === form.ownerUserId);
      if (currentOwner) {
        return [currentOwner, ...filtered];
      }

      if (userId && form.ownerUserId === userId && userRole) {
        return [
          {
            id: userId,
            name: appointmentText("patients_current_user"),
            role: userRole,
          },
          ...filtered,
        ];
      }

      return filtered;
    },
    [form.ownerUserId, staff, userId, userRole],
  );
  useEffect(() => {
    if (providersLoading && providers.length === 0) {
      return;
    }
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
    providersLoading,
  ]);
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

  useEffect(() => {
    if (!form.providerId) {
      dispatchSheetState((current) => ({
        doctors: [],
        form: current.form.doctorId
          ? { ...current.form, doctorId: "" }
          : current.form,
      }));
      return;
    }
    let active = true;
    getProviderDoctors(form.providerId)
      .then((rows) => {
        if (active) dispatchSheetState({ doctors: rows });
      })
      .catch(() => {
        if (active) dispatchSheetState({ doctors: [] });
      });
    return () => {
      active = false;
    };
  }, [form.providerId]);

  useEffect(() => {
    if (!debouncedConflictQuery) {
      dispatchSheetState({ conflicts: null });
      return;
    }
    let active = true;
    apiFetch<ConflictSummary>(debouncedConflictQuery)
      .then((value) => {
        if (active) dispatchSheetState({ conflicts: value });
      })
      .catch(() => {
        if (active) dispatchSheetState({ conflicts: null });
      });
    return () => {
      active = false;
    };
  }, [debouncedConflictQuery]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    dispatchSheetState({
      busy: true,
      error: "",
    });
    try {
      if (!form.patientId) {
        dispatchSheetState({
          error: `${t.orders_patient}: ${t.cf_required}`,
          busy: false,
        });
        return;
      }
      if (!form.title.trim()) {
        dispatchSheetState({
          error: `${t.appointments_title_col}: ${t.cf_required}`,
          busy: false,
        });
        return;
      }
      if (!form.date) {
        dispatchSheetState({
          error: `${t.appointments_date}: ${t.cf_required}`,
          busy: false,
        });
        return;
      }
      if (
        form.appointmentType === "medical" &&
        !form.providerId &&
        !form.skipMedicalProviderBinding
      ) {
        dispatchSheetState({
          error: appointmentText("appointments_medical_provider_required"),
          busy: false,
        });
        return;
      }
      const repeatInterval = parsePositiveIntegerInput(form.repeatInterval);
      const repeatCount = parsePositiveIntegerInput(form.repeatCount);
      if (form.repeatEnabled) {
        if (!repeatInterval) {
          dispatchSheetState({
            error: t.appointments_repeat_interval_error,
            busy: false,
          });
          return;
        }
        if (!repeatCount && !form.repeatUntil) {
          dispatchSheetState({
            error: t.appointments_repeat_require_end_error,
            busy: false,
          });
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
          skip_medical_provider_binding:
            form.appointmentType === "medical" &&
            !form.providerId &&
            form.skipMedicalProviderBinding,
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
      dispatchSheetState({
        error:
          submitError instanceof Error
            ? submitError.message
            : appointmentText("appointments_failed_to_create_appointment"),
        busy: false,
      });
    }
  }

  function sectionTitle(label: string) {
    return (
      <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
        <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
        <span>{label}</span>
      </h3>
    );
  }

  return (
    <AppointmentEditorSheet
      open={open}
      onOpenChange={handleEditorOpenChange}
      dirty={isDirty}
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
            onClick={requestClose}
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
                {sectionTitle(appointmentText("appointments_appointment_and_timing"))}
                <div className="grid gap-4 md:grid-cols-3">
                  <Field compact label={t.orders_patient}>
                    <NativeComboboxSelect
                      value={form.patientId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          patientId: event.target.value,
                        }))
                      }
                      className={createSheetSelectClassName}
                    >
                      <option value="">{t.orders_patient}</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patient.patient_id} · {patientName(patient)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field compact label={t.appointments_type}>
                    <NativeComboboxSelect
                      value={form.appointmentType}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          appointmentType:
                            event.target.value as AppointmentKind,
                          carePathKind:
                            event.target.value === "medical" ? current.carePathKind : "regular",
                          providerTaxonomyNodeId: "",
                          providerId: event.target.value === "internal" ? "" : current.providerId,
                          doctorId: event.target.value === "internal" ? "" : current.doctorId,
                          skipMedicalProviderBinding:
                            event.target.value === "medical"
                              ? current.skipMedicalProviderBinding
                              : false,
                        }))
                      }
                      className={createSheetSelectClassName}
                    >
                      {TYPE_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {appointmentTypeLabel(value, tr)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field
                    compact
                    label={appointmentText("appointments_care_path")}
                  >
                    <NativeComboboxSelect
                      value={form.carePathKind}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          carePathKind:
                            event.target.value as AppointmentCarePathKind,
                        }))
                      }
                      disabled={form.appointmentType !== "medical"}
                      className={createSheetSelectClassName}
                    >
                      {CARE_PATH_KIND_OPTIONS.map((value) => (
                        <option key={value} value={value}>
                          {carePathKindLabel(value)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
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
                  <label
                    htmlFor="appointment-repeat-enabled"
                    aria-label={t.appointments_repeat_this}
                    className="flex items-start gap-3 text-sm text-foreground"
                  >
                    <input
                      id="appointment-repeat-enabled"
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
                      className={cn(checkboxClass, "mt-0.5")}
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
                      <Field compact label={t.appointments_repeat_frequency}>
                        <NativeComboboxSelect
                          value={form.repeatFrequency}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              repeatFrequency:
                                event.target.value as AppointmentRecurrenceFrequency,
                            }))
                          }
                          className={createSheetSelectClassName}
                        >
                          {RECURRENCE_FREQUENCY_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {recurrenceFrequencyLabel(value)}
                            </option>
                          ))}
                        </NativeComboboxSelect>
                      </Field>
                      <Field compact label={t.appointments_repeat_every}>
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
                        label={appointmentText("appointments_total_occurrences")}
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
                          className={createSheetInputClassName}
                        />
                      </Field>
                    </div>
                  ) : null}
                </div>
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                {sectionTitle(appointmentText("appointments_provider_and_doctor"))}
                {providersError ? (
                  <Banner tone="error">{providersError}</Banner>
                ) : null}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="md:col-span-2">
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
                      providerPlaceholder={
                        providersLoading ? t.common_loading : t.common_not_set
                      }
                      taxonomyPlaceholder={t.appointments_provider_category}
                      taxonomyAllLabel={t.providers_all}
                      taxonomyLabel={t.appointments_provider_category}
                      providerSelectLabel={t.common_provider}
                      taxonomySelectClassName={createSheetSelectClassName}
                      providerSelectClassName={createSheetSelectClassName}
                      providerDisabled={providersLoading && providers.length === 0}
                      providerLabel={(provider) => providerLabel(provider)}
                      onTaxonomyChange={(providerTaxonomyNodeId) => {
                        setForm((current) => ({
                          ...current,
                          providerTaxonomyNodeId,
                        }));
                      }}
                      onChange={(providerId) => {
                        const provider = providers.find((item) => item.id === providerId);
                        setForm((current) => ({
                          ...current,
                          providerId,
                          doctorId: "",
                          skipMedicalProviderBinding: providerId
                            ? false
                            : current.skipMedicalProviderBinding,
                          location:
                            provider && !current.location.trim()
                              ? providerLabel(provider)
                              : current.location,
                        }));
                      }}
                      disabled={form.appointmentType === "internal"}
                    />
                  </div>
                  <Field compact label={t.common_doctor}>
                    <NativeComboboxSelect
                      value={form.doctorId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          doctorId: event.target.value,
                        }))
                      }
                      disabled={!form.providerId}
                      className={createSheetSelectClassName}
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
                {form.appointmentType === "medical" ? (
                  <div className="space-y-2">
                    <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-foreground">
                      <input
                        id="appointment-skip-provider-binding"
                        type="checkbox"
                        checked={form.skipMedicalProviderBinding}
                        aria-labelledby="appointment-skip-provider-binding-label"
                        aria-describedby="appointment-skip-provider-binding-hint"
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            skipMedicalProviderBinding: event.target.checked,
                          }))
                        }
                        disabled={Boolean(form.providerId)}
                        className={cn(checkboxClass, "mt-0.5")}
                      />
                      <span>
                        <span
                          id="appointment-skip-provider-binding-label"
                          className="block font-medium text-foreground"
                        >
                          {appointmentText("appointments_medical_provider_opt_out")}
                        </span>
                        <span
                          id="appointment-skip-provider-binding-hint"
                          className="block text-xs text-muted-foreground"
                        >
                          {appointmentText("appointments_medical_provider_opt_out_hint")}
                        </span>
                      </span>
                    </div>
                    {!form.providerId && !form.skipMedicalProviderBinding ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        {appointmentText("appointments_medical_provider_required_hint")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
                {sectionTitle(appointmentText("appointments_coordination_and_notes"))}
                <div className="grid gap-4 md:grid-cols-2">
                  <Field compact label={t.patients_assign_owner}>
                    <NativeComboboxSelect
                      value={form.ownerUserId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          ownerUserId: event.target.value,
                        }))
                      }
                      className={createSheetSelectClassName}
                    >
                      <option value="">{t.common_not_set}</option>
                      {ownerOptions.map((member) => (
                        <option key={member.id} value={member.id}>
                          {staffLabel(member)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                  </Field>
                  <Field compact label={interpreterFieldLabel}>
                    <NativeComboboxSelect
                      value={form.interpreterId}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          interpreterId: event.target.value,
                        }))
                      }
                      className={createSheetSelectClassName}
                    >
                      <option value="">{tr.common_not_set}</option>
                      {interpreters.map((member) => (
                        <option key={member.id} value={member.id}>
                          {staffLabel(member)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
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
                      placeholder={
                        selectedProvider
                          ? providerLabel(selectedProvider)
                          : appointmentText("appointments_location")
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

function CreateAppointmentSheet(...args: Parameters<typeof useCreateAppointmentSheetContent>) {
  return useCreateAppointmentSheetContent(...args);
}

export const MemoizedCreateAppointmentSheet = memo(
  CreateAppointmentSheet,
  (prev, next) =>
    prev.open === next.open &&
    prev.seed === next.seed &&
    prev.draft === next.draft &&
    prev.appointments === next.appointments &&
    prev.patients === next.patients &&
    prev.providers === next.providers &&
    prev.providersError === next.providersError &&
    prev.providersLoading === next.providersLoading &&
    prev.taxonomyNodes === next.taxonomyNodes &&
    prev.interpreters === next.interpreters &&
    prev.staff === next.staff &&
    prev.userId === next.userId &&
    prev.userRole === next.userRole &&
    prev.onDraftChange === next.onDraftChange &&
    prev.onDraftDiscard === next.onDraftDiscard &&
    prev.title === next.title &&
    prev.onOpenChange === next.onOpenChange &&
    prev.onCreated === next.onCreated,
);
