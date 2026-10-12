import { hasFormChanges } from "@/lib/form-changes";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Field,
  checkboxClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/components/ui-shell";
import { formatDocumentSourceLabel } from "@/lib/document-source-labels";
import { uiText, useLang } from "@/lib/i18n";
import {
  localizeDocumentCategory,
  localizeDocumentCode,
} from "@/lib/required-document-labels";
import {
  fetchDocument,
  fetchDocumentCategories,
  fetchDocumentVersions,
  updateDocument,
} from "@/pages/documents/data/document-api";
import type {
  CategoryOption,
  DocumentAccessCategory,
  DocumentDirection,
  DocumentFinancialStatus,
  DocumentItem,
  DocumentPaymentMethod,
  DocumentStatus,
  DocumentVariant,
  DocumentVisibility,
} from "@/pages/documents/model/types";

import { orderCategoryTree } from "../../model/document-category-tree";
import { FormSection } from "../shared/patient-form-primitives";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type Copy = {
  title: string;
  description: string;
  loading: string;
  loadFailed: string;
  saveFailed: string;
  saved: string;
  cancel: string;
  save: string;
  saving: string;
  identity: string;
  name: string;
  type: string;
  typePlaceholder: string;
  category: string;
  noCategory: string;
  medical: string;
  manualHint: string;
  classification: string;
  status: string;
  visibility: string;
  direction: string;
  variant: string;
  language: string;
  access: string;
  documentDate: string;
  notSet: string;
  source: string;
  sourcePerson: string;
  sourceInstitution: string;
  addresseePerson: string;
  addresseeInstitution: string;
  processing: string;
  clinic: string;
  origin: string;
  notes: string;
  finance: string;
  financialStatus: string;
  dueDate: string;
  paymentDate: string;
  paymentMethod: string;
};

const COPY: Record<"de" | "ru", Copy> = {
  de: {
    title: "Patientendokument bearbeiten",
    description:
      "Name, Dokumentart, vollständige Kategorie und weitere Metadaten ändern.",
    loading: "Dokument wird geladen …",
    loadFailed: "Das Dokument konnte nicht geladen werden.",
    saveFailed: "Das Dokument konnte nicht gespeichert werden.",
    saved: "Dokument aktualisiert",
    cancel: "Abbrechen",
    save: "Änderungen speichern",
    saving: "Wird gespeichert …",
    identity: "Benennung und Kategorie",
    name: "Einheitlicher Dokumentname",
    type: "Dokumentart",
    typePlaceholder: "z. B. Arztbrief oder Befund",
    category: "Kategorie / Fachgebiet",
    noCategory: "Nicht zugeordnet",
    medical: "Medizinisches Dokument",
    manualHint:
      "Manuelle Änderungen haben Vorrang und werden nicht mehr durch die Hintergrund-Erkennung überschrieben.",
    classification: "Klassifikation und Freigabe",
    status: "Status",
    visibility: "Sichtbarkeit",
    direction: "Richtung",
    variant: "Variante",
    language: "Dokumentsprache",
    access: "Zugriffskategorie",
    documentDate: "Dokumentdatum",
    notSet: "Nicht festgelegt",
    source: "Verfasser, Institution und Adressat",
    sourcePerson: "Verfasser",
    sourceInstitution: "Erstellende Institution",
    addresseePerson: "Adressat",
    addresseeInstitution: "Adressaten-Institution",
    processing: "Weitere Angaben",
    clinic: "Klinik",
    origin: "Herkunft",
    notes: "Notizen",
    finance: "Finanzangaben",
    financialStatus: "Finanzstatus",
    dueDate: "Fälligkeitsdatum",
    paymentDate: "Zahlungsdatum",
    paymentMethod: "Zahlungsart",
  },
  ru: {
    title: "Редактировать документ пациента",
    description:
      "Измените название, тип, любую категорию и остальные метаданные документа.",
    loading: "Загружаем документ …",
    loadFailed: "Не удалось загрузить документ.",
    saveFailed: "Не удалось сохранить документ.",
    saved: "Документ обновлён",
    cancel: "Отмена",
    save: "Сохранить изменения",
    saving: "Сохраняем …",
    identity: "Название и категория",
    name: "Унифицированное название документа",
    type: "Тип документа",
    typePlaceholder: "Например: Arztbrief или Befund",
    category: "Категория / специализация",
    noCategory: "Не назначена",
    medical: "Медицинский документ",
    manualHint:
      "Ручные изменения имеют приоритет и больше не будут перезаписаны фоновым распознаванием.",
    classification: "Классификация и доступ",
    status: "Статус",
    visibility: "Видимость",
    direction: "Направление",
    variant: "Вариант",
    language: "Язык документа",
    access: "Категория доступа",
    documentDate: "Дата документа",
    notSet: "Не указано",
    source: "Автор, учреждение и адресат",
    sourcePerson: "Автор / составитель",
    sourceInstitution: "Учреждение-составитель",
    addresseePerson: "Адресат",
    addresseeInstitution: "Учреждение-адресат",
    processing: "Дополнительные данные",
    clinic: "Клиника",
    origin: "Источник / происхождение",
    notes: "Примечания",
    finance: "Финансовые данные",
    financialStatus: "Финансовый статус",
    dueDate: "Срок оплаты",
    paymentDate: "Дата оплаты",
    paymentMethod: "Способ оплаты",
  },
};

