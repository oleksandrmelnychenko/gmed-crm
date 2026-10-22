import { useId } from "react";
import { Mail, Phone, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { checkboxClass } from "@/components/ui-shell";
import { EmailDomainWarning } from "@/components/email-domain-warning";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type {
  PatientContactFormState,
  PatientFormState,
  PatientTrustedContactFormState,
} from "../../model/list-model";
import {
  computeAge,
  makePatientContactFormId,
  makePatientTrustedContactForm,
  normalizePatientContactForms,
} from "../../model/list-model";
import { newPatientFieldKey } from "../../model/profile-validation";
import {
  CountrySelect,
  Field,
  PatientFormSection as FormSection,
  FunctionalLabelChips,
  LanguageChips,
  NationalitySelect,
  formInputClassName,
  textareaClassName,
} from "./patient-form-primitives";

function isGuardianOrParentRelation(value: string) {
  return ["guardian", "parent", "mother", "father"].includes(value.trim());
}

/**
 * The validation messages of one form instance and the prefix of its field
 * ids (the list's detail pane and the create sheet can be open together).
 */
type PatientFieldErrors = {
  messages: Record<string, string>;
  idPrefix: string;
};

function fieldDomId(fieldKey: string, fieldErrors: PatientFieldErrors) {
  return `${fieldErrors.idPrefix}-${fieldKey.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}

/** id and ARIA state of a field that may carry a validation error. */
function fieldErrorProps(fieldKey: string, fieldErrors: PatientFieldErrors) {
  const id = fieldDomId(fieldKey, fieldErrors);
  const invalid = Boolean(fieldErrors.messages[fieldKey]);
  return {
    id,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? `${id}-error` : undefined,
  };
}

function FieldErrorText({
  fieldKey,
  fieldErrors,
}: {
  fieldKey: string;
  fieldErrors: PatientFieldErrors;
}) {
  const message = fieldErrors.messages[fieldKey];
  if (!message) return null;
  return (
    <p id={`${fieldDomId(fieldKey, fieldErrors)}-error`} className="text-xs text-destructive">
      {message}
    </p>
  );
}

const NO_FIELD_ERRORS: Record<string, string> = {};

type PatientFormFieldsProps = {
  form: PatientFormState;
  onChange: (field: keyof PatientFormState, value: string) => void;
  onContactsChange?: (contacts: PatientContactFormState[]) => void;
  onTrustedContactsChange?: (contacts: PatientTrustedContactFormState[]) => void;
  contactMode?: "simple" | "multiple";
  includeBirthAndGender?: boolean;
  readOnly?: boolean;
  /** Messages per field key (`newPatientFieldKey`), shown under the fields. */
  fieldErrors?: Record<string, string>;
};

type PatientFormTranslations = ReturnType<typeof useLang>["t"];
type PatientFormText = (key: string) => string;
type PatientFormChange = (field: keyof PatientFormState, value: string) => void;

const contactAddButtonClassName =
  "h-8 rounded-lg border-[var(--brand)] bg-[var(--brand)] px-3 text-white shadow-sm hover:bg-[var(--brand)]/90 hover:text-white focus-visible:ring-[var(--brand)]/30";

function contactAddLabel(
  contactKind: PatientContactFormState["contactKind"],
  t: PatientFormTranslations,
  lang: "de" | "ru",
) {
  const addLabel = t.uiText.patients_add ?? "Добавить";
  if (lang === "de") {
    return `${contactKind === "email" ? t.field_email : t.field_phone} ${addLabel}`;
  }
  return contactKind === "email"
    ? `${addLabel} электронную почту`
    : `${addLabel} телефон`;
}

export function PatientFormFields({
  form,
  onChange,
  onContactsChange,
  onTrustedContactsChange,
  contactMode = "simple",
  includeBirthAndGender = false,
  readOnly = false,
  fieldErrors: fieldErrorMessages = NO_FIELD_ERRORS,
}: PatientFormFieldsProps) {
  const { t, lang } = useLang();
  const fieldIdPrefix = useId();
  const fieldErrors: PatientFieldErrors = {
    messages: fieldErrorMessages,
    idPrefix: `patient-form${fieldIdPrefix.replace(/[^a-zA-Z0-9-]/g, "")}`,
  };
  const l = (key: string) => t.uiText[key] ?? key;
  const age = computeAge(form.birthDate);
  const isMinor = includeBirthAndGender && age !== null && age < 18;
  const notSetLabel = t.common_not_set;
  const trustedRelationOptions = [
    ["spouse", t.patient_relation_type_spouse],
    ["parent", t.patient_relation_type_parent],
    ["mother", t.patient_relation_type_mother],
    ["father", t.patient_relation_type_father],
    ["child", t.patient_relation_type_child],
    ["sibling", t.patient_relation_type_sibling],
    ["relative", t.patient_relation_type_relative],
    ["guardian", t.patient_relation_type_guardian],
    ["caregiver", t.patient_relation_type_caregiver],
    ["friend", t.patient_relation_type_friend],
    ["other", t.patient_relation_type_other],
  ] as const;

  function handleBirthDateChange(value: string) {
    onChange("birthDate", value);
  }

  const addTrustedContact = () => {
    if (!onTrustedContactsChange || readOnly) return;
    onTrustedContactsChange([
      ...form.trustedContacts,
      makePatientTrustedContactForm(isMinor ? "guardian" : "other"),
    ]);
  };

  const updateTrustedContact = (
    contactId: string,
    patch: Partial<PatientTrustedContactFormState>,
  ) => {
    if (!onTrustedContactsChange || readOnly) return;
    onTrustedContactsChange(form.trustedContacts.map((contact) => (
      contact.id === contactId ? { ...contact, ...patch } : contact
    )));
  };

  const removeTrustedContact = (contactId: string) => {
    if (!onTrustedContactsChange || readOnly) return;
    onTrustedContactsChange(
      form.trustedContacts.filter((contact) => contact.id !== contactId),
    );
  };

  const updateContact = (
    contactId: string,
    patch: Partial<PatientContactFormState>,
  ) => {
    if (!onContactsChange || readOnly) return;
    const changedContact = form.contacts.find((contact) => contact.id === contactId);
    const changedContactKind = patch.contactKind ?? changedContact?.contactKind;
    const changedContacts = form.contacts.map((contact) => {
      const nextContact =
        contact.id === contactId ? { ...contact, ...patch } : contact;
      if (
        patch.isPrimary &&
        contact.id !== contactId &&
        changedContactKind &&
        nextContact.contactKind === changedContactKind
      ) {
        return { ...nextContact, isPrimary: false };
      }
      return nextContact;
    });
    onContactsChange(normalizePatientContactForms(changedContacts));
  };

  const addContact = (preferredKind?: PatientContactFormState["contactKind"]) => {
    if (!onContactsChange || readOnly) return;
    const hasPhone = form.contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = preferredKind ?? (hasPhone ? "email" : "phone");
    onContactsChange(
      normalizePatientContactForms([
        ...form.contacts,
        {
          id: makePatientContactFormId("patient-contact"),
          contactKind,
          contactType: "private",
          value: "",
          isPrimary: !form.contacts.some((contact) => contact.contactKind === contactKind),
          notes: "",
        },
      ]),
    );
  };

  const removeContact = (contactId: string) => {
    if (!onContactsChange || readOnly) return;
    onContactsChange(
      normalizePatientContactForms(
        form.contacts.filter((contact) => contact.id !== contactId),
      ),
    );
  };

  return (
    <div className="space-y-3">
      <PatientPersonalDataSection
        form={form}
        fieldErrors={fieldErrors}
        includeBirthAndGender={includeBirthAndGender}
        isMinor={isMinor}
        notSetLabel={notSetLabel}
        readOnly={readOnly}
        t={t}
        l={l}
        onBirthDateChange={handleBirthDateChange}
        onChange={onChange}
      />

      <PatientContactSection
        contactMode={contactMode}
        fieldErrors={fieldErrors}
        form={form}
        readOnly={readOnly}
        t={t}
        lang={lang}
        l={l}
        onAddContact={addContact}
        onChange={onChange}
        onRemoveContact={removeContact}
        onUpdateContact={updateContact}
      />

      <FormSection title={l("patients_address")}>
        <Field label={t.patients_address_street}>
          <Input
            value={form.addressStreet}
            onChange={(event) => onChange("addressStreet", event.target.value)}
            className={formInputClassName}
            disabled={readOnly}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_address_city}>
            <Input
              value={form.addressCity}
              onChange={(event) => onChange("addressCity", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
            />
          </Field>
          <Field label={t.patients_address_zip} htmlFor={fieldDomId(newPatientFieldKey.addressZip, fieldErrors)}>
            <Input
              {...fieldErrorProps(newPatientFieldKey.addressZip, fieldErrors)}
              value={form.addressZip}
              onChange={(event) => onChange("addressZip", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
              autoComplete="postal-code"
              maxLength={10}
            />
            <FieldErrorText fieldKey={newPatientFieldKey.addressZip} fieldErrors={fieldErrors} />
          </Field>
          <Field label={t.patients_address_country}>
            <CountrySelect
              value={form.addressCountry}
              onChange={(value) => onChange("addressCountry", value)}
              placeholder={notSetLabel}
              disabled={readOnly}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("patients_insurance")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_insurance_provider}>
            <Input
              value={form.insuranceProvider}
              onChange={(event) => onChange("insuranceProvider", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
            />
          </Field>
          <Field label={t.patients_insurance_number}>
            <Input
              value={form.insuranceNumber}
              onChange={(event) => onChange("insuranceNumber", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
            />
          </Field>
          <Field label={t.patients_insurance_type}>
            <NativeComboboxSelect value={form.insuranceType}
              onChange={(event) => onChange("insuranceType", event.target.value ?? "")} className={cn("w-full", formInputClassName)} disabled={readOnly}>
                <option value="">{t.common_not_set}</option>
                <option value="private">{t.insurance_private}</option>
                <option value="public">{t.insurance_public}</option>
                <option value="self_pay">{t.insurance_self_pay}</option>
                <option value="foreign">{t.insurance_foreign}</option>
              </NativeComboboxSelect>
          </Field>
        </div>
      </FormSection>

      <FormSection
        className={isMinor ? "border-amber-200 bg-amber-50/60" : undefined}
        title={
          isMinor
            ? l("patients_guardian_parent_contact")
            : l("patients_emergency_contact")
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {lang === "de"
              ? "Mehrere Kontakte und Vertretungen können hinterlegt werden."
              : "Можно добавить несколько контактов и представителей."}
          </p>
          {!readOnly ? (
            <Button
              id={fieldDomId(newPatientFieldKey.guardian, fieldErrors)}
              type="button"
              variant="outline"
              size="sm"
              className={cn(contactAddButtonClassName, "shrink-0 gap-1.5")}
              onClick={addTrustedContact}
              aria-describedby={
                fieldErrors.messages[newPatientFieldKey.guardian]
                  ? `${fieldDomId(newPatientFieldKey.guardian, fieldErrors)}-error`
                  : undefined
              }
            >
              <Plus className="size-3.5" />
              {lang === "de" ? "Kontakt hinzufügen" : "Добавить контакт"}
            </Button>
          ) : null}
        </div>
        <FieldErrorText fieldKey={newPatientFieldKey.guardian} fieldErrors={fieldErrors} />

        {form.trustedContacts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
            {lang === "de"
              ? "Noch keine Kontakte oder Vertretungen hinzugefügt."
              : "Контакты и представители пока не добавлены."}
          </div>
        ) : (
          <div className="space-y-2.5">
            {form.trustedContacts.map((contact, index) => {
              const contactHasData = Boolean(
                  contact.name.trim() || contact.phone.trim() || contact.email.trim() || contact.notes.trim(),
              );
              const relationOptions = isMinor
                ? trustedRelationOptions.filter(([value]) => isGuardianOrParentRelation(value))
                : trustedRelationOptions;
              return (
                <div key={contact.id} className="rounded-lg border border-border/70 bg-card p-3">
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold text-foreground">
                      {lang === "de" ? "Kontakt / Vertretung" : "Контакт / представитель"} {index + 1}
                    </p>
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={lang === "de" ? "Kontakt entfernen" : "Удалить контакт"}
                        onClick={() => removeTrustedContact(contact.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field
                      label={t.patients_emergency_name}
                      required={isMinor || contactHasData}
                      htmlFor={fieldDomId(newPatientFieldKey.trustedName(contact.id), fieldErrors)}
                    >
                      <Input
                        {...fieldErrorProps(newPatientFieldKey.trustedName(contact.id), fieldErrors)}
                        value={contact.name}
                        onChange={(event) => updateTrustedContact(contact.id, { name: event.target.value })}
                        className={formInputClassName}
                        disabled={readOnly}
                        required={isMinor || contactHasData}
                      />
                      <FieldErrorText fieldKey={newPatientFieldKey.trustedName(contact.id)} fieldErrors={fieldErrors} />
                    </Field>
                    <Field
                      label={t.patients_emergency_phone}
                      required={isMinor && !contact.email.trim()}
                      htmlFor={fieldDomId(newPatientFieldKey.trustedPhone(contact.id), fieldErrors)}
                    >
                      <Input
                        {...fieldErrorProps(newPatientFieldKey.trustedPhone(contact.id), fieldErrors)}
                        value={contact.phone}
                        onChange={(event) => updateTrustedContact(contact.id, { phone: event.target.value })}
                        className={formInputClassName}
                        disabled={readOnly}
                        required={isMinor && !contact.email.trim()}
                      />
                      <FieldErrorText fieldKey={newPatientFieldKey.trustedPhone(contact.id)} fieldErrors={fieldErrors} />
                    </Field>
                    <Field label={t.field_email} htmlFor={fieldDomId(newPatientFieldKey.trustedEmail(contact.id), fieldErrors)}>
                      <Input
                        {...fieldErrorProps(newPatientFieldKey.trustedEmail(contact.id), fieldErrors)}
                        type="email"
                        value={contact.email}
                        onChange={(event) => updateTrustedContact(contact.id, { email: event.target.value })}
                        className={formInputClassName}
                        disabled={readOnly}
                      />
                      <FieldErrorText fieldKey={newPatientFieldKey.trustedEmail(contact.id)} fieldErrors={fieldErrors} />
                      <EmailDomainWarning email={contact.email} enabled={!fieldErrors.messages[newPatientFieldKey.trustedEmail(contact.id)]} />
                    </Field>
                    <Field label={t.patients_emergency_relation} required>
                      <NativeComboboxSelect
                        value={
                          isMinor && !isGuardianOrParentRelation(contact.relation)
                            ? "guardian"
                            : contact.relation
                        }
                        onChange={(event) => updateTrustedContact(contact.id, {
                          relation: event.target.value ?? (isMinor ? "guardian" : "other"),
                        })}
                        className={cn("w-full", formInputClassName)}
                        disabled={readOnly}
                        required
                      >
                        {relationOptions.map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </NativeComboboxSelect>
                    </Field>
                  </div>
                  <Field label={t.patients_notes}>
                    <textarea
                      value={contact.notes}
                      onChange={(event) => updateTrustedContact(contact.id, { notes: event.target.value })}
                      className={cn(textareaClassName, "min-h-20")}
                      disabled={readOnly}
                      rows={2}
                    />
                  </Field>
                </div>
              );
            })}
          </div>
        )}
      </FormSection>

      <FormSection title={t.patients_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          disabled={readOnly}
          rows={4}
        />
      </FormSection>
    </div>
  );
}

function PatientPersonalDataSection({
  form,
  fieldErrors,
  includeBirthAndGender,
  isMinor,
  notSetLabel,
  readOnly,
  t,
  l,
  onBirthDateChange,
  onChange,
}: {
  form: PatientFormState;
  fieldErrors: PatientFieldErrors;
  includeBirthAndGender: boolean;
  isMinor: boolean;
  notSetLabel: string;
  readOnly: boolean;
  t: PatientFormTranslations;
  l: PatientFormText;
  onBirthDateChange: (value: string) => void;
  onChange: PatientFormChange;
}) {
  return (
    <FormSection title={l("patients_personal_data")}>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label={t.patients_title_field}>
          <Input
            value={form.title}
            onChange={(event) => onChange("title", event.target.value)}
            className={formInputClassName}
            disabled={readOnly}
          />
        </Field>
        <Field label={t.patients_first_name} required htmlFor={fieldDomId(newPatientFieldKey.firstName, fieldErrors)}>
          <Input
            {...fieldErrorProps(newPatientFieldKey.firstName, fieldErrors)}
            value={form.firstName}
            onChange={(event) => onChange("firstName", event.target.value)}
            className={formInputClassName}
            disabled={readOnly}
            required
          />
          <FieldErrorText fieldKey={newPatientFieldKey.firstName} fieldErrors={fieldErrors} />
        </Field>
        <Field label={t.patients_last_name} required htmlFor={fieldDomId(newPatientFieldKey.lastName, fieldErrors)}>
          <Input
            {...fieldErrorProps(newPatientFieldKey.lastName, fieldErrors)}
            value={form.lastName}
            onChange={(event) => onChange("lastName", event.target.value)}
            className={formInputClassName}
            disabled={readOnly}
            required
          />
          <FieldErrorText fieldKey={newPatientFieldKey.lastName} fieldErrors={fieldErrors} />
        </Field>
      </div>

      {includeBirthAndGender ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t.patients_birth_date} required htmlFor={fieldDomId(newPatientFieldKey.birthDate, fieldErrors)}>
            <Input
              {...fieldErrorProps(newPatientFieldKey.birthDate, fieldErrors)}
              type="date"
              value={form.birthDate}
              onChange={(event) => onBirthDateChange(event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
              required
            />
            <FieldErrorText fieldKey={newPatientFieldKey.birthDate} fieldErrors={fieldErrors} />
          </Field>
          {/* No preselected sex: a silent default was saved when nobody looked. */}
          <Field label={t.patients_gender} required htmlFor={fieldDomId(newPatientFieldKey.gender, fieldErrors)}>
            <NativeComboboxSelect
              {...fieldErrorProps(newPatientFieldKey.gender, fieldErrors)}
              value={form.gender}
              onChange={(event) => onChange("gender", event.target.value ?? "")}
              className={cn("w-full", formInputClassName)}
              disabled={readOnly}
              required
              hidePlaceholderOption
            >
              <option value="">{t.patient_form_choose_gender}</option>
              <option value="male">{t.gender_male}</option>
              <option value="female">{t.gender_female}</option>
              <option value="diverse">{t.gender_diverse}</option>
            </NativeComboboxSelect>
            <FieldErrorText fieldKey={newPatientFieldKey.gender} fieldErrors={fieldErrors} />
          </Field>
        </div>
      ) : null}

      {isMinor ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {l("patients_minor_guardian_notice")}
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <Field label={t.patients_nationality}>
          <NationalitySelect
            value={form.nationality}
            onChange={(value) => onChange("nationality", value)}
            placeholder={notSetLabel}
            disabled={readOnly}
          />
        </Field>
        <Field label={t.patients_residence_country}>
          <CountrySelect
            value={form.residenceCountry}
            onChange={(value) => onChange("residenceCountry", value)}
            placeholder={notSetLabel}
            disabled={readOnly}
          />
        </Field>
      </div>

      <Field label={t.patients_languages}>
        <LanguageChips
          value={form.languages}
          onChange={(next) => onChange("languages", next)}
          placeholder={l("patients_languages_select_placeholder")}
          disabled={readOnly}
        />
      </Field>

      <Field label={l("patients_functional_labels")}>
        <FunctionalLabelChips
          value={form.functionalLabels}
          onChange={(next) => onChange("functionalLabels", next)}
          disabled={readOnly}
        />
      </Field>
    </FormSection>
  );
}

function PatientContactSection({
  contactMode,
  fieldErrors,
  form,
  readOnly,
  t,
  lang,
  l,
  onAddContact,
  onChange,
  onRemoveContact,
  onUpdateContact,
}: {
  contactMode: "simple" | "multiple";
  fieldErrors: PatientFieldErrors;
  form: PatientFormState;
  readOnly: boolean;
  t: PatientFormTranslations;
  lang: "de" | "ru";
  l: PatientFormText;
  onAddContact: (contactKind?: PatientContactFormState["contactKind"]) => void;
  onChange: PatientFormChange;
  onRemoveContact: (contactId: string) => void;
  onUpdateContact: (
    contactId: string,
    patch: Partial<PatientContactFormState>,
  ) => void;
}) {
  const contactTypeLabel = (value: PatientContactFormState["contactType"]) => {
    if (value === "work") return l("providers_contact_type_work");
    if (value === "other") return l("providers_contact_type_other");
    return l("providers_contact_type_private");
  };
  const contactValueLabel = (contactKind: PatientContactFormState["contactKind"]) =>
    contactKind === "email" ? t.field_email : t.field_phone;

  return (
    <FormSection title={l("patients_contact")}>
      {contactMode === "multiple" ? (
        <div className="space-y-3">
          {form.contacts.map((contact) => (
            <div
              key={contact.id}
              className="min-w-0 rounded-lg border border-border/70 bg-muted/15 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]">
                    {contact.contactKind === "email" ? (
                      <Mail className="size-4" />
                    ) : (
                      <Phone className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="min-w-0 break-words text-[13px] font-semibold tracking-tight text-foreground">
                      {contactValueLabel(contact.contactKind)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {contactTypeLabel(contact.contactType)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={contact.isPrimary}
                      onChange={(event) =>
                        onUpdateContact(contact.id, { isPrimary: event.target.checked })
                      }
                      className={checkboxClass}
                      disabled={readOnly}
                    />
                    {l("providers_contact_primary")}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    title={t.common_remove}
                    aria-label={t.common_remove}
                    onClick={() => onRemoveContact(contact.id)}
                    disabled={readOnly}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(170px,1fr)_minmax(150px,1fr)_minmax(240px,2fr)]">
                <Field label={l("providers_contact_kind")}>
                  <NativeComboboxSelect
                    value={contact.contactKind}
                    onChange={(event) =>
                      onUpdateContact(contact.id, {
                        contactKind: event.target.value === "email" ? "email" : "phone",
                      })
                    }
                    className={cn("w-full", formInputClassName)}
                    disabled={readOnly}
                  >
                    <option value="phone">{t.field_phone}</option>
                    <option value="email">{t.field_email}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field label={l("providers_contact_type")}>
                  <NativeComboboxSelect
                    value={contact.contactType}
                    onChange={(event) =>
                      onUpdateContact(contact.id, {
                        contactType:
                          event.target.value === "work" ||
                          event.target.value === "other"
                            ? event.target.value
                            : "private",
                      })
                    }
                    className={cn("w-full", formInputClassName)}
                    disabled={readOnly}
                  >
                    <option value="private">{l("providers_contact_type_private")}</option>
                    <option value="work">{l("providers_contact_type_work")}</option>
                    <option value="other">{l("providers_contact_type_other")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label={contactValueLabel(contact.contactKind)}
                  className="sm:col-span-2 xl:col-span-1"
                  htmlFor={fieldDomId(newPatientFieldKey.contact(contact.id), fieldErrors)}
                >
                  <Input
                    {...fieldErrorProps(newPatientFieldKey.contact(contact.id), fieldErrors)}
                    type={contact.contactKind === "email" ? "email" : "tel"}
                    value={contact.value}
                    onChange={(event) =>
                      onUpdateContact(contact.id, { value: event.target.value })
                    }
                    className={formInputClassName}
                    disabled={readOnly}
                  />
                  <FieldErrorText fieldKey={newPatientFieldKey.contact(contact.id)} fieldErrors={fieldErrors} />
                  <EmailDomainWarning email={contact.value} enabled={contact.contactKind === "email" && !fieldErrors.messages[newPatientFieldKey.contact(contact.id)]} />
                </Field>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={contactAddButtonClassName}
              onClick={() => onAddContact("phone")}
              disabled={readOnly}
            >
              <Phone className="size-3.5" />
              {contactAddLabel("phone", t, lang)}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={contactAddButtonClassName}
              onClick={() => onAddContact("email")}
              disabled={readOnly}
            >
              <Mail className="size-3.5" />
              {contactAddLabel("email", t, lang)}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_phone_primary}>
            <Input
              value={form.phonePrimary}
              onChange={(event) => onChange("phonePrimary", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
            />
          </Field>
          <Field label={t.patients_phone_secondary}>
            <Input
              value={form.phoneSecondary}
              onChange={(event) => onChange("phoneSecondary", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
            />
          </Field>
          <Field label={t.patients_email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              className={formInputClassName}
              disabled={readOnly}
            />
            <EmailDomainWarning email={form.email} />
          </Field>
        </div>
      )}
    </FormSection>
  );
}
