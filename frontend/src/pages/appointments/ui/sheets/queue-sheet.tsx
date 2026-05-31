import { memo, useEffect, useMemo, useState, type FormEvent } from "react";

import {
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Stethoscope,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import {
  EmptyCell,
  ListItem,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  defaultAppointmentOwnerUserId,
  statusActionKey,
} from "@/pages/appointments/model/form-factories";
import { filterAppointmentOwnerOptions } from "@/pages/appointments/model/staff-roles";
import {
  operationalScopeReason,
} from "@/pages/appointments/model/operational-scopes";
import {
  formatAppointmentSlotLabel as slotLabel,
} from "@/pages/appointments/model/runtime-formatters";
import {
  appointmentText,
  appointmentTypeLabel,
  carePathKindLabel,
  staffLabel,
  statusLabel,
} from "@/pages/appointments/model/labels";
import { currentDateInput } from "@/pages/appointments/model/date-time";
import type {
  AppointmentAttentionItem,
  AppointmentListItem,
  AppointmentRequestItem,
  AppointmentRequestStatus,
  AppointmentRecurringActionScope,
  AppointmentStatus,
  InterpreterOption,
  OperationalScope,
  StaffOption,
} from "@/pages/appointments/model/types";
import {
  appointmentStatusBadgeClassName,
} from "@/pages/appointments/appearance/status-appearance";
import {
  AppointmentPreviewSheet,
} from "@/pages/appointments/ui/shared/workspace-primitives";

export type QueueSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointmentsLoading: boolean;
  metadataLoading: boolean;
  items: AppointmentListItem[];
  appointmentRequests: AppointmentRequestItem[];
  appointmentRequestsLoading: boolean;
  appointmentRequestsError: string;
  currentUserId?: string;
  staff: StaffOption[];
  interpreters: InterpreterOption[];
  openDetailSheet: (appointmentId: string) => void;
  operationalScope: OperationalScope;
  userRole?: string;
  attentionIndex: Map<string, AppointmentAttentionItem>;
  canManageStatus: boolean;
  actionBusy: string;
  requestActionBusy: string;
  scheduleDraft?: QueueScheduleDraft | null;
  onScheduleDraftChange?: (draft: QueueScheduleDraft | null) => void;
  onStatusChange: (
    appointmentId: string,
    status: AppointmentStatus,
    scope?: AppointmentRecurringActionScope,
  ) => Promise<void> | void;
  onReviewRequest: (
    requestId: string,
    status: Extract<AppointmentRequestStatus, "approved" | "rejected">,
  ) => Promise<void> | void;
  onConvertRequest: (
    requestId: string,
    input: ConvertAppointmentRequestInput,
  ) => Promise<void> | void;
};

type ConvertAppointmentRequestInput = {
  providerId: string | null;
  doctorId: string | null;
  ownerUserId: string | null;
  interpreterId: string | null;
  orderId: string | null;
  title: string;
  date: string;
  timeStart: string | null;
  timeEnd: string | null;
  location: string | null;
  category: string | null;
  notes: string | null;
};

export type RequestScheduleFormState = {
  title: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  ownerUserId: string;
  interpreterId: string;
  location: string;
  notes: string;
};

export type QueueScheduleDraft = {
  requestId: string;
  form: RequestScheduleFormState;
  error: string;
};

function requestActionKey(
  requestId: string,
  status: Extract<AppointmentRequestStatus, "approved" | "rejected">,
) {
  return `${requestId}:${status}`;
}

function requestConvertActionKey(requestId: string) {
  return `${requestId}:convert`;
}

function buildScheduleForm(
  item: AppointmentRequestItem,
  currentUserId?: string,
  currentUserRole?: string,
): RequestScheduleFormState {
  const patientLabel =
    item.patient_name || item.patient_pid || appointmentText("appointments_patient");
  return {
    title: `${appointmentTypeLabel(item.appointment_type)} · ${patientLabel}`,
    date: item.preferred_date_from || item.preferred_date_to || currentDateInput(),
    timeStart: "",
    timeEnd: "",
    ownerUserId: defaultAppointmentOwnerUserId(currentUserId, currentUserRole),
    interpreterId: "",
    location: item.location ?? "",
    notes: [item.reason, item.notes].filter(Boolean).join("\n\n"),
  };
}

