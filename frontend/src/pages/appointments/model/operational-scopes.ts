import {
  attentionReasonLabel,
  appointmentText,
  responseLabel,
  roleLabel,
} from "@/pages/appointments/model/labels";
import type {
  AppointmentAttentionItem,
  AppointmentListItem,
  OperationalScope,
  OperationalScopeOption,
} from "@/pages/appointments/model/types";

export function matchesOperationalScope(
  item: AppointmentListItem,
  scope: OperationalScope,
  userId?: string,
  userRole?: string,
  attentionIds?: ReadonlySet<string>,
) {
  switch (scope) {
    case "all":
      return true;
    case "owned_by_me":
      return Boolean(userId) && item.owner_user_id === userId;
    case "needs_attention":
      return Boolean(attentionIds?.has(item.id));
    case "pending_interpreter":
      return (
        Boolean(item.interpreter_id) &&
        item.interpreter_response === "pending" &&
        item.status !== "cancelled"
      );
    case "my_interpreter_queue":
      return (
        Boolean(userId) &&
        item.interpreter_id === userId &&
        item.status !== "cancelled" &&
        (item.interpreter_response === "pending" ||
          ["planned", "confirmed", "in_progress"].includes(item.status))
      );
    case "concierge_flow":
      return item.type === "non_medical" && item.status !== "cancelled";
    case "blocked_medical":
      return userRole === "concierge" && item.is_blocked;
  }
}

export function operationalScopeReason(
  item: AppointmentListItem,
  scope: OperationalScope,
  userRole?: string,
  attentionIndex?: ReadonlyMap<string, AppointmentAttentionItem>,
  tr?: Record<string, string>,
) {
  switch (scope) {
    case "owned_by_me":
      return item.owner_role
        ? `${tr?.patients_assign_owner ?? appointmentText("appointments_owner")} · ${roleLabel(item.owner_role)}`
        : appointmentText("appointments_owned_by_me");
    case "needs_attention": {
      const attention = attentionIndex?.get(item.id);
      return attention?.reasons[0]
        ? attentionReasonLabel(attention.reasons[0], attention.reason_details?.[0])
        : (tr?.common_error ??
            appointmentText("appointments_operational_follow_up_required"));
    }
    case "pending_interpreter":
      return item.interpreter_name
        ? `${item.interpreter_name} · ${responseLabel(item.interpreter_response ?? "pending")}`
        : appointmentText("appointments_interpreter_pending");
    case "my_interpreter_queue":
      return item.interpreter_response === "pending"
        ? appointmentText("appointments_response_required")
        : item.status === "completed"
          ? appointmentText("appointments_completed_slot")
          : appointmentText("appointments_assigned_interpreter_slot");
    case "concierge_flow":
      return (
        item.provider_name ||
        appointmentText("appointments_non_medical_service_flow")
      );
    case "blocked_medical":
      return userRole === "concierge"
        ? appointmentText("appointments_medical_slot_shown_as_blocked")
        : appointmentText("appointments_blocked_slot");
    case "all":
      return (
        item.owner_name ||
        item.provider_name ||
        (tr?.appointments_title ?? appointmentText("appointments_appointment"))
      );
  }
}

export function operationalScopeOptions(
  role: string | undefined,
  tr: Record<string, string>,
): OperationalScopeOption[] {
  const options: OperationalScopeOption[] = [
    {
      id: "all",
      label:
        tr.providers_all ?? appointmentText("appointments_all_visible"),
    },
  ];

  if (role && role !== "interpreter") {
    options.push({
      id: "owned_by_me",
      label: appointmentText("appointments_owned_by_me"),
    });
  }
  if (role) {
    options.push({
      id: "needs_attention",
      label: appointmentText("appointments_needs_attention"),
    });
  }
  if (
    role === "ceo" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter"
  ) {
    options.push({
      id: "pending_interpreter",
      label: appointmentText("appointments_pending_interpreter"),
    });
  }
  if (role === "teamlead_interpreter" || role === "interpreter") {
    options.push({
      id: "my_interpreter_queue",
      label: appointmentText("appointments_interpreter_queue"),
    });
  }
  if (role === "ceo" || role === "patient_manager" || role === "concierge") {
    options.push({
      id: "concierge_flow",
      label: appointmentText("appointments_concierge_flow"),
    });
  }
  if (role === "concierge") {
    options.push({
      id: "blocked_medical",
      label: appointmentText("appointments_blocked_medical"),
    });
  }

  return options;
}
