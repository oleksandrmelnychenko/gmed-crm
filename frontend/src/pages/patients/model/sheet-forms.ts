import type { PatientLegalStatus } from "./legal-status";
import { normalizePatientLegalStatus } from "./legal-status";
import { normalizeCitizenships } from "@/components/ui/citizenship-multi-select";
import { countryCodeFromStoredValue } from "@/components/ui/country-select";
import { nationalityCountryCode } from "./nationalities";

import {
  patientContactsToForm,
  type PatientContactFormState,
  type PatientDetail,
} from "./list-model";
import type { DocumentStatus, DocumentVisibility, RelationItem } from "./detail-tab-types";

export type RelationFormState = {
  relatedPatientId: string;
  relatedName: string;
  relationType: string;
  isEmergencyContact: boolean;
  phone: string;
  notes: string;
  /** Where invoices to this relative go (Rechnungsanschrift). */
  email: string;
  addressStreet: string;
  addressZip: string;
  addressCity: string;
  addressCountry: string;
  /** Receives the patient's invoices unless an order names another payer. */
  isDefaultPayer: boolean;
  /**
   * A separate contact is an organisation (company, foundation, insurer): the sanctions screening
   * compares it with the listed entities by its whole name. A linked patient record is a person.
   */
  isOrganisation: boolean;
};

export type DocumentUploadFormState = {
  file: File | null;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  notes: string;
  orderId: string;
  appointmentId: string;
};

export type PatientEditFormState = {
  title: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  gender: string;
  phonePrimary: string;
  phoneSecondary: string;
  email: string;
  contacts: PatientContactFormState[];
  nationality: string;
  /** ISO codes; several citizenships. Saved with `nationality` = the first one. */
  citizenships: string[];
  residenceCountry: string;
  languages: string;
  functionalLabels: string;
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
  passportNumber: string;
  passportExpiry: string;
  legalStatus: PatientLegalStatus;
  clinicalWarnings: string;
  notes: string;
};

export function blankRelationForm(): RelationFormState {
  return {
    relatedPatientId: "",
    relatedName: "",
    relationType: "other",
    isEmergencyContact: false,
    phone: "",
    notes: "",
    email: "",
    addressStreet: "",
    addressZip: "",
    addressCity: "",
    addressCountry: "",
    isDefaultPayer: false,
    isOrganisation: false,
  };
}

/**
 * Legal forms that mark a name as an organisation's, as the server's guess for relations without an
 * answer (`ORGANISATION_LEGAL_FORMS` in crates/server/src/sanctions/screening.rs). Only a hint for a
 * new relation's box; the box staff tick or untick is what the server stores.
 */
const ORGANISATION_LEGAL_FORMS = new Set([
  "gmbh", "mbh", "ag", "kg", "kgaa", "ohg", "ug", "llc", "ltd", "limited", "inc", "corp", "plc",
  "llp", "jsc", "pjsc", "ojsc", "cjsc", "ooo", "oao", "zao", "pao", "sarl", "srl", "spa", "bv",
  "nv", "fze", "ооо", "оао", "зао", "пао", "тов", "пат",
]);

/** Whether a typed name carries a legal form ("Beispiel GmbH", "ООО Полартек"). */
export function relationNameSuggestsOrganisation(name: string): boolean {
  return name
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word !== "" && ORGANISATION_LEGAL_FORMS.has(word.toLocaleLowerCase()));
}

export function relationToForm(relation: RelationItem): RelationFormState {
  return {
    relatedPatientId: relation.related_patient_id ?? "",
    relatedName: relation.related_name,
    relationType: relation.relation_type,
    isEmergencyContact: relation.is_emergency_contact,
    phone: relation.phone ?? "",
    notes: relation.notes ?? "",
    email: relation.email ?? "",
    addressStreet: relation.address_street ?? "",
    addressZip: relation.address_zip ?? "",
    addressCity: relation.address_city ?? "",
    // The country picker stores ISO codes (QA 2026-10-11 B-25). An older
    // free-text country it recognises ("Deutschland", "Germany") is saved as
    // its code with the next save; anything else is kept as written.
    addressCountry: countryCodeFromStoredValue(relation.address_country),
    isDefaultPayer: relation.is_default_payer ?? false,
    // The server answers how the contact is screened: the stored box, or for an older row the
    // legal form in its name; saving stores it.
    isOrganisation: !relation.related_patient_id && relation.is_organisation === true,
  };
}

