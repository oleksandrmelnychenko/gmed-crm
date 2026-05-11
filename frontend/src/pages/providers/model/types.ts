export type ProviderType = "medical" | "non_medical";

export type ProviderSummary = {
  id: string;
  name: string;
  provider_type: ProviderType;
  legal_name: string | null;
  tax_id: string | null;
  address_city: string | null;
  address_country: string | null;
  fachbereich: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  has_contract: boolean;
  doctor_count: number;
  patient_count: number;
  appointment_count: number;
  service_count: number;
  concierge_service_count: number;
  open_concierge_service_count: number;
  rating_count: number;
  avg_rating: number | null;
  last_interaction_at: string | null;
  created_at: string;
};

export type LinkedPatient = {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  appointment_count: number;
  leistung_count: number;
  concierge_count: number;
  last_interaction_at: string;
};

type InteractionItem = {
  kind: string;
  id: string;
  patient_id: string;
  patient_name: string;
  doctor_id: string | null;
  doctor_name: string | null;
  order_id: string | null;
  order_number: string | null;
  status: string;
  title: string;
  appointment_type: string | null;
  location: string | null;
  notes: string | null;
  occurred_at: string;
  quantity: string | null;
  unit_price: string | null;
  currency: string | null;
};

export type DoctorSummary = {
  id: string;
  provider_id: string;
  name: string;
  title: string | null;
  fachbereich: string | null;
  languages: string[];
  phone: string | null;
  email: string | null;
  license_number: string | null;
  licensing_country: string | null;
  licensing_valid_until: string | null;
  notes: string | null;
  patient_count: number;
  appointment_count: number;
  created_at: string;
};

export type ServiceItem = {
  id: string;
  provider_id: string;
  service_name: string;
  description: string | null;
  price: string;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};

export type ProviderDetail = {
  id: string;
  name: string;
  provider_type: ProviderType;
  legal_name: string | null;
  tax_id: string | null;
  address_street: string | null;
  address_city: string | null;
  address_zip: string | null;
  address_country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  fachbereich: string | null;
  kooperationsvertrag: unknown;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  doctors: DoctorSummary[];
  services: ServiceItem[];
  linked_patients: LinkedPatient[];
  interactions: InteractionItem[];
};

export type CreateResponse = {
  id: string;
  created_at?: string;
};

export type ProviderFilters = {
  search: string;
  providerType: string;
  activeOnly: string;
  city: string;
  country: string;
  fachbereich: string;
  doctorName: string;
  doctorFachbereich: string;
  serviceName: string;
  hasContract: string;
  ratingGte: string;
};

export type ProviderFormState = {
  name: string;
  providerType: ProviderType;
  legalName: string;
  taxId: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  addressCountry: string;
  phone: string;
  email: string;
  website: string;
  fachbereich: string;
  contractText: string;
  notes: string;
};

export type DoctorFormState = {
  id: string;
  name: string;
  title: string;
  fachbereich: string;
  languages: string;
  phone: string;
  email: string;
  licenseNumber: string;
  licensingCountry: string;
  licensingValidUntil: string;
  notes: string;
};

export type ServiceFormState = {
  id: string;
  serviceName: string;
  description: string;
  price: string;
  currency: string;
  validFrom: string;
  validTo: string;
};

export type ProviderPermissions = {
  canViewPage: boolean;
  canManageRegistry: boolean;
  forceNonMedical: boolean;
};
