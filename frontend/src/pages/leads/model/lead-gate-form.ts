import { isValidEmailAddress } from "@/lib/contact-validation";
import { isValidPersonPhone } from "@/lib/person-fields";

import type { LeadGateForm } from "./types";

type Tx = (ru: string, de: string) => string;

/** The fields of «Данные для квалификации» that can be refused at the field. */
export type LeadGateField = "email" | "phone" | "dateOfBirth" | "legalSex";
export type LeadGateErrors = Partial<Record<LeadGateField, string>>;

/** The earliest date of birth staff may store (the wizard and the server use the same). */
export const EARLIEST_GATE_BIRTH_DATE = "1900-01-01";

/** The API field of a 422 (`field`) as the gate form names it. */
export const GATE_SERVER_FIELDS: Record<string, LeadGateField> = {
  email: "email",
  phone: "phone",
  date_of_birth: "dateOfBirth",
  legal_sex: "legalSex",
};

const changed = (value: string, stored: string) => value.trim() !== "" && value.trim() !== stored.trim();

/**
 * What the side-panel form refuses before it is sent: a new or changed
 * e-mail or phone must be usable (an older stored value does not block
 * unrelated edits, as on the server), a date of birth not in the future and
 * not before 01.01.1900. `today` is the app date key (YYYY-MM-DD).
 */
export function leadGateFormErrors(
  form: LeadGateForm,
  stored: LeadGateForm,
  today: string,
  tx: Tx,
): LeadGateErrors {
  const errors: LeadGateErrors = {};
  if (changed(form.email, stored.email) && !isValidEmailAddress(form.email.trim())) {
    errors.email = tx("Введите корректный адрес электронной почты", "Gültige E-Mail-Adresse eingeben");
  }
  if (changed(form.phone, stored.phone) && !isValidPersonPhone(form.phone)) {
    errors.phone = tx("Введите корректный номер телефона (не менее 6 цифр)", "Gültige Telefonnummer eingeben (mindestens 6 Ziffern)");
  }
  const birthDate = form.dateOfBirth.trim();
  if (birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || birthDate > today || birthDate < EARLIEST_GATE_BIRTH_DATE)) {
    errors.dateOfBirth = tx(
      "Дата рождения в формате ДД.ММ.ГГГГ, не в будущем и не раньше 01.01.1900",
      "Geburtsdatum im Format TT.MM.JJJJ, nicht in der Zukunft und nicht vor dem 01.01.1900",
    );
  }
  return errors;
}
