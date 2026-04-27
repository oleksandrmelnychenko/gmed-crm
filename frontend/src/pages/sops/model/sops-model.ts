import type { SopFormState } from "./types";

export function emptyForm(): SopFormState {
  return {
    title: "",
    category: "sop",
    summary: "",
    bodyMarkdown: "",
    requiresAck: false,
    targetRoles: [],
    targetUserIds: [],
  };
}

export function categoryLabel(value: string) {
  if (value === "sop") return "SOP";
  if (value === "handbook") return "Handbook";
  if (value === "training") return "Training";
  return value;
}

export function roleCanOpenLearning(role?: string) {
  return role !== undefined && role !== "patient";
}

export function roleCanCreate(role?: string) {
  return role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter";
}

export function roleCanReview(role?: string) {
  return role === "ceo" || role === "patient_manager";
}

export function formatDate(value?: string | null) {
  if (!value) return "Not set";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function approvalRoleLabel(value?: string | null) {
  if (value === "ceo") return "CEO approval";
  if (value === "patient_manager") return "Patient-manager approval";
  return "Approval";
}

export function reviewQueueCopy(role?: string) {
  if (role === "patient_manager") {
    return {
      metric: "PM review queue",
      title: "Patient-manager approval queue",
      description:
        "Interpreter-team SOPs waiting for patient-manager approval before they become visible.",
    };
  }

  return {
    metric: "CEO review queue",
    title: "CEO approval queue",
    description: "Team-authored SOPs waiting for CEO approval before they become visible.",
  };
}

export function formDescription(role?: string) {
  if (role === "ceo") {
    return "Create role-scoped SOP, handbook or training content. CEO content is published immediately.";
  }
  if (role === "patient_manager") {
    return "Create role-scoped SOP, handbook or training content. Patient-manager content is routed to CEO approval.";
  }
  return "Create interpreter-team SOP content. Teamlead interpreter content is routed to patient-manager approval and can target interpreters only.";
}
