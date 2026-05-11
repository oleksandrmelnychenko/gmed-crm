import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  CalendarClock,
  ClipboardList,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Stethoscope,
  UserRound,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import type { CaseRosterItem } from "@/components/cases-roster-section";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import {
  AdminInlineMetric,
  AdminSheetScaffold,
  AdminTableCard,
  AdminToolbar,
  SheetFormFooter,
} from "@/components/admin-page-patterns";
import {
  PageHeader,
  checkboxClass,
  inputClass as shellInputClassName,
  selectClass as shellSelectClass,
  textareaClass as shellTextareaClass,
} from "@/components/ui-shell";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { clearApiCache } from "@/lib/api";
import { useSecurePersistedState } from "@/lib/secure-persist";
import { useAuth } from "@/lib/auth";
import {
  formatEnumLabelFromKeys,
  getLang,
  t as translateCatalog,
  type Translations,
  useLang,
} from "@/lib/i18n";
import {
  CASE_HISTORY_SECTION_LABEL_KEYS,
  CASE_MEDICATION_TYPE_LABEL_KEYS,
  CASE_MEDICATION_TYPE_VALUES,
  CASE_SNIPPET_CATEGORY_LABEL_KEYS,
  CASE_SNIPPET_CATEGORY_VALUES,
  CASE_STATUS_LABEL_KEYS,
} from "@/lib/i18n/catalogs/cases-clinical";
import { useDebouncedRealtimeSubscription } from "@/lib/realtime";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import {
  CASE_TEXT_SNIPPET_PLACEHOLDERS,
  appendSnippetToNarrative,
  renderCaseTextSnippet,
} from "../cases.snippets";
import { statusBadgeClass } from "./appearance/status-appearance";
import {
  confirmMedicationExpiry,
  createCase,
  fetchCaseDetail,
  fetchCaseLookups,
  fetchCaseTextSnippets,
  fetchCases,
  saveCaseAllergien,
  saveCaseCardiology,
  saveCaseGastroenterology,
  saveCaseImpfstatus,
  saveCaseMedikamente,
  saveCaseNeurology,
  saveCaseOperationen,
  saveCaseOrthopedics,
  saveCaseOverview,
  saveCasePain,
  saveCasePulmonology,
  saveCaseSymptome,
  saveCaseTextSnippet,
  saveCaseUrology,
  saveCaseVegetative,
  saveCaseVorerkrankungen,
} from "./data/case-api";

type CaseStatus = "open" | "in_progress" | "closed";

type VorerkrankungItem = {
  erkrankung: string;
  erstdiagnose?: string | null;
  notiz?: string | null;
};

type AllergieItem = {
  allergie: string;
  reaktion?: string | null;
};

type OperationItem = {
  datum?: string | null;
  grund: string;
  arzt_id?: string | null;
  arzt?: string | null;
  arzt_registry_name?: string | null;
  arzt_provider_name?: string | null;
  notiz?: string | null;
};

type CaseHistoryEntry = {
  id: number;
  section: string;
  old_value?: unknown;
  new_value?: unknown;
  created_at: string;
  changed_by: string;
  changed_by_name: string;
  changed_by_role: string;
};

type CaseTextSnippet = {
  id: string;
  label: string;
  category: string;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name?: string | null;
  updated_by_name?: string | null;
};

type CaseTextSnippetFormState = {
  id: string;
  label: string;
  category: string;
  body: string;
  is_active: boolean;
};

type MedikamentItem = {
  id?: string | null;
  handelsname: string;
  wirkstoff?: string | null;
  dosis?: string | null;
  dosis_einheit?: string | null;
  einnahmeschema?: string | null;
  darreichungsform?: string | null;
  einheit?: string | null;
  anmerkung?: string | null;
  grund?: string | null;
  seit?: string | null;
  verordnender_arzt_id?: string | null;
  verordnender_arzt?: string | null;
  verordnender_arzt_registry_name?: string | null;
  verordnender_arzt_provider_name?: string | null;
  med_typ?: string | null;
  expiry_date?: string | null;
  is_expired?: boolean;
  pending_expiry_confirmation?: boolean;
  pending_expiry_notification_sent_at?: string | null;
};

type PainItem = {
  lokalisierung: string;
  seit_wann?: string | null;
  ursache?: string | null;
  qualitaet?: string | null;
  kontinuitaet?: string | null;
  entwicklung?: string | null;
  nrs_aktuell?: number | null;
  nrs_anfang?: number | null;
  dauer_anfang?: string | null;
  dauer_aktuell?: string | null;
  ausstrahlung?: string | null;
  auftreten?: string | null;
};

type SymptomItem = {
  beschreibung: string;
  fachrichtung?: string | null;
};

type VegetativeState = {
  appetit_durst: string;
  koerpergroesse: string;
  gewicht: string;
  gewichtsveraenderung: string;
  grund: string;
};

type CardiologyAssessment = {
  is_relevant: boolean;
  chest_pain: boolean;
  dyspnea: boolean;
  palpitations: boolean;
  syncope: boolean;
  edema: boolean;
  known_diagnosis: string;
  prior_cardiac_workup: string;
  cardiovascular_risk_factors: string;
  anticoagulation: string;
  family_history: string;
  red_flags: string;
  notes: string;
};

type GastroenterologyAssessment = {
  is_relevant: boolean;
  abdominal_pain: boolean;
  reflux: boolean;
  nausea: boolean;
  diarrhea: boolean;
  constipation: boolean;
  gi_bleeding: boolean;
  prior_endoscopy: string;
  bowel_habits: string;
  liver_history: string;
  food_intolerance: string;
  red_flags: string;
  notes: string;
};

type OrthopedicsAssessment = {
  is_relevant: boolean;
  joint_pain: boolean;
  back_pain: boolean;
  mobility_limitation: boolean;
  trauma_history: boolean;
  prior_imaging: string;
  assistive_devices: string;
  physiotherapy_history: string;
  pain_triggers: string;
  red_flags: string;
  notes: string;
};

type NeurologyAssessment = {
  is_relevant: boolean;
  headache: boolean;
  dizziness: boolean;
  sensory_changes: boolean;
  weakness: boolean;
  seizure_history: boolean;
  gait_balance_issues: boolean;
  prior_neuro_imaging: string;
  prior_neurology_workup: string;
  cognitive_changes: string;
  red_flags: string;
  notes: string;
};

type PulmonologyAssessment = {
  is_relevant: boolean;
  chronic_cough: boolean;
  dyspnea: boolean;
  wheezing: boolean;
  chest_tightness: boolean;
  hemoptysis: boolean;
  smoking_history: string;
  prior_chest_imaging: string;
  inhaler_therapy: string;
  sleep_apnea_history: string;
  red_flags: string;
  notes: string;
};

type UrologyAssessment = {
  is_relevant: boolean;
  dysuria: boolean;
  hematuria: boolean;
  flank_pain: boolean;
  urinary_frequency: boolean;
  urinary_retention: boolean;
  incontinence: boolean;
  prior_urology_workup: string;
  catheter_history: string;
  stone_history: string;
  red_flags: string;
  notes: string;
};

type CaseDetail = {
  id: string;
  case_uuid?: string;
  case_id: string;
  patient_id: string;
  manager_id: string;
  status: CaseStatus | string;
  hauptanfragegrund: string | null;
  aktuelle_anamnese: string | null;
  zuweiser_doctor_id?: string | null;
  zuweiser: string | null;
  zuweiser_registry_name?: string | null;
  zuweiser_provider_name?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  retention_until?: string | null;
  last_clinical_update_at?: string | null;
  version_count?: number;
  vorerkrankungen: VorerkrankungItem[];
  allergien: AllergieItem[];
  operationen: OperationItem[];
  medikamente: MedikamentItem[];
  pain_records: PainItem[];
  symptome: SymptomItem[];
  cardiology_recommended?: boolean;
  cardiology?: Partial<CardiologyAssessment> | null;
  gastroenterology_recommended?: boolean;
  gastroenterology?: Partial<GastroenterologyAssessment> | null;
  orthopedics_recommended?: boolean;
  orthopedics?: Partial<OrthopedicsAssessment> | null;
  neurology_recommended?: boolean;
  neurology?: Partial<NeurologyAssessment> | null;
  pulmonology_recommended?: boolean;
  pulmonology?: Partial<PulmonologyAssessment> | null;
  urology_recommended?: boolean;
  urology?: Partial<UrologyAssessment> | null;
  vegetative_anamnese?: {
    appetit_durst?: string | null;
    koerpergroesse?: number | null;
    gewicht?: number | null;
    gewichtsveraenderung?: string | null;
    grund?: string | null;
  } | null;
  impfstatus?: string | null;
  history?: CaseHistoryEntry[];
};

type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

type DoctorOption = {
  id: string;
  provider_id: string;
  provider_name: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
};

type CaseFilters = {
  search: string;
  status: string;
  patientId: string;
};

type CaseCreateFormState = {
  patientId: string;
  hauptanfragegrund: string;
  aktuelleAnamnese: string;
  zuweiserDoctorId: string;
  zuweiser: string;
};

type CaseOverviewFormState = {
  hauptanfragegrund: string;
  aktuelle_anamnese: string;
  zuweiser_doctor_id: string;
  zuweiser: string;
};

type CasePermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canEdit: boolean;
};

type SectionStatusKey =
  | "overview"
  | "vorerkrankungen"
  | "allergien"
  | "operationen"
  | "medikamente"
  | "pain"
  | "symptome"
  | "cardiology"
  | "gastroenterology"
  | "orthopedics"
  | "neurology"
  | "pulmonology"
  | "urology"
  | "vegetative"
  | "impfstatus";

type MetricCardProps = {
  label: string;
  value: string;
  description: string;
  icon: ReactNode;
};

type PanelProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  accent?: boolean;
  tone?: "default" | "clinical" | "subtle";
};

type FieldProps = {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
};

type BannerProps = {
  tone: "error" | "success";
  children: ReactNode;
};

type CasesPageProps = {
  embedded?: boolean;
  embeddedPatientId?: string | null;
  embeddedCaseId?: string | null;
  embeddedSheetClassName?: string;
  embeddedSheetModal?: boolean | "trap-focus";
  embeddedSheetShowOverlay?: boolean;
  embeddedSheetSide?: "left" | "right";
  onCloseCaseSheet?: () => void;
};

type EmptyPanelProps = {
  title: string;
  text: string;
  action?: ReactNode;
};

type ItemEditorSectionProps = {
  title: string;
  description: string;
  count: number;
  addLabel: string;
  emptyTitle: string;
  emptyText: string;
  busy: boolean;
  error: string;
  canEdit: boolean;
  onAdd: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
};

const CASE_STATUSES: CaseStatus[] = ["open", "in_progress", "closed"];
const DEFAULT_FILTERS: CaseFilters = { search: "", status: "", patientId: "" };
const DEFAULT_CREATE_FORM: CaseCreateFormState = {
  patientId: "",
  hauptanfragegrund: "",
  aktuelleAnamnese: "",
  zuweiserDoctorId: "",
  zuweiser: "",
};
const DEFAULT_OVERVIEW_FORM: CaseOverviewFormState = {
  hauptanfragegrund: "",
  aktuelle_anamnese: "",
  zuweiser_doctor_id: "",
  zuweiser: "",
};
const DEFAULT_CASE_TEXT_SNIPPET_FORM: CaseTextSnippetFormState = {
  id: "",
  label: "",
  category: "general",
  body: "",
  is_active: true,
};

const inputClassName = shellInputClassName;
const selectClassName = shellSelectClass;
const textareaClassName = shellTextareaClass;
const CASE_REALTIME_EVENTS = [
  "case.created",
  "case.updated",
  "case.medication_expiry_confirmed",
  "case.medication_expiry_flagged",
] as const;

function casePermissions(role?: string): CasePermissions {
  return {
    canViewPage: role === "ceo" || role === "patient_manager",
    canCreate: role === "ceo" || role === "patient_manager",
    canEdit: role === "ceo" || role === "patient_manager",
  };
}

function cardClass(className?: string) {
  return cn(
    "rounded-xl border border-border bg-card",
    className,
  );
}

function caseStatusLabel(
  status: string,
  tr: Translations,
) {
  return formatEnumLabelFromKeys(status, CASE_STATUS_LABEL_KEYS, tr);
}

function blankVorerkrankung(): VorerkrankungItem {
  return { erkrankung: "", erstdiagnose: "", notiz: "" };
}

function blankAllergie(): AllergieItem {
  return { allergie: "", reaktion: "" };
}

function blankOperation(): OperationItem {
  return { datum: "", grund: "", arzt_id: "", arzt: "", notiz: "" };
}

function blankMedikament(): MedikamentItem {
  return {
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
}

function blankPainItem(): PainItem {
  return {
    lokalisierung: "",
    seit_wann: "",
    ursache: "",
    qualitaet: "",
    kontinuitaet: "",
    entwicklung: "",
    nrs_aktuell: null,
    nrs_anfang: null,
    dauer_anfang: "",
    dauer_aktuell: "",
    ausstrahlung: "",
    auftreten: "",
  };
}

function blankSymptom(): SymptomItem {
  return { beschreibung: "", fachrichtung: "" };
}

function vorerkrankungItemKey(item: VorerkrankungItem) {
  return [item.erkrankung, item.erstdiagnose ?? "", item.notiz ?? ""].join("|");
}

function allergieItemKey(item: AllergieItem) {
  return [item.allergie, item.reaktion ?? ""].join("|");
}

function operationItemKey(item: OperationItem) {
  return [
    item.datum ?? "",
    item.grund,
    item.arzt_id ?? "",
    item.arzt ?? "",
    item.notiz ?? "",
  ].join("|");
}

function medikamentItemKey(item: MedikamentItem) {
  return [
    item.id ?? "",
    item.handelsname,
    item.wirkstoff ?? "",
    item.dosis ?? "",
    item.seit ?? "",
    item.verordnender_arzt_id ?? "",
  ].join("|");
}

function painItemKey(item: PainItem) {
  return [
    item.lokalisierung,
    item.seit_wann ?? "",
    item.ursache ?? "",
    item.qualitaet ?? "",
    item.nrs_aktuell ?? "",
  ].join("|");
}

function symptomItemKey(item: SymptomItem) {
  return [item.beschreibung, item.fachrichtung ?? ""].join("|");
}

function blankVegetative(): VegetativeState {
  return {
    appetit_durst: "",
    koerpergroesse: "",
    gewicht: "",
    gewichtsveraenderung: "",
    grund: "",
  };
}

function blankCardiology(): CardiologyAssessment {
  return {
    is_relevant: false,
    chest_pain: false,
    dyspnea: false,
    palpitations: false,
    syncope: false,
    edema: false,
    known_diagnosis: "",
    prior_cardiac_workup: "",
    cardiovascular_risk_factors: "",
    anticoagulation: "",
    family_history: "",
    red_flags: "",
    notes: "",
  };
}

function blankGastroenterology(): GastroenterologyAssessment {
  return {
    is_relevant: false,
    abdominal_pain: false,
    reflux: false,
    nausea: false,
    diarrhea: false,
    constipation: false,
    gi_bleeding: false,
    prior_endoscopy: "",
    bowel_habits: "",
    liver_history: "",
    food_intolerance: "",
    red_flags: "",
    notes: "",
  };
}

function blankOrthopedics(): OrthopedicsAssessment {
  return {
    is_relevant: false,
    joint_pain: false,
    back_pain: false,
    mobility_limitation: false,
    trauma_history: false,
    prior_imaging: "",
    assistive_devices: "",
    physiotherapy_history: "",
    pain_triggers: "",
    red_flags: "",
    notes: "",
  };
}

function blankNeurology(): NeurologyAssessment {
  return {
    is_relevant: false,
    headache: false,
    dizziness: false,
    sensory_changes: false,
    weakness: false,
    seizure_history: false,
    gait_balance_issues: false,
    prior_neuro_imaging: "",
    prior_neurology_workup: "",
    cognitive_changes: "",
    red_flags: "",
    notes: "",
  };
}

function blankPulmonology(): PulmonologyAssessment {
  return {
    is_relevant: false,
    chronic_cough: false,
    dyspnea: false,
    wheezing: false,
    chest_tightness: false,
    hemoptysis: false,
    smoking_history: "",
    prior_chest_imaging: "",
    inhaler_therapy: "",
    sleep_apnea_history: "",
    red_flags: "",
    notes: "",
  };
}

function blankUrology(): UrologyAssessment {
  return {
    is_relevant: false,
    dysuria: false,
    hematuria: false,
    flank_pain: false,
    urinary_frequency: false,
    urinary_retention: false,
    incontinence: false,
    prior_urology_workup: "",
    catheter_history: "",
    stone_history: "",
    red_flags: "",
    notes: "",
  };
}

function buildCasesPath(filters: CaseFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.patientId) params.set("patient_id", filters.patientId);
  const query = params.toString();
  return `/cases${query ? `?${query}` : ""}`;
}

