import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useEffect, useMemo, useReducer, type SetStateAction } from "react";
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
  uiText,
  useLang,
  type Lang,
  type Translations,
} from "@/lib/i18n";
import {
  CASE_MEDICATION_TYPE_LABEL_KEYS,
  CASE_MEDICATION_TYPE_VALUES,
} from "@/lib/i18n/catalogs/cases-clinical";
import { doctorSpecialtyLabel, type SpecializationLabelLang } from "@/pages/providers/model/specialization-labels";

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

function doctorOptionLabel(doctor: CaseWorkspaceDoctor, lang: SpecializationLabelLang) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialtyLabel = doctorSpecialtyLabel(doctor, lang);
  const specialty = specialtyLabel ? ` - ${specialtyLabel}` : "";
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

type MedicationsSectionState = {
  equivalentMedicationId: string;
  includeEquivalentCandidates: boolean;
  equivalentCandidates: GermanEquivalent[];
  equivalentLoading: boolean;
  equivalentError: string;
  verifyingEquivalentId: string | null;
  drugSearchQuery: string;
  drugSearchCountry: string;
  includeDrugCandidates: boolean;
  drugSearchResults: DrugProduct[];
  drugSearchLoading: boolean;
  drugSearchError: string;
  productUpdatingId: string | null;
  matchUpdatingId: string | null;
  lastMedicationMatch: MedicationDrugMatchResponse | null;
  drugImportText: string;
  drugImportPreview: DrugImportPreview | null;
  drugImportLoading: boolean;
  drugImportError: string;
};

type MedicationsSectionAction =
  | { type: "patch"; value: Partial<MedicationsSectionState> }
  | {
      type: "update";
      updater: (state: MedicationsSectionState) => MedicationsSectionState;
    };

const MEDICATIONS_SECTION_INITIAL_STATE: MedicationsSectionState = {
  equivalentMedicationId: "",
  includeEquivalentCandidates: false,
  equivalentCandidates: [],
  equivalentLoading: false,
  equivalentError: "",
  verifyingEquivalentId: null,
  drugSearchQuery: "",
  drugSearchCountry: "",
  includeDrugCandidates: false,
  drugSearchResults: [],
  drugSearchLoading: false,
  drugSearchError: "",
  productUpdatingId: null,
  matchUpdatingId: null,
  lastMedicationMatch: null,
  drugImportText: "",
  drugImportPreview: null,
  drugImportLoading: false,
  drugImportError: "",
};

function medicationsSectionReducer(
  state: MedicationsSectionState,
  action: MedicationsSectionAction,
): MedicationsSectionState {
  switch (action.type) {
    case "patch":
      return { ...state, ...action.value };
    case "update":
      return action.updater(state);
    default:
      return state;
  }
}

function createMedicationsFieldAction<K extends keyof MedicationsSectionState>(
  field: K,
  value: SetStateAction<MedicationsSectionState[K]>,
): MedicationsSectionAction {
  return {
    type: "update",
    updater: (state) => {
      const currentValue = state[field];
      const nextValue =
        typeof value === "function"
          ? (value as (current: MedicationsSectionState[K]) => MedicationsSectionState[K])(
              currentValue,
            )
          : value;

      if (Object.is(currentValue, nextValue)) return state;
      return { ...state, [field]: nextValue };
    },
  };
}

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
  return value.split(/\r?\n/).flatMap((line) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) return [];
      const [
        brand_name,
        country_code,
        substance,
        strength,
        form,
        manufacturer,
        atc_code,
      ] = trimmedLine.split(",").map((part) => part.trim());
      return [{
        brand_name,
        country_code,
        atc_code,
        form,
        strength,
        manufacturer,
        substances: substance ? [substance] : [],
        verification_status: "candidate",
      }];
    });
}

