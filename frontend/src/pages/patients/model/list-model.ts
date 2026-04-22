export type PatientSummary = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  gender: string;
  nationality?: string | null;
  residence_country?: string | null;
  languages?: string[];
  functional_labels?: string[];
  phone_primary?: string | null;
  email?: string | null;
  insurance_provider?: string | null;
  insurance_type?: string | null;
  is_active: boolean;
  created_at: string;
};

export type PatientDetail = PatientSummary & {
  updated_at?: string;
  phone_secondary?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  insurance_number?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  legal_status?: unknown;
  clinical_warnings?: string | null;
  notes?: string | null;
};

export type PatientAssignment = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
};

export type StaffOption = {
  id: string;
  name: string;
  role: string;
};

export type ProviderOption = {
  id: string;
  name: string;
  provider_type: string;
  address_city: string | null;
};

export type DoctorOption = {
  id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
};

export type PatientFilters = {
  search: string;
  activeOnly: string;
  providerId: string;
  doctorId: string;
};

export type PatientFormState = {
  title: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  nationality: string;
  residenceCountry: string;
  languages: string;
  functionalLabels: string;
  phonePrimary: string;
  phoneSecondary: string;
  email: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  addressCountry: string;
  insuranceProvider: string;
  insuranceNumber: string;
  insuranceType: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  notes: string;
};

export type PatientPermissions = {
  canViewPage: boolean;
  canCreateEdit: boolean;
  canViewAssignments: boolean;
  canManageAssignments: boolean;
};

export const DEFAULT_PATIENT_FILTERS: PatientFilters = {
  search: "",
  activeOnly: "true",
  providerId: "",
  doctorId: "",
};

export function patientPermissions(role?: string): PatientPermissions {
  return {
    canViewPage: [
      "ceo",
      "ceo_assistant",
      "patient_manager",
      "billing",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
    ].includes(role ?? ""),
    canCreateEdit: role === "ceo" || role === "patient_manager",
    canViewAssignments: [
      "ceo",
      "patient_manager",
      "teamlead_interpreter",
      "interpreter",
      "concierge",
    ].includes(role ?? ""),
    canManageAssignments:
      role === "ceo" || role === "patient_manager" || role === "teamlead_interpreter",
  };
}

export function blankPatientForm(): PatientFormState {
  return {
    title: "",
    firstName: "",
    lastName: "",
    birthDate: "",
    gender: "male",
    nationality: "",
    residenceCountry: "",
    languages: "",
    functionalLabels: "",
    phonePrimary: "",
    phoneSecondary: "",
    email: "",
    addressStreet: "",
    addressCity: "",
    addressZip: "",
    addressCountry: "",
    insuranceProvider: "",
    insuranceNumber: "",
    insuranceType: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    notes: "",
  };
}

export function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parseLanguages(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function patientToForm(detail: PatientDetail): PatientFormState {
  return {
    title: detail.title ?? "",
    firstName: detail.first_name ?? "",
    lastName: detail.last_name ?? "",
    birthDate: detail.birth_date ?? "",
    gender: detail.gender ?? "male",
    nationality: detail.nationality ?? "",
    residenceCountry: detail.residence_country ?? "",
    languages: detail.languages?.join(", ") ?? "",
    functionalLabels: detail.functional_labels?.join(", ") ?? "",
    phonePrimary: detail.phone_primary ?? "",
    phoneSecondary: detail.phone_secondary ?? "",
    email: detail.email ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    insuranceProvider: detail.insurance_provider ?? "",
    insuranceNumber: detail.insurance_number ?? "",
    insuranceType: detail.insurance_type ?? "",
    emergencyContactName: detail.emergency_contact_name ?? "",
    emergencyContactPhone: detail.emergency_contact_phone ?? "",
    emergencyContactRelation: detail.emergency_contact_relation ?? "",
    notes: detail.notes ?? "",
  };
}

export type PatientsDictionary = Record<string, string>;

export function computeAge(birthDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null;
  const dob = new Date(birthDate);
  if (!Number.isFinite(dob.getTime())) return null;
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

export function patientDisplayName(patient: Pick<PatientSummary, "first_name" | "last_name" | "title">): string {
  const parts = [patient.title, patient.first_name, patient.last_name]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

export function buildPatientsPath(filters: PatientFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.activeOnly === "true") params.set("active_only", "true");
  else params.set("active_only", "false");
  if (filters.providerId) params.set("provider_id", filters.providerId);
  if (filters.doctorId) params.set("doctor_id", filters.doctorId);
  const query = params.toString();
  return query ? `/patients?${query}` : "/patients";
}

export function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo":
      return ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(
        targetRole
      );
    case "patient_manager":
      return ["teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "teamlead_interpreter":
      return targetRole === "interpreter";
    default:
      return false;
  }
}
