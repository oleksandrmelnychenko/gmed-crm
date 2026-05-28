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
  contacts?: PatientContact[];
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
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  taxonomy_path?: Array<{ id?: string | null }>;
};

export type DoctorOption = {
  id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
};

type PatientContact = {
  id: string | null;
  contact_kind: "phone" | "email";
  contact_type: "work" | "private" | "other";
  value: string;
  is_primary: boolean;
  notes: string | null;
};

export type PatientContactFormState = {
  id: string;
  contactKind: "phone" | "email";
  contactType: "work" | "private" | "other";
  value: string;
  isPrimary: boolean;
  notes: string;
};

export type PatientContactPayload = {
  contact_kind: "phone" | "email";
  contact_type: "work" | "private" | "other";
  value: string;
  is_primary: boolean;
  notes: string | null;
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
  contacts: PatientContactFormState[];
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
    contacts: [
      {
        id: makePatientContactFormId("patient-phone"),
        contactKind: "phone",
        contactType: "private",
        value: "",
        isPrimary: true,
        notes: "",
      },
      {
        id: makePatientContactFormId("patient-email"),
        contactKind: "email",
        contactType: "private",
        value: "",
        isPrimary: true,
        notes: "",
      },
    ],
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

export function makePatientContactFormId(prefix = "patient-contact") {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function patientContactsToForm(detail: PatientDetail): PatientContactFormState[] {
  const contacts = (detail.contacts ?? []).flatMap(
    (contact, index): PatientContactFormState[] => {
      const value = contact.value.trim();
      if (!value) return [];
      return [
        {
          id: contact.id ?? makePatientContactFormId(`patient-contact-${index}`),
          contactKind: contact.contact_kind === "email" ? "email" : "phone",
          contactType:
            contact.contact_type === "work" || contact.contact_type === "other"
              ? contact.contact_type
              : "private",
          value,
          isPrimary: contact.is_primary,
          notes: contact.notes ?? "",
        },
      ];
    },
  );

  if (contacts.length === 0) {
    if (detail.phone_primary) {
      contacts.push({
        id: makePatientContactFormId("patient-phone-primary"),
        contactKind: "phone",
        contactType: "private",
        value: detail.phone_primary,
        isPrimary: true,
        notes: "",
      });
    }
    if (detail.phone_secondary) {
      contacts.push({
        id: makePatientContactFormId("patient-phone-secondary"),
        contactKind: "phone",
        contactType: "private",
        value: detail.phone_secondary,
        isPrimary: false,
        notes: "",
      });
    }
    if (detail.email) {
      contacts.push({
        id: makePatientContactFormId("patient-email"),
        contactKind: "email",
        contactType: "private",
        value: detail.email,
        isPrimary: true,
        notes: "",
      });
    }
  }

  return normalizePatientContactForms(contacts.length > 0 ? contacts : blankPatientForm().contacts);
}

export function normalizePatientContactForms(contacts: PatientContactFormState[]) {
  return contacts.map((contact, _index, all) => {
    const sameKind = all.filter((item) => item.contactKind === contact.contactKind);
    const firstPrimary = sameKind.find((item) => item.isPrimary);
    if (firstPrimary) {
      return { ...contact, isPrimary: contact.id === firstPrimary.id };
    }
    return { ...contact, isPrimary: sameKind[0]?.id === contact.id };
  });
}

export function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function patientContactFormsToPayload(contacts: PatientContactFormState[]) {
  const normalized: PatientContactPayload[] = normalizePatientContactForms(contacts).flatMap(
    (contact) => {
      const value = contact.value.trim();
      if (!value) return [];
      return [
        {
          contact_kind: contact.contactKind,
          contact_type: contact.contactType,
          value,
          is_primary: contact.isPrimary,
          notes: toOptional(contact.notes),
        },
      ];
    },
  );
  const phones = normalized.filter((contact) => contact.contact_kind === "phone");
  const emails = normalized.filter((contact) => contact.contact_kind === "email");
  const primaryPhone = phones.find((contact) => contact.is_primary) ?? phones[0];
  const secondaryPhone =
    phones.find((contact) => contact !== primaryPhone) ??
    phones.find((contact) => contact.value !== primaryPhone?.value);
  const primaryEmail = emails.find((contact) => contact.is_primary) ?? emails[0];

  return {
    contacts: normalized,
    phonePrimary: primaryPhone?.value ?? "",
    phoneSecondary: secondaryPhone?.value ?? "",
    email: primaryEmail?.value ?? "",
  };
}

export function parseLanguages(value: string) {
  return value.split(",").flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });
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
    contacts: patientContactsToForm(detail),
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
  const parts = [patient.title, patient.first_name, patient.last_name].flatMap((part) => {
    const trimmed = part?.trim();
    return trimmed ? [trimmed] : [];
  });
  return parts.join(" ").trim();
}

export function buildPatientsPath(filters: PatientFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  // Server defaults active_only=true, so we always pass it explicitly:
  //   "true"   → only active rows from the server
  //   "false"  → only inactive (server returns all, client filters)
  //   ""       → "All" filter, also returns all from the server
  params.set("active_only", filters.activeOnly === "true" ? "true" : "false");
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