const DOCUMENT_TYPES = [
  "Arztbrief",
  "Entlassungsbrief",
  "Befund",
  "Befundbericht",
  "Laborbefund",
  "Radiologischer Befund",
  "Histologischer Befund",
  "Pathologischer Befund",
  "OP-Bericht",
  "Gutachten",
  "Verordnung",
  "Überweisung",
  "Behandlungsplan",
  "Medikationsplan",
  "Rechnung",
  "Kostenvoranschlag",
  "Zahlungsbeleg",
  "Versicherungsunterlage",
  "Korrespondenz",
  "Reisepass",
  "Vertrag",
  "Einverständniserklärung",
  "Terminbestätigung",
  "Übersetzung",
  "Sonstiges",
] as const;

const SPECIALTIES = [
  ["GASTRO", "Gastroenterologie", "Гастроэнтерология"],
  ["ONKO", "Onkologie", "Онкология"],
  ["KARDIO", "Kardiologie", "Кардиология"],
  ["KARDCH", "Kardiochirurgie", "Кардиохирургия"],
  ["DERMA", "Dermatologie", "Дерматология"],
  ["DERMCH", "Dermatologische Chirurgie", "Дерматологическая хирургия"],
  ["RAD", "Radiologie", "Радиология"],
  ["LAB", "Labor", "Лабораторные исследования"],
  ["HISTO/PATHO", "Histologie / Pathologie", "Гистология / патология"],
  ["NEURO", "Neurologie", "Неврология"],
  ["NEURCH", "Neurochirurgie", "Нейрохирургия"],
  ["CHIR", "Chirurgie", "Хирургия"],
  ["GYN", "Gynäkologie", "Гинекология"],
  ["GYNCH", "Gynäkologische Chirurgie", "Гинекологическая хирургия"],
  ["AUGE", "Ophthalmologie", "Офтальмология"],
  ["AUGCH", "Ophthalmologische Chirurgie", "Офтальмологическая хирургия"],
  ["HÄMAT", "Hämatologie", "Гематология"],
  ["URO", "Urologie", "Урология"],
  ["UROCH", "Urologische Chirurgie", "Урологическая хирургия"],
  ["SCHLAF", "Schlafmedizin", "Медицина сна"],
  ["ENDO", "Endokrinologie", "Эндокринология"],
  ["ENDOCH", "Endokrine Chirurgie", "Эндокринная хирургия"],
  ["VASK", "Gefäßchirurgie", "Сосудистая хирургия"],
  ["ORTHOL", "Orthopädie", "Ортопедия"],
  ["UNFAL", "Unfallchirurgie", "Травматология"],
  ["MKG", "Mund-Kiefer-Gesichtschirurgie", "Челюстно-лицевая хирургия"],
  ["DENT", "Zahnmedizin", "Стоматология"],
  ["KFO", "Kieferorthopädie", "Ортодонтия"],
  ["PLASTCHIR", "Plastische Chirurgie", "Пластическая хирургия"],
  ["PÄD", "Kinderheilkunde", "Педиатрия"],
  [
    "PHYSIO/REHA",
    "Physiotherapie / Rehabilitation",
    "Физиотерапия / реабилитация",
  ],
  ["HNO", "Hals-Nasen-Ohren-Heilkunde", "Оториноларингология"],
  ["INFEKT", "Infektiologie", "Инфектология"],
  ["ANA", "Anästhesie", "Анестезиология"],
  ["NEPHRO", "Nephrologie", "Нефрология"],
  ["PSYCH", "Psychiatrie", "Психиатрия"],
  ["PNEUMO/RESP", "Pneumologie", "Пульмонология"],
  ["PROKTO", "Proktologie", "Проктология"],
  ["RHEUM", "Rheumatologie", "Ревматология"],
  ["GER", "Geriatrie", "Гериатрия"],
  ["ALLMED", "Allgemeinmedizin", "Общая медицина"],
] as const;

