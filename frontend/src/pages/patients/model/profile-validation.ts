import { isValidEmailAddress, isValidPhoneNumber } from "@/lib/contact-validation";

import type {
  PatientContactFormState,
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
} as const;

/**
 * Checks the patient profile the way the lead wizard checks its master data,
 * with the app's own messages instead of the browser's: required personal
 * data, e-mail addresses and phone numbers (empty optional contacts are
 * allowed), and a named trusted contact, with a phone for a minor. Returns
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
    // A blank row is dropped on save.
    if (!name && !phone && !contact.notes.trim()) continue;
    if (!name) errors[patientProfileFieldKey.trustedName(contact.id)] = messages.required;
    if (isMinor && !phone) errors[patientProfileFieldKey.trustedPhone(contact.id)] = messages.required;
  }
  return errors;
}
