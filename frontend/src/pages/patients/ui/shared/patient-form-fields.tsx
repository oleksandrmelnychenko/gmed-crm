import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { PatientFormState } from "../../model/list-model";
import { computeAge } from "../../model/list-model";
import {
  CountrySelect,
  Field,
  FormSection,
  FunctionalLabelChips,
  LanguageChips,
  NationalitySelect,
  formInputClassName,
  textareaClassName,
} from "./patient-form-primitives";

type PatientFormFieldsProps = {
  form: PatientFormState;
  onChange: (field: keyof PatientFormState, value: string) => void;
  includeBirthAndGender?: boolean;
};

export function PatientFormFields({
  form,
  onChange,
  includeBirthAndGender = false,
}: PatientFormFieldsProps) {
  const { t } = useLang();
  const l = (key: string) => t.uiText[key] ?? key;
  const age = computeAge(form.birthDate);
  const isMinor = includeBirthAndGender && age !== null && age < 18;
  const notSetLabel = t.common_not_set;

  function handleBirthDateChange(value: string) {
    onChange("birthDate", value);
    const nextAge = computeAge(value);
    if (nextAge !== null && nextAge < 18 && !form.emergencyContactRelation.trim()) {
      onChange("emergencyContactRelation", "guardian");
    }
  }

  return (
    <div className="space-y-3">
      <FormSection title={l("patients_personal_data")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_title_field}>
            <Input
              value={form.title}
              onChange={(event) => onChange("title", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_first_name}>
            <Input
              value={form.firstName}
              onChange={(event) => onChange("firstName", event.target.value)}
              className={formInputClassName}
              required
            />
          </Field>
          <Field label={t.patients_last_name}>
            <Input
              value={form.lastName}
              onChange={(event) => onChange("lastName", event.target.value)}
              className={formInputClassName}
              required
            />
          </Field>
        </div>

        {includeBirthAndGender ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t.patients_birth_date}>
              <Input
                type="date"
                value={form.birthDate}
                onChange={(event) => handleBirthDateChange(event.target.value)}
                className={formInputClassName}
                required
              />
            </Field>
            <Field label={t.patients_gender}>
              <NativeComboboxSelect value={form.gender}
                onChange={(event) => onChange("gender", event.target.value ?? "male")} className={cn("w-full", formInputClassName)}>
                  <option value="male">{t.gender_male}</option>
                  <option value="female">{t.gender_female}</option>
                  <option value="diverse">{t.gender_diverse}</option>
                </NativeComboboxSelect>
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
            />
          </Field>
          <Field label={t.patients_residence_country}>
            <CountrySelect
              value={form.residenceCountry}
              onChange={(value) => onChange("residenceCountry", value)}
              placeholder={notSetLabel}
            />
          </Field>
        </div>

        <Field label={t.patients_languages}>
          <LanguageChips
            value={form.languages}
            onChange={(next) => onChange("languages", next)}
            placeholder={l("patients_languages_select_placeholder")}
          />
        </Field>

        <Field label={l("patients_functional_labels")}>
          <FunctionalLabelChips
            value={form.functionalLabels}
            onChange={(next) => onChange("functionalLabels", next)}
          />
        </Field>
      </FormSection>

      <FormSection title={l("patients_contact")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_phone_primary}>
            <Input
              value={form.phonePrimary}
              onChange={(event) => onChange("phonePrimary", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_phone_secondary}>
            <Input
              value={form.phoneSecondary}
              onChange={(event) => onChange("phoneSecondary", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_email}>
            <Input
              type="email"
              value={form.email}
              onChange={(event) => onChange("email", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("patients_address")}>
        <Field label={t.patients_address_street}>
          <Input
            value={form.addressStreet}
            onChange={(event) => onChange("addressStreet", event.target.value)}
            className={formInputClassName}
          />
        </Field>

        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_address_city}>
            <Input
              value={form.addressCity}
              onChange={(event) => onChange("addressCity", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_address_zip}>
            <Input
              value={form.addressZip}
              onChange={(event) => onChange("addressZip", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_address_country}>
            <CountrySelect
              value={form.addressCountry}
              onChange={(value) => onChange("addressCountry", value)}
              placeholder={notSetLabel}
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
            />
          </Field>
          <Field label={t.patients_insurance_number}>
            <Input
              value={form.insuranceNumber}
              onChange={(event) => onChange("insuranceNumber", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_insurance_type}>
            <NativeComboboxSelect value={form.insuranceType}
              onChange={(event) => onChange("insuranceType", event.target.value ?? "")} className={cn("w-full", formInputClassName)}>
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
        title={
          isMinor
            ? l("patients_guardian_parent_contact")
            : l("patients_emergency_contact")
        }
      >
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_emergency_name}>
            <Input
              value={form.emergencyContactName}
              onChange={(event) => onChange("emergencyContactName", event.target.value)}
              className={formInputClassName}
              required={isMinor}
            />
          </Field>
          <Field label={t.patients_emergency_phone}>
            <Input
              value={form.emergencyContactPhone}
              onChange={(event) => onChange("emergencyContactPhone", event.target.value)}
              className={formInputClassName}
              required={isMinor}
            />
          </Field>
          <Field label={t.patients_emergency_relation}>
            <Input
              value={form.emergencyContactRelation}
              onChange={(event) => onChange("emergencyContactRelation", event.target.value)}
              className={formInputClassName}
              required={isMinor}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={t.patients_notes}>
        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          className={textareaClassName}
          rows={4}
        />
      </FormSection>
    </div>
  );
}