const CANONICAL_SPECIALTY_KEYS: Record<string, string> = {
  KARDIO: "medical_kardio",
  GASTRO: "medical_gastro",
  URO: "medical_uro",
  LAB: "medical_lab",
  "HISTO/PATHO": "medical_patho_histo",
  RAD: "medical_radiology",
};

function specialtyKey(code: string) {
  return (
    CANONICAL_SPECIALTY_KEYS[code] ??
    `medical_${code
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`
  );
}

function specialtyCategories(lang: "de" | "ru"): CategoryOption[] {
  return SPECIALTIES.map(([code, de, ru], index) => ({
    key: specialtyKey(code),
    label: lang === "de" ? de : ru,
    label_de: de,
    label_en: ru,
    is_medical: true,
    level: "subcategory",
    parent_key: "medical",
    short_code: code,
    access_category: "medical",
    sort_order: 400 + index,
  }));
}

function mergeCategories(
  categories: CategoryOption[],
  currentCategory: string,
  lang: "de" | "ru",
) {
  // A legacy duplicate (medical_report, conclusion, lab_analysis) is offered
  // only to the document already filed under it (QA 2026-10-12 B-12).
  const merged = categories.filter(
    (category) => category.selectable !== false || category.key === currentCategory,
  );
  const knownKeys = new Set(categories.map((item) => item.key));
  const knownCodes = new Set(
    merged.map((item) => item.short_code?.toUpperCase()).filter(Boolean),
  );
  for (const specialty of specialtyCategories(lang)) {
    if (
      !knownKeys.has(specialty.key) &&
      !knownCodes.has(specialty.short_code?.toUpperCase())
    ) {
      merged.push(specialty);
      knownKeys.add(specialty.key);
    }
  }
  if (currentCategory && !knownKeys.has(currentCategory)) {
    merged.unshift({
      key: currentCategory,
      label: currentCategory,
      label_de: currentCategory,
      level: "type",
      sort_order: -1,
    });
  }
  // Tree order: each category right under its own parent (QA 2026-10-11 B-12).
  return orderCategoryTree(merged);
}

function categoryLabel(
  category: CategoryOption & { depth: number },
  lang: "de" | "ru",
) {
  const label = localizeDocumentCategory(category, lang, (key) =>
    uiText(key, lang),
  );
  const prefix = category.short_code ? `${category.short_code} · ` : "";
  const indent = category.depth > 0 ? `${"—".repeat(category.depth)} ` : "";
  return `${indent}${prefix}${label}`;
}

