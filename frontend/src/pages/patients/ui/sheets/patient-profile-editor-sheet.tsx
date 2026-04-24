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
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  Section as FormSection,
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
  lang,
  statusLabel,
  onOpenChange,
  onSaved,
  onError,
}: PatientProfileEditorSheetProps) {
  const [form, setForm] = useState<PatientEditFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

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
      title={l(
        "Patientenprofil bearbeiten",
        "Редактировать профиль пациента",
        "Edit patient profile"
      )}
      footer={
        form ? (
          <>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-lg"
              onClick={() => onOpenChange(false)}
            >
              {l("Abbrechen", "Отмена", "Cancel")}
            </Button>
            <Button
              type="submit"
              className="h-9 rounded-lg gap-1.5 px-3.5"
              disabled={busy}
            >
              {busy ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
              {l("Patient speichern", "Сохранить пациента", "Save patient")}
            </Button>
          </>
        ) : undefined
      }
    >
      {form ? (
        <div className="space-y-3">
              <FormSection title={l("Persönliche Daten", "Личные данные", "Personal data")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Titel", "Обращение", "Title")}>
                    <Input
                      value={form.title}
                      onChange={(event) => updateField("title", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Vorname", "Имя", "First name")}>
                    <Input
                      value={form.firstName}
                      onChange={(event) => updateField("firstName", event.target.value)}
                      required
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Nachname", "Фамилия", "Last name")}>
                    <Input
                      value={form.lastName}
                      onChange={(event) => updateField("lastName", event.target.value)}
                      required
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label={l("Nationalität", "Гражданство", "Nationality")}>
                    <Input
                      value={form.nationality}
                      onChange={(event) => updateField("nationality", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Wohnsitzland", "Страна проживания", "Residence country")}>
                    <Input
                      value={form.residenceCountry}
                      onChange={(event) =>
                        updateField("residenceCountry", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
                <FormField label={l("Sprachen", "Языки", "Languages")}>
                  <Input
                    value={form.languages}
                    onChange={(event) => updateField("languages", event.target.value)}
                    placeholder="de, uk, en"
                    className={formInputClassName}
                  />
                </FormField>
                <FormField
                  label={l(
                    "Funktionale Labels",
                    "Функциональные метки",
                    "Functional labels"
                  )}
                >
                  <FunctionalLabelChips
                    value={form.functionalLabels}
                    onChange={(next) => updateField("functionalLabels", next)}
                  />
                </FormField>
              </FormSection>

              <FormSection title={l("Kontakt", "Контакты", "Contact")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField
                    label={l("Primäre Telefonnummer", "Основной телефон", "Primary phone")}
                  >
                    <Input
                      value={form.phonePrimary}
                      onChange={(event) => updateField("phonePrimary", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField
                    label={l(
                      "Sekundäre Telefonnummer",
                      "Доп. телефон",
                      "Secondary phone"
                    )}
                  >
                    <Input
                      value={form.phoneSecondary}
                      onChange={(event) => updateField("phoneSecondary", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("E-Mail", "Эл. почта", "Email")}>
                    <Input
                      type="email"
                      value={form.email}
                      onChange={(event) => updateField("email", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={l("Adresse", "Адрес", "Address")}>
                <FormField label={l("Straße", "Улица", "Street")}>
                  <Input
                    value={form.addressStreet}
                    onChange={(event) => updateField("addressStreet", event.target.value)}
                    className={formInputClassName}
                  />
                </FormField>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Stadt", "Город", "City")}>
                    <Input
                      value={form.addressCity}
                      onChange={(event) => updateField("addressCity", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("PLZ", "Индекс", "ZIP")}>
                    <Input
                      value={form.addressZip}
                      onChange={(event) => updateField("addressZip", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Adressland", "Страна адреса", "Address country")}>
                    <Input
                      value={form.addressCountry}
                      onChange={(event) => updateField("addressCountry", event.target.value)}
                      className={formInputClassName}
                    />
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={l("Versicherung", "Страхование", "Insurance")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Versicherer", "Страховая компания", "Insurance provider")}>
                    <Input
                      value={form.insuranceProvider}
                      onChange={(event) =>
                        updateField("insuranceProvider", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField
                    label={l("Versicherungsnummer", "Номер полиса", "Insurance number")}
                  >
                    <Input
                      value={form.insuranceNumber}
                      onChange={(event) =>
                        updateField("insuranceNumber", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Versicherungstyp", "Тип страхования", "Insurance type")}>
                    <ShadSelect
                      value={form.insuranceType || "__unset__"}
                      onValueChange={(value) =>
                        updateField(
                          "insuranceType",
                          value === "__unset__" ? "" : value ?? ""
                        )
                      }
                    >
                      <SelectTrigger className={cn("w-full", formInputClassName)}>
                        <SelectValue>
                          {(() => {
                            switch (form.insuranceType) {
                              case "private":
                                return l("Privat", "Частная", "Private");
                              case "public":
                                return l("Gesetzlich", "Государственная", "Public");
                              case "self_pay":
                                return l("Selbstzahler", "Самооплата", "Self pay");
                              case "foreign":
                                return l("Ausland", "Иностранная", "Foreign");
                              default:
                                return dictionary.common_not_set;
                            }
                          })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__unset__">{dictionary.common_not_set}</SelectItem>
                        <SelectItem value="private">{l("Privat", "Частная", "Private")}</SelectItem>
                        <SelectItem value="public">{l("Gesetzlich", "Государственная", "Public")}</SelectItem>
                        <SelectItem value="self_pay">{l("Selbstzahler", "Самооплата", "Self pay")}</SelectItem>
                        <SelectItem value="foreign">{l("Ausland", "Иностранная", "Foreign")}</SelectItem>
                      </SelectContent>
                    </ShadSelect>
                  </FormField>
                </div>
              </FormSection>

              <FormSection title={l("Notfallkontakt", "Экстренный контакт", "Emergency contact")}>
                <div className="grid gap-3 md:grid-cols-3">
                  <FormField label={l("Notfallkontakt", "Контакт", "Contact")}>
                    <Input
                      value={form.emergencyContactName}
                      onChange={(event) =>
                        updateField("emergencyContactName", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Notfalltelefon", "Телефон", "Phone")}>
                    <Input
                      value={form.emergencyContactPhone}
                      onChange={(event) =>
                        updateField("emergencyContactPhone", event.target.value)
                      }
                      className={formInputClassName}
                    />
                  </FormField>
                  <FormField label={l("Beziehung", "Связь", "Relation")}>
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
                      label: l("DSGVO unterschrieben", "DSGVO подписано", "DSGVO signed"),
                    },
                    {
                      key: "confidentialityReleaseSigned",
                      label: l(
                        "Schweigepflicht freigegeben",
                        "Снятие врачебной тайны",
                        "Confidentiality released"
                      ),
                    },
                    {
                      key: "identityVerified",
                      label: l(
                        "Identität bestätigt",
                        "Личность подтверждена",
                        "Identity verified"
                      ),
                    },
                    {
                      key: "documentPackComplete",
                      label: l(
                        "Dokumentenpaket vollständig",
                        "Пакет документов собран",
                        "Document pack complete"
                      ),
                    },
                    {
                      key: "complianceCompleted",
                      label: l(
                        "Bereit bestätigt",
                        "Готовность подтверждена",
                        "Readiness confirmed"
                      ),
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
                          className="size-3.5 accent-[var(--brand)] cursor-pointer"
                        />
                        {item.label}
                      </label>
                    );
                  })}
                </div>
                <FormField label={l("Vertragsstatus", "Статус договора", "Contract status")}>
                  <ShadSelect
                    value={form.legalStatus.contractStatus}
                    onValueChange={(value) =>
                      updateLegalStatusField("contractStatus", value ?? "")
                    }
                  >
                    <SelectTrigger className={cn("w-full", formInputClassName)}>
                      <SelectValue>
                        {statusLabel(form.legalStatus.contractStatus)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {PATIENT_CONTRACT_STATUS_OPTIONS.map((status) => (
                        <SelectItem key={status} value={status}>
                          {statusLabel(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                </FormField>
                <FormField label={l("Notizen", "Заметки", "Notes")}>
                  <textarea
                    className={formTextareaClassName}
                    value={form.legalStatus.notes}
                    onChange={(event) => updateLegalStatusField("notes", event.target.value)}
                    placeholder={l(
                      "Ausstehende Unterschriften, fehlende IDs, offene Compliance-Fragen",
                      "Ожидающие подписи, отсутствующие ID, открытые вопросы compliance",
                      "Pending signatures, missing IDs, open compliance questions"
                    )}
                  />
                </FormField>
              </FormSection>

              <FormSection title={l("CAVE-Hinweise", "Предупреждения CAVE", "CAVE warnings")}>
                <textarea
                  className={formTextareaClassName}
                  value={form.clinicalWarnings}
                  onChange={(event) =>
                    updateField("clinicalWarnings", event.target.value)
                  }
                  placeholder={l(
                    "Dauerhafte klinische Warnhinweise oder Sicherheitshinweise",
                    "Постоянные клинические предупреждения или сигналы безопасности",
                    "Persistent clinical warnings or safety alerts"
                  )}
                />
              </FormSection>

              <FormSection title={l("Notizen", "Заметки", "Notes")}>
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
