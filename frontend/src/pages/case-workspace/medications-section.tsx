import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  fetchMedicationEquivalents,
  type GermanEquivalent,
} from "@/lib/api/clinical";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { MedicationEquivalentsPanel } from "./medication-equivalents-panel";
import {
  type CaseWorkspaceDoctor,
  type MedikamentItem,
  useCaseWorkspace,
} from "./context";
import {
  Field,
  inputBaseClassName,
  nativeSelectClassName,
  textareaBaseClassName,
} from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function doctorOptionLabel(doctor: CaseWorkspaceDoctor) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialty = doctor.fachbereich?.trim()
    ? ` · ${doctor.fachbereich.trim()}`
    : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

const BLANK: MedikamentItem = {
  handelsname: "",
  wirkstoff: "",
  dosis: "",
  dosis_einheit: "",
  einnahmeschema: "",
  darreichungsform: "",
  einheit: "",
  anmerkung: "",
  grund: "",
  seit: "",
  verordnender_arzt_id: "",
  verordnender_arzt: "",
  med_typ: "permanent",
  expiry_date: "",
};

const MED_TYP_OPTIONS: Array<{
  value: string;
  labels: { de: string; ru: string; en: string };
}> = [
  { value: "permanent", labels: { de: "Dauermedikation", ru: "Постоянная", en: "Permanent" } },
  { value: "temporary", labels: { de: "Befristet", ru: "Временная", en: "Temporary" } },
  { value: "as_needed", labels: { de: "Bei Bedarf", ru: "По необходимости", en: "As needed" } },
];