/**
 * A free-text field whose stored value may be a system code
 * ("confidentiality_release", "patient_portal", "template:…"): it shows the
 * code's label (QA 2026-10-11 B-06, B-12) and keeps the code as long as the
 * text is not changed; a picked suggestion stores its code.
 */
function CodedTextField({
  id,
  label,
  value,
  displayValue,
  options = [],
  placeholder,
  required = false,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  displayValue: (value: string) => string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  // The sheet remounts the field per document and language (its key), so the
  // stored code and its label are those the field opened with.
  const [initial] = useState(() => ({ value, shown: displayValue(value) }));
  const [text, setText] = useState(initial.shown);
  const listId = options.length > 0 ? `${id}-options` : undefined;

  function change(next: string) {
    setText(next);
    if (next === initial.shown) {
      onChange(initial.value);
      return;
    }
    const picked = options.find((option) => option.label === next);
    onChange(picked ? picked.value : next);
  }

  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        list={listId}
        value={text}
        onChange={(event) => change(event.target.value)}
        className={inputClass}
        placeholder={placeholder}
        required={required}
      />
      {listId ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.value} value={option.label} />
          ))}
        </datalist>
      ) : null}
    </Field>
  );
}

type EditForm = {
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  klinik: string;
  ursprung: string;
  notes: string;
  documentDirection: DocumentDirection | "";
  documentVariant: DocumentVariant | "";
  documentLanguage: string;
  accessCategory: DocumentAccessCategory | "";
  documentDate: string;
  sourcePerson: string;
  sourceInstitution: string;
  addresseePerson: string;
  addresseeInstitution: string;
  financialStatus: DocumentFinancialStatus | "";
  paymentDueDate: string;
  paymentDate: string;
  paymentMethod: DocumentPaymentMethod | "";
};

function formFromDocument(document: DocumentItem): EditForm {
  return {
    autoName: document.auto_name,
    art: document.art,
    category: document.category ?? "",
    status: document.status as DocumentStatus,
    visibility: document.visibility as DocumentVisibility,
    isMedical: document.is_medical,
    klinik: document.klinik ?? "",
    ursprung: document.ursprung ?? "",
    notes: document.notes ?? "",
    documentDirection: document.document_direction ?? "",
    documentVariant: document.document_variant ?? "",
    documentLanguage: document.document_language ?? "",
    accessCategory: document.access_category ?? "",
    documentDate: document.document_date ?? "",
    sourcePerson: document.source_person ?? "",
    sourceInstitution: document.source_institution ?? "",
    addresseePerson: document.addressee_person ?? "",
    addresseeInstitution: document.addressee_institution ?? "",
    financialStatus: document.financial_status ?? "",
    paymentDueDate: document.payment_due_date ?? "",
    paymentDate: document.payment_date ?? "",
    paymentMethod: document.payment_method ?? "",
  };
}

