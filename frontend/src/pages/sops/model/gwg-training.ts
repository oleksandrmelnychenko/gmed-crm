/**
 * GwG instruction and reliability of the staff (§ 6 Abs. 2 GwG) in
 * "SOP и обучение": wire types of `crates/server/src/routes/sops_gwg_training.rs`
 * and the pure rules of the form. See docs/architecture/gwg-staff-training_ua.md.
 */

import { addMonthsToDateKey } from "@/lib/app-time-zone";

/** The six instructions of section 2, in the order of the sheet. */
export const GWG_INSTRUCTION_CODES = [
  "identify_partner",
  "identify_acting_person",
  "beneficial_owner",
  "enhanced_due_diligence",
  "suspicious_activity_report",
  "record_keeping",
] as const;

export type GwgInstructionCode = (typeof GWG_INSTRUCTION_CODES)[number];
export type GwgTrainingStatus = "none" | "unsigned" | "signed";
export type GwgReliability = "long_standing" | "new_employee";

/** An instruction is due again after this many months. */
export const GWG_DUE_AFTER_MONTHS = 12;

export type GwgTrainingRecord = {
  id: string;
  employee_id: string;
  template_id: string;
  instructed_on: string;
  position: string;
  department: string;
  delivered_by: "internal" | "other";
  delivered_by_other: string | null;
  form_oral: boolean;
  form_material: boolean;
  form_other: boolean;
  form_other_text: string | null;
  instructions: string[];
  reliability: GwgReliability;
  reliability_interview: boolean;
  reliability_certificate: boolean;
  reliability_other: boolean;
  reliability_other_text: string | null;
  management_name: string;
  status: Exclude<GwgTrainingStatus, "none">;
  document_id: string;
  document_file_name: string;
  document_mime_type: string;
  signed_document_id: string | null;
  signed_file_name: string | null;
  signed_mime_type: string | null;
  signed_at: string | null;
  signed_by_name: string | null;
  created_by_name: string | null;
  created_at: string;
};

/** Status, last date and due flag of one employee, newest record first. */
export type GwgTrainingSummary = {
  status: GwgTrainingStatus;
  last_instructed_on: string | null;
  next_due_on: string | null;
  due: boolean;
  records: GwgTrainingRecord[];
};

export type GwgTrainingEmployee = GwgTrainingSummary & {
  employee_id: string;
  first_name: string;
  last_name: string;
  display_name: string;
  employment_start: string | null;
  user_role: string | null;
  default_position: string;
  default_department: string;
};

export type GwgTrainingOverview = {
  today: string;
  due_after_months: number;
  management_name: string;
  instructions: string[];
  employees: GwgTrainingEmployee[];
};

export type GwgOwnTrainings = GwgTrainingSummary & { employee_id: string | null };

export type GwgTrainingForm = {
  employeeId: string;
  instructedOn: string;
  position: string;
  department: string;
  deliveredBy: "internal" | "other";
  deliveredByOther: string;
  formOral: boolean;
  formMaterial: boolean;
  formOther: boolean;
  formOtherText: string;
  instructions: GwgInstructionCode[];
  reliability: GwgReliability;
  reliabilityInterview: boolean;
  reliabilityCertificate: boolean;
  reliabilityOther: boolean;
  reliabilityOtherText: string;
};

export type GwgTrainingFormError =
  | "date"
  | "delivered_by_other"
  | "form"
  | "form_other"
  | "instructions"
  | "reliability"
  | "reliability_other";

/**
 * Employed for at least twelve months on `today` counts as long-standing
 * (section 3 a); a newer or unknown start date as new (section 3 b).
 */
export function isLongStanding(employmentStart: string | null, today: string): boolean {
  if (!employmentStart) return false;
  return addMonthsToDateKey(employmentStart, GWG_DUE_AFTER_MONTHS) <= today;
}

/**
 * The form of a new instruction: today, in-house, oral plus the information
 * sheet, all six instructions; "als" / "im Bereich" from the last record or
 * the role, the reliability from the length of employment.
 */
export function defaultTrainingForm(employee: GwgTrainingEmployee, today: string): GwgTrainingForm {
  const last = employee.records[0];
  const longStanding = isLongStanding(employee.employment_start, today);
  return {
    employeeId: employee.employee_id,
    instructedOn: today,
    position: last?.position || employee.default_position,
    department: last?.department || employee.default_department,
    deliveredBy: "internal",
    deliveredByOther: "",
    formOral: true,
    formMaterial: true,
    formOther: false,
    formOtherText: "",
    instructions: [...GWG_INSTRUCTION_CODES],
    reliability: longStanding ? "long_standing" : "new_employee",
    reliabilityInterview: !longStanding,
    reliabilityCertificate: false,
    reliabilityOther: false,
    reliabilityOtherText: "",
  };
}

/** What the server would refuse, in the order of the form. */
export function trainingFormErrors(form: GwgTrainingForm, today: string): GwgTrainingFormError[] {
  const errors: GwgTrainingFormError[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.instructedOn) || form.instructedOn > today) errors.push("date");
  if (form.deliveredBy === "other" && !form.deliveredByOther.trim()) errors.push("delivered_by_other");
  if (!form.formOral && !form.formMaterial && !form.formOther) errors.push("form");
  if (form.formOther && !form.formOtherText.trim()) errors.push("form_other");
  if (form.instructions.length === 0) errors.push("instructions");
  if (form.reliability === "new_employee") {
    if (!form.reliabilityInterview && !form.reliabilityCertificate && !form.reliabilityOther) {
      errors.push("reliability");
    }
    if (form.reliabilityOther && !form.reliabilityOtherText.trim()) errors.push("reliability_other");
  }
  return errors;
}

/** The body of `POST /sops/gwg-training`; texts of unticked boxes are dropped. */
export function trainingPayload(form: GwgTrainingForm): Record<string, unknown> {
  const newEmployee = form.reliability === "new_employee";
  return {
    employee_id: form.employeeId,
    instructed_on: form.instructedOn,
    position: form.position.trim(),
    department: form.department.trim(),
    delivered_by: form.deliveredBy,
    delivered_by_other: form.deliveredBy === "other" ? form.deliveredByOther.trim() : null,
    form_oral: form.formOral,
    form_material: form.formMaterial,
    form_other: form.formOther,
    form_other_text: form.formOther ? form.formOtherText.trim() : null,
    instructions: GWG_INSTRUCTION_CODES.filter((code) => form.instructions.includes(code)),
    reliability: form.reliability,
    reliability_interview: newEmployee && form.reliabilityInterview,
    reliability_certificate: newEmployee && form.reliabilityCertificate,
    reliability_other: newEmployee && form.reliabilityOther,
    reliability_other_text: newEmployee && form.reliabilityOther ? form.reliabilityOtherText.trim() : null,
  };
}

/** Badge colours of the three statuses. */
export function gwgStatusTone(status: GwgTrainingStatus): string {
  if (status === "signed") return "bg-emerald-100 text-emerald-700 hover:bg-emerald-100";
  if (status === "unsigned") return "bg-amber-100 text-amber-700 hover:bg-amber-100";
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
}

/** Employees whose instruction is due first, then by name. */
export function sortForAttention(employees: GwgTrainingEmployee[]): GwgTrainingEmployee[] {
  return [...employees].sort(
    (left, right) =>
      Number(right.due) - Number(left.due) ||
      left.last_name.localeCompare(right.last_name, "de") ||
      left.first_name.localeCompare(right.first_name, "de"),
  );
}