/**
 * Relation payload for create/update. The billing fields are always sent
 * (blank clears them) so the server never keeps stale invoice addresses.
 */
export function relationFormToPayload(
  form: RelationFormState,
  relatedName: string,
): Record<string, unknown> {
  const optional = (value: string) => value.trim() || null;
  return {
    related_patient_id: form.relatedPatientId || undefined,
    related_name: relatedName.trim(),
    relation_type: form.relationType,
    is_emergency_contact: form.isEmergencyContact,
    phone: optional(form.phone),
    notes: optional(form.notes),
    email: form.email.trim(),
    address_street: form.addressStreet.trim(),
    address_zip: form.addressZip.trim(),
    address_city: form.addressCity.trim(),
    address_country: form.addressCountry.trim(),
    is_default_payer: form.isDefaultPayer,
    // A linked patient record is a person; the server stores no answer for it.
    is_organisation: form.relatedPatientId ? null : form.isOrganisation,
  };
}

/**
 * The multipart body of "Upload document" in the patient card. The medical
 * flag is always sent as chosen ("false" when unticked): without it the server
 * classified the upload itself. An empty type is left out, so the server
 * classifies the file (e.g. a passport scan as an identity document, which is
 * never medical) instead of storing the former default type "report", a
 * medical report (QA 2026-10-12 B2-04).
 */
export function buildPatientDocumentUploadFormData(
  form: DocumentUploadFormState,
  patientId: string,
  file: Blob,
): FormData {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("patient_id", patientId);
  if (form.orderId) formData.append("order_id", form.orderId);
  if (form.appointmentId) formData.append("appointment_id", form.appointmentId);
  if (form.autoName.trim()) formData.append("auto_name", form.autoName.trim());
  if (form.art.trim()) formData.append("art", form.art.trim());
  if (form.category.trim()) formData.append("category", form.category.trim());
  formData.append("status", form.status);
  formData.append("visibility", form.visibility);
  formData.append("is_medical", form.isMedical ? "true" : "false");
  if (form.notes.trim()) formData.append("notes", form.notes.trim());
  return formData;
}

export function blankDocumentUploadForm(): DocumentUploadFormState {
  return {
    file: null,
    autoName: "",
    art: "",
    category: "",
    status: "active",
    visibility: "internal",
    isMedical: true,
    notes: "",
    orderId: "",
    appointmentId: "",
  };
}

export function patientToEditForm(detail: PatientDetail): PatientEditFormState {
  return {
    title: detail.title ?? "",
    firstName: detail.first_name ?? "",
    lastName: detail.last_name ?? "",
    birthDate: detail.birth_date ?? "",
    gender: detail.gender ?? "male",
    phonePrimary: detail.phone_primary ?? "",
    phoneSecondary: detail.phone_secondary ?? "",
    email: detail.email ?? "",
    contacts: patientContactsToForm(detail),
    nationality: detail.nationality ?? "",
    citizenships: detail.citizenships?.length
      ? normalizeCitizenships(detail.citizenships)
      : normalizeCitizenships([nationalityCountryCode(detail.nationality)]),
    residenceCountry: detail.residence_country ?? "",
    languages: detail.languages?.join(", ") ?? "",
    functionalLabels: detail.functional_labels?.join(", ") ?? "",
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
    passportNumber: detail.passport_number ?? "",
    passportExpiry: detail.passport_expiry ?? "",
    legalStatus: normalizePatientLegalStatus(detail.legal_status),
    clinicalWarnings: detail.clinical_warnings ?? "",
    notes: detail.notes ?? "",
  };
}