export function MedicationsSection() {
  const { t, lang } = useLang();
  const {
    caseId,
    detail,
    doctors,
    permissions,
    sectionBusy,
    sectionError,
    saveMedications,
  } = useCaseWorkspace();
  const medications = useMemo(
    () => detail?.medikamente ?? [],
    [detail?.medikamente],
  );
  const medicationOptions = useMemo(
    () =>
      medications.filter(
        (item): item is MedikamentItem & { id: string } => Boolean(item.id),
      ),
    [medications],
  );
  const [equivalentMedicationId, setEquivalentMedicationId] = useState("");
  const [includeEquivalentCandidates, setIncludeEquivalentCandidates] =
    useState(false);
  const [equivalentCandidates, setEquivalentCandidates] = useState<
    GermanEquivalent[]
  >([]);
  const [equivalentLoading, setEquivalentLoading] = useState(false);
  const [equivalentError, setEquivalentError] = useState("");

  useEffect(() => {
    if (
      equivalentMedicationId &&
      medicationOptions.some((item) => item.id === equivalentMedicationId)
    ) {
      return;
    }
    setEquivalentMedicationId(medicationOptions[0]?.id ?? "");
  }, [equivalentMedicationId, medicationOptions]);

  const selectedEquivalentMedication =
    medicationOptions.find((item) => item.id === equivalentMedicationId) ??
    medicationOptions[0] ??
    null;

  useEffect(() => {
    setEquivalentCandidates([]);
    setEquivalentError("");
  }, [equivalentMedicationId]);

  async function handleFindEquivalent() {
    if (!selectedEquivalentMedication?.id) return;
    setEquivalentLoading(true);
    setEquivalentError("");
    try {
      const payload = await fetchMedicationEquivalents(
        caseId,
        selectedEquivalentMedication.id,
        includeEquivalentCandidates,
      );
      setEquivalentCandidates(payload.candidates);
    } catch (error) {
      setEquivalentCandidates([]);
      setEquivalentError(
        error instanceof Error
          ? error.message
          : tri(
              lang,
              "Failed to load medication equivalents.",
              "Failed to load medication equivalents.",
              "Failed to load medication equivalents.",
            ),
      );
    } finally {
      setEquivalentLoading(false);
    }
  }

  return (
    <>
      <CaseItemList<MedikamentItem>
      title={tri(lang, "Medikamente", "Медикаменты", "Medications")}
      description={tri(
        lang,
        "Aktuelle Medikation, Dosierung, Ablaufdatum und Verordner.",
        "Текущая медикация, дозировка, срок и назначивший врач.",
        "Current medications, dosing, expiry, and prescriber.",
      )}
      items={medications}
      blankItem={BLANK}
      cloneItem={(item) => ({ ...BLANK, ...item })}
      isValid={(form) => form.handelsname.trim().length > 0}
      save={saveMedications}
      busy={sectionBusy === "medications"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: tri(lang, "Neues Medikament", "Новый медикамент", "New medication"),
        edit: tri(lang, "Medikament bearbeiten", "Редактировать медикамент", "Edit medication"),
      }}
      sheetWidth="wide"
      emptyTitle={tri(
        lang,
        "Keine Medikamente erfasst.",
        "Медикаментов пока нет.",
        "No medications recorded yet.",
      )}
      addFirstLabel={tri(
        lang,
        "Erstes Medikament hinzufügen",
        "Добавить первый медикамент",
        "Add first medication",
      )}
      missingPrimaryMessage={tri(
        lang,
        "Bitte den Handelsnamen eingeben.",
        "Укажите торговое название.",
        "Please enter the brand name.",
      )}
      renderCard={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.handelsname || tri(lang, "Ohne Namen", "Без названия", "Untitled")}
            </p>
          </div>
          {item.wirkstoff ? (
            <p className="truncate text-xs text-muted-foreground">{item.wirkstoff}</p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {item.dosis ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {item.dosis} {item.dosis_einheit ?? ""}
              </Badge>
            ) : null}
            {item.einnahmeschema ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {item.einnahmeschema}
              </Badge>
            ) : null}
            {item.med_typ ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {item.med_typ}
              </Badge>
            ) : null}
          </div>
          {item.is_expired ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700">
              <AlertTriangle className="size-3" />
              {tri(lang, "Abgelaufen", "Истёк срок", "Expired")}
              {item.pending_expiry_confirmation
                ? ` · ${tri(lang, "Bestätigung nötig", "Требуется подтверждение", "Confirmation required")}`
                : ""}
            </div>
          ) : null}
        </>
      )}
      renderForm={({ form, setForm, updateField, disabled }) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={tri(lang, "Handelsname", "Торговое название", "Brand name")}
              required
            >
              <Input
                value={form.handelsname}
                autoFocus
                onChange={(event) => updateField("handelsname", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Wirkstoff", "Действующее вещество", "Active ingredient")}>
              <Input
                value={form.wirkstoff ?? ""}
                onChange={(event) => updateField("wirkstoff", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label={tri(lang, "Dosis", "Доза", "Dose")}>
              <Input
                value={form.dosis ?? ""}
                onChange={(event) => updateField("dosis", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Einheit", "Единица", "Unit")}>
              <Input
                value={form.dosis_einheit ?? ""}
                onChange={(event) => updateField("dosis_einheit", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Schema", "Схема приёма", "Regimen")}>
              <Input
                value={form.einnahmeschema ?? ""}
                onChange={(event) => updateField("einnahmeschema", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Field label={tri(lang, "Darreichungsform", "Форма", "Form")}>
              <Input
                value={form.darreichungsform ?? ""}
                onChange={(event) => updateField("darreichungsform", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Typ", "Тип", "Type")}>
              <NativeComboboxSelect
                value={form.med_typ ?? "permanent"}
                onChange={(event) => updateField("med_typ", event.target.value)}
                className={nativeSelectClassName}
                disabled={disabled}
              >
                {MED_TYP_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {tri(lang, option.labels.de, option.labels.ru, option.labels.en)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </Field>
            <Field label={tri(lang, "Gültig bis", "Действительно до", "Valid until")}>
              <Input
                type="date"
                value={form.expiry_date ?? ""}
                onChange={(event) => updateField("expiry_date", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tri(lang, "Seit", "Начало приёма", "Since")}>
              <Input
                value={form.seit ?? ""}
                onChange={(event) => updateField("seit", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Grund", "Причина", "Reason")}>
              <Input
                value={form.grund ?? ""}
                onChange={(event) => updateField("grund", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <Field
            label={tri(lang, "Verordnender Arzt (Register)", "Назначивший врач (реестр)", "Prescriber (registry)")}
          >
            <NativeComboboxSelect
              value={form.verordnender_arzt_id ?? ""}
              onChange={(event) => {
                const doctorId = event.target.value;
                const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                setForm({
                  ...form,
                  verordnender_arzt_id: doctorId,
                  verordnender_arzt: selectedDoctor
                    ? selectedDoctor.name
                    : form.verordnender_arzt ?? "",
                });
              }}
              className={nativeSelectClassName}
              disabled={disabled}
            >
              <option value="">{t.common_not_set}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctorOptionLabel(doctor)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>

          <Field label={tri(lang, "Freitext Arzt", "Наименование врача", "Doctor label")}>
            <Input
              value={form.verordnender_arzt ?? ""}
              onChange={(event) => updateField("verordnender_arzt", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>

          <Field label={tri(lang, "Anmerkung", "Комментарий", "Note")}>
            <textarea
              value={form.anmerkung ?? ""}
              onChange={(event) => updateField("anmerkung", event.target.value)}
              className={textareaBaseClassName}
              rows={3}
              disabled={disabled}
            />
          </Field>

          {form.is_expired && form.pending_expiry_confirmation ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] text-amber-800">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="size-3.5" />
                {tri(
                  lang,
                  "Ablaufprüfung ausstehend",
                  "Требуется подтверждение истечения",
                  "Expiry review pending",
                )}
              </div>
              <p className="mt-1 leading-relaxed">
                {tri(
                  lang,
                  "Die Bestätigung des Ablaufs erfolgt im vollständigen Editor.",
                  "Подтверждение делается в полном редакторе.",
                  "Confirmation is handled in the full editor.",
                )}
              </p>
            </div>
          ) : null}
        </>
      )}
    />
      {selectedEquivalentMedication ? (
        <div className="mt-4 space-y-3">
          <Field
            label={tri(
              lang,
              "Medication for German equivalent lookup",
              "Medication for German equivalent lookup",
              "Medication for German equivalent lookup",
            )}
          >
            <NativeComboboxSelect
              value={selectedEquivalentMedication.id}
              onChange={(event) => setEquivalentMedicationId(event.target.value)}
              className={nativeSelectClassName}
              disabled={equivalentLoading}
            >
              {medicationOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.handelsname}
                  {item.wirkstoff ? ` - ${item.wirkstoff}` : ""}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <MedicationEquivalentsPanel
            medicationName={selectedEquivalentMedication.handelsname}
            medicationSubstance={selectedEquivalentMedication.wirkstoff}
            candidates={equivalentCandidates}
            includeCandidates={includeEquivalentCandidates}
            loading={equivalentLoading}
            error={equivalentError || undefined}
            onFind={() => void handleFindEquivalent()}
            onToggleCandidates={(next) => {
              setIncludeEquivalentCandidates(next);
              setEquivalentCandidates([]);
              setEquivalentError("");
            }}
          />
        </div>
      ) : null}
    </>
  );
}