type PatientDocumentEditSheetProps = {
  open: boolean;
  documentId: string | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function PatientDocumentEditSheet({
  open,
  documentId,
  onOpenChange,
  onSaved,
}: PatientDocumentEditSheetProps) {
  const { lang, t } = useLang();
  const copy = COPY[lang];
  // After a signature the open sheet follows the document's new current
  // version (the signed scan) instead of the stale draft (QA 2026-10-11 B-07).
  const [followed, setFollowed] = useState<{ from: string; to: string } | null>(null);
  const activeDocumentId =
    followed && documentId && followed.from === documentId ? followed.to : documentId;
  const [form, setForm] = useState<EditForm | null>(null);
  const [initialForm, setInitialForm] = useState<EditForm | null>(null);
  const dirty = form !== null && initialForm !== null && hasFormChanges(form, initialForm);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [arts, setArts] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !activeDocumentId) {
      setForm(null);
      setCategories([]);
      setArts([]);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([fetchDocument(activeDocumentId), fetchDocumentCategories()])
      .then(([document, lookups]) => {
        if (cancelled) return;
        const loadedForm = formFromDocument(document);
        setForm(loadedForm);
        setInitialForm(loadedForm);
        setCategories(lookups.categories);
        setArts(lookups.arts);
      })
      .catch((nextError) => {
        if (cancelled) return;
        setError(
          nextError instanceof Error ? nextError.message : copy.loadFailed,
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [copy.loadFailed, activeDocumentId, open]);

  const categoryOptions = useMemo(
    () => mergeCategories(categories, form?.category ?? "", lang),
    [categories, form?.category, lang],
  );
  // Suggestions for the type: known codes by their label, other types as
  // typed (QA 2026-10-11: no raw codes in the sheet).
  const artOptions = useMemo(
    () =>
      Array.from(new Set([...DOCUMENT_TYPES, ...arts].filter(Boolean)))
        .sort()
        .map((art) => ({
          value: art,
          label: localizeDocumentCode(art, (key) => uiText(key, lang)),
        })),
    [arts, lang],
  );
  const artLabel = (value: string) =>
    localizeDocumentCode(value, (key) => uiText(key, lang));
  const sourceLabel = (value: string) =>
    value.trim() ? formatDocumentSourceLabel(value, t) : "";

  // A signature (paper scan or electronic) stores a new version: the list
  // refreshes and the sheet switches to the current version.
  async function handleSignatureDone() {
    onSaved();
    if (!activeDocumentId || !documentId) return;
    try {
      const versions = await fetchDocumentVersions(activeDocumentId);
      const current =
        versions.find((version) => version.is_latest_version) ??
        [...versions].sort((left, right) => right.version_number - left.version_number)[0];
      if (current && current.id !== activeDocumentId) {
        setFollowed({ from: documentId, to: current.id });
      }
    } catch {
      // The refreshed list shows the new version all the same.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeDocumentId || !form || !dirty || busy) return;
    if (!form.autoName.trim() || !form.art.trim()) {
      setError(copy.saveFailed);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updateDocument(activeDocumentId, {
        auto_name: form.autoName.trim(),
        art: form.art.trim(),
        category: form.category || null,
        status: form.status,
        visibility: form.visibility,
        is_medical: form.isMedical,
        klinik: form.klinik.trim() || null,
        ursprung: form.ursprung.trim() || null,
        notes: form.notes.trim() || null,
        document_direction: form.documentDirection || null,
        document_variant: form.documentVariant || null,
        document_language: form.documentLanguage || null,
        access_category: form.accessCategory || null,
        document_date: form.documentDate || null,
        source_person: form.sourcePerson.trim() || null,
        source_institution: form.sourceInstitution.trim() || null,
        addressee_person: form.addresseePerson.trim() || null,
        addressee_institution: form.addresseeInstitution.trim() || null,
        financial_status: form.financialStatus || null,
        payment_due_date: form.paymentDueDate || null,
        payment_date: form.paymentDate || null,
        payment_method: form.paymentMethod || null,
      });
      toast.success(copy.saved);
      onOpenChange(false);
      onSaved();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : copy.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  function update<K extends keyof EditForm>(key: K, value: EditForm[K]) {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function handleCategoryChange(value: string) {
    const selected = categoryOptions.find((option) => option.key === value);
    setForm((current) =>
      current
        ? {
            ...current,
            category: value,
            ...(selected
              ? {
                  isMedical: selected.is_medical ?? current.isMedical,
                  accessCategory:
                    selected.access_category ?? current.accessCategory,
                }
              : {}),
          }
        : current,
    );
  }

  return (
    <PatientSheetScaffold requireChanges dirty={dirty}
      open={open}
      onOpenChange={onOpenChange}
      width="detail-wide"
      onSubmit={handleSubmit}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {copy.cancel}
          </Button>
          <Button type="submit" size="sm" disabled={busy || loading || !form}>
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {busy ? copy.saving : copy.save}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex min-h-52 items-center justify-center rounded-xl border border-border bg-muted/25 text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {copy.loading}
        </div>
      ) : form ? (
        <>
          {activeDocumentId ? (
            <DocumentSignatureAction
              key={activeDocumentId}
              documentId={activeDocumentId}
              title={initialForm?.autoName || activeDocumentId}
              onDone={() => void handleSignatureDone()}
            />
          ) : null}
          <FormSection title={copy.identity}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label={copy.name}
                htmlFor="patient-document-edit-name"
                className="md:col-span-2"
              >
                <Input
                  id="patient-document-edit-name"
                  value={form.autoName}
                  onChange={(event) => update("autoName", event.target.value)}
                  className={inputClass}
                  required
                />
              </Field>
              <CodedTextField
                key={`art-${activeDocumentId}-${lang}`}
                id="patient-document-edit-art"
                label={copy.type}
                value={form.art}
                displayValue={artLabel}
                options={artOptions}
                placeholder={copy.typePlaceholder}
                required
                onChange={(value) => update("art", value)}
              />
              <Field
                label={copy.category}
                htmlFor="patient-document-edit-category"
              >
                <NativeComboboxSelect
                  id="patient-document-edit-category"
                  value={form.category}
                  onChange={(event) => handleCategoryChange(event.target.value)}
                  className={selectClass}
                >
                  <option value="">{copy.noCategory}</option>
                  {categoryOptions.map((category) => (
                    <option key={category.key} value={category.key}>
                      {categoryLabel(category, lang)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </Field>
            </div>
            <label className="flex min-h-10 items-center gap-3 rounded-lg border border-input bg-card px-3 py-2 text-sm">
              <input
                type="checkbox"
                className={checkboxClass}
                checked={form.isMedical}
                onChange={(event) => update("isMedical", event.target.checked)}
              />
              {copy.medical}
            </label>
            <div className="rounded-xl border border-primary/20 bg-primary/[0.045] px-3.5 py-3 text-xs leading-5 text-foreground/75">
              {copy.manualHint}
            </div>
          </FormSection>

          <FormSection title={copy.classification}>
            <div className="grid gap-3 md:grid-cols-3">
              <SelectField
                id="patient-document-edit-status"
                label={copy.status}
                value={form.status}
                onChange={(value) => update("status", value as DocumentStatus)}
                options={statusOptions(lang)}
              />
              <SelectField
                id="patient-document-edit-visibility"
                label={copy.visibility}
                value={form.visibility}
                onChange={(value) =>
                  update("visibility", value as DocumentVisibility)
                }
                options={visibilityOptions(lang)}
              />
              <SelectField
                id="patient-document-edit-access"
                label={copy.access}
                value={form.accessCategory}
                onChange={(value) =>
                  update("accessCategory", value as DocumentAccessCategory | "")
                }
                options={accessOptions(lang, copy.notSet)}
              />
              <SelectField
                id="patient-document-edit-direction"
                label={copy.direction}
                value={form.documentDirection}
                onChange={(value) =>
                  update("documentDirection", value as DocumentDirection | "")
                }
                options={directionOptions(lang, copy.notSet)}
              />
              <SelectField
                id="patient-document-edit-variant"
                label={copy.variant}
                value={form.documentVariant}
                onChange={(value) =>
                  update("documentVariant", value as DocumentVariant | "")
                }
                options={variantOptions(lang, copy.notSet)}
              />
              <Field
                label={copy.language}
                htmlFor="patient-document-edit-language"
              >
                <NativeComboboxSelect
                  id="patient-document-edit-language"
                  value={form.documentLanguage}
                  onChange={(event) =>
                    update("documentLanguage", event.target.value)
                  }
                  className={selectClass}
                >
                  <option value="">{copy.notSet}</option>
                  {languageOptions(form.documentLanguage).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ),
                  )}
                </NativeComboboxSelect>
              </Field>
              <Field
                label={copy.documentDate}
                htmlFor="patient-document-edit-date"
              >
                <Input
                  id="patient-document-edit-date"
                  type="date"
                  value={form.documentDate}
                  onChange={(event) =>
                    update("documentDate", event.target.value)
                  }
                  className={inputClass}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title={copy.source}>
            <div className="grid gap-3 md:grid-cols-2">
              <CodedTextField
                key={`source-person-${activeDocumentId}-${lang}`}
                id="patient-document-source-person"
                label={copy.sourcePerson}
                value={form.sourcePerson}
                displayValue={sourceLabel}
                onChange={(value) => update("sourcePerson", value)}
              />
              <TextField
                id="patient-document-source-institution"
                label={copy.sourceInstitution}
                value={form.sourceInstitution}
                onChange={(value) => update("sourceInstitution", value)}
              />
              <TextField
                id="patient-document-addressee-person"
                label={copy.addresseePerson}
                value={form.addresseePerson}
                onChange={(value) => update("addresseePerson", value)}
              />
              <TextField
                id="patient-document-addressee-institution"
                label={copy.addresseeInstitution}
                value={form.addresseeInstitution}
                onChange={(value) => update("addresseeInstitution", value)}
              />
            </div>
          </FormSection>

          <FormSection title={copy.finance}>
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                id="patient-document-financial-status"
                label={copy.financialStatus}
                value={form.financialStatus}
                onChange={(value) =>
                  update(
                    "financialStatus",
                    value as DocumentFinancialStatus | "",
                  )
                }
                options={financialStatusOptions(lang, copy.notSet)}
              />
              <SelectField
                id="patient-document-payment-method"
                label={copy.paymentMethod}
                value={form.paymentMethod}
                onChange={(value) =>
                  update("paymentMethod", value as DocumentPaymentMethod | "")
                }
                options={paymentMethodOptions(lang, copy.notSet)}
              />
              <Field label={copy.dueDate} htmlFor="patient-document-due-date">
                <Input
                  id="patient-document-due-date"
                  type="date"
                  value={form.paymentDueDate}
                  onChange={(event) =>
                    update("paymentDueDate", event.target.value)
                  }
                  className={inputClass}
                />
              </Field>
              <Field
                label={copy.paymentDate}
                htmlFor="patient-document-payment-date"
              >
                <Input
                  id="patient-document-payment-date"
                  type="date"
                  value={form.paymentDate}
                  onChange={(event) =>
                    update("paymentDate", event.target.value)
                  }
                  className={inputClass}
                />
              </Field>
            </div>
          </FormSection>

          <FormSection title={copy.processing}>
            <div className="grid gap-3 md:grid-cols-2">
              <TextField
                id="patient-document-clinic"
                label={copy.clinic}
                value={form.klinik}
                onChange={(value) => update("klinik", value)}
              />
              <CodedTextField
                key={`origin-${activeDocumentId}-${lang}`}
                id="patient-document-origin"
                label={copy.origin}
                value={form.ursprung}
                displayValue={sourceLabel}
                onChange={(value) => update("ursprung", value)}
              />
              <Field
                label={copy.notes}
                htmlFor="patient-document-notes"
                className="md:col-span-2"
              >
                <textarea
                  id="patient-document-notes"
                  value={form.notes}
                  onChange={(event) => update("notes", event.target.value)}
                  className={textareaClass}
                  rows={4}
                />
              </Field>
            </div>
          </FormSection>
        </>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}
    </PatientSheetScaffold>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
    </Field>
  );
}

function SelectField({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <NativeComboboxSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={selectClass}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue || "empty"} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </NativeComboboxSelect>
    </Field>
  );
}

function statusOptions(lang: "de" | "ru"): Array<[string, string]> {
  return lang === "de"
    ? [
        ["draft", "Entwurf"],
        ["active", "Aktiv"],
        ["archived", "Archiviert"],
      ]
    : [
        ["draft", "Черновик"],
        ["active", "Активный"],
        ["archived", "Архивный"],
      ];
}

function visibilityOptions(lang: "de" | "ru"): Array<[string, string]> {
  return lang === "de"
    ? [
        ["internal", "Intern"],
        ["released_internal", "Intern freigegeben"],
        ["released_external", "Extern freigegeben"],
        // The portal shows a document only after a release (QA 2026-10-11).
        ["patient_visible", "Zur Patientenfreigabe bereit"],
      ]
    : [
        ["internal", "Внутренний"],
        ["released_internal", "Открыт внутри компании"],
        ["released_external", "Открыт внешним получателям"],
        ["patient_visible", "Можно выпустить пациенту"],
      ];
}

function directionOptions(
  lang: "de" | "ru",
  empty: string,
): Array<[string, string]> {
  return [
    ["", empty],
    ["incoming", lang === "de" ? "Eingehend" : "Входящий"],
    ["outgoing", lang === "de" ? "Ausgehend" : "Исходящий"],
  ];
}

function variantOptions(
  lang: "de" | "ru",
  empty: string,
): Array<[string, string]> {
  return [
    ["", empty],
    ["original", lang === "de" ? "Original" : "Оригинал"],
    ["translation", lang === "de" ? "Übersetzung" : "Перевод"],
  ];
}

function accessOptions(
  lang: "de" | "ru",
  empty: string,
): Array<[string, string]> {
  const labels: Record<DocumentAccessCategory, [string, string]> = {
    internal: ["Intern", "Внутренний"],
    patient: ["Patient", "Пациент"],
    provider: ["Provider", "Провайдер"],
    authority: ["Behörde", "Ведомство"],
    financial: ["Finanziell", "Финансовый"],
    medical: ["Medizinisch", "Медицинский"],
    other: ["Sonstiges", "Другое"],
  };
  return [
    ["", empty] as [string, string],
    ...Object.entries(labels).map(
      ([value, label]) =>
        [value, label[lang === "de" ? 0 : 1]] as [string, string],
    ),
  ];
}

function financialStatusOptions(
  lang: "de" | "ru",
  empty: string,
): Array<[string, string]> {
  return [
    ["", empty],
    ["open", lang === "de" ? "Offen" : "Открыт"],
    ["in_progress", lang === "de" ? "In Bearbeitung" : "В работе"],
    ["paid", lang === "de" ? "Bezahlt" : "Оплачен"],
    ["overdue", lang === "de" ? "Überfällig" : "Просрочен"],
    [
      "billed_to_patient",
      lang === "de" ? "An Patient berechnet" : "Выставлен пациенту",
    ],
    ["reimbursed", lang === "de" ? "Erstattet" : "Возмещён"],
  ];
}

function paymentMethodOptions(
  lang: "de" | "ru",
  empty: string,
): Array<[string, string]> {
  return [
    ["", empty],
    ["cash", lang === "de" ? "Bar" : "Наличные"],
    ["bank_transfer", lang === "de" ? "Überweisung" : "Банковский перевод"],
    ["card", lang === "de" ? "Karte" : "Карта"],
    ["other", lang === "de" ? "Sonstiges" : "Другое"],
  ];
}

function languageOptions(current: string): Array<[string, string]> {
  const options: Array<[string, string]> = [
    ["de", "Deutsch"],
    ["en", "English"],
    ["uk", "Українська"],
    ["ru", "Русский"],
    ["pl", "Polski"],
    ["tr", "Türkçe"],
    ["ar", "العربية"],
    ["fr", "Français"],
    ["es", "Español"],
    ["it", "Italiano"],
  ];
  return current && !options.some(([value]) => value === current)
    ? [[current, current], ...options]
    : options;
}
