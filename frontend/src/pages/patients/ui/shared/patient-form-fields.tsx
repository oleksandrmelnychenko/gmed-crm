import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import type { PatientFormState } from "../../model/list-model";
import {
  getPatientGenderLabel,
  getPatientInsuranceLabel,
} from "../../model/list-formatters";
import {
  Field,
  FormSection,
  FunctionalLabelChips,
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
  const { t, lang } = useLang();
  const tr = t as unknown as Record<string, string>;
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

  return (
    <div className="space-y-3">
      <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
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
                onChange={(event) => onChange("birthDate", event.target.value)}
                className={formInputClassName}
                required
              />
            </Field>
            <Field label={t.patients_gender}>
              <ShadSelect value={form.gender} onValueChange={(v) => onChange("gender", v ?? "male")}>
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>{getPatientGenderLabel(form.gender, tr)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">{t.gender_male}</SelectItem>
                  <SelectItem value="female">{t.gender_female}</SelectItem>
                  <SelectItem value="diverse">{t.gender_diverse}</SelectItem>
                </SelectContent>
              </ShadSelect>
            </Field>
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t.patients_nationality}>
            <Input
              value={form.nationality}
              onChange={(event) => onChange("nationality", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_residence_country}>
            <Input
              value={form.residenceCountry}
              onChange={(event) => onChange("residenceCountry", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>

        <Field label={t.patients_languages}>
          <Input
            value={form.languages}
            onChange={(event) => onChange("languages", event.target.value)}
            className={formInputClassName}
            placeholder={t.patients_languages}
          />
        </Field>

        <Field label={l("Funktionslabels", "Функциональные метки", "Functional labels")}>
          <FunctionalLabelChips
            value={form.functionalLabels}
            onChange={(next) => onChange("functionalLabels", next)}
          />
        </Field>
      </FormSection>

      <FormSection title={l("Kontakt", "Контакты", "Contact")}>
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

      <FormSection title={l("Adresse", "Адрес", "Address")}>
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
            <Input
              value={form.addressCountry}
              onChange={(event) => onChange("addressCountry", event.target.value)}
              className={formInputClassName}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Versicherung", "Страхование", "Insurance")}>
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
            <ShadSelect value={form.insuranceType} onValueChange={(v) => onChange("insuranceType", v ?? "")}>
              <SelectTrigger className={cn("w-full", formInputClassName)}>
                <SelectValue>{getPatientInsuranceLabel(form.insuranceType, tr)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t.common_not_set}</SelectItem>
                <SelectItem value="private">{t.insurance_private}</SelectItem>
                <SelectItem value="public">{t.insurance_public}</SelectItem>
                <SelectItem value="self_pay">{t.insurance_self_pay}</SelectItem>
                <SelectItem value="foreign">{t.insurance_foreign}</SelectItem>
              </SelectContent>
            </ShadSelect>
          </Field>
        </div>
      </FormSection>

      <FormSection title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={t.patients_emergency_name}>
            <Input
              value={form.emergencyContactName}
              onChange={(event) => onChange("emergencyContactName", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_emergency_phone}>
            <Input
              value={form.emergencyContactPhone}
              onChange={(event) => onChange("emergencyContactPhone", event.target.value)}
              className={formInputClassName}
            />
          </Field>
          <Field label={t.patients_emergency_relation}>
            <Input
              value={form.emergencyContactRelation}
              onChange={(event) => onChange("emergencyContactRelation", event.target.value)}
              className={formInputClassName}
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
