import { isValidEmailAddress, isValidPhoneNumber } from "@/lib/contact-validation";

import type {
  PatientContactFormState,
  PatientFormState,
  PatientTrustedContactFormState,
} from "./list-model";
import type { PatientEditFormState } from "./sheet-forms";

export type PatientProfileValidationMessages = {
  required: string;
  invalidEmail: string;
  invalidPhone: string;
};

/** Field keys of the profile editor that can carry an error. */
export const patientProfileFieldKey = {
  firstName: "firstName",
  lastName: "lastName",
  birthDate: "birthDate",
  gender: "gender",
  contact: (contactId: string) => `contact:${contactId}`,
  trustedName: (contactId: string) => `trusted-name:${contactId}`,
  trustedPhone: (contactId: string) => `trusted-phone:${contactId}`,
  trustedEmail: (contactId: string) => `trusted-email:${contactId}`,
} as const;

/**
 * Checks the patient profile the way the lead wizard checks its master data,
 * with the app's own messages instead of the browser's: required personal
 * data, e-mail addresses and phone numbers (empty optional contacts are
 * allowed), and a named trusted contact, with phone or e-mail for a minor. Returns
 * the message per field key; an empty object means the profile can be saved.
 */
export function validatePatientProfileForm(
  form: Pick<PatientEditFormState, "firstName" | "lastName" | "birthDate" | "gender">,
  contacts: PatientContactFormState[],
  trustedContacts: PatientTrustedContactFormState[],
  isMinor: boolean,
  messages: PatientProfileValidationMessages,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.firstName.trim()) errors[patientProfileFieldKey.firstName] = messages.required;
  if (!form.lastName.trim()) errors[patientProfileFieldKey.lastName] = messages.required;
  if (!form.birthDate.trim()) errors[patientProfileFieldKey.birthDate] = messages.required;
  if (!form.gender.trim()) errors[patientProfileFieldKey.gender] = messages.required;

  for (const contact of contacts) {
    const value = contact.value.trim();
    if (!value) continue;
    if (contact.contactKind === "email" ? !isValidEmailAddress(value) : !isValidPhoneNumber(value)) {
      errors[patientProfileFieldKey.contact(contact.id)] =
        contact.contactKind === "email" ? messages.invalidEmail : messages.invalidPhone;
    }
  }

  for (const contact of trustedContacts) {
    const name = contact.name.trim();
    const phone = contact.phone.trim();
    const email = contact.email.trim();
    // A blank row is dropped on save.
    if (!name && !phone && !email && !contact.notes.trim()) continue;
    if (!name) errors[patientProfileFieldKey.trustedName(contact.id)] = messages.required;
    if (isMinor && !phone && !email) errors[patientProfileFieldKey.trustedPhone(contact.id)] = messages.required;
    if (phone && !isValidPhoneNumber(phone)) errors[patientProfileFieldKey.trustedPhone(contact.id)] = messages.invalidPhone;
    if (email && !isValidEmailAddress(email)) errors[patientProfileFieldKey.trustedEmail(contact.id)] = messages.invalidEmail;
  }
  return errors;
}

const GERMAN_POSTAL_CODE = /^\d{5}$/;
// Letters and digits, inner spaces and hyphens ("SW1A 1AA", "00-950").
const POSTAL_CODE = /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,8}[A-Za-z0-9])?$/;
const GERMANY_VALUES = new Set(["de", "deu", "germany", "deutschland", "германия", "німеччина"]);

/** Whether an address country (ISO code, or an older stored name) is Germany. */
export function isGermanyCountry(country: string | null | undefined) {
  return GERMANY_VALUES.has((country ?? "").trim().toLowerCase());
}

export type PostalCodeMessages = {
  zipGermany: string;
  zipInvalid: string;
};

/**
 * The postal-code check of an address: a German PLZ has five digits; other
 * countries' codes have letters, digits, spaces and hyphens (at most ten
 * characters). An empty code is no error — the address is optional.
 */
export function postalCodeError(
  zip: string,
  country: string | null | undefined,
  messages: PostalCodeMessages,
): string | undefined {
  const value = zip.trim();
  if (!value) return undefined;
  if (isGermanyCountry(country)) {
    return GERMAN_POSTAL_CODE.test(value) ? undefined : messages.zipGermany;
  }
  return POSTAL_CODE.test(value) ? undefined : messages.zipInvalid;
}

/**
 * The trusted contacts of a minor as the form shows them: the relation field
 * offers mother, father, parent and guardian and shows "guardian" for any other stored
 * relation, so that is what is checked and saved.
 */
export function withMinorGuardianRelations(
  contacts: PatientTrustedContactFormState[],
  isMinor: boolean,
): PatientTrustedContactFormState[] {
  if (!isMinor) return contacts;
  return contacts.map((contact) =>
    ["guardian", "parent", "mother", "father"].includes(contact.relation.trim())
      ? contact
      : { ...contact, relation: "guardian" },
  );
}

/** Field keys of the new-patient form beyond the profile ones. */
export const newPatientFieldKey = {
  ...patientProfileFieldKey,
  addressZip: "addressZip",
  guardian: "guardian",
} as const;

export type NewPatientValidationMessages = PatientProfileValidationMessages &
  PostalCodeMessages & {
    minorNeedsGuardian: string;
  };

/**
 * The new-patient form's checks with the app's own messages (the form has
 * `noValidate`, so the browser shows none): the profile checks, an explicit
 * sex, the postal code, and for a minor a parent or guardian with a contact.
 */
export function validateNewPatientForm(
  form: PatientFormState,
  isMinor: boolean,
  messages: NewPatientValidationMessages,
): Record<string, string> {
  const errors = validatePatientProfileForm(
    form,
    form.contacts,
    form.trustedContacts,
    isMinor,
    messages,
  );
  const zipError = postalCodeError(form.addressZip, form.addressCountry, messages);
  if (zipError) errors[newPatientFieldKey.addressZip] = zipError;
  if (
    isMinor &&
    !form.trustedContacts.some(
      (contact) =>
        ["guardian", "parent", "mother", "father"].includes(contact.relation) &&
        Boolean(contact.name.trim()) &&
        Boolean(contact.phone.trim() || contact.email.trim()),
    )
  ) {
    errors[newPatientFieldKey.guardian] = messages.minorNeedsGuardian;
  }
  return errors;
}
