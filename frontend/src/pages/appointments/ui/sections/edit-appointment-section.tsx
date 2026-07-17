import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { LoaderCircle, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DirtyDismissConfirmDialog } from "@/components/ui/dirty-dismiss-confirm-dialog";
import { isInternalOverlayInteractionEvent } from "@/components/ui/dismissal-guard";
import {
  Banner,
  checkboxClass,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
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
  providerSelectionFitsAppointmentScope,
} from "@/pages/appointments/model/provider-taxonomy";
import {
  buildEditAppointmentForm,
  hasAppointmentFormChanges,
  restoreEditAppointmentRecurrenceFields,
} from "@/pages/appointments/model/form-factories";
import {
  buildEditAppointmentUpdatePayload,
  defaultEditAppointmentRecurrenceScope,
  validateEditAppointmentForm,
} from "@/pages/appointments/model/edit-payload";
import { hasValidAppointmentTimeRange } from "@/pages/appointments/model/date-time";
import {
  appointmentText,
  appointmentTypeLabel,
  carePathKindLabel,
  checklistPhaseLabel,
  doctorLabel,
  normalizeCarePathKindForAppointmentType,
  roleLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import {
  buildLocalScheduleWarnings,
  buildScheduleNotice,
  formatScheduleConflictError,
} from "@/pages/appointments/model/schedule-warnings";
import { filterAppointmentOwnerOptions } from "@/pages/appointments/model/staff-roles";
import {
  recurrenceFrequencyLabel,
} from "@/pages/appointments/model/recurrence";
import type {
  AppointmentCarePathKind,
  AppointmentDetail,
  AppointmentFormState,
  AppointmentKind,
  AppointmentListItem,
  AppointmentPermissions,
  AppointmentRecurrenceFrequency,
  AppointmentRecurringActionScope,
  ConflictSummary,
  DoctorOption,
  InterpreterOption,
  ProviderSummary,
  StaffOption,
} from "@/pages/appointments/model/types";
import type { ProviderTaxonomyNode } from "@/pages/providers/model/types";
import { ProviderSelectWithTaxonomyFilter } from "@/pages/providers/ui/provider-select-with-taxonomy-filter";
import {
  CARE_PATH_KIND_OPTIONS,
  CHECKLIST_PHASES,
  TYPE_OPTIONS,
} from "@/pages/appointments/model/constants";
import {
  AppointmentEditorSheet,
  Field,
  type AppointmentEditorSheetOpenChangeDetails,
} from "@/pages/appointments/ui/shared/workspace-primitives";
import {
  ConflictPanel,
  ScheduleWarningsPanel,
} from "@/pages/appointments/ui/shared/schedule-panels";

type EditAppointmentSectionProps = {
  detail: AppointmentDetail;
  appointments: AppointmentListItem[];
  providers: ProviderSummary[];
  providersError?: string;
  taxonomyNodes: ProviderTaxonomyNode[];
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  permissions?: Pick<
    AppointmentPermissions,
    "canEditSchedule" | "canManageStatus" | "canManageChecklist"
  >;
  currentUserId?: string;
  currentUserRole?: string;
  showSummary?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

type EditAppointmentOpenSnapshot = {
  form: AppointmentFormState;
  recurrenceScope: AppointmentRecurringActionScope;
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
    recurrenceScope: defaultEditAppointmentRecurrenceScope(),
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

function resolveStateAction<T>(value: SetStateAction<T>, current: T) {
  return typeof value === "function"
    ? (value as (currentValue: T) => T)(current)
    : value;
}

function formatEditAppointmentError(
  error: unknown,
  translations: { uiText: Record<string, string> },
  fallback: string,
) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("recurrence rule updates require following or series scope")) {
    return translations.uiText.appointments_recurring_scope_required ?? message;
  }
  return formatScheduleConflictError(error, fallback);
}

const selectClassName = appointmentSelectControlClassName;
const inputClassName = appointmentSlateInputClassName;

function editSheetSectionTitle(label: string) {
  return (
    <h3 className="inline-flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{label}</span>
    </h3>
  );
}

function editOverviewTitle(title: ReactNode) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
      <span>{title}</span>
    </span>
  );
}

