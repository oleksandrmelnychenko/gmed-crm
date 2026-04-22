import {
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
        ? `${tr?.patients_assign_owner ?? appointmentText("Zustandig", "Куратор", "Owner")} · ${roleLabel(item.owner_role)}`
        : appointmentText("Bei mir", "Мои", "Owned by me");
    case "needs_attention":
      return (
        attentionIndex?.get(item.id)?.reasons[0] ||
        (tr?.common_error ??
          appointmentText(
            "Operative Nachverfolgung erforderlich",
            "Нужно операционное действие",
            "Operational follow-up required",
          ))
      );
    case "pending_interpreter":
      return item.interpreter_name
        ? `${item.interpreter_name} · ${responseLabel(item.interpreter_response ?? "pending")}`
        : appointmentText(
            "Dolmetscher ausstehend",
            "Ожидается переводчик",
            "Interpreter pending",
          );
    case "my_interpreter_queue":
      return item.interpreter_response === "pending"
        ? appointmentText("Antwort ausstehend", "Нужен ответ", "Response required")
        : item.status === "completed"
          ? appointmentText("Slot abgeschlossen", "Слот завершён", "Completed slot")
          : appointmentText(
              "Zugewiesener Dolmetscher-Slot",
              "Назначенный слот переводчика",
              "Assigned interpreter slot",
            );
    case "concierge_flow":
      return (
        item.provider_name ||
        appointmentText(
          "Nicht-medizinischer Servicefluss",
          "Поток немедицинского сервиса",
          "Non-medical service flow",
        )
      );
    case "blocked_medical":
      return userRole === "concierge"
        ? appointmentText(
            "Medizinischer Slot als blockiert angezeigt",
            "Медицинский слот показан как заблокированный",
            "Medical slot shown as blocked",
          )
        : appointmentText("Blockierter Slot", "Заблокированный слот", "Blocked slot");
    case "all":
      return (
        item.owner_name ||
        item.provider_name ||
        (tr?.appointments_title ?? appointmentText("Termin", "Приём", "Appointment"))
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
        tr.providers_all ?? appointmentText("Alle sichtbar", "Все видимые", "All visible"),
    },
  ];

  if (role && role !== "interpreter") {
    options.push({
      id: "owned_by_me",
      label: appointmentText("Bei mir", "Мои", "Owned by me"),
    });
  }
  if (role) {
    options.push({
      id: "needs_attention",
      label: appointmentText("Braucht Aufmerksamkeit", "Требует внимания", "Needs attention"),
    });
  }
  if (
    role === "ceo" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter"
  ) {
    options.push({
      id: "pending_interpreter",
      label: appointmentText(
        "Dolmetscher ausstehend",
        "Ожидается переводчик",
        "Pending interpreter",
      ),
    });
  }
  if (role === "teamlead_interpreter" || role === "interpreter") {
    options.push({
      id: "my_interpreter_queue",
      label: appointmentText(
        "Dolmetscher-Warteschlange",
        "Очередь переводчика",
        "Interpreter queue",
      ),
    });
  }
  if (role === "ceo" || role === "patient_manager" || role === "concierge") {
    options.push({
      id: "concierge_flow",
      label: appointmentText("Concierge-Flow", "Поток concierge", "Concierge flow"),
    });
  }
  if (role === "concierge") {
    options.push({
      id: "blocked_medical",
      label: appointmentText(
        "Blockierte Medizin-Slots",
        "Заблокированные медслоты",
        "Blocked medical",
      ),
    });
  }

  return options;
}
