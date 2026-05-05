import {
  memo,
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";

import {
  FunctionalLabelChips,
  parseFunctionalLabels,
} from "../shared/patient-form-primitives";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  Section as FormSection,
  checkboxClass,
  inputClass as formInputClassName,
  textareaClass as formTextareaClassName,
} from "@/components/ui-shell";
import { cn } from "@/lib/utils";

import { updatePatient } from "../../data/patient-mutations";
import type { PatientDetail } from "../../model/list-model";
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
  dictionary: Record<string, string>;
  lang: string;
  statusLabel: (status: string) => string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

function PatientProfileEditorSheet({
  open,
  patientId,
  detail,
  dictionary,
  statusLabel,
  onOpenChange,
  onSaved,
  onError,
}: PatientProfileEditorSheetProps) {
  const [form, setForm] = useState<PatientEditFormState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (open && detail && form === null) {
      setForm(patientToEditForm(detail));
    }
  }, [detail, form, open]);

  function updateField<K extends keyof PatientEditFormState>(
    field: K,
    value: PatientEditFormState[K]
  ) {
    setForm((current) => (current ? { ...current, [field]: value } : current));
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
      if (!patientId || !form) return;
      setBusy(true);
      onError("");
      try {
        await updatePatient(patientId, {
          title: form.title,
          first_name: form.firstName,
          last_name: form.lastName,
          phone_primary: form.phonePrimary,
          phone_secondary: form.phoneSecondary,
          email: form.email,
          nationality: form.nationality,
          residence_country: form.residenceCountry,
          languages: form.languages
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          functional_labels: parseFunctionalLabels(form.functionalLabels),
          address_street: form.addressStreet,
          address_city: form.addressCity,
          address_zip: form.addressZip,
          address_country: form.addressCountry,
          insurance_provider: form.insuranceProvider,
          insurance_number: form.insuranceNumber,
          insurance_type: form.insuranceType,
          emergency_contact_name: form.emergencyContactName,
          emergency_contact_phone: form.emergencyContactPhone,
          emergency_contact_relation: form.emergencyContactRelation,
          legal_status: serializePatientLegalStatus(form.legalStatus),
          clinical_warnings: form.clinicalWarnings,
          notes: form.notes,
        });
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
      dictionary.common_active,
      dictionary.common_failed_update,
      form,
      onError,
      onOpenChange,
      onSaved,
      patientId,
    ]
  );

  return (
    <PatientSheetScaffold
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
              disabled={busy}
            >
              {busy ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
              {dictionary.patient_profile_editor_save_patient}
            </Button>
          </>
        ) : undefined
      }
    >
      {form ? (
        <div className="space-y-3">
              <FormSection title={dictionary.patient_profile_editor_personal_data}>
                <div className="grid gap-3 md:grid-cols-3">
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
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label={dictionary.patient_profile_editor_nationality}>
                    <Input
                      value={form.nationality}
                      onChange={(event) => updateField("nationality", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_residence_country}>
                    <Input
                      value={form.residenceCountry}
                      onChange={(event) =>
                        updateField("residenceCountry", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
                <FormField label={dictionary.patient_profile_editor_languages}>
                  <Input
                    value={form.languages}
                    onChange={(event) => updateField("languages", event.target.value)}
                    placeholder="de, uk, en"
                    className={formInputClassName}
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
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField
                    label={dictionary.patient_profile_editor_primary_phone}
                  >
                    <Input
                      value={form.phonePrimary}
                      onChange={(event) => updateField("phonePrimary", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField
                    label={dictionary.patient_profile_editor_secondary_phone}
                  >
                    <Input
                      value={form.phoneSecondary}
                      onChange={(event) => updateField("phoneSecondary", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_email}>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(event) => updateField("email", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
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
                <div className="grid gap-3 md:grid-cols-3">
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
                    <Input
                      value={form.addressCountry}
                      onChange={(event) => updateField("addressCountry", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={dictionary.patient_profile_editor_insurance}>
                <div className="grid gap-3 md:grid-cols-3">
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

              <FormSection title={dictionary.patient_profile_editor_emergency_contact}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={dictionary.patient_profile_editor_contact_2}>
                    <Input
                      value={form.emergencyContactName}
                      onChange={(event) =>
                        updateField("emergencyContactName", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_phone}>
                    <Input
                      value={form.emergencyContactPhone}
                      onChange={(event) =>
                        updateField("emergencyContactPhone", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={dictionary.patient_profile_editor_relation}>
                    <Input
                      value={form.emergencyContactRelation}
                      onChange={(event) =>
                        updateField("emergencyContactRelation", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
              </FormSection>

              <FormSection
                title={dictionary.patients_legal_status}
                accessory={<LegalStatusPill status={form.legalStatus} />}
              >
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {[
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
                  ].map((item) => {
                    const key = item.key as keyof PatientLegalStatus;
                    return (
                      <label
                        key={item.key}
                        className="flex items-center gap-2 rounded-lg border border-border/50 bg-card px-2.5 py-2 text-[12.5px] text-foreground cursor-pointer hover:bg-muted/40 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(form.legalStatus[key])}
                          onChange={(event) =>
                            updateLegalStatusField(
                              key,
                              event.target.checked as PatientLegalStatus[typeof key]
                            )
                          }
                          className={checkboxClass}
                        />
                        {item.label}
                      </label>
                    );
                  })}
                </div>
                <FormField label={dictionary.patient_profile_editor_contract_status}>
                  <NativeComboboxSelect
                    value={form.legalStatus.contractStatus}


                    onChange={(event) => updateLegalStatusField("contractStatus", event.target.value ?? "")} className={cn("w-full", formInputClassName)}>
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
                    placeholder={dictionary.patient_profile_editor_pending_signatures_missing_ids_open_compliance_questions}
                  />
                </FormField>
              </FormSection>

              <FormSection title={dictionary.patient_profile_editor_cave_warnings}>
                <textarea
                  className={formTextareaClassName}
                  value={form.clinicalWarnings}
                  onChange={(event) =>
                    updateField("clinicalWarnings", event.target.value)
                  }
                  placeholder={dictionary.patient_profile_editor_persistent_clinical_warnings_or_safety_alerts}
                />
              </FormSection>

              <FormSection title={dictionary.patient_profile_editor_notes}>
                <textarea
                  className={formTextareaClassName}
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                />
              </FormSection>
        </div>
      ) : null}
    </PatientSheetScaffold>
  );
}

export const MemoizedPatientProfileEditorSheet = memo(PatientProfileEditorSheet);