function formatCatalogMessage(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function medicationDrugMatchNote(lang: Lang) {
  return uiText("cases_medications_drug_match_note", lang);
}

type MedicationCardContentProps = {
  item: MedikamentItem;
  t: Translations;
};

function MedicationCardContent({ item, t }: MedicationCardContentProps) {
  return (
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
  );
}
type MedicationFormContentProps = {
  disabled: boolean;
  doctors: CaseWorkspaceDoctor[];
  form: MedikamentItem;
  lang: SpecializationLabelLang;
  setForm: (value: SetStateAction<MedikamentItem>) => void;
  t: Translations;
  updateField: <K extends keyof MedikamentItem>(field: K, value: MedikamentItem[K]) => void;
};

function MedicationFormContent({
  disabled,
  doctors,
  form,
  lang,
  setForm,
  t,
  updateField,
}: MedicationFormContentProps) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t.cases_medications_brand_name} required>
          <Input
            value={form.handelsname}
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
            setForm((current) => ({
              ...current,
              verordnender_arzt_id: doctorId,
              verordnender_arzt: selectedDoctor
                ? selectedDoctor.name
                : current.verordnender_arzt ?? "",
            }));
          }}
          className={nativeSelectClassName}
          disabled={disabled}
        >
          <option value="">{t.common_not_set}</option>
          {doctors.map((doctor) => (
            <option key={doctor.id} value={doctor.id}>
              {doctorOptionLabel(doctor, lang)}
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
  );
}

type MedicationReferenceWorkspaceProps = {
  drugImportError: string;
  drugImportLoading: boolean;
  drugImportPreview: DrugImportPreview | null;
  drugImportText: string;
  drugSearchCountry: string;
  drugSearchError: string;
  drugSearchLoading: boolean;
  drugSearchQuery: string;
  drugSearchResults: DrugProduct[];
  equivalentCandidates: GermanEquivalent[];
  equivalentError: string;
  equivalentLoading: boolean;
  includeDrugCandidates: boolean;
  includeEquivalentCandidates: boolean;
  lastMedicationMatch: MedicationDrugMatchResponse | null;
  matchUpdatingId: string | null;
  medicationOptions: Array<MedikamentItem & { id: string }>;
  productUpdatingId: string | null;
  selectedEquivalentMedication: (MedikamentItem & { id: string }) | null;
  t: Translations;
  verifyingEquivalentId: string | null;
  handleCreateMedicationMatch: (productId: string) => void | Promise<void>;
  handleFindEquivalent: () => void | Promise<void>;
  handlePreviewDrugImport: () => void | Promise<void>;
  handleSearchDrugs: () => void | Promise<void>;
  handleVerifyDrugProduct: (productId: string, verificationStatus: "verified" | "rejected" | "candidate") => void | Promise<void>;
  handleVerifyEquivalent: (relationshipId: string, verificationStatus: "verified" | "rejected" | "candidate") => void | Promise<void>;
  handleVerifyMedicationMatch: (verificationStatus: "verified" | "rejected" | "candidate") => void | Promise<void>;
  setDrugImportError: (value: SetStateAction<string>) => void;
  setDrugImportPreview: (value: SetStateAction<DrugImportPreview | null>) => void;
  setDrugImportText: (value: SetStateAction<string>) => void;
  setDrugSearchCountry: (value: SetStateAction<string>) => void;
  setDrugSearchQuery: (value: SetStateAction<string>) => void;
  setEquivalentCandidates: (value: SetStateAction<GermanEquivalent[]>) => void;
  setEquivalentError: (value: SetStateAction<string>) => void;
  setEquivalentMedicationId: (value: SetStateAction<string>) => void;
  setIncludeDrugCandidates: (value: SetStateAction<boolean>) => void;
  setIncludeEquivalentCandidates: (value: SetStateAction<boolean>) => void;
};

function MedicationReferenceWorkspace({
  drugImportError,
  drugImportLoading,
  drugImportPreview,
  drugImportText,
  drugSearchCountry,
  drugSearchError,
  drugSearchLoading,
  drugSearchQuery,
  drugSearchResults,
  equivalentCandidates,
  equivalentError,
  equivalentLoading,
  includeDrugCandidates,
  includeEquivalentCandidates,
  lastMedicationMatch,
  matchUpdatingId,
  medicationOptions,
  productUpdatingId,
  selectedEquivalentMedication,
  t,
  verifyingEquivalentId,
  handleCreateMedicationMatch,
  handleFindEquivalent,
  handlePreviewDrugImport,
  handleSearchDrugs,
  handleVerifyDrugProduct,
  handleVerifyEquivalent,
  handleVerifyMedicationMatch,
  setDrugImportError,
  setDrugImportPreview,
  setDrugImportText,
  setDrugSearchCountry,
  setDrugSearchQuery,
  setEquivalentCandidates,
  setEquivalentError,
  setEquivalentMedicationId,
  setIncludeDrugCandidates,
  setIncludeEquivalentCandidates,
}: MedicationReferenceWorkspaceProps) {
  return selectedEquivalentMedication ? (
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
                  placeholder={t.uiText.cases_medications_drug_search_placeholder}
                />
              </Field>
              <Field label={t.cases_medications_country}>
                <Input
                  value={drugSearchCountry}
                  onChange={(event) => setDrugSearchCountry(event.target.value)}
                  className={inputBaseClassName}
                  placeholder={t.uiText.cases_medications_country_placeholder}
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
              placeholder={t.uiText.cases_medications_import_placeholder}
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

  ) : null;
}
function useMedicationsSectionContent() {
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
  const [
    {
      equivalentMedicationId,
      includeEquivalentCandidates,
      equivalentCandidates,
      equivalentLoading,
      equivalentError,
      verifyingEquivalentId,
      drugSearchQuery,
      drugSearchCountry,
      includeDrugCandidates,
      drugSearchResults,
      drugSearchLoading,
      drugSearchError,
      productUpdatingId,
      matchUpdatingId,
      lastMedicationMatch,
      drugImportText,
      drugImportPreview,
      drugImportLoading,
      drugImportError,
    },
    dispatchMedicationsState,
  ] = useReducer(medicationsSectionReducer, MEDICATIONS_SECTION_INITIAL_STATE);
  const setMedicationField = <K extends keyof MedicationsSectionState>(
    field: K,
    value: SetStateAction<MedicationsSectionState[K]>,
  ) => dispatchMedicationsState(createMedicationsFieldAction(field, value));
  const setEquivalentMedicationId = (value: SetStateAction<string>) =>
    dispatchMedicationsState({
      type: "update",
      updater: (current) => {
        const equivalentMedicationId =
          typeof value === "function" ? value(current.equivalentMedicationId) : value;
        if (equivalentMedicationId === current.equivalentMedicationId) {
          return current;
        }
        return {
          ...current,
          equivalentMedicationId,
          equivalentCandidates: [],
          equivalentError: "",
          lastMedicationMatch: null,
        };
      },
    });
  const setIncludeEquivalentCandidates = (value: SetStateAction<boolean>) =>
    setMedicationField("includeEquivalentCandidates", value);
  const setEquivalentCandidates = (value: SetStateAction<GermanEquivalent[]>) =>
    setMedicationField("equivalentCandidates", value);
  const setEquivalentLoading = (value: SetStateAction<boolean>) =>
    setMedicationField("equivalentLoading", value);
  const setEquivalentError = (value: SetStateAction<string>) =>
    setMedicationField("equivalentError", value);
  const setVerifyingEquivalentId = (value: SetStateAction<string | null>) =>
    setMedicationField("verifyingEquivalentId", value);
  const setDrugSearchQuery = (value: SetStateAction<string>) =>
    setMedicationField("drugSearchQuery", value);
  const setDrugSearchCountry = (value: SetStateAction<string>) =>
    setMedicationField("drugSearchCountry", value);
  const setIncludeDrugCandidates = (value: SetStateAction<boolean>) =>
    setMedicationField("includeDrugCandidates", value);
  const setDrugSearchResults = (value: SetStateAction<DrugProduct[]>) =>
    setMedicationField("drugSearchResults", value);
  const setDrugSearchLoading = (value: SetStateAction<boolean>) =>
    setMedicationField("drugSearchLoading", value);
  const setDrugSearchError = (value: SetStateAction<string>) =>
    setMedicationField("drugSearchError", value);
  const setProductUpdatingId = (value: SetStateAction<string | null>) =>
    setMedicationField("productUpdatingId", value);
  const setMatchUpdatingId = (value: SetStateAction<string | null>) =>
    setMedicationField("matchUpdatingId", value);
  const setLastMedicationMatch = (
    value: SetStateAction<MedicationDrugMatchResponse | null>,
  ) => setMedicationField("lastMedicationMatch", value);
  const setDrugImportText = (value: SetStateAction<string>) =>
    setMedicationField("drugImportText", value);
  const setDrugImportPreview = (value: SetStateAction<DrugImportPreview | null>) =>
    setMedicationField("drugImportPreview", value);
  const setDrugImportLoading = (value: SetStateAction<boolean>) =>
    setMedicationField("drugImportLoading", value);
  const setDrugImportError = (value: SetStateAction<string>) =>
    setMedicationField("drugImportError", value);

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
      setLastMedicationMatch((current) => current ? {
        ...current,
        verification_status: verificationStatus,
      } : current);
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
        cardContent={(item) => <MedicationCardContent item={item} t={t} />}
        formContent={(props) => (
          <MedicationFormContent {...props} doctors={doctors} lang={lang} t={t} />
        )}
      />
      <MedicationReferenceWorkspace
        drugImportError={drugImportError}
        drugImportLoading={drugImportLoading}
        drugImportPreview={drugImportPreview}
        drugImportText={drugImportText}
        drugSearchCountry={drugSearchCountry}
        drugSearchError={drugSearchError}
        drugSearchLoading={drugSearchLoading}
        drugSearchQuery={drugSearchQuery}
        drugSearchResults={drugSearchResults}
        equivalentCandidates={equivalentCandidates}
        equivalentError={equivalentError}
        equivalentLoading={equivalentLoading}
        includeDrugCandidates={includeDrugCandidates}
        includeEquivalentCandidates={includeEquivalentCandidates}
        lastMedicationMatch={lastMedicationMatch}
        matchUpdatingId={matchUpdatingId}
        medicationOptions={medicationOptions}
        productUpdatingId={productUpdatingId}
        selectedEquivalentMedication={selectedEquivalentMedication}
        t={t}
        verifyingEquivalentId={verifyingEquivalentId}
        handleCreateMedicationMatch={handleCreateMedicationMatch}
        handleFindEquivalent={handleFindEquivalent}
        handlePreviewDrugImport={handlePreviewDrugImport}
        handleSearchDrugs={handleSearchDrugs}
        handleVerifyDrugProduct={handleVerifyDrugProduct}
        handleVerifyEquivalent={handleVerifyEquivalent}
        handleVerifyMedicationMatch={handleVerifyMedicationMatch}
        setDrugImportError={setDrugImportError}
        setDrugImportPreview={setDrugImportPreview}
        setDrugImportText={setDrugImportText}
        setDrugSearchCountry={setDrugSearchCountry}
        setDrugSearchQuery={setDrugSearchQuery}
        setEquivalentCandidates={setEquivalentCandidates}
        setEquivalentError={setEquivalentError}
        setEquivalentMedicationId={setEquivalentMedicationId}
        setIncludeDrugCandidates={setIncludeDrugCandidates}
        setIncludeEquivalentCandidates={setIncludeEquivalentCandidates}
      />    </>
  );
}


export function MedicationsSection() {
  return useMedicationsSectionContent();
}
