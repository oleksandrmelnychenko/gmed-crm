import type {
  PersonContact,
  ProviderPersonGender,
  ProviderType,
  SpecializationItem,
} from "./types";

export type ProviderPeoplePersonType = "doctor" | "staff";

export type ProviderPeopleCounts = {
  patient_count?: number;
  appointment_count?: number;
  leistung_count?: number;
  concierge_count?: number;
  service_count?: number;
  order_count?: number;
  interaction_count?: number;
  [key: string]: number | undefined;
};

export type ProviderPeopleRow = {
  person_type: ProviderPeoplePersonType;
  person_id: string;
  provider_id: string;
  provider_name: string;
  provider_type: ProviderType;
  name: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  title: string | null;
  role_code: string | null;
  role_label: string | null;
  subrole?: string | null;
  gender: ProviderPersonGender;
  opening_hours: string | null;
  fachbereich: string | null;
  specializations: SpecializationItem[];
  languages: string[];
  phone: string | null;
  email: string | null;
  contacts: PersonContact[];
  department: string | null;
  status: "active" | "inactive" | "external" | "unknown";
  license_number: string | null;
  licensing_country: string | null;
  licensing_valid_until: string | null;
  notes: string | null;
  counts: ProviderPeopleCounts;
  last_interaction_at: string | null;
};

export type ProviderPeopleResponse = ProviderPeopleRow[];

export type ProviderPeopleFilters = {
  search: string;
  personType: "" | ProviderPeoplePersonType;
  providerId: string;
  providerType: "" | ProviderType;
  gender: "" | ProviderPersonGender;
  fachbereich: string;
  specialization: string;
  role: string;
  patientId: string;
};

export const DEFAULT_PROVIDER_PEOPLE_FILTERS: ProviderPeopleFilters = {
  search: "",
  personType: "",
  providerId: "",
  providerType: "",
  gender: "",
  fachbereich: "",
  specialization: "",
  role: "",
  patientId: "",
};

export type ProviderPeoplePatientOption = {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
};
