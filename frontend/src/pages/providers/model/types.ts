export type ProviderType = "medical" | "non_medical";
export type ProviderOrganizationLevel = "organization" | "clinic" | "department" | "unit";
type ServicePriceType = "fixed" | "range" | "on_request";
export type ProviderPersonGender = "male" | "female" | "unknown";
export type DoctorRoleCode =
  | "clinical_director"
  | "chefarzt"
  | "oberarzt"
  | "facharzt"
  | "assistenzarzt"
  | "other";

export type SpecializationItem = {
  id: string;
  code: string;
  name_en: string;
  name_de: string | null;
  name_ru: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  is_primary?: boolean;
};

export type ProviderStaffRoleItem = {
  id: string;
  code: string;
  name_en: string;
  name_de: string | null;
  name_ru: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type InsuranceProviderItem = {
  id: string;
  name: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ProviderTaxonomyNode = {
  id: string;
  parent_id: string | null;
  code: string;
  level: "category" | "group" | "subgroup" | "type";
  provider_kind: ProviderType;
  name_en: string;
  name_de: string | null;
  name_ru: string | null;
  description: string | null;
  filter_keys: string[];
  is_leaf: boolean;
  is_assignable: boolean;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

export type ProviderTaxonomyResponse = {
  nodes: ProviderTaxonomyNode[];
  leaves: ProviderTaxonomyNode[];
};

export type PersonContact = {
  id: string | null;
  contact_kind: "phone" | "email";
  contact_type: "work" | "private" | "other";
  value: string;
  is_primary: boolean;
  notes: string | null;
};

type ProviderContact = {
  id: string | null;
  contact_kind: "phone" | "email";
  contact_type: "work" | "department" | "other";
  label: string | null;
  department: string | null;
  value: string;
  is_primary: boolean;
  notes: string | null;
};

export type PersonContactFormState = {
  id: string;
  contactKind: "phone" | "email";
  contactType: "work" | "private" | "other";
  value: string;
  isPrimary: boolean;
  notes: string;
};

type DoctorContactFormState = PersonContactFormState;

export type ProviderContactFormState = {
  id: string;
  contactKind: "phone" | "email";
  contactType: "work" | "department" | "other";
  label: string;
  department: string;
  value: string;
  isPrimary: boolean;
  notes: string;
};

export type DoctorRelationship = {
  id: string;
  source_doctor_id: string;
  target_doctor_id: string;
  target_doctor_name: string;
  target_doctor_title: string | null;
  target_provider_id: string;
  target_provider_name: string;
  relationship_type: "professional" | "referral" | "knows" | "approach_via" | "other";
  description: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

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
  opening_hours: string | null;
  parent_provider_id: string | null;
  parent_provider_name: string | null;
  organization_level: ProviderOrganizationLevel;
  taxonomy_node_id?: string | null;
  taxonomy_node_ids?: string[];
  taxonomy_filter_ids?: string[];
  taxonomy_node?: ProviderTaxonomyNode | null;
  taxonomy_path?: ProviderTaxonomyNode[];
  taxonomy_attributes?: Record<string, unknown>;
  specializations: SpecializationItem[];
  insurance_providers: InsuranceProviderItem[];
  doctor_insurance_providers?: InsuranceProviderItem[];
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
  internal_rating?: number | null;
  internal_rating_note?: string | null;
  last_interaction_at: string | null;
  created_at: string;
};

export type LinkedPatient = {
  id: string;
  patient_id: string;
  first_name: string;
  last_name: string;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  appointment_count: number;
  leistung_count: number;
  concierge_count: number;
  last_interaction_at: string;
};

type InteractionItem = {
  kind: string;
  id: string;
  patient_uuid?: string | null;
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
  shared_identity_id: string | null;
  name: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  title: string | null;
  fachbereich: string | null;
  specializations: SpecializationItem[];
  insurance_providers: InsuranceProviderItem[];
  languages: string[];
  phone: string | null;
  email: string | null;
  contacts: PersonContact[];
  role_code: DoctorRoleCode | null;
  role_label: string | null;
  subrole: string | null;
  website: string | null;
  schwerpunkt: string | null;
  gender: ProviderPersonGender;
  opening_hours: string | null;
  relationships: DoctorRelationship[];
  linked_patients?: LinkedPatient[];
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
  taxonomy_node_id?: string | null;
  taxonomy_node?: ProviderTaxonomyNode | null;
  taxonomy_attributes?: Record<string, unknown>;
  price: string;
  price_type: ServicePriceType;
  price_from: string | null;
  price_to: string | null;
  price_note: string | null;
  currency: string;
  valid_from: string;
  valid_to: string | null;
  created_at: string;
};

export type ProviderStaff = {
  id: string;
  provider_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  role: string;
  department: string | null;
  gender: ProviderPersonGender;
  opening_hours: string | null;
  status: "active" | "inactive" | "external" | "unknown";
  notes: string | null;
  is_active: boolean;
  contacts: PersonContact[];
  created_at: string;
  updated_at: string;
};

type ProviderChild = {
  id: string;
  name: string;
  provider_type: ProviderType;
  organization_level: ProviderOrganizationLevel;
  address_city: string | null;
  address_country: string | null;
  is_active: boolean;
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
  opening_hours: string | null;
  contacts: ProviderContact[];
  website: string | null;
  fachbereich: string | null;
  specializations: SpecializationItem[];
  insurance_providers: InsuranceProviderItem[];
  parent_provider_id: string | null;
  parent_provider_name: string | null;
  organization_level: ProviderOrganizationLevel;
  taxonomy_node_id: string | null;
  taxonomy_node_ids?: string[];
  taxonomy_filter_ids?: string[];
  taxonomy_node: ProviderTaxonomyNode | null;
  taxonomy_path: ProviderTaxonomyNode[];
  taxonomy_attributes: Record<string, unknown>;
  kooperationsvertrag: unknown;
  internal_rating: number | null;
  internal_rating_note: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  doctors: DoctorSummary[];
  services: ServiceItem[];
  staff: ProviderStaff[];
  children: ProviderChild[];
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
  specializations: string;
  doctorName: string;
  doctorFachbereich: string;
  serviceName: string;
  hasContract: string;
  ratingGte: string;
  taxonomyNodeId: string;
  taxonomyAttributeKey: string;
  taxonomyAttributeValue: string;
  internalRatingGte: string;
  insuranceProvider: string;
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
  contacts: ProviderContactFormState[];
  website: string;
  openingHours: string;
  fachbereich: string;
  specializations: string;
  insuranceProviders: string;
  parentProviderId: string;
  organizationLevel: ProviderOrganizationLevel;
  taxonomyNodeId: string;
  taxonomyAttributes: string;
  internalRating: string;
  internalRatingNote: string;
  contractText: string;
  notes: string;
};

export type DoctorFormState = {
  id: string;
  sharedIdentityId: string;
  name: string;
  firstName: string;
  lastName: string;
  title: string;
  roleCode: "" | DoctorRoleCode;
  roleLabel: string;
  subrole: string;
  website: string;
  schwerpunkt: string;
  gender: ProviderPersonGender;
  openingHours: string;
  fachbereich: string;
  specializations: string;
  insuranceProviders: string;
  languages: string;
  phone: string;
  email: string;
  privatePhone: string;
  privateEmail: string;
  contacts: DoctorContactFormState[];
  licenseNumber: string;
  licensingCountry: string;
  licensingValidUntil: string;
  notes: string;
};

export type ServiceFormState = {
  id: string;
  serviceName: string;
  description: string;
  taxonomyNodeId: string;
  taxonomyAttributes: string;
  price: string;
  priceType: ServicePriceType;
  priceFrom: string;
  priceTo: string;
  priceNote: string;
  currency: string;
  validFrom: string;
  validTo: string;
};

export type StaffFormState = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: string;
  department: string;
  gender: ProviderPersonGender;
  openingHours: string;
  status: "active" | "inactive" | "external" | "unknown";
  phone: string;
  email: string;
  privatePhone: string;
  privateEmail: string;
  contacts: PersonContactFormState[];
  notes: string;
};

export type ProviderPermissions = {
  canViewPage: boolean;
  canManageRegistry: boolean;
  forceNonMedical: boolean;
};
