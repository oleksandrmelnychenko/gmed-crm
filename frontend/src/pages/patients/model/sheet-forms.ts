import type { PatientLegalStatus } from "./legal-status";
import { normalizePatientLegalStatus } from "./legal-status";

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
  };
}

export function relationToForm(relation: RelationItem): RelationFormState {
  return {
    relatedPatientId: relation.related_patient_id ?? "",
    relatedName: relation.related_name,
    relationType: relation.relation_type,
    isEmergencyContact: relation.is_emergency_contact,
    phone: relation.phone ?? "",
    notes: relation.notes ?? "",
  };
}

export function blankDocumentUploadForm(): DocumentUploadFormState {
  return {
    file: null,
    autoName: "",
    art: "report",
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