function EditOverviewLine({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg py-2">
      <span className="shrink-0 text-sm text-muted-foreground">{label}</span>
      <span className="h-px min-w-6 flex-1 bg-border/70" />
      <span className="max-w-[48%] text-right text-sm font-semibold leading-tight text-foreground">
        {value}
      </span>
    </div>
  );
}

function defaultProviderTaxonomyNodeId(provider: ProviderSummary | null | undefined) {
  return (
    provider?.taxonomy_node_id?.trim() ||
    provider?.taxonomy_node_ids?.find((value) => value.trim()) ||
    provider?.taxonomy_path?.at(-1)?.id?.trim() ||
    ""
  );
}

function EditAppointmentSection(props: EditAppointmentSectionProps) {
  return <EditAppointmentSectionContent key={props.detail.id} {...props} />;
}

function useEditAppointmentSectionContentContent({
  detail,
  appointments,
  providers,
  providersError = "",
  taxonomyNodes,
  staff,
  interpreters,
  permissions,
  currentUserId,
  currentUserRole,
  showSummary = true,
  open,
  onOpenChange,
  onSaved,
}: EditAppointmentSectionProps) {
  const { t, lang } = useLang();
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
  const [internalSheetOpen, setInternalSheetOpen] = useState(false);
  const [openSnapshot, setOpenSnapshot] =
    useState<EditAppointmentOpenSnapshot | null>(null);
  const wasSheetOpenRef = useRef(false);
  const hasUnsavedChangesRef = useRef(false);
  const suppressNextOutsideDismissRef = useRef(false);
  const pendingDismissConfirmActionRef = useRef<(() => void) | null>(null);
  const [dismissConfirmOpen, setDismissConfirmOpen] = useState(false);
  const sheetOpen = open ?? internalSheetOpen;
  const canManageStatus = permissions?.canManageStatus ?? false;
  const canManageChecklist = permissions?.canManageChecklist ?? false;
  const canEditAppointmentType = canManageStatus;
  const hasUnsavedChanges = useMemo(
    () =>
      sheetOpen &&
      openSnapshot !== null &&
      (hasAppointmentFormChanges(form, openSnapshot.form) ||
        recurrenceScope !== openSnapshot.recurrenceScope),
    [form, openSnapshot, recurrenceScope, sheetOpen],
  );
  const createOpenSnapshot = useCallback(() => ({
    form: { ...form },
    recurrenceScope,
  }), [form, recurrenceScope]);
  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);
  useEffect(() => {
    if (sheetOpen && !wasSheetOpenRef.current) {
      setOpenSnapshot(createOpenSnapshot());
      hasUnsavedChangesRef.current = false;
      suppressNextOutsideDismissRef.current = false;
      pendingDismissConfirmActionRef.current = null;
      setDismissConfirmOpen(false);
    }
    if (!sheetOpen && wasSheetOpenRef.current) {
      setOpenSnapshot(null);
      hasUnsavedChangesRef.current = false;
      suppressNextOutsideDismissRef.current = false;
      pendingDismissConfirmActionRef.current = null;
      setDismissConfirmOpen(false);
    }
    wasSheetOpenRef.current = sheetOpen;
  }, [createOpenSnapshot, sheetOpen]);
  useEffect(() => {
    if (sheetOpen) {
      return;
    }
    dispatchEditState({
      type: "patch",
      value: {
        form: buildEditAppointmentForm(detail),
        recurrenceScope: defaultEditAppointmentRecurrenceScope(),
        conflicts: null,
        error: "",
        busy: false,
      },
    });
  }, [detail, sheetOpen]);
  const setForm = (value: SetStateAction<AppointmentFormState>) =>
    dispatchEditState(createEditAppointmentFieldAction("form", value));
  const updateDirtyRef = (
    nextForm: AppointmentFormState,
    nextRecurrenceScope: AppointmentRecurringActionScope,
  ) => {
    hasUnsavedChangesRef.current =
      sheetOpen &&
      openSnapshot !== null &&
      (hasAppointmentFormChanges(nextForm, openSnapshot.form) ||
        nextRecurrenceScope !== openSnapshot.recurrenceScope);
  };
  const setFormFromUser = (value: SetStateAction<AppointmentFormState>) => {
    dispatchEditState({
      type: "update",
      updater: (state) => {
        const next = resolveStateAction(value, state.form);

        updateDirtyRef(next, state.recurrenceScope);

        return {
          ...state,
          form: next,
          conflicts: state.conflicts ? null : state.conflicts,
          error: state.error ? "" : state.error,
        };
      },
    });
  };
  const setRecurrenceScopeFromUser = (
    value: SetStateAction<AppointmentRecurringActionScope>,
  ) => {
    dispatchEditState({
      type: "update",
      updater: (state) => {
        const next = resolveStateAction(value, state.recurrenceScope);
        const nextForm =
          next === "single"
            ? restoreEditAppointmentRecurrenceFields(state.form, detail)
            : state.form;

        updateDirtyRef(nextForm, next);

        return {
          ...state,
          form: nextForm,
          recurrenceScope: next,
          conflicts: state.conflicts ? null : state.conflicts,
          error: state.error ? "" : state.error,
        };
      },
    });
  };
  const setDoctors = (value: SetStateAction<DoctorOption[]>) =>
    dispatchEditState(createEditAppointmentFieldAction("doctors", value));
  const setConflicts = (value: SetStateAction<ConflictSummary | null>) =>
    dispatchEditState(createEditAppointmentFieldAction("conflicts", value));
  const setError = (value: SetStateAction<string>) =>
    dispatchEditState(createEditAppointmentFieldAction("error", value));
  const setBusy = (value: SetStateAction<boolean>) =>
    dispatchEditState(createEditAppointmentFieldAction("busy", value));
  useEffect(() => {
    if (!providers.length) {
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
  ]);

  useEffect(() => {
    if (!providers.length || !form.providerId || form.providerTaxonomyNodeId) {
      return;
    }

    const selectedProvider = providers.find((provider) => provider.id === form.providerId);
    const taxonomyNodeId = defaultProviderTaxonomyNodeId(selectedProvider);
    if (!taxonomyNodeId) {
      return;
    }

    setForm((current) =>
      current.providerTaxonomyNodeId || current.providerId !== form.providerId
        ? current
        : { ...current, providerTaxonomyNodeId: taxonomyNodeId },
    );
  }, [form.providerId, form.providerTaxonomyNodeId, providers]);

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
  const ownerOptions = useMemo(() => {
    const filtered = filterAppointmentOwnerOptions(
      staff,
      currentUserRole,
      currentUserId,
    );
    if (
      !form.ownerUserId ||
      filtered.some((member) => member.id === form.ownerUserId)
    ) {
      return filtered;
    }

    const currentOwner = staff.find((member) => member.id === form.ownerUserId);
    return currentOwner ? [currentOwner, ...filtered] : filtered;
  }, [currentUserId, currentUserRole, form.ownerUserId, staff]);
  const conflictQuery = useMemo(() => {
    if (!detail.patient_id || !form.date) return "";
    return buildConflictQuery(
      detail.patient_id,
      detail.id,
      form.date,
      form.timeStart,
      form.timeEnd,
      form.interpreterId,
      form.doctorId,
    );
  }, [
    detail.id,
    detail.patient_id,
    form.date,
    form.timeStart,
    form.timeEnd,
    form.interpreterId,
    form.doctorId,
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
      const validation = validateEditAppointmentForm(
        detail,
        form,
        recurrenceScope,
        {
          titleRequired: `${t.appointments_title_col}: ${t.cf_required}`,
          dateRequired: `${t.appointments_date}: ${t.cf_required}`,
          medicalProviderRequired: appointmentText(
            "appointments_medical_provider_required",
          ),
          timePairError: t.appointments_time_pair_error,
          timeRangeError: t.appointments_time_range_error,
          repeatIntervalError: t.appointments_repeat_interval_error,
          repeatRequireEndError: t.appointments_repeat_require_end_error,
        },
      );
      if (validation.error) {
        setError(validation.error);
        return;
      }
      const { payload: updatePayload } = buildEditAppointmentUpdatePayload({
        detail,
        form,
        recurrenceScope,
        canEditAppointmentType,
        canManageChecklist,
      });

      const result = await apiFetch<{
        ok: boolean;
        conflicts?: ConflictSummary;
      }>(`/appointments/${detail.id}/update`, {
        method: "POST",
        body: JSON.stringify(updatePayload),
      });
      closeSheet(false);
      onSaved(buildScheduleNotice(result.conflicts, localWarnings));
    } catch (submitError) {
      setError(
        formatEditAppointmentError(
          submitError,
          t,
          appointmentText("appointments_failed_to_save_schedule"),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function resetEditFormState() {
    setOpenSnapshot(null);
    hasUnsavedChangesRef.current = false;
    suppressNextOutsideDismissRef.current = false;
    pendingDismissConfirmActionRef.current = null;
    setDismissConfirmOpen(false);
    dispatchEditState({
      type: "patch",
      value: {
        form: buildEditAppointmentForm(detail),
        recurrenceScope: defaultEditAppointmentRecurrenceScope(),
        conflicts: null,
        error: "",
        busy: false,
      },
    });
  }

  function setSheetOpen(open: boolean) {
    if (onOpenChange) {
      onOpenChange(open);
    } else {
      setInternalSheetOpen(open);
    }
  }

  function openSheet() {
    setOpenSnapshot(createOpenSnapshot());
    hasUnsavedChangesRef.current = false;
    suppressNextOutsideDismissRef.current = false;
    pendingDismissConfirmActionRef.current = null;
    setDismissConfirmOpen(false);
    setError("");
    setSheetOpen(true);
  }

  function requestDismissConfirm(onConfirm: () => void) {
    pendingDismissConfirmActionRef.current = onConfirm;
    setDismissConfirmOpen(true);
  }

  function handleConfirmDismiss() {
    const action = pendingDismissConfirmActionRef.current;

    pendingDismissConfirmActionRef.current = null;
    setDismissConfirmOpen(false);
    action?.();
  }

  function handleCancelDismiss() {
    pendingDismissConfirmActionRef.current = null;
    setDismissConfirmOpen(false);
  }

  function closeSheet(
    confirmBeforeClose: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) {
    if (confirmBeforeClose && suppressNextOutsideDismissRef.current) {
      suppressNextOutsideDismissRef.current = false;
      eventDetails?.cancel?.();
      return;
    }

    if (
      confirmBeforeClose &&
      (hasUnsavedChangesRef.current || hasUnsavedChanges)
    ) {
      eventDetails?.cancel?.();
      requestDismissConfirm(() => closeSheet(false));
      return;
    }
    setSheetOpen(false);
    resetEditFormState();
  }

  function handleSheetOpenChange(
    open: boolean,
    eventDetails?: AppointmentEditorSheetOpenChangeDetails,
  ) {
    if (open) {
      openSheet();
      return;
    }
    closeSheet(true, eventDetails);
  }

  function requestSheetClose() {
    closeSheet(true);
  }

  useEffect(() => {
    if (!sheetOpen) {
      return;
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (isInternalOverlayInteractionEvent(event)) {
        return;
      }

      const sheetContents = Array.from(
        document.querySelectorAll<HTMLElement>('[data-slot="sheet-content"]'),
      );
      const activeSheetContent = sheetContents[sheetContents.length - 1];

      if (!activeSheetContent || activeSheetContent.contains(target)) {
        return;
      }

      if (!(hasUnsavedChangesRef.current || hasUnsavedChanges)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      suppressNextOutsideDismissRef.current = true;

      requestDismissConfirm(() => closeSheet(false));

      window.setTimeout(() => {
        suppressNextOutsideDismissRef.current = false;
      }, 250);
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [closeSheet, hasUnsavedChanges, sheetOpen, t.common_overlay_dismiss_blocked]);

  const providerSummary =
    providers.find((provider) => provider.id === form.providerId)?.name ??
    detail.provider_name ??
    t.common_not_set;
  const selectedDoctor = doctors.find((doctor) => doctor.id === form.doctorId);
  const doctorSummary = selectedDoctor
    ? doctorLabel(selectedDoctor, lang)
    : detail.doctor_name ?? t.common_not_set;
  const ownerSummary =
    staff.find((member) => member.id === form.ownerUserId)?.name ??
    detail.owner_name ??
    t.common_not_set;
  const interpreterSummary =
    interpreters.find((member) => member.id === form.interpreterId)?.name ??
    detail.interpreter_name ??
    t.common_not_set;
  const timeSummary =
    [form.timeStart, form.timeEnd].filter(Boolean).join(" - ") ||
    t.common_not_set;

  return (
    <>
      {showSummary ? (
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className={tokens.text.sectionTitle}>
            {editOverviewTitle(t.appointments_title)}
          </h2>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-8 rounded-lg"
            onClick={openSheet}
            aria-label={t.common_edit}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="grid gap-x-8 gap-y-1 md:grid-cols-2">
            <EditOverviewLine
              label={t.appointments_title_col}
              value={form.title || detail.title}
            />
            <EditOverviewLine
              label={appointmentText("appointments_care_path")}
              value={carePathKindLabel(form.carePathKind)}
            />
            <EditOverviewLine
              label={appointmentText("appointments_status")}
              value={statusLabel(form.status)}
            />
            <EditOverviewLine
              label={t.appointments_type}
              value={appointmentTypeLabel(form.appointmentType, tr)}
            />
            <EditOverviewLine
              label={t.orders_phase}
              value={checklistPhaseLabel(form.checklistPhase)}
            />
            <EditOverviewLine
              label={t.appointments_date}
              value={form.date || t.common_not_set}
            />
            <EditOverviewLine label={t.appointments_time} value={timeSummary} />
            <EditOverviewLine label={t.common_provider} value={providerSummary} />
            <EditOverviewLine label={t.common_doctor} value={doctorSummary} />
            <EditOverviewLine
              label={t.patients_assign_owner}
              value={ownerSummary}
            />
            <EditOverviewLine
              label={interpreterFieldLabel}
              value={interpreterSummary}
            />
          </div>

          <div className="space-y-3">
            <h3 className={tokens.text.sectionTitle}>
              {editOverviewTitle(t.appointments_location)}
            </h3>
            <div className="rounded-xl border border-border bg-background/60 p-4 text-sm font-medium leading-snug text-foreground">
              {form.location.trim() || t.common_not_set}
            </div>
          </div>
        </div>
      </section>
      ) : null}

      <AppointmentEditorSheet
        open={sheetOpen}
        onOpenChange={handleSheetOpenChange}
        allowImplicitDismissal
        dirty={hasUnsavedChanges}
        title={t.appointments_title}
        maxWidthClassName="sm:max-w-[760px]"
        onSubmit={handleSubmit}
        footerError={error || undefined}
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={requestSheetClose}
            >
              {t.common_cancel}
            </Button>
            <Button
              type="submit"
              size="sm"
              className="h-8 rounded-lg gap-1.5"
              disabled={busy}
            >
              {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {busy ? t.patients_saving : t.common_save}
            </Button>
          </>
        }
      >
        <div className="space-y-4 rounded-xl">
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
        {editSheetSectionTitle(appointmentText("appointments_appointment_and_timing"))}
        <div className="grid gap-4 md:grid-cols-3">
        <Field compact required label={t.appointments_title_col}>
          <Input
            value={form.title}
            required
            aria-invalid={!form.title.trim()}
            onChange={(event) =>
              setFormFromUser((current) => ({
                ...current,
                title: event.target.value,
              }))
            }
            className={inputClassName}
          />
        </Field>
        <Field compact label={t.appointments_type}>
          <NativeComboboxSelect
            value={form.appointmentType}
            onChange={(event) => {
              const appointmentType = event.target.value as AppointmentKind;
              setFormFromUser((current) => ({
                ...current,
                appointmentType,
                providerTaxonomyNodeId: "",
                providerId: appointmentType === "internal" ? "" : current.providerId,
                doctorId: appointmentType === "internal" ? "" : current.doctorId,
                skipMedicalProviderBinding:
                  appointmentType === "medical"
                    ? current.skipMedicalProviderBinding
                    : false,
                carePathKind: normalizeCarePathKindForAppointmentType(
                  appointmentType,
                  current.carePathKind,
                ),
              }));
            }}
            className={selectClassName}
            disabled={!canEditAppointmentType}
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
              setFormFromUser((current) => ({
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
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Field compact required label={t.appointments_date}>
            <Input
              type="date"
              value={form.date}
              required
              aria-invalid={!form.date}
              onChange={(event) =>
                setFormFromUser((current) => ({
                  ...current,
                  date: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
          <Field compact label={appointmentText("appointments_start")}>
            <Input
              type="time"
              value={form.timeStart}
              aria-invalid={
                !hasValidAppointmentTimeRange(form.timeStart, form.timeEnd)
              }
              onChange={(event) =>
                setFormFromUser((current) => ({
                  ...current,
                  timeStart: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
          <Field compact label={appointmentText("appointments_end")}>
            <Input
              type="time"
              value={form.timeEnd}
              aria-invalid={
                !hasValidAppointmentTimeRange(form.timeStart, form.timeEnd)
              }
              onChange={(event) =>
                setFormFromUser((current) => ({
                  ...current,
                  timeEnd: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
        </div>
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
        {editSheetSectionTitle(appointmentText("appointments_status_and_responsibilities"))}
        <div className="grid gap-4">
          <Field compact label={t.orders_phase}>
            <NativeComboboxSelect
              value={form.checklistPhase}
              onChange={(event) =>
                setFormFromUser((current) => ({
                  ...current,
                  checklistPhase: event.target.value,
                }))
              }
              className={selectClassName}
              disabled={!canManageChecklist}
            >
              {CHECKLIST_PHASES.map((phase) => (
                <option key={phase} value={phase}>
                  {checklistPhaseLabel(phase)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
        </div>
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
        {editSheetSectionTitle(appointmentText("appointments_provider_and_doctor"))}
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
              providerPlaceholder={t.common_not_set}
              taxonomyPlaceholder={t.appointments_provider_category}
              taxonomyAllLabel={t.providers_all}
              noProvidersLabel={t.providers_none_in_category}
              restrictTaxonomyToAvailable
              showInsuranceFilter
              insuranceLabel={t.patients_insurance_provider}
              insurancePlaceholder={t.providers_all}
              taxonomyLabel={t.appointments_provider_category}
              providerSelectLabel={t.common_provider}
              taxonomySelectClassName={selectClassName}
              providerSelectClassName={selectClassName}
              providerLabel={(provider) => provider.name}
              onTaxonomyChange={(providerTaxonomyNodeId) => {
                setFormFromUser((current) => ({
                  ...current,
                  providerTaxonomyNodeId,
                }));
              }}
              onChange={(providerId) =>
                setFormFromUser((current) => ({
                  ...current,
                  providerId,
                  doctorId: "",
                  skipMedicalProviderBinding: providerId
                    ? false
                    : current.skipMedicalProviderBinding,
                }))
              }
              disabled={form.appointmentType === "internal"}
            />
          </div>
          <Field compact label={t.common_doctor}>
            <NativeComboboxSelect
              value={form.doctorId}
              onChange={(event) =>
                setFormFromUser((current) => ({
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
            {form.providerId && doctors.length === 0 ? (
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground">
                {t.providers_no_doctors}
              </p>
            ) : null}
          </Field>
        </div>
        {form.appointmentType === "medical" ? (
          <div className="space-y-2">
            <label className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3 py-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.skipMedicalProviderBinding}
                onChange={(event) =>
                  setFormFromUser((current) => ({
                    ...current,
                    skipMedicalProviderBinding: event.target.checked,
                  }))
                }
                disabled={Boolean(form.providerId)}
                className={`${checkboxClass} mt-0.5`}
              />
              <span>
                <span className="block font-medium text-foreground">
                  {appointmentText("appointments_medical_provider_opt_out")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {appointmentText(
                    "appointments_medical_provider_opt_out_hint",
                  )}
                </span>
              </span>
            </label>
            {!form.providerId && !form.skipMedicalProviderBinding ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {appointmentText(
                  "appointments_medical_provider_required_hint",
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        </section>
        <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
        {editSheetSectionTitle(appointmentText("appointments_coordination_and_notes"))}
        <div className="grid gap-4 md:grid-cols-2">
          <Field compact label={t.patients_assign_owner}>
            <NativeComboboxSelect
              value={form.ownerUserId}
              onChange={(event) =>
                setFormFromUser((current) => ({
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
          <Field compact label={interpreterFieldLabel}>
            <NativeComboboxSelect
              value={form.interpreterId}
              onChange={(event) =>
                setFormFromUser((current) => ({
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
          <Field compact label={t.appointments_location}>
            <Input
              value={form.location}
              onChange={(event) =>
                setFormFromUser((current) => ({
                  ...current,
                  location: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
          <Field compact label={tr.documents_category}>
            <Input
              value={form.category}
              onChange={(event) =>
                setFormFromUser((current) => ({
                  ...current,
                  category: event.target.value,
                }))
              }
              className={inputClassName}
            />
          </Field>
        </div>
        <Field compact label={t.patients_notes}>
          <textarea
            value={form.notes}
            onChange={(event) =>
              setFormFromUser((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            className={textareaClass}
            rows={3}
          />
        </Field>
        </section>
        {detail.recurrence_frequency ? (
          <section className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3.5">
          {editSheetSectionTitle(appointmentText("appointments_repeat_frequency"))}
          <div className="space-y-3 rounded-lg border border-border/60 bg-card p-3">
            <Field compact label={t.appointments_scope_apply_schedule}>
              <NativeComboboxSelect
                value={recurrenceScope}
                onChange={(event) =>
                  setRecurrenceScopeFromUser(
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
            <p className="text-xs text-muted-foreground">
              {t.appointments_scope_following_hint}
            </p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field
                compact
                label={appointmentText("appointments_repeat_frequency")}
              >
                <NativeComboboxSelect
                  value={form.repeatFrequency}
                  onChange={(event) =>
                    setFormFromUser((current) => ({
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
                compact
                label={appointmentText("appointments_repeat_every")}
              >
                <Input
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.repeatInterval}
                  onChange={(event) =>
                    setFormFromUser((current) => ({
                      ...current,
                      repeatInterval: event.target.value,
                    }))
                  }
                  className={inputClassName}
                  disabled={recurrenceScope === "single"}
                />
              </Field>
              <Field
                compact
                label={t.appointments_repeat_end_mode}
              >
                <NativeComboboxSelect
                  value={form.repeatEndMode}
                  onChange={(event) =>
                    setFormFromUser((current) => ({
                      ...current,
                      repeatEndMode: event.target
                        .value as AppointmentFormState["repeatEndMode"],
                      repeatCount:
                        event.target.value === "count"
                          ? current.repeatCount ||
                            String(detail.recurrence_series_size)
                          : "",
                      repeatUntil:
                        event.target.value === "until"
                          ? current.repeatUntil
                          : "",
                    }))
                  }
                  className={selectClassName}
                  disabled={recurrenceScope === "single"}
                >
                  <option value="count">{t.appointments_repeat_end_count}</option>
                  <option value="until">{t.appointments_repeat_end_until}</option>
                </NativeComboboxSelect>
              </Field>
              {form.repeatEndMode === "count" ? (
                <Field
                  compact
                  label={appointmentText("appointments_total_occurrences")}
                >
                  <Input
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={form.repeatCount}
                    onChange={(event) =>
                      setFormFromUser((current) => ({
                        ...current,
                        repeatCount: event.target.value,
                        repeatUntil: "",
                      }))
                    }
                    className={inputClassName}
                    disabled={recurrenceScope === "single"}
                  />
                </Field>
              ) : (
                <Field
                  compact
                  label={appointmentText("appointments_repeat_until")}
                >
                  <Input
                    type="date"
                    value={form.repeatUntil}
                    onChange={(event) =>
                      setFormFromUser((current) => ({
                        ...current,
                        repeatCount: "",
                        repeatUntil: event.target.value,
                      }))
                    }
                    className={inputClassName}
                    disabled={recurrenceScope === "single"}
                  />
                </Field>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t.appointments_edit_recurrence_rule_guidance}
            </p>
          </div>
          </section>
        ) : null}
        <ConflictPanel conflicts={conflicts} />
        <ScheduleWarningsPanel warnings={localWarnings} />
        </div>
      </AppointmentEditorSheet>
      <DirtyDismissConfirmDialog
        open={dismissConfirmOpen}
        title={t.common_discard_unsaved_confirm}
        message={t.common_overlay_dismiss_blocked}
        cancelLabel={t.common_cancel}
        confirmLabel={t.common_ok}
        onCancel={handleCancelDismiss}
        onConfirm={handleConfirmDismiss}
      />
    </>
  );
}

function EditAppointmentSectionContent(...args: Parameters<typeof useEditAppointmentSectionContentContent>) {
  return useEditAppointmentSectionContentContent(...args);
}

export const MemoizedEditAppointmentSection = memo(EditAppointmentSection);
