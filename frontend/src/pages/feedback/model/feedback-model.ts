import type { FeedbackFormState, PatientOption } from "./types";

export const scoreOptions = ["1", "2", "3", "4", "5"];
export const npsOptions = Array.from({ length: 11 }, (_, index) => String(index));

export function blankFeedbackForm(): FeedbackFormState {
  return {
    appointmentId: "",
    overallScore: "5",
    patientManagerScore: "5",
    interpreterScore: "5",
    conciergeScore: "5",
    treatmentScore: "5",
    doctorScore: "5",
    organizationScore: "5",
    serviceScore: "5",
    infrastructureScore: "5",
    priceValueScore: "5",
    treatmentSuccess: "yes",
    complicationReported: false,
    npsScore: "10",
    comments: "",
    improvementNotes: "",
    internalNote: "",
  };
}

export function roleCanCaptureFeedback(role?: string) {
  return role === "ceo" || role === "patient_manager";
}

export function canViewStaffFeedback(role?: string) {
  return (
    role === "ceo" ||
    role === "ceo_assistant" ||
    role === "patient_manager" ||
    role === "teamlead_interpreter" ||
    role === "concierge"
  );
}

export function buildFeedbackQuery(search: string, status: string, source: string) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function patientLabel(item: PatientOption) {
  return `${item.patient_id} - ${[item.first_name, item.last_name].filter(Boolean).join(" ")}`.trim();
}
