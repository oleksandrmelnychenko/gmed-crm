import { hasFormChanges } from "@/lib/form-changes";
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import { Mail, Phone, Plus, Trash2 } from "lucide-react";

import {
  CountrySelect,
  FormSection,
  FunctionalLabelChips,
  LanguageChips,
  NationalitySelect,
  parseFunctionalLabels,
} from "../shared/patient-form-primitives";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  checkboxClass,
  inputClass as formInputClassName,
  textareaClass as formTextareaClassName,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import { updatePatient } from "../../data/patient-mutations";
import {
  deletePatientRelation,
  fetchPatientRelations,
  PATIENT_RELATIONS_UPDATED_EVENT,
  upsertPatientRelation,
} from "../../data/patient-detail-mutations";
import {
  computeAge,
  makePatientContactFormId,
  makePatientTrustedContactForm,
  normalizePatientContactForms,
  normalizePatientTrustedContactRelation,
  patientContactFormsToPayload,
  patientTrustedContactsFromRelations,
  type PatientContactFormState,
  type PatientDetail,
  type PatientTrustedContactFormState,
} from "../../model/list-model";
import { createPatientLeadOrigin } from "../../model/patient-lead-origin";
import {
  patientToEditForm,
  type PatientEditFormState,
} from "../../model/sheet-forms";
import {
  PATIENT_CONTRACT_STATUS_OPTIONS,
  serializePatientLegalStatus,
  type PatientLegalStatus,
} from "../../model/legal-status";
import { LegalStatusPill } from "../shared/legal-status-pill";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type PatientProfileEditorSheetProps = {
  open: boolean;
  patientId: string | undefined;
  detail: PatientDetail | null;
  dictionary: Record<string, string> & { uiText?: Record<string, string> };
  lang: string;
  statusLabel: (status: string) => string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

const contactAddButtonClassName =
  "h-8 rounded-lg border-[var(--brand)] bg-[var(--brand)] px-3 text-white shadow-sm hover:bg-[var(--brand)]/90 hover:text-white focus-visible:ring-[var(--brand)]/30";

function trustedContactRecordString(
  record: Record<string, unknown>,
  key: string,
) {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function trustedContactsFromDetail(detail: PatientDetail): PatientTrustedContactFormState[] {
  const leadOrigin = createPatientLeadOrigin(detail);
  const leadContacts = leadOrigin.records("trusted_contacts").flatMap((contact) => {
    const name = trustedContactRecordString(contact, "name");
    if (!name) return [];
    const extraNotes = [
      trustedContactRecordString(contact, "email")
        ? `Email: ${trustedContactRecordString(contact, "email")}`
        : "",
      trustedContactRecordString(contact, "birth_date")
        ? `Geburtsdatum: ${trustedContactRecordString(contact, "birth_date")}`
        : "",
      trustedContactRecordString(contact, "address")
        ? `Adresse: ${trustedContactRecordString(contact, "address")}`
        : "",
    ].filter(Boolean).join("\n");
    return [{
      id: makePatientContactFormId("trusted-contact-lead"),
      persistedId: null,
      name,
      phone: trustedContactRecordString(contact, "phone"),
      relation: normalizePatientTrustedContactRelation(trustedContactRecordString(contact, "relation")),
      notes: extraNotes,
    }];
  });
  if (leadContacts.length > 0) return leadContacts;

  const legacyName = detail.emergency_contact_name?.trim() ?? "";
  const legacyPhone = detail.emergency_contact_phone?.trim() ?? "";
  const legacyRelation = detail.emergency_contact_relation?.trim() ?? "";
  if (!legacyName && !legacyPhone && !legacyRelation) return [];
  return [{
    ...makePatientTrustedContactForm(normalizePatientTrustedContactRelation(legacyRelation)),
    name: legacyName,
    phone: legacyPhone,
  }];
}

function contactAddLabel(
  contactKind: PatientContactFormState["contactKind"],
  dictionary: Record<string, string> & { uiText?: Record<string, string> },
  lang: string,
) {
  const addLabel = dictionary.uiText?.patients_add ?? dictionary.patients_add ?? "Добавить";
  if (lang === "de") {
    return `${contactKind === "email" ? dictionary.field_email : dictionary.field_phone} ${addLabel}`;
  }
  return contactKind === "email"
    ? `${addLabel} электронную почту`
    : `${addLabel} телефон`;
}

function isGuardianOrParentRelation(value: string) {
  return value.trim() === "guardian" || value.trim() === "parent";
}

function normalizeMinorGuardianRelation(
  form: PatientEditFormState,
): PatientEditFormState {
  const age = computeAge(form.birthDate);
  if (age === null || age >= 18 || isGuardianOrParentRelation(form.emergencyContactRelation)) {
    return form;
  }
  return { ...form, emergencyContactRelation: "guardian" };
}

function contactFromLegacyField(
  contactKind: PatientContactFormState["contactKind"],
  value: string,
  isPrimary: boolean,
): PatientContactFormState {
  return {
    id: makePatientContactFormId(`patient-${contactKind}`),
    contactKind,
    contactType: "private",
    value,
    isPrimary,
    notes: "",
  };
}

function patientEditFormContacts(form: PatientEditFormState): PatientContactFormState[] {
  const contacts = (form as { contacts?: PatientContactFormState[] }).contacts;
  if (Array.isArray(contacts)) return contacts;

  const fallbackContacts: PatientContactFormState[] = [];
  if (form.phonePrimary.trim()) {
    fallbackContacts.push(contactFromLegacyField("phone", form.phonePrimary, true));
  }
  if (form.phoneSecondary.trim()) {
    fallbackContacts.push(contactFromLegacyField("phone", form.phoneSecondary, false));
  }
  if (form.email.trim()) {
    fallbackContacts.push(contactFromLegacyField("email", form.email, true));
  }

  return normalizePatientContactForms(
    fallbackContacts.length > 0
      ? fallbackContacts
      : [
          contactFromLegacyField("phone", "", true),
          contactFromLegacyField("email", "", true),
        ],
  );
}

function ensurePatientEditFormContacts(form: PatientEditFormState): PatientEditFormState {
  const contacts = patientEditFormContacts(form);
  return contacts === form.contacts ? form : { ...form, contacts };
}

function PatientProfileEditorSheet(props: PatientProfileEditorSheetProps) {
  return (
    <PatientProfileEditorSheetContent
      key={`${props.open ? "open" : "closed"}:${props.detail?.id ?? "none"}`}
      {...props}
    />
  );
}

type PatientProfileEditorFormSectionsProps = {
  dictionary: Record<string, string> & { uiText?: Record<string, string> };
  lang: string;
  form: PatientEditFormState;
  trustedContacts: PatientTrustedContactFormState[];
  trustedContactsLoading: boolean;
  statusLabel: (status: string) => string;
  updateField: <K extends keyof PatientEditFormState>(field: K, value: PatientEditFormState[K]) => void;
  updateContacts: (contacts: PatientContactFormState[]) => void;
  updateTrustedContacts: (contacts: PatientTrustedContactFormState[]) => void;
  updateLegalStatusField: <K extends keyof PatientLegalStatus>(field: K, value: PatientLegalStatus[K]) => void;
};

function PatientProfileEditorFormSections({
  dictionary,
  lang,
  form,
  trustedContacts,
  trustedContactsLoading,
  statusLabel,
  updateField,
  updateContacts,
  updateTrustedContacts,
  updateLegalStatusField,
}: PatientProfileEditorFormSectionsProps) {
  const age = computeAge(form.birthDate);
  const isMinor = age !== null && age < 18;
  const text = dictionary.uiText ?? {};
  const guardianLabel =
    dictionary.patient_relation_type_guardian ??
    text.patients_detail_guardian ??
    dictionary.common_not_set;
  const parentLabel =
    dictionary.patient_relation_type_parent ??
    text.patients_detail_parent ??
    dictionary.common_not_set;
  const trustedRelationOptions = [
    ["spouse", dictionary.patient_relation_type_spouse],
    ["parent", parentLabel],
    ["child", dictionary.patient_relation_type_child],
    ["sibling", dictionary.patient_relation_type_sibling],
    ["relative", dictionary.patient_relation_type_relative],
    ["guardian", guardianLabel],
    ["caregiver", dictionary.patient_relation_type_caregiver],
    ["friend", dictionary.patient_relation_type_friend],
    ["other", dictionary.patient_relation_type_other],
  ] as const;
  const label = (key: string, fallback: string) => text[key] ?? dictionary[key] ?? fallback;
  const contactTypeLabel = (value: PatientContactFormState["contactType"]) => {
    if (value === "work") return label("providers_contact_type_work", dictionary.common_not_set);
    if (value === "other") return label("providers_contact_type_other", dictionary.common_not_set);
    return label("providers_contact_type_private", dictionary.common_not_set);
  };
  const contactValueLabel = (contactKind: PatientContactFormState["contactKind"]) =>
    contactKind === "email" ? dictionary.field_email : dictionary.field_phone;
  const contacts = patientEditFormContacts(form);
  const addTrustedContact = () => {
    updateTrustedContacts([
      ...trustedContacts,
      makePatientTrustedContactForm(isMinor ? "guardian" : "other"),
    ]);
  };
  const patchTrustedContact = (
    contactId: string,
    patch: Partial<PatientTrustedContactFormState>,
  ) => {
    updateTrustedContacts(trustedContacts.map((contact) => (
      contact.id === contactId ? { ...contact, ...patch } : contact
    )));
  };
  const removeTrustedContact = (contactId: string) => {
    updateTrustedContacts(trustedContacts.filter((contact) => contact.id !== contactId));
  };

  function updateContact(
    contactId: string,
    patch: Partial<PatientContactFormState>,
  ) {
    const changedContact = contacts.find((contact) => contact.id === contactId);
    const changedContactKind = patch.contactKind ?? changedContact?.contactKind;
    const changedContacts = contacts.map((contact) => {
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
    updateContacts(normalizePatientContactForms(changedContacts));
  }

  function addContact(preferredKind?: PatientContactFormState["contactKind"]) {
    const hasPhone = contacts.some((contact) => contact.contactKind === "phone");
    const contactKind = preferredKind ?? (hasPhone ? "email" : "phone");
    updateContacts(
      normalizePatientContactForms([
        ...contacts,
        {
          id: makePatientContactFormId("patient-contact"),
          contactKind,
          contactType: "private",
          value: "",
          isPrimary: !contacts.some((contact) => contact.contactKind === contactKind),
          notes: "",
        },
      ]),
    );
  }

  function removeContact(contactId: string) {
    updateContacts(
      normalizePatientContactForms(
        contacts.filter((contact) => contact.id !== contactId),
      ),
    );
  }

  function handleBirthDateChange(value: string) {
    updateField("birthDate", value);
    const nextAge = computeAge(value);
    if (
      nextAge !== null &&
      nextAge < 18 &&
      !isGuardianOrParentRelation(form.emergencyContactRelation)
    ) {
      updateField("emergencyContactRelation", "guardian");
    }
  }

  return (        <div className="space-y-3">
              <FormSection title={dictionary.patient_profile_editor_personal_data}>
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-5">
                  <FormField label={dictionary.patient_profile_editor_title}>
                    <Input
                      value={form.title}
                      onChange={(event) => updateField("title", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_first_name}>
                    <Input
                      value={form.firstName}
                      onChange={(event) => updateField("firstName", event.target.value)}
                      required
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_last_name}>
                    <Input
                      value={form.lastName}
                      onChange={(event) => updateField("lastName", event.target.value)}
                      required
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patients_birth_date}>
                    <Input
                      type="date"
                      value={form.birthDate}
                      onChange={(event) => handleBirthDateChange(event.target.value)}
                      required
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patients_gender}>
                    <NativeComboboxSelect
                      value={form.gender}
                      onChange={(event) => updateField("gender", event.target.value)}
                      required
                      className={cn("w-full", formInputClassName)}
                    >
                      <option value="male">{text.patients_gender_male ?? dictionary.gender_male}</option>
                      <option value="female">{text.patients_gender_female ?? dictionary.gender_female}</option>
                      <option value="diverse">{text.patients_gender_diverse ?? dictionary.gender_diverse}</option>
                    </NativeComboboxSelect>
                  </FormField>
                </div>
                {isMinor ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    {text.patients_minor_guardian_notice ?? dictionary.patient_profile_editor_emergency_contact}
                  </div>
                ) : null}
                <div className="grid gap-2.5 md:grid-cols-2">
                  <FormField label={dictionary.patient_profile_editor_nationality}>
                    <NationalitySelect
                      value={form.nationality}
                      onChange={(value) => updateField("nationality", value)}
                      placeholder={dictionary.common_not_set}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_residence_country}>
                    <CountrySelect
                      value={form.residenceCountry}
                      onChange={(value) => updateField("residenceCountry", value)}
                      placeholder={dictionary.common_not_set}
                    />
                  </FormField>
                </div>
                <FormField label={dictionary.patient_profile_editor_languages}>
                  <LanguageChips
                    value={form.languages}
                    onChange={(next) => updateField("languages", next)}
                    placeholder={
                      dictionary.uiText?.patients_languages_placeholder ??
                      "patients_languages_placeholder"
                    }
                  />
                </FormField>
                <FormField
                  label={dictionary.patient_profile_editor_functional_labels}
                >
                  <FunctionalLabelChips
                    value={form.functionalLabels}
                    onChange={(next) => updateField("functionalLabels", next)}
                  />
                </FormField>
              </FormSection>
              <FormSection title={dictionary.patient_profile_editor_contact}>
                <div className="space-y-2.5">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className="rounded-xl border border-border/70 bg-card/50 p-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/25 text-muted-foreground">
                            {contact.contactKind === "email" ? (
                              <Mail className="size-4" />
                            ) : (
                              <Phone className="size-4" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="min-w-0 max-w-full break-words text-[13px] font-semibold tracking-tight text-foreground">
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
                                updateContact(contact.id, {
                                  isPrimary: event.target.checked,
                                })
                              }
                              className={checkboxClass}
                            />
                            {label("providers_contact_primary", dictionary.common_not_set)}
                          </label>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            title={dictionary.common_remove}
                            aria-label={dictionary.common_remove}
                            onClick={() => removeContact(contact.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2.5 grid gap-2.5 md:grid-cols-2 xl:grid-cols-[150px_150px_minmax(220px,1fr)]">
                        <FormField label={label("providers_contact_kind", dictionary.common_not_set)}>
                          <NativeComboboxSelect
                            value={contact.contactKind}
                            onChange={(event) =>
                              updateContact(contact.id, {
                                contactKind:
                                  event.target.value === "email" ? "email" : "phone",
                              })
                            }
                            className={cn("w-full", formInputClassName)}
                          >
                            <option value="phone">{dictionary.field_phone}</option>
                            <option value="email">{dictionary.field_email}</option>
                          </NativeComboboxSelect>
                        </FormField>
                        <FormField label={label("providers_contact_type", dictionary.common_not_set)}>
                          <NativeComboboxSelect
                            value={contact.contactType}
                            onChange={(event) =>
                              updateContact(contact.id, {
                                contactType:
                                  event.target.value === "work" ||
                                  event.target.value === "other"
                                    ? event.target.value
                                    : "private",
                              })
                            }
                            className={cn("w-full", formInputClassName)}
                          >
                            <option value="private">
                              {label("providers_contact_type_private", dictionary.common_not_set)}
                            </option>
                            <option value="work">
                              {label("providers_contact_type_work", dictionary.common_not_set)}
                            </option>
                            <option value="other">
                              {label("providers_contact_type_other", dictionary.common_not_set)}
                            </option>
                          </NativeComboboxSelect>
                        </FormField>
                        <FormField label={contactValueLabel(contact.contactKind)}>
                          <Input
                            type={contact.contactKind === "email" ? "email" : "tel"}
                            value={contact.value}
                            onChange={(event) =>
                              updateContact(contact.id, { value: event.target.value })
                            }
                            className={formInputClassName}
                          />
                        </FormField>
                      </div>
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={contactAddButtonClassName}
                      onClick={() => addContact("phone")}
                    >
                      <Phone className="size-3.5" />
                      {contactAddLabel("phone", dictionary, lang)}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={contactAddButtonClassName}
                      onClick={() => addContact("email")}
                    >
                      <Mail className="size-3.5" />
                      {contactAddLabel("email", dictionary, lang)}
                    </Button>
                  </div>
                </div>
              </FormSection>
              <FormSection title={dictionary.patient_profile_editor_address}>
                <FormField label={dictionary.patient_profile_editor_street}>
                  <Input
                    value={form.addressStreet}
                    onChange={(event) => updateField("addressStreet", event.target.value)}
                    className={formInputClassName}
                  />
                </FormField>
                <div className="grid gap-2.5 md:grid-cols-3">
                  <FormField label={dictionary.patient_profile_editor_city}>
                    <Input
                      value={form.addressCity}
                      onChange={(event) => updateField("addressCity", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_zip}>
                    <Input
                      value={form.addressZip}
                      onChange={(event) => updateField("addressZip", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_address_country}>
                    <CountrySelect
                      value={form.addressCountry}
                      onChange={(value) => updateField("addressCountry", value)}
                      placeholder={dictionary.common_not_set}
                    />
                  </FormField>
                </div>
              </FormSection>
              <FormSection title={dictionary.patient_profile_editor_passport}>
                <div className="grid gap-2.5 md:grid-cols-2">
                  <FormField
                    label={dictionary.patient_profile_editor_passport_number}
                  >
                    <Input
                      value={form.passportNumber}
                      onChange={(event) =>
                        updateField("passportNumber", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField
                    label={dictionary.patient_profile_editor_passport_expiry}
                  >
                    <Input
                      type="date"
                      value={form.passportExpiry}
                      onChange={(event) =>
                        updateField("passportExpiry", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
              </FormSection>
              <FormSection title={dictionary.patient_profile_editor_insurance}>
                <div className="grid gap-2.5 md:grid-cols-3">
                  <FormField label={dictionary.patient_profile_editor_insurance_provider}>
                    <Input
                      value={form.insuranceProvider}
                      onChange={(event) =>
                        updateField("insuranceProvider", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField
                    label={dictionary.patient_profile_editor_insurance_number}
                  >
                    <Input
                      value={form.insuranceNumber}
                      onChange={(event) =>
                        updateField("insuranceNumber", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_insurance_type}>
                    <NativeComboboxSelect
                      value={form.insuranceType || "__unset__"}


                      onChange={(event) => updateField(
                          "insuranceType",
                          event.target.value === "__unset__" ? "" : event.target.value ?? ""
                        )} className={cn("w-full", formInputClassName)}>
                        <option value="__unset__">{dictionary.common_not_set}</option>
                        <option value="private">{dictionary.patient_profile_editor_private}</option>
                        <option value="public">{dictionary.patient_profile_editor_public}</option>
                        <option value="self_pay">{dictionary.patient_profile_editor_self_pay}</option>
                        <option value="foreign">{dictionary.patient_profile_editor_foreign}</option>
                      </NativeComboboxSelect>
                  </FormField>
                </div>
              </FormSection>

              <FormSection
                className={isMinor ? "border-amber-200 bg-amber-50/60" : undefined}
                title={
                  isMinor
                    ? (text.patients_guardian_parent_contact ?? dictionary.patient_profile_editor_emergency_contact)
                    : dictionary.patient_profile_editor_emergency_contact
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    {lang === "de"
                      ? "Mehrere Vertrauenskontakte können hinterlegt werden."
                      : "Можно добавить несколько доверенных контактов."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shrink-0 gap-1.5 rounded-lg"
                    onClick={addTrustedContact}
                  >
                    <Plus className="size-3.5" />
                    {lang === "de" ? "Kontakt hinzufügen" : "Добавить контакт"}
                  </Button>
                </div>
                {trustedContactsLoading ? (
                  <div className="py-4 text-center text-sm text-muted-foreground">
                    {dictionary.common_loading}
                  </div>
                ) : trustedContacts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">
                    {lang === "de"
                      ? "Noch keine Vertrauenskontakte hinzugefügt."
                      : "Доверенные контакты пока не добавлены."}
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {trustedContacts.map((contact, index) => (
                      <div key={contact.id} className="rounded-lg border border-border/70 bg-card p-3">
                        <div className="mb-2.5 flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold text-foreground">
                            {lang === "de" ? "Vertrauenskontakt" : "Доверенный контакт"} {index + 1}
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-destructive"
                            aria-label={lang === "de" ? "Kontakt entfernen" : "Удалить контакт"}
                            onClick={() => removeTrustedContact(contact.id)}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                        <div className="grid gap-2.5 md:grid-cols-3">
                          <FormField label={dictionary.patient_profile_editor_contact_2}>
                            <Input
                              value={contact.name}
                              onChange={(event) => patchTrustedContact(contact.id, { name: event.target.value })}
                              required={isMinor || Boolean(contact.phone || contact.relation || contact.notes)}
                              className={formInputClassName}
                            />
                          </FormField>
                          <FormField label={dictionary.patient_profile_editor_phone}>
                            <Input
                              value={contact.phone}
                              onChange={(event) => patchTrustedContact(contact.id, { phone: event.target.value })}
                              required={isMinor}
                              className={formInputClassName}
                            />
                          </FormField>
                          <FormField label={dictionary.patient_profile_editor_relation}>
                            <NativeComboboxSelect
                              value={isMinor && !isGuardianOrParentRelation(contact.relation) ? "guardian" : contact.relation}
                              onChange={(event) => patchTrustedContact(contact.id, { relation: event.target.value ?? (isMinor ? "guardian" : "other") })}
                              required
                              className={cn("w-full", formInputClassName)}
                            >
                              {(isMinor
                                ? trustedRelationOptions.filter(([value]) => isGuardianOrParentRelation(value))
                                : trustedRelationOptions
                              ).map(([value, optionLabel]) => (
                                <option key={value} value={value}>{optionLabel}</option>
                              ))}
                            </NativeComboboxSelect>
                          </FormField>
                        </div>
                        <FormField label={dictionary.patient_profile_editor_notes}>
                          <textarea
                            className={cn(formTextareaClassName, "min-h-20")}
                            value={contact.notes}
                            onChange={(event) => patchTrustedContact(contact.id, { notes: event.target.value })}
                          />
                        </FormField>
                      </div>
                    ))}
                  </div>
                )}
              </FormSection>

              <PatientProfileLegalStatusSection
                dictionary={dictionary}
                form={form}
                statusLabel={statusLabel}
                updateLegalStatusField={updateLegalStatusField}
              />

              <PatientProfileNotesSections
                dictionary={dictionary}
                form={form}
                updateField={updateField}
              />
        </div>
  );
}

function PatientProfileLegalStatusSection({
  dictionary,
  form,
  statusLabel,
  updateLegalStatusField,
}: {
  dictionary: Record<string, string> & { uiText?: Record<string, string> };
  form: PatientEditFormState;
  statusLabel: (status: string) => string;
  updateLegalStatusField: <K extends keyof PatientLegalStatus>(
    field: K,
    value: PatientLegalStatus[K],
  ) => void;
}) {
  type PatientLegalStatusFlag =
    | "dsgvoSigned"
    | "confidentialityReleaseSigned"
    | "identityVerified"
    | "documentPackComplete"
    | "complianceCompleted";
  const legalStatusItems: Array<{
    key: PatientLegalStatusFlag;
    label: string;
  }> = [
    {
      key: "dsgvoSigned",
      label: dictionary.patient_profile_editor_dsgvo_signed,
    },
    {
      key: "confidentialityReleaseSigned",
      label: dictionary.patient_profile_editor_confidentiality_released,
    },
    {
      key: "identityVerified",
      label: dictionary.patient_profile_editor_identity_verified,
    },
    {
      key: "documentPackComplete",
      label: dictionary.patient_profile_editor_document_pack_complete,
    },
    {
      key: "complianceCompleted",
      label: dictionary.patient_profile_editor_readiness_confirmed,
    },
  ];

  return (
    <FormSection
      title={dictionary.patients_legal_status}
      accessory={<LegalStatusPill status={form.legalStatus} />}
    >
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {legalStatusItems.map((item) => (
          <label
            key={item.key}
            className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-2 text-[12.5px] text-foreground cursor-pointer hover:bg-muted/40 transition-colors"
          >
            <input
              type="checkbox"
              checked={Boolean(form.legalStatus[item.key])}
              onChange={(event) =>
                updateLegalStatusField(item.key, event.target.checked)
              }
              className={checkboxClass}
            />
            {item.label}
          </label>
        ))}
      </div>
      <FormField label={dictionary.patient_profile_editor_contract_status}>
        <NativeComboboxSelect
          value={form.legalStatus.contractStatus}
          onChange={(event) =>
            updateLegalStatusField("contractStatus", event.target.value ?? "")
          }
          className={cn("w-full", formInputClassName)}
        >
          {PATIENT_CONTRACT_STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </NativeComboboxSelect>
      </FormField>
      <FormField label={dictionary.patient_profile_editor_notes}>
        <textarea
          className={formTextareaClassName}
          value={form.legalStatus.notes}
          onChange={(event) => updateLegalStatusField("notes", event.target.value)}
          placeholder={
            dictionary.patient_profile_editor_pending_signatures_missing_ids_open_compliance_questions
          }
        />
      </FormField>
    </FormSection>
  );
}

function PatientProfileNotesSections({
  dictionary,
  form,
  updateField,
}: {
  dictionary: Record<string, string> & { uiText?: Record<string, string> };
  form: PatientEditFormState;
  updateField: <K extends keyof PatientEditFormState>(
    field: K,
    value: PatientEditFormState[K],
  ) => void;
}) {
  return (
    <>
      <FormSection title={dictionary.patient_profile_editor_cave_warnings}>
        <textarea
          className={formTextareaClassName}
          value={form.clinicalWarnings}
          onChange={(event) => updateField("clinicalWarnings", event.target.value)}
          placeholder={
            dictionary.patient_profile_editor_persistent_clinical_warnings_or_safety_alerts
          }
        />
      </FormSection>

      <FormSection title={dictionary.patient_profile_editor_notes}>
        <textarea
          className={formTextareaClassName}
          value={form.notes}
          onChange={(event) => updateField("notes", event.target.value)}
        />
      </FormSection>
    </>
  );
}

function PatientProfileEditorSheetContent({
  open,
  patientId,
  detail,
  dictionary,
  lang,
  statusLabel,
  onOpenChange,
  onSaved,
  onError,
}: PatientProfileEditorSheetProps) {
  const [form, setForm] = useState<PatientEditFormState | null>(() =>
    open && detail
      ? normalizeMinorGuardianRelation(
          ensurePatientEditFormContacts(patientToEditForm(detail)),
        )
      : null,
  );
  const [trustedContacts, setTrustedContacts] = useState<PatientTrustedContactFormState[]>(() =>
    open && detail ? trustedContactsFromDetail(detail) : [],
  );
  const [initialForm] = useState(form);
  const [initialTrustedContacts, setInitialTrustedContacts] = useState(trustedContacts);
  const dirty = hasFormChanges(form, initialForm) || hasFormChanges(trustedContacts, initialTrustedContacts);
  const [initialTrustedContactIds, setInitialTrustedContactIds] = useState<string[]>([]);
  const [trustedContactsLoading, setTrustedContactsLoading] = useState(Boolean(open && patientId));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !patientId) {
      setTrustedContactsLoading(false);
      return;
    }
    let active = true;
    setTrustedContactsLoading(true);
    fetchPatientRelations(patientId)
      .then((relations) => {
        if (!active) return;
        const loadedContacts = patientTrustedContactsFromRelations(relations);
        if (loadedContacts.length > 0) {
          setTrustedContacts(loadedContacts);
          setInitialTrustedContacts(loadedContacts);
        }
        setInitialTrustedContactIds(loadedContacts.flatMap((contact) => (
          contact.persistedId ? [contact.persistedId] : []
        )));
      })
      .catch(() => {
        // Keep contacts transferred in the lead snapshot as a safe fallback.
      })
      .finally(() => {
        if (active) setTrustedContactsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, patientId]);

  function updateField<K extends keyof PatientEditFormState>(
    field: K,
    value: PatientEditFormState[K]
  ) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateContacts(contacts: PatientContactFormState[]) {
    setForm((current) => (current ? { ...current, contacts } : current));
  }

  function updateLegalStatusField<K extends keyof PatientLegalStatus>(
    field: K,
    value: PatientLegalStatus[K]
  ) {
    setForm((current) =>
      current
        ? {
            ...current,
            legalStatus: { ...current.legalStatus, [field]: value },
          }
        : current
    );
  }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!patientId || !form || !dirty || busy || trustedContactsLoading) return;
      setBusy(true);
      onError("");
      try {
        const normalizedTrustedContacts = trustedContacts.flatMap((contact) => {
          const name = contact.name.trim();
          const phone = contact.phone.trim();
          const relation = contact.relation.trim() || "other";
          const notes = contact.notes.trim();
          if (!name && !phone && !notes) return [];
          if (!name) {
            throw new Error(
              lang === "de"
                ? "Name des Vertrauenskontakts angeben"
                : "Укажите имя доверенного контакта",
            );
          }
          return [{ ...contact, name, phone, relation, notes }];
        });
        const patientAge = computeAge(form.birthDate);
        const isMinor = patientAge !== null && patientAge < 18;
        if (isMinor && normalizedTrustedContacts.length === 0) {
          throw new Error(
            lang === "de"
              ? "Für Minderjährige ist ein Elternteil oder Vormund erforderlich"
              : "Для несовершеннолетнего укажите родителя или опекуна",
          );
        }
        const primaryTrustedContact = normalizedTrustedContacts[0];
        const contactPayload = patientContactFormsToPayload(
          patientEditFormContacts(form),
        );
        await updatePatient(patientId, {
          title: form.title,
          first_name: form.firstName,
          last_name: form.lastName,
          birth_date: form.birthDate,
          gender: form.gender,
          phone_primary: contactPayload.phonePrimary,
          phone_secondary: contactPayload.phoneSecondary,
          email: contactPayload.email,
          contacts: contactPayload.contacts,
          nationality: form.nationality,
          residence_country: form.residenceCountry,
          languages: form.languages.split(",").flatMap((value) => {
            const language = value.trim();
            return language ? [language] : [];
          }),
          functional_labels: parseFunctionalLabels(form.functionalLabels),
          address_street: form.addressStreet,
          address_city: form.addressCity,
          address_zip: form.addressZip,
          address_country: form.addressCountry,
          insurance_provider: form.insuranceProvider,
          insurance_number: form.insuranceNumber,
          insurance_type: form.insuranceType,
          emergency_contact_name: primaryTrustedContact?.name ?? "",
          emergency_contact_phone: primaryTrustedContact?.phone ?? "",
          emergency_contact_relation: primaryTrustedContact?.relation ?? "",
          passport_number: form.passportNumber,
          passport_expiry: form.passportExpiry,
          legal_status: serializePatientLegalStatus(form.legalStatus),
          clinical_warnings: form.clinicalWarnings,
          notes: form.notes,
        });
        const persistedTrustedContacts: PatientTrustedContactFormState[] = [];
        for (const contact of normalizedTrustedContacts) {
          const persisted = await upsertPatientRelation(
            patientId,
            {
              related_patient_id: null,
              related_name: contact.name,
              relation_type: contact.relation,
              is_emergency_contact: true,
              phone: contact.phone || null,
              notes: contact.notes || null,
            },
            contact.persistedId,
          );
          const persistedContact = {
            ...contact,
            id: persisted.id,
            persistedId: persisted.id,
          };
          persistedTrustedContacts.push(persistedContact);
          setTrustedContacts((current) => current.map((currentContact) => (
            currentContact.id === contact.id ? persistedContact : currentContact
          )));
          setInitialTrustedContactIds((current) => Array.from(new Set([
            ...current,
            persisted.id,
          ])));
        }
        const retainedIds = new Set(persistedTrustedContacts.flatMap((contact) => (
          contact.persistedId ? [contact.persistedId] : []
        )));
        for (const relationId of initialTrustedContactIds) {
          if (!retainedIds.has(relationId)) {
            await deletePatientRelation(patientId, relationId);
          }
        }
        window.dispatchEvent(new CustomEvent(PATIENT_RELATIONS_UPDATED_EVENT, {
          detail: { patientId },
        }));
        toast.success(dictionary.common_active);
        onOpenChange(false);
        onSaved();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : dictionary.common_failed_update
        );
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      dirty,
      trustedContactsLoading,
      dictionary.common_active,
      dictionary.common_failed_update,
      form,
      initialTrustedContactIds,
      lang,
      onError,
      onOpenChange,
      onSaved,
      patientId,
      trustedContacts,
    ]
  );

  return (
    <PatientSheetScaffold requireChanges dirty={dirty}
      open={open}
      onOpenChange={onOpenChange}
      width="detail-wide"
      onSubmit={handleSubmit}
      title={dictionary.patient_profile_editor_edit_patient_profile}
      footer={
        form ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {dictionary.patient_profile_editor_cancel}
            </Button>
            <Button
              type="submit"
              className="h-9 rounded-lg gap-1.5 px-3.5"
              disabled={busy || trustedContactsLoading}
            >
              {busy ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
              {dictionary.patient_profile_editor_save_patient}
            </Button>
          </>
        ) : undefined
      }
    >
      {form ? (
        <PatientProfileEditorFormSections
          dictionary={dictionary}
          lang={lang}
          form={form}
          trustedContacts={trustedContacts}
          trustedContactsLoading={trustedContactsLoading}
          statusLabel={statusLabel}
          updateField={updateField}
          updateContacts={updateContacts}
          updateTrustedContacts={setTrustedContacts}
          updateLegalStatusField={updateLegalStatusField}
        />
      ) : null}
    </PatientSheetScaffold>
  );
}

export const MemoizedPatientProfileEditorSheet = memo(PatientProfileEditorSheet);
