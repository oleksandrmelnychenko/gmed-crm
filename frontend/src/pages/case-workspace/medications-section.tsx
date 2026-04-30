import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  createMedicationDrugMatch,
  fetchMedicationEquivalents,
  previewDrugImport,
  searchDrugProducts,
  verifyDrugEquivalent,
  verifyDrugProduct,
  verifyMedicationDrugMatch,
  type DrugImportPreview,
  type DrugProduct,
  type GermanEquivalent,
  type MedicationDrugMatchResponse,
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
  Panel,
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

function parseDrugImportRows(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [
        brand_name,
        country_code,
        substance,
        strength,
        form,
        manufacturer,
        atc_code,
      ] = line.split(",").map((part) => part.trim());
      return {
        brand_name,
        country_code,
        atc_code,
        form,
        strength,
        manufacturer,
        substances: substance ? [substance] : [],
        verification_status: "candidate",
      };
    });
}

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
  const [verifyingEquivalentId, setVerifyingEquivalentId] = useState<string | null>(null);
  const [drugSearchQuery, setDrugSearchQuery] = useState("");
  const [drugSearchCountry, setDrugSearchCountry] = useState("");
  const [includeDrugCandidates, setIncludeDrugCandidates] = useState(false);
  const [drugSearchResults, setDrugSearchResults] = useState<DrugProduct[]>([]);
  const [drugSearchLoading, setDrugSearchLoading] = useState(false);
  const [drugSearchError, setDrugSearchError] = useState("");
  const [productUpdatingId, setProductUpdatingId] = useState<string | null>(null);
  const [matchUpdatingId, setMatchUpdatingId] = useState<string | null>(null);
  const [lastMedicationMatch, setLastMedicationMatch] =
    useState<MedicationDrugMatchResponse | null>(null);
  const [drugImportText, setDrugImportText] = useState("");
  const [drugImportPreview, setDrugImportPreview] =
    useState<DrugImportPreview | null>(null);
  const [drugImportLoading, setDrugImportLoading] = useState(false);
  const [drugImportError, setDrugImportError] = useState("");

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
    setLastMedicationMatch(null);
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

  async function handleVerifyEquivalent(
    relationshipId: string,
    verificationStatus: "verified" | "rejected" | "candidate",
  ) {
    setVerifyingEquivalentId(relationshipId);
    setEquivalentError("");
    try {
      await verifyDrugEquivalent(relationshipId, verificationStatus);
      await handleFindEquivalent();
    } catch (error) {
      setEquivalentError(
        error instanceof Error
          ? error.message
          : "Failed to verify drug equivalent.",
      );
    } finally {
      setVerifyingEquivalentId(null);
    }
  }

  async function handleSearchDrugs() {
    if (!drugSearchQuery.trim()) {
      setDrugSearchError("Enter a drug name, ATC code, or substance.");
      return;
    }
    setDrugSearchLoading(true);
    setDrugSearchError("");
    try {
      const rows = await searchDrugProducts({
        q: drugSearchQuery,
        country_code: drugSearchCountry.trim() || undefined,
        include_candidates: includeDrugCandidates,
      });
      setDrugSearchResults(rows);
    } catch (error) {
      setDrugSearchResults([]);
      setDrugSearchError(
        error instanceof Error ? error.message : "Failed to search drugs.",
      );
    } finally {
      setDrugSearchLoading(false);
    }
  }

  async function handleVerifyDrugProduct(
    productId: string,
    verificationStatus: "verified" | "rejected" | "candidate",
  ) {
    setProductUpdatingId(productId);
    setDrugSearchError("");
    try {
      await verifyDrugProduct(productId, verificationStatus);
      await handleSearchDrugs();
    } catch (error) {
      setDrugSearchError(
        error instanceof Error ? error.message : "Failed to verify drug product.",
      );
    } finally {
      setProductUpdatingId(null);
    }
  }

  async function handleCreateMedicationMatch(productId: string) {
    if (!selectedEquivalentMedication?.id) return;
    setMatchUpdatingId(productId);
    setDrugSearchError("");
    try {
      const match = await createMedicationDrugMatch(caseId, selectedEquivalentMedication.id, {
        drug_product_id: productId,
        confidence: 0.85,
        note: "Selected from drug reference search.",
      });
      setLastMedicationMatch(match);
      await handleFindEquivalent();
    } catch (error) {
      setDrugSearchError(
        error instanceof Error
          ? error.message
          : "Failed to create medication drug match.",
      );
    } finally {
      setMatchUpdatingId(null);
    }
  }

  async function handleVerifyMedicationMatch(
    verificationStatus: "verified" | "rejected" | "candidate",
  ) {
    if (!selectedEquivalentMedication?.id || !lastMedicationMatch?.id) return;
    setMatchUpdatingId(lastMedicationMatch.id);
    setDrugSearchError("");
    try {
      await verifyMedicationDrugMatch(
        caseId,
        selectedEquivalentMedication.id,
        lastMedicationMatch.id,
        verificationStatus,
      );
      setLastMedicationMatch({
        ...lastMedicationMatch,
        verification_status: verificationStatus,
      });
      await handleFindEquivalent();
    } catch (error) {
      setDrugSearchError(
        error instanceof Error
          ? error.message
          : "Failed to verify medication drug match.",
      );
    } finally {
      setMatchUpdatingId(null);
    }
  }

  async function handlePreviewDrugImport() {
    const rows = parseDrugImportRows(drugImportText);
    if (rows.length === 0) {
      setDrugImportError("Paste at least one CSV row to preview.");
      return;
    }
    setDrugImportLoading(true);
    setDrugImportError("");
    try {
      setDrugImportPreview(await previewDrugImport(rows));
    } catch (error) {
      setDrugImportPreview(null);
      setDrugImportError(
        error instanceof Error ? error.message : "Failed to preview drug import.",
      );
    } finally {
      setDrugImportLoading(false);
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
            verifyingEquivalentId={verifyingEquivalentId}
            onFind={() => void handleFindEquivalent()}
            onToggleCandidates={(next) => {
              setIncludeEquivalentCandidates(next);
              setEquivalentCandidates([]);
              setEquivalentError("");
            }}
            onVerifyEquivalent={(relationshipId, verificationStatus) =>
              void handleVerifyEquivalent(relationshipId, verificationStatus)
            }
          />
          <Panel
            title="Drug reference admin"
            description="Search curated products, verify product records, and attach a product match to the selected medication before showing final equivalents."
            action={
              <Badge variant="outline" className="rounded-full">
                staff only
              </Badge>
            }
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
              <Field label="Drug search">
                <Input
                  value={drugSearchQuery}
                  onChange={(event) => setDrugSearchQuery(event.target.value)}
                  className={inputBaseClassName}
                  placeholder="Atorvastatin, Sortis, C10AA05"
                />
              </Field>
              <Field label="Country">
                <Input
                  value={drugSearchCountry}
                  onChange={(event) => setDrugSearchCountry(event.target.value)}
                  className={inputBaseClassName}
                  placeholder="DE"
                />
              </Field>
              <div className="flex items-end">
                <button
                  type="button"
                  className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground"
                  disabled={drugSearchLoading}
                  onClick={() => void handleSearchDrugs()}
                >
                  {drugSearchLoading ? "Searching..." : "Search"}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeDrugCandidates}
                onChange={(event) => setIncludeDrugCandidates(event.target.checked)}
              />
              Include candidate and rejected products for staff verification
            </label>
            {drugSearchError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {drugSearchError}
              </div>
            ) : null}
            {lastMedicationMatch ? (
              <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-semibold">Medication match saved</p>
                    <p className="mt-1 text-xs text-sky-800/80">
                      Match {lastMedicationMatch.id} - {lastMedicationMatch.verification_status}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="h-8 rounded-lg border border-sky-300 bg-white px-3 text-xs font-medium text-sky-900"
                      disabled={matchUpdatingId === lastMedicationMatch.id}
                      onClick={() => void handleVerifyMedicationMatch("verified")}
                    >
                      Verify match
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-lg border border-sky-300 bg-white px-3 text-xs font-medium text-sky-900"
                      disabled={matchUpdatingId === lastMedicationMatch.id}
                      onClick={() => void handleVerifyMedicationMatch("rejected")}
                    >
                      Reject match
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {drugSearchResults.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-center text-sm text-muted-foreground">
                Search results will appear here.
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {drugSearchResults.map((product) => (
                  <article
                    key={product.id}
                    className="rounded-xl border border-border/50 bg-card/60 px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {product.brand_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {product.country_code}
                          {product.strength ? ` - ${product.strength}` : ""}
                          {product.form ? ` - ${product.form}` : ""}
                        </p>
                      </div>
                      <Badge variant="outline" className="rounded-full">
                        {product.verification_status}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Substances: {product.substances.join(", ") || "unknown"}
                    </p>
                    {product.clinical_note ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {product.clinical_note}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="h-7 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium"
                        disabled={productUpdatingId === product.id}
                        onClick={() => void handleVerifyDrugProduct(product.id, "verified")}
                      >
                        Verify product
                      </button>
                      <button
                        type="button"
                        className="h-7 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium"
                        disabled={productUpdatingId === product.id}
                        onClick={() => void handleVerifyDrugProduct(product.id, "rejected")}
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        className="h-7 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium"
                        disabled={!selectedEquivalentMedication?.id || matchUpdatingId === product.id}
                        onClick={() => void handleCreateMedicationMatch(product.id)}
                      >
                        Use for medication
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>
          <Panel
            title="Drug import skeleton"
            description="Dry-run CSV preview for future drug imports. Format: brand,country,substance,strength,form,manufacturer,atc."
          >
            <textarea
              value={drugImportText}
              onChange={(event) => {
                setDrugImportText(event.target.value);
                setDrugImportPreview(null);
                setDrugImportError("");
              }}
              className={textareaBaseClassName}
              rows={4}
              placeholder="Sortis,DE,Atorvastatin,20 mg,tablet,Pfizer,C10AA05"
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="h-9 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground"
                disabled={drugImportLoading}
                onClick={() => void handlePreviewDrugImport()}
              >
                {drugImportLoading ? "Previewing..." : "Preview import"}
              </button>
            </div>
            {drugImportError ? (
              <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {drugImportError}
              </div>
            ) : null}
            {drugImportPreview ? (
              <div className="rounded-xl border border-border/50 bg-muted/25 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">
                  {drugImportPreview.message}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {drugImportPreview.received_count} rows received - {drugImportPreview.valid_preview_count} valid preview rows - {drugImportPreview.issue_preview_count} with issues
                </p>
                <div className="mt-3 grid gap-2">
                  {drugImportPreview.preview.map((row) => (
                    <div
                      key={row.row_number}
                      className="rounded-lg border border-border/50 bg-card/60 px-3 py-2 text-xs"
                    >
                      <p className="font-medium text-foreground">
                        #{row.row_number} {row.brand_name} ({row.country_code})
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {row.substances?.join(", ") || "No substances"}
                        {row.issues.length > 0 ? ` - issues: ${row.issues.join(", ")}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
