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
import {
  formatEnumLabelFromKeys,
  useLang,
  type Lang,
  type Translations,
} from "@/lib/i18n";
import {
  CASE_MEDICATION_TYPE_LABEL_KEYS,
  CASE_MEDICATION_TYPE_VALUES,
} from "@/lib/i18n/catalogs/cases-clinical";

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

const MED_TYP_OPTIONS = CASE_MEDICATION_TYPE_VALUES;

function verificationStatusLabel(
  translations: Translations,
  status?: string | null,
) {
  if (status === "verified") return translations.cases_medications_status_verified;
  if (status === "rejected") return translations.cases_medications_status_rejected;
  if (status === "candidate") return translations.cases_medications_status_candidate;
  if (status === "pending") return translations.cases_medications_status_pending;
  return translations.cases_medications_status_unknown;
}

function medicationTypeLabel(
  value: string | null | undefined,
  translations: Translations,
) {
  return formatEnumLabelFromKeys(
    value,
    CASE_MEDICATION_TYPE_LABEL_KEYS,
    translations,
  );
}

function isKnownMedicationType(value: string) {
  return (CASE_MEDICATION_TYPE_VALUES as readonly string[]).includes(value);
}

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

function formatCatalogMessage(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function medicationDrugMatchNote(lang: Lang) {
  if (lang === "de") {
    return "Aus der Arzneimittel-Referenzsuche ausgewählt.";
  }
  return "Выбрано из справочника препаратов.";
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
          : t.cases_medications_equivalents_load_error,
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
          : t.cases_medications_equivalent_verify_error,
      );
    } finally {
      setVerifyingEquivalentId(null);
    }
  }

  async function handleSearchDrugs() {
    if (!drugSearchQuery.trim()) {
      setDrugSearchError(t.cases_medications_drug_search_required);
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
        error instanceof Error
          ? error.message
          : t.cases_medications_drug_search_failed,
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
        error instanceof Error
          ? error.message
          : t.cases_medications_product_verify_failed,
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
        note: medicationDrugMatchNote(lang),
      });
      setLastMedicationMatch(match);
      await handleFindEquivalent();
    } catch (error) {
      setDrugSearchError(
        error instanceof Error
          ? error.message
          : t.cases_medications_drug_match_create_failed,
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
          : t.cases_medications_drug_match_verify_failed,
      );
    } finally {
      setMatchUpdatingId(null);
    }
  }

  async function handlePreviewDrugImport() {
    const rows = parseDrugImportRows(drugImportText);
    if (rows.length === 0) {
      setDrugImportError(t.cases_medications_import_preview_required);
      return;
    }
    setDrugImportLoading(true);
    setDrugImportError("");
    try {
      setDrugImportPreview(await previewDrugImport(rows));
    } catch (error) {
      setDrugImportPreview(null);
      setDrugImportError(
        error instanceof Error
          ? error.message
          : t.cases_medications_import_preview_failed,
      );
    } finally {
      setDrugImportLoading(false);
    }
  }

  return (
    <>
      <CaseItemList<MedikamentItem>
        title={t.cases_medications_title}
        description={t.cases_medications_description}
        items={medications}
        blankItem={BLANK}
        cloneItem={(item) => ({ ...BLANK, ...item })}
        isValid={(form) => form.handelsname.trim().length > 0}
        save={saveMedications}
        busy={sectionBusy === "medications"}
        sectionError={sectionError}
        canEdit={permissions.canEdit}
        sheetTitle={{
          create: t.cases_medications_sheet_create,
          edit: t.cases_medications_sheet_edit,
        }}
        sheetWidth="wide"
        emptyTitle={t.cases_medications_empty_title}
        addFirstLabel={t.cases_medications_add_first}
        missingPrimaryMessage={t.cases_medications_missing_brand}
        renderCard={(item) => (
          <>
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
              <p className="truncate text-sm font-medium text-foreground">
                {item.handelsname || t.cases_medications_untitled}
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
                  {medicationTypeLabel(item.med_typ, t)}
                </Badge>
              ) : null}
            </div>
            {item.is_expired ? (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-700">
                <AlertTriangle className="size-3" />
                {t.cases_medications_expired}
                {item.pending_expiry_confirmation
                  ? ` · ${t.cases_medications_confirmation_required}`
                  : ""}
              </div>
            ) : null}
          </>
        )}
        renderForm={({ form, setForm, updateField, disabled }) => (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_medications_brand_name} required>
                <Input
                  value={form.handelsname}
                  autoFocus
                  onChange={(event) => updateField("handelsname", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_medications_active_ingredient}>
                <Input
                  value={form.wirkstoff ?? ""}
                  onChange={(event) => updateField("wirkstoff", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t.cases_medications_dose}>
                <Input
                  value={form.dosis ?? ""}
                  onChange={(event) => updateField("dosis", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_medications_unit}>
                <Input
                  value={form.dosis_einheit ?? ""}
                  onChange={(event) => updateField("dosis_einheit", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_medications_regimen}>
                <Input
                  value={form.einnahmeschema ?? ""}
                  onChange={(event) => updateField("einnahmeschema", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label={t.cases_medications_form}>
                <Input
                  value={form.darreichungsform ?? ""}
                  onChange={(event) => updateField("darreichungsform", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_medications_type}>
                <NativeComboboxSelect
                  value={form.med_typ ?? "permanent"}
                  onChange={(event) => updateField("med_typ", event.target.value)}
                  className={nativeSelectClassName}
                  disabled={disabled}
                >
                  {MED_TYP_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {medicationTypeLabel(option, t)}
                    </option>
                  ))}
                  {form.med_typ && !isKnownMedicationType(form.med_typ) ? (
                    <option value={form.med_typ}>
                      {medicationTypeLabel(form.med_typ, t)}
                    </option>
                  ) : null}
                </NativeComboboxSelect>
              </Field>
              <Field label={t.cases_medications_valid_until}>
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
              <Field label={t.cases_medications_since}>
                <Input
                  value={form.seit ?? ""}
                  onChange={(event) => updateField("seit", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_medications_reason}>
                <Input
                  value={form.grund ?? ""}
                  onChange={(event) => updateField("grund", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <Field label={t.cases_medications_prescriber_registry}>
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

            <Field label={t.cases_medications_doctor_label}>
              <Input
                value={form.verordnender_arzt ?? ""}
                onChange={(event) => updateField("verordnender_arzt", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>

            <Field label={t.cases_medications_note}>
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
                  {t.cases_medications_expiry_review_pending}
                </div>
                <p className="mt-1 leading-relaxed">
                  {t.cases_medications_expiry_review_full_editor}
                </p>
              </div>
            ) : null}
          </>
        )}
      />
      {selectedEquivalentMedication ? (
        <div className="mt-4 space-y-3">
          <Field label={t.cases_medications_equivalent_lookup_medication}>
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
            title={t.cases_medications_reference_title}
            description={t.cases_medications_reference_description}
            action={
              <Badge variant="outline" className="rounded-full">
                {t.cases_medications_staff_only}
              </Badge>
            }
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
              <Field label={t.cases_medications_drug_search}>
                <Input
                  value={drugSearchQuery}
                  onChange={(event) => setDrugSearchQuery(event.target.value)}
                  className={inputBaseClassName}
                  placeholder="Atorvastatin, Sortis, C10AA05"
                />
              </Field>
              <Field label={t.cases_medications_country}>
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
                  {drugSearchLoading
                    ? t.cases_medications_searching
                    : t.cases_medications_search}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeDrugCandidates}
                onChange={(event) => setIncludeDrugCandidates(event.target.checked)}
              />
              {t.cases_medications_include_candidates}
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
                    <p className="font-semibold">
                      {t.cases_medications_match_saved}
                    </p>
                    <p className="mt-1 text-xs text-sky-800/80">
                      {t.cases_medications_match_label} {lastMedicationMatch.id} -{" "}
                      {verificationStatusLabel(t, lastMedicationMatch.verification_status)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="h-8 rounded-lg border border-sky-300 bg-white px-3 text-xs font-medium text-sky-900"
                      disabled={matchUpdatingId === lastMedicationMatch.id}
                      onClick={() => void handleVerifyMedicationMatch("verified")}
                    >
                      {t.cases_medications_match_verify}
                    </button>
                    <button
                      type="button"
                      className="h-8 rounded-lg border border-sky-300 bg-white px-3 text-xs font-medium text-sky-900"
                      disabled={matchUpdatingId === lastMedicationMatch.id}
                      onClick={() => void handleVerifyMedicationMatch("rejected")}
                    >
                      {t.cases_medications_match_reject}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {drugSearchResults.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-6 text-center text-sm text-muted-foreground">
                {t.cases_medications_search_results_empty}
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
                        {verificationStatusLabel(t, product.verification_status)}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t.cases_medications_substances}:{" "}
                      {product.substances.join(", ") || t.cases_medications_unknown}
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
                        {t.cases_medications_product_verify}
                      </button>
                      <button
                        type="button"
                        className="h-7 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium"
                        disabled={productUpdatingId === product.id}
                        onClick={() => void handleVerifyDrugProduct(product.id, "rejected")}
                      >
                        {t.cases_medications_reject}
                      </button>
                      <button
                        type="button"
                        className="h-7 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium"
                        disabled={!selectedEquivalentMedication?.id || matchUpdatingId === product.id}
                        onClick={() => void handleCreateMedicationMatch(product.id)}
                      >
                        {t.cases_medications_use_for_medication}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </Panel>
          <Panel
            title={t.cases_medications_import_title}
            description={t.cases_medications_import_description}
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
                {drugImportLoading
                  ? t.cases_medications_previewing
                  : t.cases_medications_preview_import}
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
                  {formatCatalogMessage(t.cases_medications_import_summary, {
                    received: String(drugImportPreview.received_count),
                    valid: String(drugImportPreview.valid_preview_count),
                    issues: String(drugImportPreview.issue_preview_count),
                  })}
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
                        {row.substances?.join(", ") || t.cases_medications_no_substances}
                        {row.issues.length > 0
                          ? ` - ${t.cases_medications_issues}: ${row.issues.join(", ")}`
                          : ""}
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