function runtimeTranslations(): Translations {
  return translateCatalog(getLang());
}

function runtimeLocale() {
  switch (getLang()) {
    case "ru":
      return "ru-RU";
    case "de":
      return "de-DE";
    default:
      return "en-GB";
  }
}

function caseText(de: string, ru: string, _en: string) {
  switch (getLang()) {
    case "ru":
      return ru;
    case "de":
      return de;
    default:
      return _en;
  }
}

function formatCatalogMessage(
  template: string,
  values: Record<string, string>,
) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? "");
}

function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || runtimeTranslations().cases_clinical_patient_fallback} (${patient.patient_id})`;
}

function doctorOptionLabel(doctor: DoctorOption) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialty = doctor.fachbereich?.trim() ? ` · ${doctor.fachbereich.trim()}` : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

const CASE_DATE_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }),
  "en-GB": new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }),
};

const CASE_DATE_TIME_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
  "en-GB": new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }),
};

function formatDate(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (CASE_DATE_FORMATTERS[runtimeLocale()] ?? CASE_DATE_FORMATTERS["en-GB"]).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (CASE_DATE_TIME_FORMATTERS[runtimeLocale()] ?? CASE_DATE_TIME_FORMATTERS["en-GB"]).format(date);
}

function historyValuePreview(value: unknown) {
  const empty = runtimeTranslations().cases_clinical_history_value_empty;
  if (value == null) return empty;
  if (typeof value === "string") return value || empty;
  const serialized = JSON.stringify(value);
  if (!serialized) return empty;
  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

function historySectionLabel(section: string) {
  return formatEnumLabelFromKeys(
    section,
    CASE_HISTORY_SECTION_LABEL_KEYS,
    runtimeTranslations(),
  );
}

function snippetCategoryLabel(category: string) {
  return formatEnumLabelFromKeys(
    category,
    CASE_SNIPPET_CATEGORY_LABEL_KEYS,
    runtimeTranslations(),
  );
}

function medicationTypeLabel(type: string | null | undefined) {
  return formatEnumLabelFromKeys(
    type,
    CASE_MEDICATION_TYPE_LABEL_KEYS,
    runtimeTranslations(),
  );
}

function isKnownSnippetCategory(value: string) {
  return (CASE_SNIPPET_CATEGORY_VALUES as readonly string[]).includes(value);
}

function isKnownMedicationType(value: string) {
  return (CASE_MEDICATION_TYPE_VALUES as readonly string[]).includes(value);
}

function numericInputToValue(value: string) {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parsePainNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function countFilled(items: Array<{ [key: string]: unknown }>, key: string) {
  return items.filter((item) => {
    const value = item[key];
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }).length;
}

function updateItemAtIndex<T>(
  items: T[],
  index: number,
  patch: Partial<T>,
): T[] {
  return items.map((item, currentIndex) =>
    currentIndex === index ? { ...item, ...patch } : item,
  );
}

function removeItemAtIndex<T>(items: T[], index: number) {
  return items.filter((_, currentIndex) => currentIndex !== index);
}

function bannerText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function sanitizeVorerkrankungen(items: VorerkrankungItem[]) {
  return items.flatMap((item) => {
    const erkrankung = item.erkrankung.trim();
    if (!erkrankung) return [];
    return [{
      erkrankung,
      erstdiagnose: toOptionalText(item.erstdiagnose ?? ""),
      notiz: toOptionalText(item.notiz ?? ""),
    }];
  });
}

function sanitizeAllergien(items: AllergieItem[]) {
  return items.flatMap((item) => {
    const allergie = item.allergie.trim();
    if (!allergie) return [];
    return [{
      allergie,
      reaktion: toOptionalText(item.reaktion ?? ""),
    }];
  });
}

function sanitizeOperationen(items: OperationItem[]) {
  return items.flatMap((item) => {
    const grund = item.grund.trim();
    if (!grund) return [];
    return [{
      datum: toOptionalText(item.datum ?? ""),
      grund,
      arzt_id: toOptionalText(item.arzt_id ?? ""),
      arzt: toOptionalText(item.arzt ?? ""),
      notiz: toOptionalText(item.notiz ?? ""),
    }];
  });
}

function sanitizeMedikamente(items: MedikamentItem[]) {
  return items.flatMap((item) => {
    const handelsname = item.handelsname.trim();
    if (!handelsname) return [];
    return [{
      handelsname,
      wirkstoff: toOptionalText(item.wirkstoff ?? ""),
      dosis: toOptionalText(item.dosis ?? ""),
      dosis_einheit: toOptionalText(item.dosis_einheit ?? ""),
      einnahmeschema: toOptionalText(item.einnahmeschema ?? ""),
      darreichungsform: toOptionalText(item.darreichungsform ?? ""),
      einheit: toOptionalText(item.einheit ?? ""),
      anmerkung: toOptionalText(item.anmerkung ?? ""),
      grund: toOptionalText(item.grund ?? ""),
      seit: toOptionalText(item.seit ?? ""),
      verordnender_arzt_id: toOptionalText(item.verordnender_arzt_id ?? ""),
      verordnender_arzt: toOptionalText(item.verordnender_arzt ?? ""),
      med_typ: toOptionalText(item.med_typ ?? "") ?? "permanent",
      expiry_date: toOptionalText(item.expiry_date ?? ""),
    }];
  });
}

function sanitizePainRecords(items: PainItem[]) {
  return items.flatMap((item) => {
    const lokalisierung = item.lokalisierung.trim();
    if (!lokalisierung) return [];
    return [{
      lokalisierung,
      seit_wann: toOptionalText(item.seit_wann ?? ""),
      ursache: toOptionalText(item.ursache ?? ""),
      qualitaet: toOptionalText(item.qualitaet ?? ""),
      kontinuitaet: toOptionalText(item.kontinuitaet ?? ""),
      entwicklung: toOptionalText(item.entwicklung ?? ""),
      nrs_aktuell: parsePainNumber(item.nrs_aktuell),
      nrs_anfang: parsePainNumber(item.nrs_anfang),
      dauer_anfang: toOptionalText(item.dauer_anfang ?? ""),
      dauer_aktuell: toOptionalText(item.dauer_aktuell ?? ""),
      ausstrahlung: toOptionalText(item.ausstrahlung ?? ""),
      auftreten: toOptionalText(item.auftreten ?? ""),
    }];
  });
}

function sanitizeSymptome(items: SymptomItem[]) {
  return items.flatMap((item) => {
    const beschreibung = item.beschreibung.trim();
    if (!beschreibung) return [];
    return [{
      beschreibung,
      fachrichtung: toOptionalText(item.fachrichtung ?? ""),
    }];
  });
}

function cardiologyToPayload(cardiology: CardiologyAssessment) {
  return {
    is_relevant: cardiology.is_relevant,
    chest_pain: cardiology.chest_pain,
    dyspnea: cardiology.dyspnea,
    palpitations: cardiology.palpitations,
    syncope: cardiology.syncope,
    edema: cardiology.edema,
    known_diagnosis: toOptionalText(cardiology.known_diagnosis),
    prior_cardiac_workup: toOptionalText(cardiology.prior_cardiac_workup),
    cardiovascular_risk_factors: toOptionalText(cardiology.cardiovascular_risk_factors),
    anticoagulation: toOptionalText(cardiology.anticoagulation),
    family_history: toOptionalText(cardiology.family_history),
    red_flags: toOptionalText(cardiology.red_flags),
    notes: toOptionalText(cardiology.notes),
  };
}

function gastroenterologyToPayload(gastroenterology: GastroenterologyAssessment) {
  return {
    is_relevant: gastroenterology.is_relevant,
    abdominal_pain: gastroenterology.abdominal_pain,
    reflux: gastroenterology.reflux,
    nausea: gastroenterology.nausea,
    diarrhea: gastroenterology.diarrhea,
    constipation: gastroenterology.constipation,
    gi_bleeding: gastroenterology.gi_bleeding,
    prior_endoscopy: toOptionalText(gastroenterology.prior_endoscopy),
    bowel_habits: toOptionalText(gastroenterology.bowel_habits),
    liver_history: toOptionalText(gastroenterology.liver_history),
    food_intolerance: toOptionalText(gastroenterology.food_intolerance),
    red_flags: toOptionalText(gastroenterology.red_flags),
    notes: toOptionalText(gastroenterology.notes),
  };
}

function orthopedicsToPayload(orthopedics: OrthopedicsAssessment) {
  return {
    is_relevant: orthopedics.is_relevant,
    joint_pain: orthopedics.joint_pain,
    back_pain: orthopedics.back_pain,
    mobility_limitation: orthopedics.mobility_limitation,
    trauma_history: orthopedics.trauma_history,
    prior_imaging: toOptionalText(orthopedics.prior_imaging),
    assistive_devices: toOptionalText(orthopedics.assistive_devices),
    physiotherapy_history: toOptionalText(orthopedics.physiotherapy_history),
    pain_triggers: toOptionalText(orthopedics.pain_triggers),
    red_flags: toOptionalText(orthopedics.red_flags),
    notes: toOptionalText(orthopedics.notes),
  };
}

function neurologyToPayload(neurology: NeurologyAssessment) {
  return {
    is_relevant: neurology.is_relevant,
    headache: neurology.headache,
    dizziness: neurology.dizziness,
    sensory_changes: neurology.sensory_changes,
    weakness: neurology.weakness,
    seizure_history: neurology.seizure_history,
    gait_balance_issues: neurology.gait_balance_issues,
    prior_neuro_imaging: toOptionalText(neurology.prior_neuro_imaging),
    prior_neurology_workup: toOptionalText(neurology.prior_neurology_workup),
    cognitive_changes: toOptionalText(neurology.cognitive_changes),
    red_flags: toOptionalText(neurology.red_flags),
    notes: toOptionalText(neurology.notes),
  };
}

function pulmonologyToPayload(pulmonology: PulmonologyAssessment) {
  return {
    is_relevant: pulmonology.is_relevant,
    chronic_cough: pulmonology.chronic_cough,
    dyspnea: pulmonology.dyspnea,
    wheezing: pulmonology.wheezing,
    chest_tightness: pulmonology.chest_tightness,
    hemoptysis: pulmonology.hemoptysis,
    smoking_history: toOptionalText(pulmonology.smoking_history),
    prior_chest_imaging: toOptionalText(pulmonology.prior_chest_imaging),
    inhaler_therapy: toOptionalText(pulmonology.inhaler_therapy),
    sleep_apnea_history: toOptionalText(pulmonology.sleep_apnea_history),
    red_flags: toOptionalText(pulmonology.red_flags),
    notes: toOptionalText(pulmonology.notes),
  };
}

function urologyToPayload(urology: UrologyAssessment) {
  return {
    is_relevant: urology.is_relevant,
    dysuria: urology.dysuria,
    hematuria: urology.hematuria,
    flank_pain: urology.flank_pain,
    urinary_frequency: urology.urinary_frequency,
    urinary_retention: urology.urinary_retention,
    incontinence: urology.incontinence,
    prior_urology_workup: toOptionalText(urology.prior_urology_workup),
    catheter_history: toOptionalText(urology.catheter_history),
    stone_history: toOptionalText(urology.stone_history),
    red_flags: toOptionalText(urology.red_flags),
    notes: toOptionalText(urology.notes),
  };
}

type CasesPageState = {
  filters: CaseFilters;
  patients: PatientOption[];
  doctors: DoctorOption[];
  cases: CaseRosterItem[];
  listBusy: boolean;
  listError: string;
  listVersion: number;
  createOpen: boolean;
  createBusy: boolean;
  createError: string;
  createForm: CaseCreateFormState;
  detailOpen: boolean;
  selectedId: string;
  detail: CaseDetail | null;
  detailBusy: boolean;
  detailError: string;
  detailVersion: number;
  overviewForm: CaseOverviewFormState;
  vorerkrankungen: VorerkrankungItem[];
  allergien: AllergieItem[];
  operationen: OperationItem[];
  medikamente: MedikamentItem[];
  painRecords: PainItem[];
  symptome: SymptomItem[];
  cardiology: CardiologyAssessment;
  gastroenterology: GastroenterologyAssessment;
  orthopedics: OrthopedicsAssessment;
  neurology: NeurologyAssessment;
  pulmonology: PulmonologyAssessment;
  urology: UrologyAssessment;
  vegetative: VegetativeState;
  impfstatus: string;
  sectionBusy: SectionStatusKey | "";
  sectionErrors: Record<string, string>;
  snippets: CaseTextSnippet[];
  snippetsBusy: boolean;
  snippetsError: string;
  snippetVersion: number;
  snippetDialogOpen: boolean;
  snippetSaveBusy: boolean;
  snippetSaveError: string;
  snippetForm: CaseTextSnippetFormState;
};

type CasesPagePatch =
  | Partial<CasesPageState>
  | ((current: CasesPageState) => Partial<CasesPageState>);

function casesPageReducer(
  current: CasesPageState,
  patch: CasesPagePatch,
): CasesPageState {
  return {
    ...current,
    ...(typeof patch === "function" ? patch(current) : patch),
  };
}

function resolveCasesPageStateAction<T>(
  action: SetStateAction<T>,
  current: T,
): T {
  return typeof action === "function"
    ? (action as (value: T) => T)(current)
    : action;
}

function createCasesPageFieldPatch<K extends keyof CasesPageState>(
  field: K,
  nextValue: SetStateAction<CasesPageState[K]>,
): CasesPagePatch {
  return (current) => ({
    [field]: resolveCasesPageStateAction(nextValue, current[field]),
  } as Partial<CasesPageState>);
}

function useCasesPageContent({
  embedded = false,
  embeddedPatientId = null,
  embeddedCaseId = null,
  embeddedSheetClassName,
  embeddedSheetModal = false,
  embeddedSheetShowOverlay = false,
  embeddedSheetSide = "right",
  onCloseCaseSheet,
}: CasesPageProps = {}) {
  const { t } = useLang();
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => casePermissions(user?.role), [user?.role]);

  type PersistedCaseFilters = Pick<CaseFilters, "status" | "patientId">;
  const [persistedCaseFilters, setPersistedCaseFilters] = useSecurePersistedState<PersistedCaseFilters>(
    "cases.filters",
    { status: DEFAULT_FILTERS.status, patientId: DEFAULT_FILTERS.patientId },
    {
      schemaVersion: 1,
      validate: (value): value is PersistedCaseFilters =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).status === "string" &&
        typeof (value as Record<string, unknown>).patientId === "string",
    },
  );
  const [casesPageState, dispatchCasesPageState] = useReducer(
    casesPageReducer,
    undefined,
    (): CasesPageState => ({
      filters: {
        ...DEFAULT_FILTERS,
        status: persistedCaseFilters.status,
        patientId: persistedCaseFilters.patientId,
      },
      patients: [],
      doctors: [],
      cases: [],
      listBusy: false,
      listError: "",
      listVersion: 0,
      createOpen: false,
      createBusy: false,
      createError: "",
      createForm: DEFAULT_CREATE_FORM,
      detailOpen: false,
      selectedId: "",
      detail: null,
      detailBusy: false,
      detailError: "",
      detailVersion: 0,
      overviewForm: DEFAULT_OVERVIEW_FORM,
      vorerkrankungen: [],
      allergien: [],
      operationen: [],
      medikamente: [],
      painRecords: [],
      symptome: [],
      cardiology: blankCardiology(),
      gastroenterology: blankGastroenterology(),
      orthopedics: blankOrthopedics(),
      neurology: blankNeurology(),
      pulmonology: blankPulmonology(),
      urology: blankUrology(),
      vegetative: blankVegetative(),
      impfstatus: "",
      sectionBusy: "",
      sectionErrors: {},
      snippets: [],
      snippetsBusy: false,
      snippetsError: "",
      snippetVersion: 0,
      snippetDialogOpen: false,
      snippetSaveBusy: false,
      snippetSaveError: "",
      snippetForm: DEFAULT_CASE_TEXT_SNIPPET_FORM,
    }),
  );
  const {
    allergien,
    cardiology,
    cases,
    createBusy,
    createError,
    createForm,
    createOpen,
    detail,
    detailBusy,
    detailError,
    detailOpen,
    detailVersion,
    doctors,
    filters,
    gastroenterology,
    impfstatus,
    listBusy,
    listError,
    listVersion,
    medikamente,
    neurology,
    operationen,
    orthopedics,
    painRecords,
    patients,
    pulmonology,
    sectionBusy,
    sectionErrors,
    selectedId,
    snippetDialogOpen,
    snippetForm,
    snippetSaveBusy,
    snippetSaveError,
    snippets,
    snippetsBusy,
    snippetsError,
    snippetVersion,
    symptome,
    urology,
    vegetative,
    vorerkrankungen,
    overviewForm,
  } = casesPageState;
  const setCasesPageField = <K extends keyof CasesPageState>(
    field: K,
    nextValue: SetStateAction<CasesPageState[K]>,
  ) => dispatchCasesPageState(createCasesPageFieldPatch(field, nextValue));
  const setFilters = useCallback(
    (value: SetStateAction<CaseFilters>) => {
      dispatchCasesPageState((current) => {
        const next = resolveCasesPageStateAction(value, current.filters);
        setPersistedCaseFilters({
          status: next.status,
          patientId: next.patientId,
        });
        return { filters: next };
      });
    },
    [setPersistedCaseFilters],
  );
  const deferredSearch = useDeferredValue(filters.search);
  const setPatients = (nextValue: SetStateAction<PatientOption[]>) =>
    setCasesPageField("patients", nextValue);
  const setDoctors = (nextValue: SetStateAction<DoctorOption[]>) =>
    setCasesPageField("doctors", nextValue);
  const setCases = (nextValue: SetStateAction<CaseRosterItem[]>) =>
    setCasesPageField("cases", nextValue);
  const setListBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("listBusy", nextValue);
  const setListError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("listError", nextValue);
  const setListVersion = (nextValue: SetStateAction<number>) =>
    setCasesPageField("listVersion", nextValue);
  const setCreateOpen = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("createOpen", nextValue);
  const setCreateBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("createBusy", nextValue);
  const setCreateError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("createError", nextValue);
  const setCreateForm = (nextValue: SetStateAction<CaseCreateFormState>) =>
    setCasesPageField("createForm", nextValue);
  const setDetailOpen = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("detailOpen", nextValue);
  const setSelectedId = (nextValue: SetStateAction<string>) =>
    setCasesPageField("selectedId", nextValue);
  const setDetail = (nextValue: SetStateAction<CaseDetail | null>) =>
    setCasesPageField("detail", nextValue);
  const setDetailBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("detailBusy", nextValue);
  const setDetailError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("detailError", nextValue);
  const setDetailVersion = (nextValue: SetStateAction<number>) =>
    setCasesPageField("detailVersion", nextValue);
  const setOverviewForm = (
    nextValue: SetStateAction<CaseOverviewFormState>,
  ) => setCasesPageField("overviewForm", nextValue);
  const setVorerkrankungen = (
    nextValue: SetStateAction<VorerkrankungItem[]>,
  ) => setCasesPageField("vorerkrankungen", nextValue);
  const setAllergien = (nextValue: SetStateAction<AllergieItem[]>) =>
    setCasesPageField("allergien", nextValue);
  const setOperationen = (nextValue: SetStateAction<OperationItem[]>) =>
    setCasesPageField("operationen", nextValue);
  const setMedikamente = (nextValue: SetStateAction<MedikamentItem[]>) =>
    setCasesPageField("medikamente", nextValue);
  const setPainRecords = (nextValue: SetStateAction<PainItem[]>) =>
    setCasesPageField("painRecords", nextValue);
  const setSymptome = (nextValue: SetStateAction<SymptomItem[]>) =>
    setCasesPageField("symptome", nextValue);
  const setCardiology = (nextValue: SetStateAction<CardiologyAssessment>) =>
    setCasesPageField("cardiology", nextValue);
  const setGastroenterology = (
    nextValue: SetStateAction<GastroenterologyAssessment>,
  ) => setCasesPageField("gastroenterology", nextValue);
  const setOrthopedics = (
    nextValue: SetStateAction<OrthopedicsAssessment>,
  ) => setCasesPageField("orthopedics", nextValue);
  const setNeurology = (nextValue: SetStateAction<NeurologyAssessment>) =>
    setCasesPageField("neurology", nextValue);
  const setPulmonology = (
    nextValue: SetStateAction<PulmonologyAssessment>,
  ) => setCasesPageField("pulmonology", nextValue);
  const setUrology = (nextValue: SetStateAction<UrologyAssessment>) =>
    setCasesPageField("urology", nextValue);
  const setVegetative = (nextValue: SetStateAction<VegetativeState>) =>
    setCasesPageField("vegetative", nextValue);
  const setImpfstatus = (nextValue: SetStateAction<string>) =>
    setCasesPageField("impfstatus", nextValue);
  const setSectionBusy = (
    nextValue: SetStateAction<SectionStatusKey | "">,
  ) => setCasesPageField("sectionBusy", nextValue);
  const setSectionErrors = (
    nextValue: SetStateAction<Record<string, string>>,
  ) => setCasesPageField("sectionErrors", nextValue);
  const setSnippets = (nextValue: SetStateAction<CaseTextSnippet[]>) =>
    setCasesPageField("snippets", nextValue);
  const setSnippetsBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("snippetsBusy", nextValue);
  const setSnippetsError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("snippetsError", nextValue);
  const setSnippetVersion = (nextValue: SetStateAction<number>) =>
    setCasesPageField("snippetVersion", nextValue);
  const setSnippetDialogOpen = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("snippetDialogOpen", nextValue);
  const setSnippetSaveBusy = (nextValue: SetStateAction<boolean>) =>
    setCasesPageField("snippetSaveBusy", nextValue);
  const setSnippetSaveError = (nextValue: SetStateAction<string>) =>
    setCasesPageField("snippetSaveError", nextValue);
  const setSnippetForm = (
    nextValue: SetStateAction<CaseTextSnippetFormState>,
  ) => setCasesPageField("snippetForm", nextValue);

  const effectiveFilters = useMemo(
    () => ({ ...filters, search: deferredSearch || filters.search }),
    [deferredSearch, filters],
  );
  const casesPath = useMemo(() => buildCasesPath(effectiveFilters), [effectiveFilters]);
  const selectedSummary = useMemo(
    () => cases.find((item) => item.id === selectedId) ?? null,
    [cases, selectedId],
  );
  const selectedPatient = useMemo(
    () => patients.find((patient) => patient.id === (detail?.patient_id ?? selectedSummary?.patient_id)),
    [detail?.patient_id, patients, selectedSummary?.patient_id],
  );

  useDebouncedRealtimeSubscription(CASE_REALTIME_EVENTS, (_event, events) => {
    if (!permissions.canViewPage) return;
    clearApiCache("/cases");
    const selectedWasUpdated = events.some((event) => event.entity_id === selectedId);
    for (const event of events) {
      if (event.entity_type === "case" && event.entity_id) {
        clearApiCache(`/cases/${event.entity_id}`);
        clearApiCache(`/cases/${event.entity_id}/history`);
      }
    }
    if (selectedId) {
      clearApiCache(`/cases/${selectedId}`);
      clearApiCache(`/cases/${selectedId}/history`);
    }
    startTransition(() => {
      setListVersion((current) => current + 1);
      if (!selectedId || selectedWasUpdated) {
        setDetailVersion((current) => current + 1);
      }
    });
  }, 250);
  const snippetContext = useMemo(
    () => ({
      patientName:
        selectedSummary?.patient_name ??
        [selectedPatient?.first_name, selectedPatient?.last_name]
          .filter(Boolean)
          .join(" ")
          .trim(),
      patientPid: selectedSummary?.patient_pid ?? selectedPatient?.patient_id ?? "",
      caseId: detail?.case_id ?? selectedSummary?.case_id ?? "",
      caseUuid: detail?.case_uuid ?? detail?.id ?? "",
      hauptanfragegrund: overviewForm.hauptanfragegrund.trim(),
      zuweiser: overviewForm.zuweiser.trim(),
      today: new Date().toISOString().slice(0, 10),
    }),
    [detail?.case_id, detail?.case_uuid, detail?.id, overviewForm.hauptanfragegrund, overviewForm.zuweiser, selectedPatient?.first_name, selectedPatient?.last_name, selectedPatient?.patient_id, selectedSummary?.case_id, selectedSummary?.patient_name, selectedSummary?.patient_pid],
  );
  const activeSnippets = useMemo(
    () => snippets.filter((snippet) => snippet.is_active),
    [snippets],
  );
  const metrics = useMemo(() => {
    return cases.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.status === "open") acc.open += 1;
        if (item.status === "in_progress") acc.inProgress += 1;
        if (item.status === "closed") acc.closed += 1;
        return acc;
      },
      { total: 0, open: 0, inProgress: 0, closed: 0 },
    );
  }, [cases]);
  const caseTableColumns = useMemo<ColumnDef<CaseRosterItem>[]>(
    () => [
      {
        id: "case_id",
        label: t.cases_clinical_case_id,
        accessor: (row) => row.case_id,
        sortable: true,
        required: true,
        width: 170,
        render: (row) => <span className="font-mono text-xs">{row.case_id}</span>,
      },
      {
        id: "patient_name",
        label: t.orders_patient,
        accessor: (row) => row.patient_name,
        sortable: true,
        required: true,
        width: 260,
      },
      {
        id: "patient_pid",
        label: t.cases_clinical_patient_id,
        accessor: (row) => row.patient_pid,
        sortable: true,
        width: 180,
      },
      {
        id: "status",
        label: t.users_status,
        accessor: (row) => row.status,
        sortable: true,
        width: 160,
        render: (row) => (
          <Badge variant="outline" className={cn("rounded-full", statusBadgeClass(row.status))}>
            {caseStatusLabel(row.status, t)}
          </Badge>
        ),
      },
      {
        id: "reason",
        label: t.cases_reason,
        accessor: (row) => row.hauptanfragegrund ?? "",
        width: 280,
        render: (row) => (
          <span className="block max-w-[280px] truncate text-sm text-foreground">
            {row.hauptanfragegrund?.trim() || t.common_not_set}
          </span>
        ),
      },
      {
        id: "created",
        label: t.users_created,
        accessor: (row) => row.created_at,
        sortable: true,
        width: 180,
        render: (row) => <span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>,
      },
    ],
    [t],
  );
  const cardiologyTriggered = useMemo(
    () =>
      cardiology.is_relevant ||
      Boolean(detail?.cardiology_recommended) ||
      symptome.some((item) => {
        const fachrichtung = (item.fachrichtung ?? "").trim().toLowerCase();
        return fachrichtung.includes("cardio") || fachrichtung.includes("kardio");
      }),
    [cardiology.is_relevant, detail?.cardiology_recommended, symptome],
  );
  const gastroenterologyTriggered = useMemo(
    () =>
      gastroenterology.is_relevant ||
      Boolean(detail?.gastroenterology_recommended) ||
      symptome.some((item) => {
        const fachrichtung = (item.fachrichtung ?? "").trim().toLowerCase();
        return (
          fachrichtung.includes("gastro") ||
          fachrichtung.includes("kolo") ||
          fachrichtung.includes("colo")
        );
      }),
    [gastroenterology.is_relevant, detail?.gastroenterology_recommended, symptome],
  );
  const orthopedicsTriggered = useMemo(
    () =>
      orthopedics.is_relevant ||
      Boolean(detail?.orthopedics_recommended) ||
      symptome.some((item) => {
        const fachrichtung = (item.fachrichtung ?? "").trim().toLowerCase();
        return (
          fachrichtung.includes("ortho") ||
          fachrichtung.includes("orthop") ||
          fachrichtung.includes("trauma") ||
          fachrichtung.includes("bewegung")
        );
      }),
    [detail?.orthopedics_recommended, orthopedics.is_relevant, symptome],
  );
  const neurologyTriggered = useMemo(
    () =>
      neurology.is_relevant ||
      Boolean(detail?.neurology_recommended) ||
      symptome.some((item) => {
        const fachrichtung = (item.fachrichtung ?? "").trim().toLowerCase();
        return fachrichtung.includes("neuro") || fachrichtung.includes("neurol");
      }),
    [detail?.neurology_recommended, neurology.is_relevant, symptome],
  );
  const pulmonologyTriggered = useMemo(
    () =>
      pulmonology.is_relevant ||
      Boolean(detail?.pulmonology_recommended) ||
      symptome.some((item) => {
        const fachrichtung = (item.fachrichtung ?? "").trim().toLowerCase();
        return (
          fachrichtung.includes("pulmo") ||
          fachrichtung.includes("pneumo") ||
          fachrichtung.includes("respir") ||
          fachrichtung.includes("asthma") ||
          fachrichtung.includes("lung")
        );
      }),
    [detail?.pulmonology_recommended, pulmonology.is_relevant, symptome],
  );
  const urologyTriggered = useMemo(
    () =>
      urology.is_relevant ||
      Boolean(detail?.urology_recommended) ||
      symptome.some((item) => {
        const fachrichtung = (item.fachrichtung ?? "").trim().toLowerCase();
        return (
          fachrichtung.includes("uro") ||
          fachrichtung.includes("renal") ||
          fachrichtung.includes("kidney") ||
          fachrichtung.includes("bladder") ||
          fachrichtung.includes("prostat")
        );
      }),
    [detail?.urology_recommended, symptome, urology.is_relevant],
  );

  const applyCaseLookups = useCallback(
    (patientItems: PatientOption[], doctorItems: DoctorOption[]) => {
      setPatients(patientItems);
      setDoctors(doctorItems);
    },
    [],
  );

  const hydratePatientFilterFromRoute = useCallback(
    (patientParam: string) => {
      setFilters((current) =>
        current.patientId === patientParam
          ? current
          : { ...current, patientId: patientParam },
      );
    },
    [setFilters],
  );

  const openCaseFromRoute = useCallback((caseId: string) => {
    setSelectedId(caseId);
    setDetailOpen(true);
  }, []);

  const openCreateCaseFromRoute = useCallback(
    (patientParam: string, currentSearchParams: URLSearchParams) => {
      setCreateError("");
      setCreateForm({
        ...DEFAULT_CREATE_FORM,
        patientId: patientParam,
      });
      setCreateOpen(true);
      const params = new URLSearchParams(currentSearchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    },
    [setSearchParams],
  );

  const startSnippetLoad = useCallback(() => {
    startSnippetLoad();
  }, []);

  const finishSnippetLoad = useCallback(() => {
    setSnippetsBusy(false);
  }, []);

  const applySnippets = useCallback((items: CaseTextSnippet[]) => {
    setSnippets(items);
  }, []);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void fetchCaseLookups().then(({ patients: patientItems, doctors: doctorItems }) => {
      if (!cancelled) {
        startTransition(() => {
          applyCaseLookups(patientItems, doctorItems);
        });
      }
    }).catch(() => {
      if (!cancelled) {
        startTransition(() => {
          applyCaseLookups([], []);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [applyCaseLookups, permissions.canViewPage]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    startSnippetLoad();

    void fetchCaseTextSnippets()
      .then((items) => {
        if (!cancelled) {
          startTransition(() => applySnippets(items));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setSnippetsError(
            bannerText(
              error,
              caseText(
                "Textbausteine konnten nicht geladen werden",
                "Не удалось загрузить текстовые шаблоны",
                "Failed to load text snippets",
              ),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          finishSnippetLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    applySnippets,
    finishSnippetLoad,
    permissions.canViewPage,
    snippetVersion,
    startSnippetLoad,
  ]);

  useEffect(() => {
    const patientParam = embedded
      ? embeddedPatientId ?? ""
      : searchParams.get("patient") ?? "";
    const caseParam = embedded
      ? embeddedCaseId ?? ""
      : searchParams.get("case") ?? "";
    const createParam = embedded ? "" : searchParams.get("create") ?? "";

    hydratePatientFilterFromRoute(patientParam);

    if (caseParam && caseParam !== selectedId) {
      openCaseFromRoute(caseParam);
    }

    if (createParam && permissions.canCreate && !embedded) {
      openCreateCaseFromRoute(patientParam, searchParams);
    }
  }, [
    embedded,
    embeddedPatientId,
    embeddedCaseId,
    hydratePatientFilterFromRoute,
    openCaseFromRoute,
    openCreateCaseFromRoute,
    permissions.canCreate,
    searchParams,
    selectedId,
  ]);

  const startCaseListLoad = useCallback(() => {
    setListBusy(true);
    setListError("");
  }, []);

  const applyCases = useCallback((items: CaseRosterItem[]) => {
    setCases(items);
  }, []);

  const finishCaseListLoad = useCallback(() => {
    setListBusy(false);
  }, []);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    startCaseListLoad();

    void fetchCases(casesPath)
      .then((items) => {
        if (!cancelled) {
          startTransition(() => applyCases(items));
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setListError(
            bannerText(
              error,
              caseText(
                "Fälle konnten nicht geladen werden",
                "Не удалось загрузить кейсы",
                "Failed to load cases",
              ),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          finishCaseListLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyCases, casesPath, finishCaseListLoad, permissions.canViewPage, listVersion, startCaseListLoad]);

  const startCaseDetailLoad = useCallback(() => {
    setDetailBusy(true);
    setDetailError("");
  }, []);

  const applyCaseDetail = useCallback((item: Awaited<ReturnType<typeof fetchCaseDetail>>) => {
    setDetail(item);
    setOverviewForm({
      hauptanfragegrund: item.hauptanfragegrund ?? "",
      aktuelle_anamnese: item.aktuelle_anamnese ?? "",
      zuweiser_doctor_id: item.zuweiser_doctor_id ?? "",
      zuweiser: item.zuweiser ?? "",
    });
    setVorerkrankungen(item.vorerkrankungen);
    setAllergien(item.allergien);
    setOperationen(item.operationen);
    setMedikamente(item.medikamente);
    setPainRecords(item.pain_records);
    setSymptome(item.symptome);
    setCardiology({
      ...blankCardiology(),
      is_relevant: item.cardiology?.is_relevant ?? item.cardiology_recommended ?? false,
      chest_pain: item.cardiology?.chest_pain ?? false,
      dyspnea: item.cardiology?.dyspnea ?? false,
      palpitations: item.cardiology?.palpitations ?? false,
      syncope: item.cardiology?.syncope ?? false,
      edema: item.cardiology?.edema ?? false,
      known_diagnosis: item.cardiology?.known_diagnosis ?? "",
      prior_cardiac_workup: item.cardiology?.prior_cardiac_workup ?? "",
      cardiovascular_risk_factors: item.cardiology?.cardiovascular_risk_factors ?? "",
      anticoagulation: item.cardiology?.anticoagulation ?? "",
      family_history: item.cardiology?.family_history ?? "",
      red_flags: item.cardiology?.red_flags ?? "",
      notes: item.cardiology?.notes ?? "",
    });
    setGastroenterology({
      ...blankGastroenterology(),
      is_relevant:
        item.gastroenterology?.is_relevant ??
        item.gastroenterology_recommended ??
        false,
      abdominal_pain: item.gastroenterology?.abdominal_pain ?? false,
      reflux: item.gastroenterology?.reflux ?? false,
      nausea: item.gastroenterology?.nausea ?? false,
      diarrhea: item.gastroenterology?.diarrhea ?? false,
      constipation: item.gastroenterology?.constipation ?? false,
      gi_bleeding: item.gastroenterology?.gi_bleeding ?? false,
      prior_endoscopy: item.gastroenterology?.prior_endoscopy ?? "",
      bowel_habits: item.gastroenterology?.bowel_habits ?? "",
      liver_history: item.gastroenterology?.liver_history ?? "",
      food_intolerance: item.gastroenterology?.food_intolerance ?? "",
      red_flags: item.gastroenterology?.red_flags ?? "",
      notes: item.gastroenterology?.notes ?? "",
    });
    setOrthopedics({
      ...blankOrthopedics(),
      is_relevant: item.orthopedics?.is_relevant ?? item.orthopedics_recommended ?? false,
      joint_pain: item.orthopedics?.joint_pain ?? false,
      back_pain: item.orthopedics?.back_pain ?? false,
      mobility_limitation: item.orthopedics?.mobility_limitation ?? false,
      trauma_history: item.orthopedics?.trauma_history ?? false,
      prior_imaging: item.orthopedics?.prior_imaging ?? "",
      assistive_devices: item.orthopedics?.assistive_devices ?? "",
      physiotherapy_history: item.orthopedics?.physiotherapy_history ?? "",
      pain_triggers: item.orthopedics?.pain_triggers ?? "",
      red_flags: item.orthopedics?.red_flags ?? "",
      notes: item.orthopedics?.notes ?? "",
    });
    setNeurology({
      ...blankNeurology(),
      is_relevant: item.neurology?.is_relevant ?? item.neurology_recommended ?? false,
      headache: item.neurology?.headache ?? false,
      dizziness: item.neurology?.dizziness ?? false,
      sensory_changes: item.neurology?.sensory_changes ?? false,
      weakness: item.neurology?.weakness ?? false,
      seizure_history: item.neurology?.seizure_history ?? false,
      gait_balance_issues: item.neurology?.gait_balance_issues ?? false,
      prior_neuro_imaging: item.neurology?.prior_neuro_imaging ?? "",
      prior_neurology_workup: item.neurology?.prior_neurology_workup ?? "",
      cognitive_changes: item.neurology?.cognitive_changes ?? "",
      red_flags: item.neurology?.red_flags ?? "",
      notes: item.neurology?.notes ?? "",
    });
    setPulmonology({
      ...blankPulmonology(),
      is_relevant: item.pulmonology?.is_relevant ?? item.pulmonology_recommended ?? false,
      chronic_cough: item.pulmonology?.chronic_cough ?? false,
      dyspnea: item.pulmonology?.dyspnea ?? false,
      wheezing: item.pulmonology?.wheezing ?? false,
      chest_tightness: item.pulmonology?.chest_tightness ?? false,
      hemoptysis: item.pulmonology?.hemoptysis ?? false,
      smoking_history: item.pulmonology?.smoking_history ?? "",
      prior_chest_imaging: item.pulmonology?.prior_chest_imaging ?? "",
      inhaler_therapy: item.pulmonology?.inhaler_therapy ?? "",
      sleep_apnea_history: item.pulmonology?.sleep_apnea_history ?? "",
      red_flags: item.pulmonology?.red_flags ?? "",
      notes: item.pulmonology?.notes ?? "",
    });
    setUrology({
      ...blankUrology(),
      is_relevant: item.urology?.is_relevant ?? item.urology_recommended ?? false,
      dysuria: item.urology?.dysuria ?? false,
      hematuria: item.urology?.hematuria ?? false,
      flank_pain: item.urology?.flank_pain ?? false,
      urinary_frequency: item.urology?.urinary_frequency ?? false,
      urinary_retention: item.urology?.urinary_retention ?? false,
      incontinence: item.urology?.incontinence ?? false,
      prior_urology_workup: item.urology?.prior_urology_workup ?? "",
      catheter_history: item.urology?.catheter_history ?? "",
      stone_history: item.urology?.stone_history ?? "",
      red_flags: item.urology?.red_flags ?? "",
      notes: item.urology?.notes ?? "",
    });
    setVegetative({
      appetit_durst: item.vegetative_anamnese?.appetit_durst ?? "",
      koerpergroesse:
        item.vegetative_anamnese?.koerpergroesse != null
          ? String(item.vegetative_anamnese.koerpergroesse)
          : "",
      gewicht:
        item.vegetative_anamnese?.gewicht != null
          ? String(item.vegetative_anamnese.gewicht)
          : "",
      gewichtsveraenderung:
        item.vegetative_anamnese?.gewichtsveraenderung ?? "",
      grund: item.vegetative_anamnese?.grund ?? "",
    });
    setImpfstatus(item.impfstatus ?? "");
  }, []);

  const finishCaseDetailLoad = useCallback(() => {
    setDetailBusy(false);
  }, []);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;
    let cancelled = false;
    startCaseDetailLoad();

    void fetchCaseDetail(selectedId)
      .then((item) => {
        if (cancelled) return;
        startTransition(() => {
          applyCaseDetail(item);
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(
            bannerText(
              error,
              caseText(
                "Fall konnte nicht geladen werden",
                "Не удалось загрузить кейс",
                "Failed to load case",
              ),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          finishCaseDetailLoad();
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyCaseDetail, detailOpen, detailVersion, finishCaseDetailLoad, selectedId, startCaseDetailLoad]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  function updateQuery(next: Record<string, string | null>) {
    if (embedded) return;
    const params = new URLSearchParams(searchParams);
    Object.entries(next).forEach(([key, value]) => {
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    setSearchParams(params, { replace: true });
  }

  function openCase(caseId: string) {
    if (embedded) {
      setSelectedId(caseId);
      setDetailOpen(true);
      return;
    }
    staffGo(`/cases/${caseId}`);
  }

  async function runSectionSave(
    key: SectionStatusKey,
    action: () => Promise<unknown>,
    fallbackMessage: string,
  ) {
    setSectionBusy(key);
    setSectionErrors((current) => ({ ...current, [key]: "" }));
    try {
      await action();
      refreshList();
      refreshDetail();
    } catch (error) {
      setSectionErrors((current) => ({
        ...current,
        [key]: bannerText(error, fallbackMessage),
      }));
    } finally {
      setSectionBusy("");
    }
  }

  async function handleCreateCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateBusy(true);
    setCreateError("");

    try {
      const created = await createCase({
        patient_id: createForm.patientId,
        hauptanfragegrund: toOptionalText(createForm.hauptanfragegrund),
        aktuelle_anamnese: toOptionalText(createForm.aktuelleAnamnese),
        zuweiser_doctor_id: toOptionalText(createForm.zuweiserDoctorId),
        zuweiser: toOptionalText(createForm.zuweiser),
      });
      setCreateOpen(false);
      setCreateForm(DEFAULT_CREATE_FORM);
      refreshList();
      openCase(created.id);
      refreshDetail();
    } catch (error) {
      setCreateError(
        bannerText(
          error,
          caseText(
            "Fall konnte nicht erstellt werden",
            "Не удалось создать кейс",
            "Failed to create case",
          ),
        ),
      );
    } finally {
      setCreateBusy(false);
    }
  }

  function openPatientWorkspace() {
    if (!detail) return;
    staffGo(`/patients?patient=${detail.patient_id}`);
  }

  function openOrdersWorkspace() {
    if (!detail) return;
    staffGo(`/orders?patient=${detail.patient_id}`);
  }

  function openAppointmentsWorkspace() {
    if (!detail) return;
    staffGo(`/appointments?patient=${detail.patient_id}`);
  }

  function refreshSnippetLibrary() {
    setSnippetVersion((current) => current + 1);
  }

  function openNewSnippetDialog() {
    setSnippetSaveError("");
    setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
    setSnippetDialogOpen(true);
  }

  function openEditSnippetDialog(snippet: CaseTextSnippet) {
    setSnippetSaveError("");
    setSnippetForm({
      id: snippet.id,
      label: snippet.label,
      category: snippet.category,
      body: snippet.body,
      is_active: snippet.is_active,
    });
    setSnippetDialogOpen(true);
  }

  function insertSnippetIntoNarrative(snippet: CaseTextSnippet) {
    const rendered = renderCaseTextSnippet(snippet.body, snippetContext);
    setOverviewForm((current) => ({
      ...current,
      aktuelle_anamnese: appendSnippetToNarrative(
        current.aktuelle_anamnese,
        rendered,
      ),
    }));
  }

  async function handleSaveSnippet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSnippetSaveBusy(true);
    setSnippetSaveError("");

    try {
      await saveCaseTextSnippet(snippetForm.id, {
        label: snippetForm.label,
        category: toOptionalText(snippetForm.category) ?? "general",
        body: snippetForm.body,
        is_active: snippetForm.is_active,
      });
      setSnippetDialogOpen(false);
      setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
      refreshSnippetLibrary();
    } catch (error) {
      setSnippetSaveError(
        bannerText(
          error,
          caseText(
            "Textbaustein konnte nicht gespeichert werden",
            "Не удалось сохранить текстовый шаблон",
            "Failed to save text snippet",
          ),
        ),
      );
    } finally {
      setSnippetSaveBusy(false);
    }
  }

  async function handleSaveOverview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "overview",
      () =>
        saveCaseOverview(detail.id, {
          hauptanfragegrund: toOptionalText(overviewForm.hauptanfragegrund),
          aktuelle_anamnese: toOptionalText(overviewForm.aktuelle_anamnese),
          zuweiser_doctor_id: toOptionalText(overviewForm.zuweiser_doctor_id),
          zuweiser: toOptionalText(overviewForm.zuweiser),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveVorerkrankungen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "vorerkrankungen",
      () =>
        saveCaseVorerkrankungen(detail.id, {
          items: sanitizeVorerkrankungen(vorerkrankungen),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveAllergien(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "allergien",
      () =>
        saveCaseAllergien(detail.id, { items: sanitizeAllergien(allergien) }),
      t.common_failed_update,
    );
  }

  async function handleSaveOperationen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "operationen",
      () =>
        saveCaseOperationen(detail.id, { items: sanitizeOperationen(operationen) }),
      t.common_failed_update,
    );
  }

  async function handleSaveMedikamente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "medikamente",
      () =>
        saveCaseMedikamente(detail.id, { items: sanitizeMedikamente(medikamente) }),
      t.common_failed_update,
    );
  }

  async function handleConfirmMedicationExpiry(medicationId: string) {
    if (!detail) return;
    await runSectionSave(
      "medikamente",
      () => confirmMedicationExpiry(detail.id, medicationId),
      caseText(
        "Prüfung des Ablaufs der Medikamentengültigkeit konnte nicht bestätigt werden",
        "Не удалось подтвердить проверку окончания срока действия лекарства",
        "Failed to confirm medication expiry review",
      ),
    );
  }

  async function handleSavePain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "pain",
      () =>
        saveCasePain(detail.id, { items: sanitizePainRecords(painRecords) }),
      t.common_failed_update,
    );
  }

  async function handleSaveSymptome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "symptome",
      () =>
        saveCaseSymptome(detail.id, { items: sanitizeSymptome(symptome) }),
      t.common_failed_update,
    );
  }

  async function handleSaveCardiology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "cardiology",
      () => saveCaseCardiology(detail.id, cardiologyToPayload(cardiology)),
      t.common_failed_update,
    );
  }

  async function handleSaveGastroenterology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "gastroenterology",
      () =>
        saveCaseGastroenterology(
          detail.id,
          gastroenterologyToPayload(gastroenterology),
        ),
      t.common_failed_update,
    );
  }

  async function handleSaveOrthopedics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "orthopedics",
      () => saveCaseOrthopedics(detail.id, orthopedicsToPayload(orthopedics)),
      t.common_failed_update,
    );
  }

  async function handleSaveNeurology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "neurology",
      () => saveCaseNeurology(detail.id, neurologyToPayload(neurology)),
      t.common_failed_update,
    );
  }

  async function handleSavePulmonology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "pulmonology",
      () => saveCasePulmonology(detail.id, pulmonologyToPayload(pulmonology)),
      t.common_failed_update,
    );
  }

  async function handleSaveUrology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "urology",
      () => saveCaseUrology(detail.id, urologyToPayload(urology)),
      t.common_failed_update,
    );
  }

  async function handleSaveVegetative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "vegetative",
      () =>
        saveCaseVegetative(detail.id, {
          appetit_durst: toOptionalText(vegetative.appetit_durst),
          koerpergroesse: numericInputToValue(vegetative.koerpergroesse),
          gewicht: numericInputToValue(vegetative.gewicht),
          gewichtsveraenderung: toOptionalText(vegetative.gewichtsveraenderung),
          grund: toOptionalText(vegetative.grund),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveImpfstatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "impfstatus",
      () =>
        saveCaseImpfstatus(detail.id, {
          status_text: toOptionalText(impfstatus),
        }),
      t.common_failed_update,
    );
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">
            {caseText("Fallbereich", "Рабочее пространство кейсов", "Case workspace")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
            {caseText(
              "Die Fallverwaltung ist im Backend derzeit auf die Rollen CEO und Patient Manager beschränkt.",
              "Управление кейсами в backend сейчас ограничено ролями CEO и Patient Manager.",
              "Case management is currently limited to CEO and Patient Manager roles in the backend.",
            )}
          </p>
        </section>
      </div>
    );
  }

  return (
    <>
      {embedded ? null : (
        <div className="space-y-4">
          <PageHeader
            title={t.cases_title}
            description={t.cases_subtitle}
            actions={(
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-lg gap-1.5 bg-card px-3.5"
                  onClick={refreshList}
                >
                  <RefreshCw className="size-3.5" />
                  {t.common_refresh}
                </Button>
                {permissions.canCreate ? (
                  <Button
                    type="button"
                    className="h-9 rounded-lg gap-1.5 px-3.5"
                    onClick={() => {
                      setCreateError("");
                      setCreateForm(DEFAULT_CREATE_FORM);
                      setCreateOpen(true);
                    }}
                  >
                    <Plus className="size-3.5" />
                    {t.cases_new}
                  </Button>
                ) : null}
              </>
            )}
          />

          <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 [&>article:not(:last-child)_.admin-inline-metric-separator]:xl:block">
            <AdminInlineMetric
              icon={ClipboardList}
              tone="sky"
              label={t.cases_title}
              value={metrics.total}
              description={t.common_registry}
            />
            <AdminInlineMetric
              icon={Plus}
              tone="slate"
              label={t.cases_open}
              value={metrics.open}
              description={t.users_status}
            />
            <AdminInlineMetric
              icon={Stethoscope}
              tone="amber"
              label={t.cases_in_progress}
              value={metrics.inProgress}
              description={t.users_status}
            />
            <AdminInlineMetric
              icon={CalendarClock}
              tone="emerald"
              label={t.cases_closed}
              value={metrics.closed}
              description={t.users_status}
            />
          </div>

          <AdminToolbar className="rounded-none border-0 bg-transparent p-0 shadow-none">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, search: event.target.value }))}
                placeholder={t.search_placeholder}
                className="h-8 w-[260px] rounded-lg bg-card pl-8 text-[13px]"
              />
            </div>

            <NativeComboboxSelect
              value={filters.status || "__all__"}


              onChange={(event) => setFilters((current) => ({
                  ...current,
                  status: event.target.value && event.target.value !== "__all__" ? event.target.value : "",
                }))} className={cn(selectClassName, "h-8 w-[220px] bg-card text-[13px]")}>
                <option value="__all__">{t.providers_all}</option>
                {CASE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {caseStatusLabel(status, t)}
                  </option>
                ))}
              </NativeComboboxSelect>

            <NativeComboboxSelect
              value={filters.patientId || "__all__"}


              onChange={(event) => {
                const patientId = event.target.value && event.target.value !== "__all__" ? event.target.value : "";
                setFilters((current) => ({ ...current, patientId }));
                updateQuery({ patient: patientId || null });
              }} className={cn(selectClassName, "h-8 w-[260px] bg-card text-[13px]")}>
                <option value="__all__">{t.providers_all}</option>
                {patients.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patientLabel(patient)}
                  </option>
                ))}
              </NativeComboboxSelect>

            {filters.search.trim() || filters.status || filters.patientId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 rounded-lg gap-1 text-[12.5px] text-muted-foreground"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  updateQuery({ patient: null, case: null });
                }}
              >
                {t.common_reset}
              </Button>
            ) : null}
          </AdminToolbar>

          <AdminTableCard
            title={t.cases_roster}
            description={t.cases_subtitle}
            count={listBusy ? t.patients_syncing : `${cases.length}`}
            className="min-h-[440px]"
          >
            {listError ? (
              <div className="p-4">
                <Banner tone="error">{listError}</Banner>
              </div>
            ) : (
              <DataTableSurface
                rows={cases}
                columns={caseTableColumns}
                rowId={(item) => item.id}
                defaultDensity="comfortable"
                dictionary={t as unknown as Record<string, string>}
                activeRowId={selectedId || undefined}
                onRowClick={(item) => openCase(item.id)}
                loading={listBusy}
                loadingState={(
                  <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                    <LoaderCircle className="mr-2 size-4 animate-spin" />
                    {t.common_loading}
                  </div>
                )}
                emptyState={(
                  <EmptyPanel
                    title={t.cases_no_match}
                    text={t.cases_no_match}
                    action={
                      permissions.canCreate ? (
                        <Button
                          type="button"
                          className="h-9 rounded-lg px-3.5"
                          onClick={() => {
                            setCreateError("");
                            setCreateForm(DEFAULT_CREATE_FORM);
                            setCreateOpen(true);
                          }}
                        >
                          <Plus className="size-4" />
                          {t.cases_new}
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                tableClassName="min-h-[360px]"
                footer={({ filteredCount, totalCount }) => (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {filteredCount === totalCount
                        ? `${totalCount}`
                        : `${filteredCount} / ${totalCount}`}
                    </span>
                    <span>{t.patients_records}</span>
                  </div>
                )}
              />
            )}
          </AdminTableCard>
        </div>
      )}

      {embedded ? null : (
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto border-l border-border p-0 sm:max-w-[640px]">
            <form onSubmit={handleCreateCase} className="flex min-h-0 flex-1 flex-col">
              <AdminSheetScaffold
                title={t.cases_new}
                description={t.cases_subtitle}
                footer={(
                  <SheetFormFooter
                    cancelLabel={t.common_cancel}
                    submitLabel={t.cases_new}
                    submittingLabel={t.patients_creating}
                    submitting={createBusy}
                    submitDisabled={!createForm.patientId}
                    onCancel={() => setCreateOpen(false)}
                  />
                )}
              >
                {createError ? <Banner tone="error">{createError}</Banner> : null}
                <Field label={t.cases_patient} required>
                  <NativeComboboxSelect
                    value={createForm.patientId || "__none__"}


                    onChange={(event) => {
                      const patientId = event.target.value && event.target.value !== "__none__" ? event.target.value : "";
                      setCreateForm((current) => ({ ...current, patientId }));
                    }} className={selectClassName}>
                      <option value="__none__">{t.cases_patient}</option>
                      {patients.map((patient) => (
                        <option key={patient.id} value={patient.id}>
                          {patientLabel(patient)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                </Field>

                <Field label={t.cases_reason} required>
                  <Input
                    value={createForm.hauptanfragegrund}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        hauptanfragegrund: event.target.value,
                      }))}
                    required
                    className={inputClassName}
                  />
                </Field>

                <Field label={t.cases_anamnesis} required>
                  <textarea
                    value={createForm.aktuelleAnamnese}
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        aktuelleAnamnese: event.target.value,
                      }))}
                    required
                    className={textareaClassName}
                    rows={4}
                  />
                </Field>

                <Field label={t.cases_referrer}>
                  <NativeComboboxSelect
                    value={createForm.zuweiserDoctorId || "__none__"}


                    onChange={(event) => {
                      const doctorId = event.target.value && event.target.value !== "__none__" ? event.target.value : "";
                      const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                      setCreateForm((current) => ({
                        ...current,
                        zuweiserDoctorId: doctorId,
                        zuweiser: selectedDoctor ? selectedDoctor.name : current.zuweiser,
                      }));
                    }} className={selectClassName}>
                      <option value="__none__">{t.common_not_set}</option>
                      {doctors.map((doctor) => (
                        <option key={doctor.id} value={doctor.id}>
                          {doctorOptionLabel(doctor)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                </Field>

                <Field
                  label={t.cases_clinical_referrer_label}
                >
                  <Input
                    value={createForm.zuweiser}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, zuweiser: event.target.value }))}
                    className={inputClassName}
                  />
                </Field>
              </AdminSheetScaffold>
            </form>
          </SheetContent>
        </Sheet>
      )}

      <Sheet
        open={detailOpen}
        modal={embedded ? embeddedSheetModal : undefined}
        onOpenChange={(open) => {
          setDetailOpen(open);
          if (!open) {
            setSelectedId("");
            setDetail(null);
            setCardiology(blankCardiology());
            setGastroenterology(blankGastroenterology());
            setOrthopedics(blankOrthopedics());
            setNeurology(blankNeurology());
            setPulmonology(blankPulmonology());
            setUrology(blankUrology());
            setDetailError("");
            updateQuery({ case: null });
            onCloseCaseSheet?.();
          }
        }}
      >
        <SheetContent
          side={embedded ? embeddedSheetSide : "right"}
          showOverlay={embedded ? embeddedSheetShowOverlay : true}
          className={cn(
            "w-full overflow-y-auto p-0",
            embedded && embeddedSheetSide === "left"
              ? "border-r border-border"
              : "border-l border-border",
            embedded ? "z-[60] sm:max-w-[48vw] xl:max-w-[760px]" : "sm:max-w-[980px]",
            embeddedSheetClassName,
          )}
        >
          <AdminSheetScaffold
            title={detail?.case_id ?? selectedSummary?.case_id ?? t.cases_title}
            description={caseText(
              "Vollständiger Verlauf und strukturierter Anamnese-Editor für den ausgewählten Patientenfall.",
              "Полный нарратив и структурированный редактор анамнеза для выбранного кейса пациента.",
              "Full narrative and structured anamnesis editor for the selected patient case.",
            )}
            className="h-full"
          >
            {detailBusy ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t.cases_clinical_loading_case}
              </div>
            ) : detailError ? (
              <Banner tone="error">{detailError}</Banner>
            ) : detail ? (
              <>
                <section className={cardClass("p-5")}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("rounded-full", statusBadgeClass(detail.status))}
                    >
                      {caseStatusLabel(detail.status, t)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-border bg-background text-foreground"
                    >
                      {selectedPatient ? patientLabel(selectedPatient) : detail.patient_id}
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-foreground md:text-2xl">{detail.case_id}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {selectedSummary?.patient_name
                          ? `${selectedSummary.patient_name} (${selectedSummary.patient_pid})`
                          : selectedPatient
                            ? patientLabel(selectedPatient)
                            : detail.patient_id}
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t.cases_clinical_reference_code}
                          </div>
                          <div className="mt-2 font-mono text-sm text-foreground">{detail.case_id}</div>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t.cases_clinical_system_case_uuid}
                          </div>
                          <div className="mt-2 break-all font-mono text-xs text-foreground">
                            {detail.case_uuid ?? detail.id}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t.cases_clinical_retention_until}
                          </div>
                          <div className="mt-2 text-sm text-foreground">
                            {formatDate(detail.retention_until)}
                          </div>
                        </div>
                        <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {t.cases_clinical_last_clinical_update}
                          </div>
                          <div className="mt-2 text-sm text-foreground">
                            {formatDateTime(detail.last_clinical_update_at ?? detail.updated_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={openPatientWorkspace}>
                        <UserRound className="size-4" />
                        {t.cases_clinical_patient_fallback}
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={openOrdersWorkspace}>
                        <ClipboardList className="size-4" />
                        {t.cases_clinical_orders}
                      </Button>
                      <Button type="button" variant="outline" className="h-9 rounded-lg px-3.5" onClick={openAppointmentsWorkspace}>
                        <CalendarClock className="size-4" />
                        {t.cases_clinical_appointments}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <MetricCard label={t.cases_preconditions} value={detail.vorerkrankungen.length.toString()} description={t.cases_subtitle} icon={<Stethoscope className="size-4" />} />
                    <MetricCard label={t.cases_allergies} value={detail.allergien.length.toString()} description={t.cases_subtitle} icon={<Plus className="size-4" />} />
                    <MetricCard label={t.cases_medication} value={detail.medikamente.length.toString()} description={t.cases_subtitle} icon={<ClipboardList className="size-4" />} />
                    <MetricCard label={t.cases_symptoms} value={detail.symptome.length.toString()} description={t.cases_subtitle} icon={<Search className="size-4" />} />
                    <MetricCard
                      label={t.cases_clinical_revisions_metric}
                      value={String(detail.version_count ?? detail.history?.length ?? 0)}
                      description={t.cases_clinical_revisions_metric_hint}
                      icon={<RefreshCw className="size-4" />}
                    />
                  </div>
                </section>

                <Panel
                  title={t.cases_core_anamnesis}
                  description={t.cases_subtitle}
                  action={
                    permissions.canEdit ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-lg px-3.5"
                        onClick={openNewSnippetDialog}
                      >
                        {t.cases_snippets_manage}
                      </Button>
                    ) : null
                  }
                >
                  <form onSubmit={handleSaveOverview} className="space-y-4">
                    {sectionErrors.overview ? <Banner tone="error">{sectionErrors.overview}</Banner> : null}
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label={t.cases_reason} required>
                        <Input
                          value={overviewForm.hauptanfragegrund}
                          onChange={(event) =>
                            setOverviewForm((current) => ({
                              ...current,
                              hauptanfragegrund: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={t.cases_referrer}>
                        <NativeComboboxSelect
                          value={overviewForm.zuweiser_doctor_id || "__none__"}


                          onChange={(event) => {
                            const doctorId = event.target.value && event.target.value !== "__none__" ? event.target.value : "";
                            const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                            setOverviewForm((current) => ({
                              ...current,
                              zuweiser_doctor_id: doctorId,
                              zuweiser: selectedDoctor ? selectedDoctor.name : current.zuweiser,
                            }));
                          }} className={selectClassName}>
                            <option value="__none__">{t.common_not_set}</option>
                            {doctors.map((doctor) => (
                              <option key={doctor.id} value={doctor.id}>
                                {doctorOptionLabel(doctor)}
                              </option>
                            ))}
                          </NativeComboboxSelect>
                      </Field>
                      <Field label={t.cases_clinical_referrer_label}>
                        <Input
                          value={overviewForm.zuweiser}
                          onChange={(event) =>
                            setOverviewForm((current) => ({
                              ...current,
                              zuweiser: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                    </div>
                    <Field label={t.cases_narrative} required>
                      <textarea
                        value={overviewForm.aktuelle_anamnese}
                        onChange={(event) =>
                          setOverviewForm((current) => ({
                            ...current,
                            aktuelle_anamnese: event.target.value,
                          }))
                        }
                        className={textareaClassName}
                        rows={5}
                      />
                    </Field>
                    <div className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {t.cases_snippets_title}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t.cases_snippets_description}
                          </p>
                        </div>
                        <code className="rounded-xl bg-white px-3 py-1 text-[11px] text-muted-foreground">
                          {CASE_TEXT_SNIPPET_PLACEHOLDERS.join(" · ")}
                        </code>
                      </div>
                      {snippetsError ? (
                        <Banner tone="error">{snippetsError}</Banner>
                      ) : null}
                      {snippetsBusy ? (
                        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                          <LoaderCircle className="size-4 animate-spin" />
                          {t.common_loading}
                        </div>
                      ) : activeSnippets.length === 0 ? (
                        <p className="mt-3 text-sm text-muted-foreground">
                          {t.cases_snippets_empty}
                        </p>
                      ) : (
                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          {activeSnippets.map((snippet) => {
                            const rendered = renderCaseTextSnippet(
                              snippet.body,
                              snippetContext,
                            );
                            return (
                              <div
                                key={snippet.id}
                                className="rounded-xl border border-border bg-card p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">
                                      {snippet.label}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {snippetCategoryLabel(snippet.category)}
                                    </p>
                                  </div>
                                  {permissions.canEdit ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="rounded-lg"
                                      onClick={() => openEditSnippetDialog(snippet)}
                                    >
                                      {t.common_edit}
                                    </Button>
                                  ) : null}
                                </div>
                                <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                                  {rendered}
                                </p>
                                <div className="mt-3 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-lg"
                                    onClick={() => insertSnippetIntoNarrative(snippet)}
                                  >
                                    {t.cases_snippets_insert}
                                  </Button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button type="submit" className="h-9 rounded-lg px-3.5" disabled={sectionBusy === "overview" || !permissions.canEdit}>
                        {sectionBusy === "overview" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {t.cases_clinical_save_overview}
                      </Button>
                    </div>
                  </form>
                </Panel>
                <Sheet open={snippetDialogOpen} onOpenChange={setSnippetDialogOpen}>
                  <SheetContent side="right" className="w-full overflow-y-auto border-l border-border p-0 sm:max-w-[960px]">
                    <AdminSheetScaffold
                      title={t.cases_snippets_title}
                      description={t.cases_snippets_description}
                      className="h-full"
                    >
                      <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
                        <div className="space-y-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">
                              {t.cases_snippets_title}
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="rounded-lg"
                              onClick={openNewSnippetDialog}
                            >
                              {t.cases_snippets_new}
                            </Button>
                          </div>
                          <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                            {snippets.map((snippet) => (
                              <button
                                key={snippet.id}
                                type="button"
                                className={cn(
                                  "w-full rounded-xl border p-4 text-left transition",
                                  snippetForm.id === snippet.id
                                    ? "border-sky-300 bg-sky-50"
                                    : "border-border bg-white hover:border-border",
                                )}
                                onClick={() => openEditSnippetDialog(snippet)}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-foreground">
                                      {snippet.label}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {snippetCategoryLabel(snippet.category)}
                                    </p>
                                  </div>
                                  <Badge
                                    variant="secondary"
                                    className={snippet.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}
                                  >
                                    {snippet.is_active ? t.common_active : t.common_inactive}
                                  </Badge>
                                </div>
                                <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground">
                                  {snippet.body}
                                </p>
                              </button>
                            ))}
                          </div>
                        </div>
                        <form onSubmit={handleSaveSnippet} className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                          {snippetSaveError ? (
                            <Banner tone="error">{snippetSaveError}</Banner>
                          ) : null}
                          <Field label={t.cases_snippets_label} required>
                            <Input
                              value={snippetForm.label}
                              onChange={(event) =>
                                setSnippetForm((current) => ({
                                  ...current,
                                  label: event.target.value,
                                }))}
                              className="h-10 rounded-xl bg-white"
                            />
                          </Field>
                          <Field label={t.cases_snippets_category}>
                            <NativeComboboxSelect
                              value={snippetForm.category || "general"}
                              onChange={(event) =>
                                setSnippetForm((current) => ({
                                  ...current,
                                  category: event.target.value,
                                }))}
                              className={selectClassName}
                            >
                              {CASE_SNIPPET_CATEGORY_VALUES.map((category) => (
                                <option key={category} value={category}>
                                  {snippetCategoryLabel(category)}
                                </option>
                              ))}
                              {snippetForm.category &&
                              !isKnownSnippetCategory(snippetForm.category) ? (
                                <option value={snippetForm.category}>
                                  {snippetCategoryLabel(snippetForm.category)}
                                </option>
                              ) : null}
                            </NativeComboboxSelect>
                          </Field>
                          <Field label={t.cases_snippets_body} required>
                            <textarea
                              value={snippetForm.body}
                              onChange={(event) =>
                                setSnippetForm((current) => ({
                                  ...current,
                                  body: event.target.value,
                                }))}
                              className={textareaClassName}
                              rows={8}
                            />
                          </Field>
                          <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-sm text-foreground">
                            <input
                              type="checkbox"
                              className={checkboxClass}
                              checked={snippetForm.is_active}
                              onChange={(event) =>
                                setSnippetForm((current) => ({
                                  ...current,
                                  is_active: event.target.checked,
                                }))}
                            />
                            {t.cases_snippets_active}
                          </label>
                          <div className="rounded-xl border border-dashed border-border bg-white p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                              {t.cases_snippets_preview}
                            </p>
                            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                              {renderCaseTextSnippet(snippetForm.body, snippetContext) || t.cases_snippets_empty}
                            </p>
                          </div>
                          <code className="block rounded-xl bg-white px-3 py-2 text-[11px] text-muted-foreground">
                            {CASE_TEXT_SNIPPET_PLACEHOLDERS.join(" · ")}
                          </code>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="rounded-lg"
                              onClick={() => {
                                setSnippetDialogOpen(false);
                                setSnippetForm(DEFAULT_CASE_TEXT_SNIPPET_FORM);
                                setSnippetSaveError("");
                              }}
                            >
                              {t.common_cancel}
                            </Button>
                            <Button
                              type="submit"
                              className="h-9 rounded-lg px-3.5"
                              disabled={snippetSaveBusy}
                            >
                              {snippetSaveBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : null}
                              {t.cases_snippets_save}
                            </Button>
                          </div>
                        </form>
                      </div>
                    </AdminSheetScaffold>
                  </SheetContent>
                </Sheet>

                <ItemEditorSection title={t.cases_preconditions} description={t.cases_subtitle} count={countFilled(vorerkrankungen, "erkrankung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "vorerkrankungen"} error={sectionErrors.vorerkrankungen ?? ""} canEdit={permissions.canEdit} onAdd={() => setVorerkrankungen((current) => [...current, blankVorerkrankung()])} onSave={handleSaveVorerkrankungen}>
                  {vorerkrankungen.map((item, index) => (
                    <div key={vorerkrankungItemKey(item)} className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.cases_preconditions} required><Input value={item.erkrankung} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { erkrankung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_preconditions}><Input value={item.erstdiagnose ?? ""} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { erstdiagnose: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <Field label={t.cases_note}>
                        <textarea value={item.notiz ?? ""} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { notiz: event.target.value }))} className="mt-2 min-h-[90px] w-full rounded-xl border border-input bg-white px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30" />
                      </Field>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setVorerkrankungen((current) => removeItemAtIndex(current, index))}>{t.cases_clinical_remove}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_allergies} description={t.cases_subtitle} count={countFilled(allergien, "allergie")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "allergien"} error={sectionErrors.allergien ?? ""} canEdit={permissions.canEdit} onAdd={() => setAllergien((current) => [...current, blankAllergie()])} onSave={handleSaveAllergien}>
                  {allergien.map((item, index) => (
                    <div key={allergieItemKey(item)} className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.cases_allergies} required><Input value={item.allergie} onChange={(event) => setAllergien((current) => updateItemAtIndex(current, index, { allergie: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_subtitle}><Input value={item.reaktion ?? ""} onChange={(event) => setAllergien((current) => updateItemAtIndex(current, index, { reaktion: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setAllergien((current) => removeItemAtIndex(current, index))}>{t.cases_clinical_remove}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_operations} description={t.cases_subtitle} count={countFilled(operationen, "grund")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "operationen"} error={sectionErrors.operationen ?? ""} canEdit={permissions.canEdit} onAdd={() => setOperationen((current) => [...current, blankOperation()])} onSave={handleSaveOperationen}>
                  {operationen.map((item, index) => (
                    <div key={operationItemKey(item)} className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <Field label={t.appointments_date}><Input type="date" value={item.datum ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { datum: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_reason} required><Input value={item.grund} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { grund: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_clinical_doctor_registry}>
                          <NativeComboboxSelect
                            value={item.arzt_id || "__none__"}


                            onChange={(event) => {
                              const doctorId = event.target.value && event.target.value !== "__none__" ? event.target.value : "";
                              const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                              setOperationen((current) =>
                                updateItemAtIndex(current, index, {
                                  arzt_id: doctorId,
                                  arzt: selectedDoctor
                                    ? selectedDoctor.name
                                    : (current[index]?.arzt ?? ""),
                                }),
                              );
                            }} className={selectClassName}>
                              <option value="__none__">{t.common_not_set}</option>
                              {doctors.map((doctor) => (
                                <option key={doctor.id} value={doctor.id}>
                                  {doctorOptionLabel(doctor)}
                                </option>
                              ))}
                            </NativeComboboxSelect>
                        </Field>
                        <Field label={t.cases_clinical_doctor_label}><Input value={item.arzt ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { arzt: event.target.value }))} className="h-10 rounded-xl bg-white" placeholder={t.cases_clinical_legacy_manual_fallback} /></Field>
                        <Field label={t.cases_note}><Input value={item.notiz ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { notiz: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setOperationen((current) => removeItemAtIndex(current, index))}>{t.cases_clinical_remove}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_medication} description={t.cases_subtitle} count={countFilled(medikamente, "handelsname")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "medikamente"} error={sectionErrors.medikamente ?? ""} canEdit={permissions.canEdit} onAdd={() => setMedikamente((current) => [...current, blankMedikament()])} onSave={handleSaveMedikamente}>
                  {medikamente.map((item, index) => (
                    <div key={medikamentItemKey(item)} className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Field label={t.cases_medications} required><Input value={item.handelsname} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { handelsname: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.wirkstoff ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { wirkstoff: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.documents_category}>
                          <NativeComboboxSelect
                            value={item.med_typ || "permanent"}
                            onChange={(event) =>
                              setMedikamente((current) =>
                                updateItemAtIndex(current, index, { med_typ: event.target.value }),
                              )}
                            className={selectClassName}
                          >
                            {CASE_MEDICATION_TYPE_VALUES.map((type) => (
                              <option key={type} value={type}>
                                {medicationTypeLabel(type)}
                              </option>
                            ))}
                            {item.med_typ && !isKnownMedicationType(item.med_typ) ? (
                              <option value={item.med_typ}>
                                {medicationTypeLabel(item.med_typ)}
                              </option>
                            ) : null}
                          </NativeComboboxSelect>
                        </Field>
                        <Field label={t.cases_clinical_valid_until}>
                          <Input
                            type="date"
                            value={item.expiry_date ?? ""}
                            onChange={(event) =>
                              setMedikamente((current) =>
                                updateItemAtIndex(current, index, {
                                  expiry_date: event.target.value,
                                }),
                              )
                            }
                            className="h-10 rounded-xl bg-white"
                          />
                        </Field>
                        <Field label={t.cases_medications}><Input value={item.dosis ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { dosis: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.dosis_einheit ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { dosis_einheit: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.einnahmeschema ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { einnahmeschema: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.documents_category}><Input value={item.darreichungsform ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { darreichungsform: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.einheit ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { einheit: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.providers_service_valid_from}><Input value={item.seit ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { seit: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_reason}><Input value={item.grund ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { grund: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_clinical_doctor_registry}>
                          <NativeComboboxSelect
                            value={item.verordnender_arzt_id || "__none__"}


                            onChange={(event) => {
                              const doctorId = event.target.value && event.target.value !== "__none__" ? event.target.value : "";
                              const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                              setMedikamente((current) =>
                                updateItemAtIndex(current, index, {
                                  verordnender_arzt_id: doctorId,
                                  verordnender_arzt: selectedDoctor
                                    ? selectedDoctor.name
                                    : (current[index]?.verordnender_arzt ?? ""),
                                }),
                              );
                            }} className={selectClassName}>
                              <option value="__none__">{t.common_not_set}</option>
                              {doctors.map((doctor) => (
                                <option key={doctor.id} value={doctor.id}>
                                  {doctorOptionLabel(doctor)}
                                </option>
                              ))}
                            </NativeComboboxSelect>
                        </Field>
                        <Field label={t.cases_clinical_doctor_label}><Input value={item.verordnender_arzt ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { verordnender_arzt: event.target.value }))} className="h-10 rounded-xl bg-white" placeholder={t.cases_clinical_legacy_manual_fallback} /></Field>
                        <Field label={t.patients_notes}><Input value={item.anmerkung ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { anmerkung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      {item.is_expired ? (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full border-amber-300 bg-white text-amber-700">
                              {t.cases_clinical_medication_expired}
                            </Badge>
                            {item.pending_expiry_confirmation ? (
                              <Badge variant="outline" className="rounded-full border-rose-300 bg-white text-rose-700">
                                {t.cases_clinical_medication_confirmation_required}
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full border-emerald-300 bg-white text-emerald-700">
                                {t.cases_clinical_medication_review_confirmed}
                              </Badge>
                            )}
                            <span>
                              {formatCatalogMessage(
                                t.cases_clinical_medication_validity_ended,
                                { date: formatDate(item.expiry_date) },
                              )}
                            </span>
                          </div>
                          {item.pending_expiry_notification_sent_at ? (
                            <p className="mt-2 text-xs text-amber-700">
                              {formatCatalogMessage(
                                t.cases_clinical_medication_notification_sent,
                                {
                                  date: formatDateTime(
                                    item.pending_expiry_notification_sent_at,
                                  ),
                                },
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        {item.pending_expiry_confirmation && item.id ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => {
                              if (item.id) {
                                void handleConfirmMedicationExpiry(item.id);
                              }
                            }}
                            disabled={sectionBusy === "medikamente"}
                          >
                            {t.cases_clinical_medication_confirm_expiry_review}
                          </Button>
                        ) : null}
                        <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setMedikamente((current) => removeItemAtIndex(current, index))}>{t.cases_clinical_remove}</Button>
                      </div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_pain} description={t.cases_subtitle} count={countFilled(painRecords, "lokalisierung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "pain"} error={sectionErrors.pain ?? ""} canEdit={permissions.canEdit} onAdd={() => setPainRecords((current) => [...current, blankPainItem()])} onSave={handleSavePain}>
                  {painRecords.map((item, index) => (
                    <div key={painItemKey(item)} className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <Field label={t.appointments_location} required><Input value={item.lokalisierung} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { lokalisierung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.providers_service_valid_from}><Input value={item.seit_wann ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { seit_wann: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_preconditions}><Input value={item.ursache ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { ursache: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_symptoms}><Input value={item.qualitaet ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { qualitaet: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_symptoms}><Input value={item.kontinuitaet ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { kontinuitaet: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_symptoms}><Input value={item.entwicklung ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { entwicklung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_pain}><Input value={item.nrs_aktuell == null ? "" : String(item.nrs_aktuell)} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { nrs_aktuell: parsePainNumber(event.target.value) }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_pain}><Input value={item.nrs_anfang == null ? "" : String(item.nrs_anfang)} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { nrs_anfang: parsePainNumber(event.target.value) }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_pain}><Input value={item.dauer_anfang ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { dauer_anfang: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_pain}><Input value={item.dauer_aktuell ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { dauer_aktuell: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_pain}><Input value={item.ausstrahlung ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { ausstrahlung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_pain}><Input value={item.auftreten ?? ""} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { auftreten: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setPainRecords((current) => removeItemAtIndex(current, index))}>{t.cases_clinical_remove}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_symptoms} description={t.cases_subtitle} count={countFilled(symptome, "beschreibung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "symptome"} error={sectionErrors.symptome ?? ""} canEdit={permissions.canEdit} onAdd={() => setSymptome((current) => [...current, blankSymptom()])} onSave={handleSaveSymptome}>
                  {symptome.map((item, index) => (
                    <div key={symptomItemKey(item)} className="rounded-xl border border-border bg-muted/20 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.patients_notes} required><Input value={item.beschreibung} onChange={(event) => setSymptome((current) => updateItemAtIndex(current, index, { beschreibung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_title}><Input value={item.fachrichtung ?? ""} onChange={(event) => setSymptome((current) => updateItemAtIndex(current, index, { fachrichtung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={() => setSymptome((current) => removeItemAtIndex(current, index))}>{t.cases_clinical_remove}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <Panel
                  title={caseText("Kardiologischer Teilbereich", "Кардиологический блок", "Cardiology sub-flow")}
                  description={
                    cardiologyTriggered
                      ? caseText(
                          "Fachspezifischer Pfad für kardiologische Symptome und bereits erfolgte Herzdiagnostik.",
                          "Специализированный блок для кардиологических симптомов и ранее выполненной кардиодиагностики.",
                          "Specialty branch for cardiology-related symptoms and prior cardiac workup.",
                        )
                      : caseText(
                          "Aktivieren, wenn Symptome oder Überweisung auf Kardiologie hinweisen.",
                          "Включайте, если симптомы или направление указывают на кардиологию.",
                          "Enable when symptoms or referral indicate cardiology.",
                        )
                  }
                >
                  <form onSubmit={handleSaveCardiology} className="space-y-4">
                    {sectionErrors.cardiology ? <Banner tone="error">{sectionErrors.cardiology}</Banner> : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={cardiology.is_relevant}
                          onChange={(event) =>
                            setCardiology((current) => ({
                              ...current,
                              is_relevant: event.target.checked,
                            }))
                          }
                        />
                        {caseText("Kardiologie relevant", "Показания к кардиологии", "Cardiology relevant")}
                      </label>
                      {[
                        ["chest_pain", caseText("Brustschmerz", "Боль в груди", "Chest pain")],
                        ["dyspnea", caseText("Dyspnoe", "Одышка", "Dyspnea")],
                        ["palpitations", caseText("Palpitationen", "Сердцебиение", "Palpitations")],
                        ["syncope", caseText("Synkope", "Обмороки", "Syncope")],
                        ["edema", caseText("Ödeme", "Отеки", "Edema")],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={Boolean(cardiology[key as keyof CardiologyAssessment])}
                            onChange={(event) =>
                              setCardiology((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={caseText("Bekannte Diagnose", "Известный диагноз", "Known diagnosis")}>
                        <Input value={cardiology.known_diagnosis} onChange={(event) => setCardiology((current) => ({ ...current, known_diagnosis: event.target.value }))} className="h-10 rounded-xl bg-muted/20" />
                      </Field>
                      <Field label={caseText("Vorbefunde (EKG / Echo / Diagnostik)", "Предыдущие ЭКГ / Эхо / обследования", "Prior ECG / echo / workup")}>
                        <Input value={cardiology.prior_cardiac_workup} onChange={(event) => setCardiology((current) => ({ ...current, prior_cardiac_workup: event.target.value }))} className="h-10 rounded-xl bg-muted/20" />
                      </Field>
                      <Field label={caseText("Antikoagulation", "Антикоагуляция", "Anticoagulation")}>
                        <Input value={cardiology.anticoagulation} onChange={(event) => setCardiology((current) => ({ ...current, anticoagulation: event.target.value }))} className="h-10 rounded-xl bg-muted/20" />
                      </Field>
                      <Field label={caseText("Kardiovaskuläre Risikofaktoren", "Сердечно-сосудистые факторы риска", "CV risk factors")}>
                        <Input value={cardiology.cardiovascular_risk_factors} onChange={(event) => setCardiology((current) => ({ ...current, cardiovascular_risk_factors: event.target.value }))} className="h-10 rounded-xl bg-muted/20" />
                      </Field>
                      <Field label={caseText("Familienanamnese", "Семейный анамнез", "Family history")}>
                        <Input value={cardiology.family_history} onChange={(event) => setCardiology((current) => ({ ...current, family_history: event.target.value }))} className="h-10 rounded-xl bg-muted/20" />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input value={cardiology.red_flags} onChange={(event) => setCardiology((current) => ({ ...current, red_flags: event.target.value }))} className="h-10 rounded-xl bg-muted/20" />
                      </Field>
                    </div>
                    <Field label={caseText("Kardiologische Notizen", "Кардиологические заметки", "Cardiology notes")}>
                      <textarea
                        value={cardiology.notes}
                        onChange={(event) =>
                          setCardiology((current) => ({ ...current, notes: event.target.value }))
                        }
                        className={textareaClassName}
                        rows={4}
                      />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button type="submit" className="h-9 rounded-lg px-3.5" disabled={sectionBusy === "cardiology" || !permissions.canEdit}>
                        {sectionBusy === "cardiology" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {caseText("Kardiologie speichern", "Сохранить кардиологию", "Save cardiology")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title={caseText("Gastroenterologischer Teilbereich", "Гастроэнтерологический блок", "Gastroenterology sub-flow")}
                  description={
                    gastroenterologyTriggered
                      ? caseText(
                          "Fachspezifischer Pfad für gastroenterologische Symptome, Stuhlveränderungen und endoskopische Vorbefunde.",
                          "Специализированный блок для гастроэнтерологических симптомов, изменений стула и данных прежней эндоскопии.",
                          "Specialty branch for gastroenterology-related symptoms, bowel changes and prior endoscopy context.",
                        )
                      : caseText(
                          "Aktivieren, wenn Symptome oder Überweisung auf Gastroenterologie hinweisen.",
                          "Включайте, если симптомы или направление указывают на гастроэнтерологию.",
                          "Enable when symptoms or referral indicate gastroenterology.",
                        )
                  }
                >
                  <form onSubmit={handleSaveGastroenterology} className="space-y-4">
                    {sectionErrors.gastroenterology ? (
                      <Banner tone="error">{sectionErrors.gastroenterology}</Banner>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={gastroenterology.is_relevant}
                          onChange={(event) =>
                            setGastroenterology((current) => ({
                              ...current,
                              is_relevant: event.target.checked,
                            }))
                          }
                        />
                        {caseText("Gastroenterologie relevant", "Показания к гастроэнтерологии", "Gastroenterology relevant")}
                      </label>
                      {[
                        ["abdominal_pain", caseText("Bauchschmerz", "Боль в животе", "Abdominal pain")],
                        ["reflux", caseText("Reflux", "Рефлюкс", "Reflux")],
                        ["nausea", caseText("Übelkeit", "Тошнота", "Nausea")],
                        ["diarrhea", caseText("Durchfall", "Диарея", "Diarrhea")],
                        ["constipation", caseText("Verstopfung", "Запор", "Constipation")],
                        ["gi_bleeding", caseText("GI-Blutung", "ЖКТ-кровотечение", "GI bleeding")],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={Boolean(
                              gastroenterology[key as keyof GastroenterologyAssessment],
                            )}
                            onChange={(event) =>
                              setGastroenterology((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={caseText("Vorherige Endoskopie / Koloskopie", "Предыдущая эндоскопия / колоноскопия", "Prior endoscopy / colonoscopy")}>
                        <Input
                          value={gastroenterology.prior_endoscopy}
                          onChange={(event) =>
                            setGastroenterology((current) => ({
                              ...current,
                              prior_endoscopy: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Veränderungen der Stuhlgewohnheiten", "Изменения стула", "Bowel habit changes")}>
                        <Input
                          value={gastroenterology.bowel_habits}
                          onChange={(event) =>
                            setGastroenterology((current) => ({
                              ...current,
                              bowel_habits: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Leber- / hepatobiliäre Vorgeschichte", "Печёночно-билиарный анамнез", "Liver / hepatobiliary history")}>
                        <Input
                          value={gastroenterology.liver_history}
                          onChange={(event) =>
                            setGastroenterology((current) => ({
                              ...current,
                              liver_history: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Nahrungsmittelunverträglichkeiten / Auslöser", "Пищевая непереносимость / триггеры", "Food intolerance / triggers")}>
                        <Input
                          value={gastroenterology.food_intolerance}
                          onChange={(event) =>
                            setGastroenterology((current) => ({
                              ...current,
                              food_intolerance: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input
                          value={gastroenterology.red_flags}
                          onChange={(event) =>
                            setGastroenterology((current) => ({
                              ...current,
                              red_flags: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                    </div>
                    <Field label={caseText("Gastroenterologische Notizen", "Гастроэнтерологические заметки", "Gastroenterology notes")}>
                      <textarea
                        value={gastroenterology.notes}
                        onChange={(event) =>
                          setGastroenterology((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className={textareaClassName}
                        rows={4}
                      />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button
                        type="submit"
                        className="h-9 rounded-lg px-3.5"
                        disabled={
                          sectionBusy === "gastroenterology" || !permissions.canEdit
                        }
                      >
                        {sectionBusy === "gastroenterology" ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {caseText("Gastroenterologie speichern", "Сохранить гастроэнтерологию", "Save gastroenterology")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title={caseText("Orthopädischer Teilbereich", "Ортопедический блок", "Orthopedics sub-flow")}
                  description={
                    orthopedicsTriggered
                      ? caseText(
                          "Fachspezifischer Pfad für muskuloskelettale Schmerzen, Mobilitätseinschränkungen und traumabezogene Vorgeschichte.",
                          "Специализированный блок для болей опорно-двигательного аппарата, ограничений подвижности и травматологического анамнеза.",
                          "Specialty branch for musculoskeletal pain, mobility issues and trauma-related context.",
                        )
                      : caseText(
                          "Aktivieren, wenn Symptome oder Überweisung auf Orthopädie hinweisen.",
                          "Включайте, если симптомы или направление указывают на ортопедию.",
                          "Enable when symptoms or referral indicate orthopedics.",
                        )
                  }
                >
                  <form onSubmit={handleSaveOrthopedics} className="space-y-4">
                    {sectionErrors.orthopedics ? (
                      <Banner tone="error">{sectionErrors.orthopedics}</Banner>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={orthopedics.is_relevant}
                          onChange={(event) =>
                            setOrthopedics((current) => ({
                              ...current,
                              is_relevant: event.target.checked,
                            }))
                          }
                        />
                        {caseText("Orthopädie relevant", "Показания к ортопедии", "Orthopedics relevant")}
                      </label>
                      {[
                        ["joint_pain", caseText("Gelenkschmerz", "Боль в суставах", "Joint pain")],
                        ["back_pain", caseText("Rücken- / Wirbelsäulenschmerz", "Боль в спине / позвоночнике", "Back / spine pain")],
                        ["mobility_limitation", caseText("Mobilitätseinschränkung", "Ограничение подвижности", "Mobility limitation")],
                        ["trauma_history", caseText("Traumaanamnese", "Травматологический анамнез", "Trauma history")],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={Boolean(orthopedics[key as keyof OrthopedicsAssessment])}
                            onChange={(event) =>
                              setOrthopedics((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={caseText("Vorherige Bildgebung", "Предыдущая визуализация", "Prior imaging")}>
                        <Input
                          value={orthopedics.prior_imaging}
                          onChange={(event) =>
                            setOrthopedics((current) => ({
                              ...current,
                              prior_imaging: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Hilfsmittel / Implantate", "Средства поддержки / импланты", "Assistive devices / implants")}>
                        <Input
                          value={orthopedics.assistive_devices}
                          onChange={(event) =>
                            setOrthopedics((current) => ({
                              ...current,
                              assistive_devices: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Physiotherapie- / Reha-Vorgeschichte", "Физиотерапия / реабилитация в анамнезе", "Physiotherapy / rehab history")}>
                        <Input
                          value={orthopedics.physiotherapy_history}
                          onChange={(event) =>
                            setOrthopedics((current) => ({
                              ...current,
                              physiotherapy_history: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Schmerzauslöser / Belastungsmuster", "Триггеры боли / характер нагрузки", "Pain triggers / load pattern")}>
                        <Input
                          value={orthopedics.pain_triggers}
                          onChange={(event) =>
                            setOrthopedics((current) => ({
                              ...current,
                              pain_triggers: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input
                          value={orthopedics.red_flags}
                          onChange={(event) =>
                            setOrthopedics((current) => ({
                              ...current,
                              red_flags: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                    </div>
                    <Field label={caseText("Orthopädische Notizen", "Ортопедические заметки", "Orthopedics notes")}>
                      <textarea
                        value={orthopedics.notes}
                        onChange={(event) =>
                          setOrthopedics((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className={textareaClassName}
                        rows={4}
                      />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button
                        type="submit"
                        className="h-9 rounded-lg px-3.5"
                        disabled={sectionBusy === "orthopedics" || !permissions.canEdit}
                      >
                        {sectionBusy === "orthopedics" ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {caseText("Orthopädie speichern", "Сохранить ортопедию", "Save orthopedics")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title={caseText("Neurologischer Teilbereich", "Неврологический блок", "Neurology sub-flow")}
                  description={
                    neurologyTriggered
                      ? caseText(
                          "Fachspezifischer Pfad für Kopfschmerzen, Schwindel, neurologische Defizite und frühere neurologische Diagnostik.",
                          "Специализированный блок для головной боли, головокружения, неврологического дефицита и прежней неврологической диагностики.",
                          "Specialty branch for headache, dizziness, neurologic deficits and prior neuro workup.",
                        )
                      : caseText(
                          "Aktivieren, wenn Symptome oder Überweisung auf Neurologie hinweisen.",
                          "Включайте, если симптомы или направление указывают на неврологию.",
                          "Enable when symptoms or referral indicate neurology.",
                        )
                  }
                >
                  <form onSubmit={handleSaveNeurology} className="space-y-4">
                    {sectionErrors.neurology ? (
                      <Banner tone="error">{sectionErrors.neurology}</Banner>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={neurology.is_relevant}
                          onChange={(event) =>
                            setNeurology((current) => ({
                              ...current,
                              is_relevant: event.target.checked,
                            }))
                          }
                        />
                        {caseText("Neurologie relevant", "Показания к неврологии", "Neurology relevant")}
                      </label>
                      {[
                        ["headache", caseText("Kopfschmerz", "Головная боль", "Headache")],
                        ["dizziness", caseText("Schwindel / Vertigo", "Головокружение / вертиго", "Dizziness / vertigo")],
                        ["sensory_changes", caseText("Sensibilitätsveränderungen", "Нарушения чувствительности", "Sensory changes")],
                        ["weakness", caseText("Schwäche", "Слабость", "Weakness")],
                        ["seizure_history", caseText("Krampfanamnese", "Судорожный анамнез", "Seizure history")],
                        ["gait_balance_issues", caseText("Gang- / Gleichgewichtsstörung", "Нарушение походки / равновесия", "Gait / balance issues")],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={Boolean(neurology[key as keyof NeurologyAssessment])}
                            onChange={(event) =>
                              setNeurology((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={caseText("Vorherige neuroradiologische Bildgebung", "Предыдущая нейровизуализация", "Prior neuro imaging")}>
                        <Input
                          value={neurology.prior_neuro_imaging}
                          onChange={(event) =>
                            setNeurology((current) => ({
                              ...current,
                              prior_neuro_imaging: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Frühere neurologische Diagnostik", "Предыдущее неврологическое обследование", "Prior neurology workup")}>
                        <Input
                          value={neurology.prior_neurology_workup}
                          onChange={(event) =>
                            setNeurology((current) => ({
                              ...current,
                              prior_neurology_workup: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Kognitive / sprachliche Veränderungen", "Когнитивные / речевые изменения", "Cognitive / speech changes")}>
                        <Input
                          value={neurology.cognitive_changes}
                          onChange={(event) =>
                            setNeurology((current) => ({
                              ...current,
                              cognitive_changes: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input
                          value={neurology.red_flags}
                          onChange={(event) =>
                            setNeurology((current) => ({
                              ...current,
                              red_flags: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                    </div>
                    <Field label={caseText("Neurologische Notizen", "Неврологические заметки", "Neurology notes")}>
                      <textarea
                        value={neurology.notes}
                        onChange={(event) =>
                          setNeurology((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className={textareaClassName}
                        rows={4}
                      />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button
                        type="submit"
                        className="h-9 rounded-lg px-3.5"
                        disabled={sectionBusy === "neurology" || !permissions.canEdit}
                      >
                        {sectionBusy === "neurology" ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {caseText("Neurologie speichern", "Сохранить неврологию", "Save neurology")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title={caseText("Pneumologischer Teilbereich", "Пульмонологический блок", "Pulmonology sub-flow")}
                  description={
                    pulmonologyTriggered
                      ? caseText(
                          "Fachspezifischer Pfad für respiratorische Symptome, chronischen Husten und frühere Thoraxdiagnostik.",
                          "Специализированный блок для респираторных симптомов, хронического кашля и прежней диагностики грудной клетки.",
                          "Specialty branch for respiratory symptoms, chronic cough and prior chest workup.",
                        )
                      : caseText(
                          "Aktivieren, wenn Symptome oder Überweisung auf Pneumologie hinweisen.",
                          "Включайте, если симптомы или направление указывают на пульмонологию.",
                          "Enable when symptoms or referral indicate pulmonology.",
                        )
                  }
                >
                  <form onSubmit={handleSavePulmonology} className="space-y-4">
                    {sectionErrors.pulmonology ? (
                      <Banner tone="error">{sectionErrors.pulmonology}</Banner>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={pulmonology.is_relevant}
                          onChange={(event) =>
                            setPulmonology((current) => ({
                              ...current,
                              is_relevant: event.target.checked,
                            }))
                          }
                        />
                        {caseText("Pneumologie relevant", "Показания к пульмонологии", "Pulmonology relevant")}
                      </label>
                      {[
                        ["chronic_cough", caseText("Chronischer Husten", "Хронический кашель", "Chronic cough")],
                        ["dyspnea", caseText("Dyspnoe / Kurzatmigkeit", "Одышка / нехватка воздуха", "Dyspnea / shortness of breath")],
                        ["wheezing", caseText("Giemen", "Свистящее дыхание", "Wheezing")],
                        ["chest_tightness", caseText("Brustenge", "Стеснение в груди", "Chest tightness")],
                        ["hemoptysis", caseText("Hämoptyse", "Кровохарканье", "Hemoptysis")],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={Boolean(pulmonology[key as keyof PulmonologyAssessment])}
                            onChange={(event) =>
                              setPulmonology((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={caseText("Raucheranamnese / Pack Years", "Курительный анамнез / пачка-лет", "Smoking history / pack years")}>
                        <Input
                          value={pulmonology.smoking_history}
                          onChange={(event) =>
                            setPulmonology((current) => ({
                              ...current,
                              smoking_history: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Vorherige Thoraxbildgebung", "Предыдущая визуализация грудной клетки", "Prior chest imaging")}>
                        <Input
                          value={pulmonology.prior_chest_imaging}
                          onChange={(event) =>
                            setPulmonology((current) => ({
                              ...current,
                              prior_chest_imaging: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Inhalation / Atemtherapie", "Ингаляторы / респираторная терапия", "Inhaler / respiratory therapy")}>
                        <Input
                          value={pulmonology.inhaler_therapy}
                          onChange={(event) =>
                            setPulmonology((current) => ({
                              ...current,
                              inhaler_therapy: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Schlafapnoe- / CPAP-Anamnese", "Анамнез апноэ сна / CPAP", "Sleep apnea / CPAP history")}>
                        <Input
                          value={pulmonology.sleep_apnea_history}
                          onChange={(event) =>
                            setPulmonology((current) => ({
                              ...current,
                              sleep_apnea_history: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input
                          value={pulmonology.red_flags}
                          onChange={(event) =>
                            setPulmonology((current) => ({
                              ...current,
                              red_flags: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                    </div>
                    <Field label={caseText("Pneumologische Notizen", "Пульмонологические заметки", "Pulmonology notes")}>
                      <textarea
                        value={pulmonology.notes}
                        onChange={(event) =>
                          setPulmonology((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className={textareaClassName}
                        rows={4}
                      />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button
                        type="submit"
                        className="h-9 rounded-lg px-3.5"
                        disabled={sectionBusy === "pulmonology" || !permissions.canEdit}
                      >
                        {sectionBusy === "pulmonology" ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {caseText("Pneumologie speichern", "Сохранить пульмонологию", "Save pulmonology")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title={caseText("Urologischer Teilbereich", "Урологический блок", "Urology sub-flow")}
                  description={
                    urologyTriggered
                      ? caseText(
                          "Fachspezifischer Pfad für urologische Symptome, Harnverhalt und frühere urologische Diagnostik.",
                          "Специализированный блок для урологических симптомов, задержки мочи и предыдущего урологического обследования.",
                          "Specialty branch for urinary symptoms, retention and prior urology workup.",
                        )
                      : caseText(
                          "Aktivieren, wenn Symptome oder Überweisung auf Urologie hinweisen.",
                          "Включайте, если симптомы или направление указывают на урологию.",
                          "Enable when symptoms or referral indicate urology.",
                        )
                  }
                >
                  <form onSubmit={handleSaveUrology} className="space-y-4">
                    {sectionErrors.urology ? (
                      <Banner tone="error">{sectionErrors.urology}</Banner>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={urology.is_relevant}
                          onChange={(event) =>
                            setUrology((current) => ({
                              ...current,
                              is_relevant: event.target.checked,
                            }))
                          }
                        />
                        {caseText("Urologie relevant", "Показания к урологии", "Urology relevant")}
                      </label>
                      {[
                        ["dysuria", caseText("Dysurie / Brennen", "Дизурия / жжение", "Dysuria / burning")],
                        ["hematuria", caseText("Hämaturie", "Гематурия", "Hematuria")],
                        ["flank_pain", caseText("Flankenschmerz", "Боль в боку", "Flank pain")],
                        ["urinary_frequency", caseText("Häufiges Wasserlassen", "Частое мочеиспускание", "Urinary frequency")],
                        ["urinary_retention", caseText("Harnverhalt", "Задержка мочи", "Urinary retention")],
                        ["incontinence", caseText("Inkontinenz", "Недержание", "Incontinence")],
                      ].map(([key, label]) => (
                        <label
                          key={key}
                          className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-4 py-3 text-sm text-foreground"
                        >
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={Boolean(urology[key as keyof UrologyAssessment])}
                            onChange={(event) =>
                              setUrology((current) => ({
                                ...current,
                                [key]: event.target.checked,
                              }))
                            }
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={caseText("Frühere urologische Diagnostik", "Предыдущее урологическое обследование", "Prior urology workup")}>
                        <Input
                          value={urology.prior_urology_workup}
                          onChange={(event) =>
                            setUrology((current) => ({
                              ...current,
                              prior_urology_workup: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Katheter- / Instrumentationsanamnese", "Катетеризация / инструментальные вмешательства в анамнезе", "Catheter / instrumentation history")}>
                        <Input
                          value={urology.catheter_history}
                          onChange={(event) =>
                            setUrology((current) => ({
                              ...current,
                              catheter_history: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Stein- / Nierenkolikanamnese", "Анамнез камней / почечной колики", "Stone / renal colic history")}>
                        <Input
                          value={urology.stone_history}
                          onChange={(event) =>
                            setUrology((current) => ({
                              ...current,
                              stone_history: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input
                          value={urology.red_flags}
                          onChange={(event) =>
                            setUrology((current) => ({
                              ...current,
                              red_flags: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-muted/20"
                        />
                      </Field>
                    </div>
                    <Field label={caseText("Urologische Notizen", "Урологические заметки", "Urology notes")}>
                      <textarea
                        value={urology.notes}
                        onChange={(event) =>
                          setUrology((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        className={textareaClassName}
                        rows={4}
                      />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button
                        type="submit"
                        className="h-9 rounded-lg px-3.5"
                        disabled={sectionBusy === "urology" || !permissions.canEdit}
                      >
                        {sectionBusy === "urology" ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : null}
                        {caseText("Urologie speichern", "Сохранить урологию", "Save urology")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel title={t.cases_vegetative} description={t.cases_subtitle}>
                  <form onSubmit={handleSaveVegetative} className="space-y-4">
                    {sectionErrors.vegetative ? <Banner tone="error">{sectionErrors.vegetative}</Banner> : null}
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      <Field label={t.cases_symptoms}><Input value={vegetative.appetit_durst} onChange={(event) => setVegetative((current) => ({ ...current, appetit_durst: event.target.value }))} className="h-10 rounded-xl bg-muted/20" /></Field>
                      <Field label={t.cases_symptoms}><Input value={vegetative.koerpergroesse} onChange={(event) => setVegetative((current) => ({ ...current, koerpergroesse: event.target.value }))} className="h-10 rounded-xl bg-muted/20" /></Field>
                      <Field label={t.cases_symptoms}><Input value={vegetative.gewicht} onChange={(event) => setVegetative((current) => ({ ...current, gewicht: event.target.value }))} className="h-10 rounded-xl bg-muted/20" /></Field>
                      <Field label={t.cases_symptoms}><Input value={vegetative.gewichtsveraenderung} onChange={(event) => setVegetative((current) => ({ ...current, gewichtsveraenderung: event.target.value }))} className="h-10 rounded-xl bg-muted/20" /></Field>
                      <Field label={t.cases_reason}><Input value={vegetative.grund} onChange={(event) => setVegetative((current) => ({ ...current, grund: event.target.value }))} className="h-10 rounded-xl bg-muted/20" /></Field>
                    </div>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button type="submit" className="h-9 rounded-lg px-3.5" disabled={sectionBusy === "vegetative" || !permissions.canEdit}>
                        {sectionBusy === "vegetative" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {caseText("Vegetative Anamnese speichern", "Сохранить вегетативный анамнез", "Save vegetative")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel title={t.cases_vaccination} description={t.cases_subtitle}>
                  <form onSubmit={handleSaveImpfstatus} className="space-y-4">
                    {sectionErrors.impfstatus ? <Banner tone="error">{sectionErrors.impfstatus}</Banner> : null}
                    <Field label={t.cases_status}>
                      <textarea value={impfstatus} onChange={(event) => setImpfstatus(event.target.value)} className={textareaClassName} rows={3} />
                    </Field>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button type="submit" className="h-9 rounded-lg px-3.5" disabled={sectionBusy === "impfstatus" || !permissions.canEdit}>
                        {sectionBusy === "impfstatus" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {caseText("Impfstatus speichern", "Сохранить вакцинацию", "Save vaccination")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title={caseText("Klinische Historie", "Клиническая история", "Clinical history")}
                  description={caseText(
                    "Append-only-Abschnittshistorie mit Aufbewahrungsmetadaten für Audit und Prüfung.",
                    "История разделов без перезаписи с метаданными хранения для аудита и проверки.",
                    "Append-only section history with retention metadata for audit and review.",
                  )}
                >
                  {detail.history?.length ? (
                    <div className="space-y-3">
                      {detail.history.map((entry) => (
                        <article
                          key={entry.id}
                          className="rounded-xl border border-border bg-muted/20 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-foreground">
                                {historySectionLabel(entry.section)}
                              </h4>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {entry.changed_by_name} · {entry.changed_by_role} ·{" "}
                                {formatDateTime(entry.created_at)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full border-border bg-background text-foreground"
                            >
                              #{entry.id}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-border bg-white p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {caseText("Vorher", "Было", "Previous")}
                              </div>
                              <p className="mt-2 break-words font-mono text-xs text-foreground">
                                {historyValuePreview(entry.old_value)}
                              </p>
                            </div>
                            <div className="rounded-xl border border-border bg-white p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                                {caseText("Neu", "Стало", "New")}
                              </div>
                              <p className="mt-2 break-words font-mono text-xs text-foreground">
                                {historyValuePreview(entry.new_value)}
                              </p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyPanel
                      title={caseText("Noch keine klinischen Revisionen", "Клинических ревизий пока нет", "No clinical revisions yet")}
                      text={caseText(
                        "Für diesen Fall liegt derzeit noch keine persistierte Abschnittshistorie vor.",
                        "Для этого кейса пока нет сохранённой истории разделов.",
                        "The case has no persisted section history at the moment.",
                      )}
                    />
                  )}
                </Panel>
              </>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-muted-foreground">
                {caseText("Wählen Sie einen Fall aus der Liste aus.", "Выберите кейс из списка.", "Select a case from the roster.")}
              </div>
            )}
          </AdminSheetScaffold>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function CasesPage(...args: Parameters<typeof useCasesPageContent>) {
  return useCasesPageContent(...args);
}

function MetricCard({ label, value, description, icon }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
          {label}
        </span>
        <span className="rounded-lg bg-muted p-2 text-muted-foreground">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function Panel({ title, description, action, children, className, accent = true, tone = "default" }: PanelProps) {
  const toneClass =
    tone === "clinical"
      ? "border-amber-200/70 bg-amber-50/40"
      : tone === "subtle"
        ? "bg-muted/20"
        : "";
  return (
    <section className={cardClass(cn("p-6", toneClass, className))}>
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {accent ? (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-primary/70"
              />
            ) : null}
            <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
              {title}
            </h3>
          </div>
          {description ? (
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </header>
      <div className="mt-5 border-t border-border pt-5">{children}</div>
    </section>
  );
}

function Field({ label, children, hint }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
      </label>
      {children}
      {hint ? (
        <span className="text-xs leading-snug text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function Banner({ tone, children }: BannerProps) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3 text-sm",
        tone === "error"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-emerald-200 bg-emerald-50 text-emerald-700",
      )}
    >
      {children}
    </div>
  );
}

function EmptyPanel({ title, text, action }: EmptyPanelProps) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-8 text-center">
      <div className="mx-auto max-w-md">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

function ItemEditorSection({
  title,
  description,
  count,
  addLabel,
  emptyTitle,
  emptyText,
  busy,
  error,
  canEdit,
  onAdd,
  onSave,
  children,
}: ItemEditorSectionProps) {
  const hasContent = Array.isArray(children) ? children.length > 0 : Boolean(children);
  const populated = count > 0;
  const itemsLabel = caseText("Einträge", "записей", "items");
  return (
    <Panel
      title={title}
      description={description}
      action={
        <>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
              populated
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-muted/30 text-muted-foreground",
            )}
          >
            {populated ? (
              <span aria-hidden className="size-1.5 rounded-full bg-primary/70" />
            ) : null}
            {count} {itemsLabel}
          </span>
          {canEdit ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={onAdd}
            >
              <Plus className="size-4" />
              {addLabel}
            </Button>
          ) : null}
        </>
      }
    >
      <form onSubmit={onSave} className="space-y-4">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!hasContent ? <EmptyPanel title={emptyTitle} text={emptyText} /> : children}
        <div className="flex justify-end border-t border-border pt-4">
          <Button
            type="submit"
            className="h-9 rounded-lg px-3.5"
            disabled={busy || !canEdit}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {caseText("Abschnitt speichern", "Сохранить раздел", "Save section")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