function requestStatusLabel(status: AppointmentRequestStatus) {
  switch (status) {
    case "requested":
      return appointmentText("appointments_requested");
    case "approved":
      return appointmentText("appointments_approved");
    case "rejected":
      return appointmentText("appointments_rejected_2");
    case "converted":
      return appointmentText("appointments_scheduled");
    case "cancelled":
      return appointmentText("appointments_cancelled_2");
  }
}

function requestStatusClassName(status: AppointmentRequestStatus) {
  switch (status) {
    case "requested":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rejected":
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "converted":
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
}

function preferredWindowLabel(item: AppointmentRequestItem) {
  const from = item.preferred_date_from;
  const to = item.preferred_date_to;
  const time = item.preferred_time_of_day
    ? item.preferred_time_of_day.replace("_", " ")
    : "";

  let dateLabel = appointmentText("appointments_flexible_date");
  if (from && to && from !== to) {
    dateLabel = `${from} - ${to}`;
  } else if (from || to) {
    dateLabel = from ?? to ?? dateLabel;
  }

  return time ? `${dateLabel} · ${time}` : dateLabel;
}

function useQueueSheetContent({
  open,
  onOpenChange,
  appointmentsLoading,
  metadataLoading,
  items,
  appointmentRequests,
  appointmentRequestsLoading,
  appointmentRequestsError,
  currentUserId,
  staff,
  interpreters,
  openDetailSheet,
  operationalScope,
  userRole,
  attentionIndex,
  canManageStatus,
  actionBusy,
  requestActionBusy,
  scheduleDraft,
  onScheduleDraftChange,
  onStatusChange,
  onReviewRequest,
  onConvertRequest,
}: QueueSheetProps) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const hasAppointmentRequests = appointmentRequests.length > 0;
  const hasAppointments = items.length > 0;
  const [activeScheduleRequestId, setActiveScheduleRequestId] = useState(
    scheduleDraft?.requestId ?? "",
  );
  const [scheduleForm, setScheduleForm] =
    useState<RequestScheduleFormState | null>(scheduleDraft?.form ?? null);
  const [scheduleError, setScheduleError] = useState(scheduleDraft?.error ?? "");
  const activeScheduleRequestExists = activeScheduleRequestId
    ? appointmentRequests.some((item) => item.id === activeScheduleRequestId)
    : true;
  const isScheduleRequestCurrent =
    !activeScheduleRequestId ||
    appointmentRequestsLoading ||
    Boolean(appointmentRequestsError) ||
    activeScheduleRequestExists;
  const visibleScheduleRequestId = isScheduleRequestCurrent
    ? activeScheduleRequestId
    : "";
  const visibleScheduleForm = isScheduleRequestCurrent ? scheduleForm : null;
  const visibleScheduleError = isScheduleRequestCurrent ? scheduleError : "";
  const ownerOptions = useMemo(() => {
    const filtered = filterAppointmentOwnerOptions(staff, userRole, currentUserId);
    const ownerUserId = visibleScheduleForm?.ownerUserId;

    if (
      !ownerUserId ||
      filtered.some((member) => member.id === ownerUserId)
    ) {
      return filtered;
    }

    const currentOwner = staff.find((member) => member.id === ownerUserId);
    if (currentOwner) {
      return [currentOwner, ...filtered];
    }

    if (currentUserId && ownerUserId === currentUserId && userRole) {
      return [
        {
          id: currentUserId,
          name: appointmentText("patients_current_user"),
          role: userRole,
        },
        ...filtered,
      ];
    }

    return filtered;
  }, [currentUserId, staff, userRole, visibleScheduleForm?.ownerUserId]);

  useEffect(() => {
    if (visibleScheduleRequestId && visibleScheduleForm) {
      onScheduleDraftChange?.({
        requestId: visibleScheduleRequestId,
        form: visibleScheduleForm,
        error: visibleScheduleError,
      });
      return;
    }

    onScheduleDraftChange?.(null);
  }, [
    onScheduleDraftChange,
    visibleScheduleError,
    visibleScheduleForm,
    visibleScheduleRequestId,
  ]);

  function resetScheduleForm() {
    setActiveScheduleRequestId("");
    setScheduleForm(null);
    setScheduleError("");
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  function openScheduleForm(item: AppointmentRequestItem) {
    setActiveScheduleRequestId(item.id);
    setScheduleForm(buildScheduleForm(item, currentUserId, userRole));
    setScheduleError("");
  }

  async function handleScheduleSubmit(
    event: FormEvent<HTMLFormElement>,
    item: AppointmentRequestItem,
  ) {
    event.preventDefault();
    if (!scheduleForm) return;
    if (!scheduleForm.title.trim()) {
      setScheduleError(appointmentText("appointments_title_is_required"));
      return;
    }
    if (!scheduleForm.date) {
      setScheduleError(appointmentText("appointments_date_is_required"));
      return;
    }
    setScheduleError("");
    try {
      await onConvertRequest(item.id, {
        providerId: item.requested_provider_id,
        doctorId: item.requested_doctor_id,
        ownerUserId: scheduleForm.ownerUserId || null,
        interpreterId: scheduleForm.interpreterId || null,
        orderId: item.order_id,
        title: scheduleForm.title,
        date: scheduleForm.date,
        timeStart: scheduleForm.timeStart || null,
        timeEnd: scheduleForm.timeEnd || null,
        location: scheduleForm.location || null,
        category: null,
        notes: scheduleForm.notes || null,
      });
      resetScheduleForm();
    } catch {
      // The page-level handler owns the visible error banner.
    }
  }

  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={handleOpenChange}
      title={t.appointments_title}
      maxWidthClassName="sm:max-w-[640px]"
    >
      {appointmentsLoading || metadataLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t.patients_syncing}
        </div>
      ) : null}
      {appointmentRequestsLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {appointmentText("appointments_loading_portal_requests")}
        </div>
      ) : null}
      {appointmentRequestsError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
          {appointmentRequestsError}
        </div>
      ) : null}
      {hasAppointmentRequests ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              {appointmentText("appointments_portal_requests")}
            </h2>
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {appointmentRequests.length}
            </span>
          </div>
          {appointmentRequests.map((item) => (
            <ListItem key={item.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {item.patient_pid ? `${item.patient_pid} · ` : ""}
                    {item.patient_name || appointmentText("appointments_patient")}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {appointmentTypeLabel(item.appointment_type, tr)} · {carePathKindLabel(item.care_path_kind)}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    requestStatusClassName(item.status),
                  )}
                >
                  {requestStatusLabel(item.status)}
                </span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="truncate font-medium text-foreground">
                  {preferredWindowLabel(item)}
                </p>
                {item.requested_provider_name || item.requested_doctor_name ? (
                  <p className="truncate">
                    {[item.requested_provider_name, item.requested_doctor_name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {item.specialty ? <p className="truncate">{item.specialty}</p> : null}
                {item.reason ? <p className="line-clamp-2">{item.reason}</p> : null}
              </div>
              {item.status === "requested" ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    disabled={Boolean(requestActionBusy)}
                    onClick={() => void onReviewRequest(item.id, "approved")}
                  >
                    {requestActionBusy === requestActionKey(item.id, "approved") ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-3.5" />
                    )}
                    {appointmentText("appointments_approve")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                    disabled={Boolean(requestActionBusy)}
                    onClick={() => void onReviewRequest(item.id, "rejected")}
                  >
                    {requestActionBusy === requestActionKey(item.id, "rejected") ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <XCircle className="size-3.5" />
                    )}
                    {appointmentText("appointments_reject")}
                  </Button>
                </div>
              ) : null}
              {item.status === "approved" ? (
                <div className="space-y-3">
                  {visibleScheduleRequestId === item.id && visibleScheduleForm ? (
                    <form
                      className="space-y-3 rounded-xl border border-border/60 bg-background/70 p-3"
                      onSubmit={(event) => void handleScheduleSubmit(event, item)}
                    >
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1.5 md:col-span-2">
                          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                            {appointmentText("appointments_title")}
                          </span>
                          <Input
                            value={visibleScheduleForm.title}
                            onChange={(event) =>
                              setScheduleForm((current) =>
                                current
                                  ? { ...current, title: event.target.value }
                                  : current,
                              )
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                            {appointmentText("appointments_date")}
                          </span>
                          <Input
                            type="date"
                            value={visibleScheduleForm.date}
                            onChange={(event) =>
                              setScheduleForm((current) =>
                                current
                                  ? { ...current, date: event.target.value }
                                  : current,
                              )
                            }
                            className={inputClass}
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                              {appointmentText("appointments_start")}
                            </span>
                            <Input
                              type="time"
                              value={visibleScheduleForm.timeStart}
                              onChange={(event) =>
                                setScheduleForm((current) =>
                                  current
                                    ? { ...current, timeStart: event.target.value }
                                    : current,
                                )
                              }
                              className={inputClass}
                            />
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                              {appointmentText("appointments_end")}
                            </span>
                            <Input
                              type="time"
                              value={visibleScheduleForm.timeEnd}
                              onChange={(event) =>
                                setScheduleForm((current) =>
                                  current
                                    ? { ...current, timeEnd: event.target.value }
                                    : current,
                                )
                              }
                              className={inputClass}
                            />
                          </label>
                        </div>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                            {t.patients_assign_owner}
                          </span>
                          <NativeComboboxSelect
                            value={visibleScheduleForm.ownerUserId}
                            onChange={(event) =>
                              setScheduleForm((current) =>
                                current
                                  ? { ...current, ownerUserId: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClass}
                          >
                            <option value="">{t.common_not_set}</option>
                            {ownerOptions.map((member) => (
                              <option key={member.id} value={member.id}>
                                {staffLabel(member)}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </label>
                        <label className="flex flex-col gap-1.5">
                          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                            {tr.role_interpreter ?? appointmentText("appointments_interpreter")}
                          </span>
                          <NativeComboboxSelect
                            value={visibleScheduleForm.interpreterId}
                            onChange={(event) =>
                              setScheduleForm((current) =>
                                current
                                  ? { ...current, interpreterId: event.target.value }
                                  : current,
                              )
                            }
                            className={selectClass}
                          >
                            <option value="">{t.common_not_set}</option>
                            {interpreters.map((member) => (
                              <option key={member.id} value={member.id}>
                                {staffLabel(member)}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                        </label>
                        <label className="flex flex-col gap-1.5 md:col-span-2">
                          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                            {appointmentText("appointments_location_2")}
                          </span>
                          <Input
                            value={visibleScheduleForm.location}
                            onChange={(event) =>
                              setScheduleForm((current) =>
                                current
                                  ? { ...current, location: event.target.value }
                                  : current,
                              )
                            }
                            className={inputClass}
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 md:col-span-2">
                          <span className="text-[11.5px] font-medium leading-tight text-muted-foreground">
                            {appointmentText("appointments_notes_2")}
                          </span>
                          <textarea
                            value={visibleScheduleForm.notes}
                            onChange={(event) =>
                              setScheduleForm((current) =>
                                current
                                  ? { ...current, notes: event.target.value }
                                  : current,
                              )
                            }
                            className={textareaClass}
                            rows={3}
                          />
                        </label>
                      </div>
                      {item.requested_provider_name || item.requested_doctor_name ? (
                        <p className="text-xs text-muted-foreground">
                          {appointmentText("appointments_requested_provider")}: {[item.requested_provider_name, item.requested_doctor_name].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                      {visibleScheduleError ? (
                        <p className="text-xs font-medium text-rose-700">
                          {visibleScheduleError}
                        </p>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="submit"
                          size="sm"
                          className="h-8 rounded-lg"
                          disabled={Boolean(requestActionBusy)}
                        >
                          {requestActionBusy === requestConvertActionKey(item.id) ? (
                            <LoaderCircle className="size-3.5 animate-spin" />
                          ) : null}
                          {appointmentText("appointments_schedule_appointment")}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg"
                          disabled={Boolean(requestActionBusy)}
                          onClick={resetScheduleForm}
                        >
                          {t.common_cancel}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-sky-200 text-sky-700 hover:bg-sky-50"
                      disabled={Boolean(requestActionBusy)}
                      onClick={() => openScheduleForm(item)}
                    >
                      <Clock3 className="size-3.5" />
                      {appointmentText("appointments_schedule_appointment")}
                    </Button>
                  )}
                </div>
              ) : null}
            </ListItem>
          ))}
        </div>
      ) : null}
      {!hasAppointments && !hasAppointmentRequests ? (
        <EmptyCell>{tr.common_not_set}</EmptyCell>
      ) : hasAppointments ? (
        <div className="space-y-3">
          {hasAppointmentRequests ? (
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">
              {appointmentText("appointments_appointment_queue")}
            </h2>
          ) : null}
          {items.map((item) => (
            <ListItem key={item.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <button
                    type="button"
                    onClick={() => openDetailSheet(item.id)}
                    className="truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-[var(--brand)]"
                  >
                    {item.title}
                  </button>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.patient_pid} · {item.patient_name}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]",
                    appointmentStatusBadgeClassName(item.status),
                  )}
                >
                  {statusLabel(item.status)}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Clock3 className="size-3.5" />
                  {slotLabel(item)}
                </span>
                {item.provider_name ? (
                  <span className="inline-flex items-center gap-1">
                    <Stethoscope className="size-3.5" />
                    {item.provider_name}
                  </span>
                ) : null}
              </div>
              <p className="truncate text-xs font-medium text-muted-foreground">
                {operationalScopeReason(
                  item,
                  operationalScope,
                  userRole,
                  attentionIndex,
                  tr,
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  onClick={() => openDetailSheet(item.id)}
                >
                  {t.providers_open}
                </Button>
                {canManageStatus &&
                item.status !== "confirmed" &&
                item.status !== "completed" &&
                item.status !== "cancelled" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    disabled={Boolean(actionBusy)}
                    onClick={() => void onStatusChange(item.id, "confirmed")}
                  >
                    {actionBusy === statusActionKey(item.id, "confirmed") ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {t.common_confirm}
                  </Button>
                ) : null}
                {canManageStatus &&
                item.status !== "completed" &&
                item.status !== "cancelled" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 rounded-lg"
                    disabled={Boolean(actionBusy)}
                    onClick={() => void onStatusChange(item.id, "completed")}
                  >
                    {actionBusy === statusActionKey(item.id, "completed") ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : null}
                    {t.dash_completed}
                  </Button>
                ) : null}
                {canManageStatus &&
                item.recurrence_frequency &&
                item.status !== "completed" &&
                item.status !== "cancelled" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={Boolean(actionBusy)}
                      onClick={() =>
                        void onStatusChange(item.id, "cancelled", "following")
                      }
                    >
                      {actionBusy ===
                      statusActionKey(item.id, "cancelled", "following") ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {t.appointments_cancel_this_and_following}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                      disabled={Boolean(actionBusy)}
                      onClick={() =>
                        void onStatusChange(item.id, "cancelled", "series")
                      }
                    >
                      {actionBusy ===
                      statusActionKey(item.id, "cancelled", "series") ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {t.appointments_cancel_whole_series}
                    </Button>
                  </>
                ) : null}
              </div>
            </ListItem>
          ))}
        </div>
      ) : null}
    </AppointmentPreviewSheet>
  );
}

function QueueSheet(...args: Parameters<typeof useQueueSheetContent>) {
  return useQueueSheetContent(...args);
}

export const MemoizedQueueSheet = memo(QueueSheet);
