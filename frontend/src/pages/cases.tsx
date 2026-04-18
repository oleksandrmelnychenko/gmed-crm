import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  getLang,
  t as translateCatalog,
  type Translations,
  useLang,
} from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import {
  CASE_TEXT_SNIPPET_PLACEHOLDERS,
  appendSnippetToNarrative,
  renderCaseTextSnippet,
} from "./cases.snippets";

type CaseStatus = "open" | "in_progress" | "closed";

type CaseItem = {
  id: string;
  case_uuid?: string;
  case_id: string;
  patient_id: string;
  patient_name: string;
  patient_pid: string;
  status: CaseStatus | string;
  hauptanfragegrund: string | null;
  created_at: string;
};

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
};

type FieldProps = {
  label: string;
  children: ReactNode;
};

type BannerProps = {
  tone: "error" | "success";
  children: ReactNode;
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

const textareaClassName =
  "min-h-[104px] w-full rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";
const nativeSelectClassName =
  "h-10 w-full rounded-xl border border-input bg-card px-3 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30";

function casePermissions(role?: string): CasePermissions {
  return {
    canViewPage: role === "ceo" || role === "patient_manager",
    canCreate: role === "ceo" || role === "patient_manager",
    canEdit: role === "ceo" || role === "patient_manager",
  };
}

function cardClass(className?: string) {
  return cn(
    "rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.05)]",
    className,
  );
}

function caseStatusLabel(
  status: string,
  tr: {
    cases_open: string;
    cases_in_progress: string;
    cases_closed: string;
  }
) {
  switch (status) {
    case "open": return tr.cases_open;
    case "in_progress": return tr.cases_in_progress;
    case "closed": return tr.cases_closed;
    default: return status;
  }
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "open":
      return "border-sky-200 bg-sky-100 text-sky-700";
    case "in_progress":
      return "border-amber-200 bg-amber-100 text-amber-700";
    case "closed":
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
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

function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || caseText("Patient", "Пациент", "Patient")} (${patient.patient_id})`;
}

function doctorOptionLabel(doctor: DoctorOption) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialty = doctor.fachbereich?.trim() ? ` · ${doctor.fachbereich.trim()}` : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(runtimeLocale(), { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(runtimeLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function historyValuePreview(value: unknown) {
  if (value == null) return caseText("leer", "пусто", "empty");
  if (typeof value === "string") return value || caseText("leer", "пусто", "empty");
  const serialized = JSON.stringify(value);
  if (!serialized) return caseText("leer", "пусто", "empty");
  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

function historySectionLabel(section: string) {
  switch (section) {
    case "overview":
      return caseText("Übersicht", "Обзор", "Overview");
    case "vorerkrankungen":
      return caseText("Vorerkrankungen", "Сопутствующие заболевания", "Preconditions");
    case "allergien":
      return caseText("Allergien", "Аллергии", "Allergies");
    case "operationen":
      return caseText("Operationen", "Операции", "Operations");
    case "medikamente":
      return caseText("Medikation", "Медикаменты", "Medication");
    case "pain_records":
      return caseText("Schmerzdokumentation", "Записи о боли", "Pain records");
    case "symptome":
      return caseText("Symptome", "Симптомы", "Symptoms");
    case "cardiology":
      return caseText("Kardiologie", "Кардиология", "Cardiology");
    case "gastroenterology":
      return caseText("Gastroenterologie", "Гастроэнтерология", "Gastroenterology");
    case "orthopedics":
      return caseText("Orthopädie", "Ортопедия", "Orthopedics");
    case "neurology":
      return caseText("Neurologie", "Неврология", "Neurology");
    case "pulmonology":
      return caseText("Pneumologie", "Пульмонология", "Pulmonology");
    case "urology":
      return caseText("Urologie", "Урология", "Urology");
    case "vegetative":
      return caseText("Vegetative Anamnese", "Вегетативный анамнез", "Vegetative");
    case "impfstatus":
      return caseText("Impfstatus", "Вакцинация", "Vaccination");
    default:
      return section;
  }
}

function textValue(value: string | null | undefined) {
  return value?.trim() ? value : runtimeTranslations().common_not_set;
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
  return items
    .filter((item) => item.erkrankung.trim())
    .map((item) => ({
      erkrankung: item.erkrankung.trim(),
      erstdiagnose: toOptionalText(item.erstdiagnose ?? ""),
      notiz: toOptionalText(item.notiz ?? ""),
    }));
}

function sanitizeAllergien(items: AllergieItem[]) {
  return items
    .filter((item) => item.allergie.trim())
    .map((item) => ({
      allergie: item.allergie.trim(),
      reaktion: toOptionalText(item.reaktion ?? ""),
    }));
}

function sanitizeOperationen(items: OperationItem[]) {
  return items
    .filter((item) => item.grund.trim())
    .map((item) => ({
      datum: toOptionalText(item.datum ?? ""),
      grund: item.grund.trim(),
      arzt_id: toOptionalText(item.arzt_id ?? ""),
      arzt: toOptionalText(item.arzt ?? ""),
      notiz: toOptionalText(item.notiz ?? ""),
    }));
}

function sanitizeMedikamente(items: MedikamentItem[]) {
  return items
    .filter((item) => item.handelsname.trim())
    .map((item) => ({
      handelsname: item.handelsname.trim(),
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
    }));
}

function sanitizePainRecords(items: PainItem[]) {
  return items
    .filter((item) => item.lokalisierung.trim())
    .map((item) => ({
      lokalisierung: item.lokalisierung.trim(),
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
    }));
}

function sanitizeSymptome(items: SymptomItem[]) {
  return items
    .filter((item) => item.beschreibung.trim())
    .map((item) => ({
      beschreibung: item.beschreibung.trim(),
      fachrichtung: toOptionalText(item.fachrichtung ?? ""),
    }));
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

export function CasesPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const { staffGo } = useStaffNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const permissions = useMemo(() => casePermissions(user?.role), [user?.role]);

  const [filters, setFilters] = useState<CaseFilters>(DEFAULT_FILTERS);
  const deferredSearch = useDeferredValue(filters.search);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const [listError, setListError] = useState("");
  const [listVersion, setListVersion] = useState(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [createForm, setCreateForm] = useState<CaseCreateFormState>(DEFAULT_CREATE_FORM);

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailVersion, setDetailVersion] = useState(0);

  const [overviewForm, setOverviewForm] =
    useState<CaseOverviewFormState>(DEFAULT_OVERVIEW_FORM);
  const [vorerkrankungen, setVorerkrankungen] = useState<VorerkrankungItem[]>([]);
  const [allergien, setAllergien] = useState<AllergieItem[]>([]);
  const [operationen, setOperationen] = useState<OperationItem[]>([]);
  const [medikamente, setMedikamente] = useState<MedikamentItem[]>([]);
  const [painRecords, setPainRecords] = useState<PainItem[]>([]);
  const [symptome, setSymptome] = useState<SymptomItem[]>([]);
  const [cardiology, setCardiology] = useState<CardiologyAssessment>(blankCardiology());
  const [gastroenterology, setGastroenterology] = useState<GastroenterologyAssessment>(
    blankGastroenterology(),
  );
  const [orthopedics, setOrthopedics] = useState<OrthopedicsAssessment>(
    blankOrthopedics(),
  );
  const [neurology, setNeurology] = useState<NeurologyAssessment>(blankNeurology());
  const [pulmonology, setPulmonology] = useState<PulmonologyAssessment>(
    blankPulmonology(),
  );
  const [urology, setUrology] = useState<UrologyAssessment>(blankUrology());
  const [vegetative, setVegetative] = useState<VegetativeState>(blankVegetative());
  const [impfstatus, setImpfstatus] = useState("");
  const [sectionBusy, setSectionBusy] = useState<SectionStatusKey | "">("");
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [snippets, setSnippets] = useState<CaseTextSnippet[]>([]);
  const [snippetsBusy, setSnippetsBusy] = useState(false);
  const [snippetsError, setSnippetsError] = useState("");
  const [snippetVersion, setSnippetVersion] = useState(0);
  const [snippetDialogOpen, setSnippetDialogOpen] = useState(false);
  const [snippetSaveBusy, setSnippetSaveBusy] = useState(false);
  const [snippetSaveError, setSnippetSaveError] = useState("");
  const [snippetForm, setSnippetForm] = useState<CaseTextSnippetFormState>(
    DEFAULT_CASE_TEXT_SNIPPET_FORM,
  );

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

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;

    void Promise.all([
      apiFetch<PatientOption[]>("/patients").catch(() => []),
      apiFetch<DoctorOption[]>("/cases/meta/doctors").catch(() => []),
    ]).then(([patientItems, doctorItems]) => {
      if (!cancelled) {
        startTransition(() => {
          setPatients(patientItems);
          setDoctors(doctorItems);
        });
      }
    }).catch(() => {
      if (!cancelled) {
        startTransition(() => {
          setPatients([]);
          setDoctors([]);
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    setSnippetsBusy(true);
    setSnippetsError("");

    void apiFetch<CaseTextSnippet[]>("/cases/text-snippets")
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setSnippets(items));
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
          setSnippetsBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [permissions.canViewPage, snippetVersion]);

  useEffect(() => {
    const patientParam = searchParams.get("patient") ?? "";
    const caseParam = searchParams.get("case") ?? "";
    const createParam = searchParams.get("create") ?? "";

    if (patientParam !== filters.patientId) {
      setFilters((current) => ({ ...current, patientId: patientParam }));
    }

    if (caseParam && caseParam !== selectedId) {
      setSelectedId(caseParam);
      setDetailOpen(true);
    }

    if (createParam && permissions.canCreate) {
      setCreateError("");
      setCreateForm({
        ...DEFAULT_CREATE_FORM,
        patientId: patientParam,
      });
      setCreateOpen(true);
      const params = new URLSearchParams(searchParams);
      params.delete("create");
      setSearchParams(params, { replace: true });
    }
  }, [filters.patientId, permissions.canCreate, searchParams, selectedId, setSearchParams]);

  useEffect(() => {
    if (!permissions.canViewPage) return;
    let cancelled = false;
    setListBusy(true);
    setListError("");

    void apiFetch<CaseItem[]>(casesPath)
      .then((items) => {
        if (!cancelled) {
          startTransition(() => setCases(items));
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
          setListBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [casesPath, permissions.canViewPage, listVersion]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;
    let cancelled = false;
    setDetailBusy(true);
    setDetailError("");

    void apiFetch<CaseDetail>(`/cases/${selectedId}`)
      .then((item) => {
        if (cancelled) return;
        startTransition(() => {
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
          setDetailBusy(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [detailOpen, detailVersion, selectedId]);

  function refreshList() {
    setListVersion((current) => current + 1);
  }

  function refreshDetail() {
    setDetailVersion((current) => current + 1);
  }

  function updateQuery(next: Record<string, string | null>) {
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
    setSelectedId(caseId);
    setDetailOpen(true);
    updateQuery({ case: caseId });
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
      const created = await apiFetch<{ id: string }>("/cases", {
        method: "POST",
          body: JSON.stringify({
            patient_id: createForm.patientId,
            hauptanfragegrund: toOptionalText(createForm.hauptanfragegrund),
            aktuelle_anamnese: toOptionalText(createForm.aktuelleAnamnese),
            zuweiser_doctor_id: toOptionalText(createForm.zuweiserDoctorId),
            zuweiser: toOptionalText(createForm.zuweiser),
          }),
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
      const path = snippetForm.id
        ? `/cases/text-snippets/${snippetForm.id}/update`
        : "/cases/text-snippets";
      await apiFetch(path, {
        method: "POST",
        body: JSON.stringify({
          label: snippetForm.label,
          category: toOptionalText(snippetForm.category) ?? "general",
          body: snippetForm.body,
          is_active: snippetForm.is_active,
        }),
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
        apiFetch(`/cases/${detail.id}/anamnesis`, {
          method: "POST",
          body: JSON.stringify({
            hauptanfragegrund: toOptionalText(overviewForm.hauptanfragegrund),
            aktuelle_anamnese: toOptionalText(overviewForm.aktuelle_anamnese),
            zuweiser_doctor_id: toOptionalText(overviewForm.zuweiser_doctor_id),
            zuweiser: toOptionalText(overviewForm.zuweiser),
          }),
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
        apiFetch(`/cases/${detail.id}/vorerkrankungen`, {
          method: "POST",
          body: JSON.stringify({ items: sanitizeVorerkrankungen(vorerkrankungen) }),
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
        apiFetch(`/cases/${detail.id}/allergien`, {
          method: "POST",
          body: JSON.stringify({ items: sanitizeAllergien(allergien) }),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveOperationen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "operationen",
      () =>
        apiFetch(`/cases/${detail.id}/operationen`, {
          method: "POST",
          body: JSON.stringify({ items: sanitizeOperationen(operationen) }),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveMedikamente(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "medikamente",
      () =>
        apiFetch(`/cases/${detail.id}/medikamente`, {
          method: "POST",
          body: JSON.stringify({ items: sanitizeMedikamente(medikamente) }),
        }),
      t.common_failed_update,
    );
  }

  async function handleConfirmMedicationExpiry(medicationId: string) {
    if (!detail) return;
    await runSectionSave(
      "medikamente",
      () =>
        apiFetch(`/cases/${detail.id}/medikamente/${medicationId}/expiry-confirm`, {
          method: "POST",
        }),
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
        apiFetch(`/cases/${detail.id}/pain`, {
          method: "POST",
          body: JSON.stringify({ items: sanitizePainRecords(painRecords) }),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveSymptome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "symptome",
      () =>
        apiFetch(`/cases/${detail.id}/symptome`, {
          method: "POST",
          body: JSON.stringify({ items: sanitizeSymptome(symptome) }),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveCardiology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "cardiology",
      () =>
        apiFetch(`/cases/${detail.id}/cardiology`, {
          method: "POST",
          body: JSON.stringify(cardiologyToPayload(cardiology)),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveGastroenterology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "gastroenterology",
      () =>
        apiFetch(`/cases/${detail.id}/gastroenterology`, {
          method: "POST",
          body: JSON.stringify(gastroenterologyToPayload(gastroenterology)),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveOrthopedics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "orthopedics",
      () =>
        apiFetch(`/cases/${detail.id}/orthopedics`, {
          method: "POST",
          body: JSON.stringify(orthopedicsToPayload(orthopedics)),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveNeurology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "neurology",
      () =>
        apiFetch(`/cases/${detail.id}/neurology`, {
          method: "POST",
          body: JSON.stringify(neurologyToPayload(neurology)),
        }),
      t.common_failed_update,
    );
  }

  async function handleSavePulmonology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "pulmonology",
      () =>
        apiFetch(`/cases/${detail.id}/pulmonology`, {
          method: "POST",
          body: JSON.stringify(pulmonologyToPayload(pulmonology)),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveUrology(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "urology",
      () =>
        apiFetch(`/cases/${detail.id}/urology`, {
          method: "POST",
          body: JSON.stringify(urologyToPayload(urology)),
        }),
      t.common_failed_update,
    );
  }

  async function handleSaveVegetative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    await runSectionSave(
      "vegetative",
      () =>
        apiFetch(`/cases/${detail.id}/vegetative`, {
          method: "POST",
          body: JSON.stringify({
            appetit_durst: toOptionalText(vegetative.appetit_durst),
            koerpergroesse: numericInputToValue(vegetative.koerpergroesse),
            gewicht: numericInputToValue(vegetative.gewicht),
            gewichtsveraenderung: toOptionalText(vegetative.gewichtsveraenderung),
            grund: toOptionalText(vegetative.grund),
          }),
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
        apiFetch(`/cases/${detail.id}/impfstatus`, {
          method: "POST",
          body: JSON.stringify({ status_text: toOptionalText(impfstatus) }),
        }),
      t.common_failed_update,
    );
  }

  if (!permissions.canViewPage) {
    return (
      <div className="space-y-6">
        <section className={cardClass("p-8")}>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            {caseText("Fallbereich", "Рабочее пространство кейсов", "Case workspace")}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
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
      <div className="space-y-6">
        <section className="rounded-[2rem] border border-white/70 bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.28),_transparent_38%),linear-gradient(135deg,rgba(255,255,255,0.98),rgba(241,245,249,0.92))] p-6 shadow-[0_32px_80px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="rounded-full border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700"
                >
                  {caseText("Fälle", "Кейсы", "Cases")}
                </Badge>
                <Badge
                  variant="outline"
                  className="rounded-full border-slate-200 bg-white/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600"
                >
                  {t.cases_subtitle}
                </Badge>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">
                {t.cases_subtitle}
              </h1>
              <p className="mt-3 text-sm leading-7 text-slate-600 md:text-[15px]">
                {t.cases_subtitle}
                
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={refreshList}>
                <RefreshCw className="size-4" />
                {caseText("Aktualisieren", "Обновить", "Refresh")}
              </Button>
              {permissions.canCreate ? (
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
                  {t.cases_title}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={t.cases_title}
              value={metrics.total.toString()}
              description={t.cases_subtitle}
              icon={<ClipboardList className="size-4" />}
            />
            <MetricCard
              label={t.cases_open}
              value={metrics.open.toString()}
              description={t.cases_subtitle}
              icon={<Plus className="size-4" />}
            />
            <MetricCard
              label={t.cases_in_progress}
              value={metrics.inProgress.toString()}
              description={t.cases_subtitle}
              icon={<Stethoscope className="size-4" />}
            />
            <MetricCard
              label={t.cases_closed}
              value={metrics.closed.toString()}
              description={t.cases_subtitle}
              icon={<CalendarClock className="size-4" />}
            />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.common_search}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.cases_subtitle}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => {
                  setFilters(DEFAULT_FILTERS);
                  updateQuery({ patient: null, case: null });
                }}
              >
                {caseText("Zurücksetzen", "Сбросить", "Reset")}
              </Button>
            </div>

            <div className="mt-5 space-y-4">
              <Field label={t.common_search}>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-3 left-3 size-4 text-slate-400" />
                  <Input
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, search: event.target.value }))
                    }
                    placeholder={t.search_placeholder}
                    className="h-10 rounded-xl bg-slate-50 pl-9"
                  />
                </div>
              </Field>

              <Field label={t.users_status}>
                <ShadSelect value={filters.status} onValueChange={(v) => setFilters((current) => ({ ...current, status: v ?? "" }))}>
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue placeholder={t.providers_all} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t.providers_all}</SelectItem>
                    {CASE_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>{caseStatusLabel(status, t)}</SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </Field>

              <Field label={t.orders_patient}>
                <ShadSelect value={filters.patientId} onValueChange={(v) => {
                  const patientId = v ?? "";
                  setFilters((current) => ({ ...current, patientId }));
                  updateQuery({ patient: patientId || null });
                }}>
                  <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                    <SelectValue>
                      {filters.patientId
                        ? patientLabel(patients.find((p) => p.id === filters.patientId) ?? { id: "", patient_id: "", first_name: "", last_name: "" })
                        : t.providers_all}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{t.providers_all}</SelectItem>
                    {patients.map((patient) => (
                      <SelectItem key={patient.id} value={patient.id}>{patientLabel(patient)}</SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
              </Field>
            </div>
          </section>

          <section className={cardClass("p-5")}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.cases_roster}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  {t.cases_subtitle}
                </p>
              </div>
              <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
                {listBusy ? t.patients_syncing : `${cases.length} ${t.patients_records}`}
              </div>
            </div>

            {listError ? (
              <div className="mt-5">
                <Banner tone="error">{listError}</Banner>
              </div>
            ) : null}

            {listBusy ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                {t.common_loading}
              </div>
            ) : cases.length === 0 ? (
              <div className="mt-5">
                <EmptyPanel
                  title={t.cases_no_match}
                  text={t.cases_no_match}
                  action={
                    permissions.canCreate ? (
                      <Button
                        type="button"
                        className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                        onClick={() => setCreateOpen(true)}
                      >
                        <Plus className="size-4" />
                        {t.cases_title}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {cases.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => openCase(item.id)}
                    className="rounded-[1.6rem] border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-xs font-semibold tracking-[0.16em] text-slate-500">
                          {item.case_id}
                        </div>
                        <h3 className="mt-2 text-lg font-semibold text-slate-950">
                          {item.patient_name}
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">{item.patient_pid}</p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn("rounded-full", statusBadgeClass(item.status))}
                      >
                        {caseStatusLabel(item.status, t)}
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {t.cases_reason}
                        </div>
                        <div className="mt-2 text-sm text-slate-900">
                          {textValue(item.hauptanfragegrund)}
                        </div>
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                          {t.users_created}
                        </div>
                        <div className="mt-2 text-sm text-slate-900">
                          {formatDate(item.created_at)}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t.cases_new}</DialogTitle>
            <DialogDescription>
              {t.cases_subtitle}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCase} className="space-y-4">
            {createError ? <Banner tone="error">{createError}</Banner> : null}
            <Field label={t.cases_patient}>
              <ShadSelect value={createForm.patientId} onValueChange={(v) => setCreateForm((current) => ({ ...current, patientId: v ?? "" }))}>
                <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50">
                  <SelectValue placeholder={t.cases_patient} />
                </SelectTrigger>
                <SelectContent>
                  {patients.map((patient) => (
                    <SelectItem key={patient.id} value={patient.id}>{patientLabel(patient)}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </Field>
            <Field label={t.cases_reason}>
              <Input
                value={createForm.hauptanfragegrund}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    hauptanfragegrund: event.target.value,
                  }))
                }
                className="h-10 rounded-xl bg-slate-50"
              />
            </Field>
            <Field label={t.cases_anamnesis}>
              <textarea
                value={createForm.aktuelleAnamnese}
                onChange={(event) =>
                  setCreateForm((current) => ({
                    ...current,
                    aktuelleAnamnese: event.target.value,
                  }))
                }
                className={textareaClassName}
                rows={4}
              />
            </Field>
            <Field label={t.cases_referrer}>
              <select
                value={createForm.zuweiserDoctorId}
                onChange={(event) => {
                  const doctorId = event.target.value;
                  const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                  setCreateForm((current) => ({
                    ...current,
                    zuweiserDoctorId: doctorId,
                    zuweiser: selectedDoctor ? selectedDoctor.name : current.zuweiser,
                  }));
                }}
                className={nativeSelectClassName}
              >
                <option value="">{t.common_not_set}</option>
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctorOptionLabel(doctor)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={caseText("Bezeichnung des Zuweisers", "Наименование направившего врача", "Referrer label")}>
              <Input
                value={createForm.zuweiser}
                onChange={(event) =>
                  setCreateForm((current) => ({ ...current, zuweiser: event.target.value }))
                }
                className="h-10 rounded-xl bg-slate-50"
              />
            </Field>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="outline" className="rounded-2xl" onClick={() => setCreateOpen(false)}>
                {t.common_cancel}
              </Button>
              <Button
                type="submit"
                className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                disabled={createBusy || !createForm.patientId}
              >
                {createBusy ? <LoaderCircle className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {createBusy ? t.patients_creating : t.cases_new}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet
        open={detailOpen}
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
          }
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto border-l border-slate-200 p-0 sm:max-w-[980px]">
          <SheetHeader className="border-b border-border/70 px-6 py-5">
            <SheetTitle>{detail?.case_id ?? selectedSummary?.case_id ?? t.cases_title}</SheetTitle>
            <SheetDescription>
              Full narrative and structured anamnesis editor for the selected patient case.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 px-6 py-6">
            {detailBusy ? (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                <LoaderCircle className="mr-2 size-4 animate-spin" />
                Loading case
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
                      {detail.status}
                    </Badge>
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white text-slate-700"
                    >
                      {selectedPatient ? patientLabel(selectedPatient) : detail.patient_id}
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold text-slate-950">{detail.case_id}</h2>
                      <p className="mt-2 text-sm text-slate-600">
                        {selectedSummary?.patient_name
                          ? `${selectedSummary.patient_name} (${selectedSummary.patient_pid})`
                          : selectedPatient
                            ? patientLabel(selectedPatient)
                            : detail.patient_id}
                      </p>
                      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {caseText("Referenzcode", "Код ссылки", "Reference code")}
                          </div>
                          <div className="mt-2 font-mono text-sm text-slate-900">{detail.case_id}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {caseText("System-UUID des Falls", "Системный UUID кейса", "System case UUID")}
                          </div>
                          <div className="mt-2 break-all font-mono text-xs text-slate-900">
                            {detail.case_uuid ?? detail.id}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {caseText("Aufbewahrung bis", "Хранить до", "Retention until")}
                          </div>
                          <div className="mt-2 text-sm text-slate-900">
                            {formatDate(detail.retention_until)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {caseText("Letzte klinische Aktualisierung", "Последнее клиническое обновление", "Last clinical update")}
                          </div>
                          <div className="mt-2 text-sm text-slate-900">
                            {formatDateTime(detail.last_clinical_update_at ?? detail.updated_at)}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={openPatientWorkspace}>
                        <UserRound className="size-4" />
                        {caseText("Patient", "Пациент", "Patient")}
                      </Button>
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={openOrdersWorkspace}>
                        <ClipboardList className="size-4" />
                        {caseText("Aufträge", "Заказы", "Orders")}
                      </Button>
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={openAppointmentsWorkspace}>
                        <CalendarClock className="size-4" />
                        {caseText("Termine", "Приёмы", "Appointments")}
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label={t.cases_preconditions} value={detail.vorerkrankungen.length.toString()} description={t.cases_subtitle} icon={<Stethoscope className="size-4" />} />
                    <MetricCard label={t.cases_allergies} value={detail.allergien.length.toString()} description={t.cases_subtitle} icon={<Plus className="size-4" />} />
                    <MetricCard label={t.cases_medication} value={detail.medikamente.length.toString()} description={t.cases_subtitle} icon={<ClipboardList className="size-4" />} />
                    <MetricCard label={t.cases_symptoms} value={detail.symptome.length.toString()} description={t.cases_subtitle} icon={<Search className="size-4" />} />
                    <MetricCard
                      label={caseText("Klinische Revisionen", "Клинические ревизии", "Clinical revisions")}
                      value={String(detail.version_count ?? detail.history?.length ?? 0)}
                      description={caseText(
                        "Append-only-Einträge in der Fallhistorie",
                        "Записи в истории кейса без перезаписи",
                        "Append-only case history entries",
                      )}
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
                        className="rounded-2xl"
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
                      <Field label={t.cases_reason}>
                        <Input
                          value={overviewForm.hauptanfragegrund}
                          onChange={(event) =>
                            setOverviewForm((current) => ({
                              ...current,
                              hauptanfragegrund: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-slate-50"
                        />
                      </Field>
                      <Field label={t.cases_referrer}>
                        <select
                          value={overviewForm.zuweiser_doctor_id}
                          onChange={(event) => {
                            const doctorId = event.target.value;
                            const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                            setOverviewForm((current) => ({
                              ...current,
                              zuweiser_doctor_id: doctorId,
                              zuweiser: selectedDoctor ? selectedDoctor.name : current.zuweiser,
                            }));
                          }}
                          className={nativeSelectClassName}
                        >
                          <option value="">{t.common_not_set}</option>
                          {doctors.map((doctor) => (
                            <option key={doctor.id} value={doctor.id}>
                              {doctorOptionLabel(doctor)}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={caseText("Bezeichnung des Zuweisers", "Наименование направившего врача", "Referrer label")}>
                        <Input
                          value={overviewForm.zuweiser}
                          onChange={(event) =>
                            setOverviewForm((current) => ({
                              ...current,
                              zuweiser: event.target.value,
                            }))
                          }
                          className="h-10 rounded-xl bg-slate-50"
                        />
                      </Field>
                    </div>
                    <Field label={t.cases_narrative}>
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
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {t.cases_snippets_title}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {t.cases_snippets_description}
                          </p>
                        </div>
                        <code className="rounded-xl bg-white px-3 py-1 text-[11px] text-slate-500">
                          {CASE_TEXT_SNIPPET_PLACEHOLDERS.join(" · ")}
                        </code>
                      </div>
                      {snippetsError ? (
                        <Banner tone="error">{snippetsError}</Banner>
                      ) : null}
                      {snippetsBusy ? (
                        <div className="mt-3 flex items-center gap-2 text-sm text-slate-500">
                          <LoaderCircle className="size-4 animate-spin" />
                          {t.common_loading}
                        </div>
                      ) : activeSnippets.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">
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
                                className="rounded-2xl border border-slate-200 bg-white p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">
                                      {snippet.label}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {snippet.category}
                                    </p>
                                  </div>
                                  {permissions.canEdit ? (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="rounded-2xl"
                                      onClick={() => openEditSnippetDialog(snippet)}
                                    >
                                      {t.common_edit}
                                    </Button>
                                  ) : null}
                                </div>
                                <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                                  {rendered}
                                </p>
                                <div className="mt-3 flex justify-end">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-2xl"
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
                      <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={sectionBusy === "overview" || !permissions.canEdit}>
                        {sectionBusy === "overview" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        {caseText("Übersicht speichern", "Сохранить обзор", "Save overview")}
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Dialog open={snippetDialogOpen} onOpenChange={setSnippetDialogOpen}>
                  <DialogContent className="max-w-4xl">
                    <DialogHeader>
                      <DialogTitle>{t.cases_snippets_title}</DialogTitle>
                      <DialogDescription>
                        {t.cases_snippets_description}
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 lg:grid-cols-[1.15fr,0.85fr]">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">
                            {t.cases_snippets_title}
                          </p>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="rounded-2xl"
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
                                "w-full rounded-2xl border p-4 text-left transition",
                                snippetForm.id === snippet.id
                                  ? "border-sky-300 bg-sky-50"
                                  : "border-slate-200 bg-white hover:border-slate-300",
                              )}
                              onClick={() => openEditSnippetDialog(snippet)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-slate-900">
                                    {snippet.label}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {snippet.category}
                                  </p>
                                </div>
                                <Badge
                                  variant="secondary"
                                  className={snippet.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}
                                >
                                  {snippet.is_active ? t.common_active : t.common_inactive}
                                </Badge>
                              </div>
                              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs text-slate-600">
                                {snippet.body}
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                      <form onSubmit={handleSaveSnippet} className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        {snippetSaveError ? (
                          <Banner tone="error">{snippetSaveError}</Banner>
                        ) : null}
                        <Field label={t.cases_snippets_label}>
                          <Input
                            value={snippetForm.label}
                            onChange={(event) =>
                              setSnippetForm((current) => ({
                                ...current,
                                label: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-white"
                          />
                        </Field>
                        <Field label={t.cases_snippets_category}>
                          <Input
                            value={snippetForm.category}
                            onChange={(event) =>
                              setSnippetForm((current) => ({
                                ...current,
                                category: event.target.value,
                              }))
                            }
                            className="h-10 rounded-xl bg-white"
                          />
                        </Field>
                        <Field label={t.cases_snippets_body}>
                          <textarea
                            value={snippetForm.body}
                            onChange={(event) =>
                              setSnippetForm((current) => ({
                                ...current,
                                body: event.target.value,
                              }))
                            }
                            className={textareaClassName}
                            rows={8}
                          />
                        </Field>
                        <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={snippetForm.is_active}
                            onChange={(event) =>
                              setSnippetForm((current) => ({
                                ...current,
                                is_active: event.target.checked,
                              }))
                            }
                          />
                          {t.cases_snippets_active}
                        </label>
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                            {t.cases_snippets_preview}
                          </p>
                          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                            {renderCaseTextSnippet(snippetForm.body, snippetContext) || t.cases_snippets_empty}
                          </p>
                        </div>
                        <code className="block rounded-xl bg-white px-3 py-2 text-[11px] text-slate-500">
                          {CASE_TEXT_SNIPPET_PLACEHOLDERS.join(" · ")}
                        </code>
                        <div className="flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-2xl"
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
                            className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                  </DialogContent>
                </Dialog>

                <ItemEditorSection title={t.cases_preconditions} description={t.cases_subtitle} count={countFilled(vorerkrankungen, "erkrankung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "vorerkrankungen"} error={sectionErrors.vorerkrankungen ?? ""} canEdit={permissions.canEdit} onAdd={() => setVorerkrankungen((current) => [...current, blankVorerkrankung()])} onSave={handleSaveVorerkrankungen}>
                  {vorerkrankungen.map((item, index) => (
                    <div key={`vor-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.cases_preconditions}><Input value={item.erkrankung} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { erkrankung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_preconditions}><Input value={item.erstdiagnose ?? ""} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { erstdiagnose: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <Field label={t.cases_note}>
                        <textarea value={item.notiz ?? ""} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { notiz: event.target.value }))} className="mt-2 min-h-[90px] w-full rounded-xl border border-input bg-white px-3 py-2 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30" />
                      </Field>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setVorerkrankungen((current) => removeItemAtIndex(current, index))}>{caseText("Entfernen", "Удалить", "Remove")}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_allergies} description={t.cases_subtitle} count={countFilled(allergien, "allergie")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "allergien"} error={sectionErrors.allergien ?? ""} canEdit={permissions.canEdit} onAdd={() => setAllergien((current) => [...current, blankAllergie()])} onSave={handleSaveAllergien}>
                  {allergien.map((item, index) => (
                    <div key={`alg-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.cases_allergies}><Input value={item.allergie} onChange={(event) => setAllergien((current) => updateItemAtIndex(current, index, { allergie: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_subtitle}><Input value={item.reaktion ?? ""} onChange={(event) => setAllergien((current) => updateItemAtIndex(current, index, { reaktion: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setAllergien((current) => removeItemAtIndex(current, index))}>{caseText("Entfernen", "Удалить", "Remove")}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_operations} description={t.cases_subtitle} count={countFilled(operationen, "grund")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "operationen"} error={sectionErrors.operationen ?? ""} canEdit={permissions.canEdit} onAdd={() => setOperationen((current) => [...current, blankOperation()])} onSave={handleSaveOperationen}>
                  {operationen.map((item, index) => (
                    <div key={`op-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <Field label={t.appointments_date}><Input type="date" value={item.datum ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { datum: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_reason}><Input value={item.grund} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { grund: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={caseText("Arzt aus Register", "Врач из реестра", "Doctor registry")}>
                          <select
                            value={item.arzt_id ?? ""}
                            onChange={(event) => {
                              const doctorId = event.target.value;
                              const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                              setOperationen((current) =>
                                updateItemAtIndex(current, index, {
                                  arzt_id: doctorId,
                                  arzt: selectedDoctor
                                    ? selectedDoctor.name
                                    : (current[index]?.arzt ?? ""),
                                }),
                              );
                            }}
                            className={nativeSelectClassName}
                          >
                            <option value="">{t.common_not_set}</option>
                            {doctors.map((doctor) => (
                              <option key={doctor.id} value={doctor.id}>
                                {doctorOptionLabel(doctor)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={caseText("Freitext Arzt", "Наименование врача", "Doctor label")}><Input value={item.arzt ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { arzt: event.target.value }))} className="h-10 rounded-xl bg-white" placeholder={caseText("Altbestand / manuelle Angabe", "Устаревшее / ручной ввод", "Legacy / manual fallback")} /></Field>
                        <Field label={t.cases_note}><Input value={item.notiz ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { notiz: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setOperationen((current) => removeItemAtIndex(current, index))}>{caseText("Entfernen", "Удалить", "Remove")}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_medication} description={t.cases_subtitle} count={countFilled(medikamente, "handelsname")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "medikamente"} error={sectionErrors.medikamente ?? ""} canEdit={permissions.canEdit} onAdd={() => setMedikamente((current) => [...current, blankMedikament()])} onSave={handleSaveMedikamente}>
                  {medikamente.map((item, index) => (
                    <div key={`med-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        <Field label={t.cases_medications}><Input value={item.handelsname} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { handelsname: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.wirkstoff ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { wirkstoff: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.documents_category}><Input value={item.med_typ ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { med_typ: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={caseText("Gültig bis", "Действительно до", "Valid until")}>
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
                        <Field label={caseText("Arzt aus Register", "Врач из реестра", "Doctor registry")}>
                          <select
                            value={item.verordnender_arzt_id ?? ""}
                            onChange={(event) => {
                              const doctorId = event.target.value;
                              const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                              setMedikamente((current) =>
                                updateItemAtIndex(current, index, {
                                  verordnender_arzt_id: doctorId,
                                  verordnender_arzt: selectedDoctor
                                    ? selectedDoctor.name
                                    : (current[index]?.verordnender_arzt ?? ""),
                                }),
                              );
                            }}
                            className={nativeSelectClassName}
                          >
                            <option value="">{t.common_not_set}</option>
                            {doctors.map((doctor) => (
                              <option key={doctor.id} value={doctor.id}>
                                {doctorOptionLabel(doctor)}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label={caseText("Freitext Arzt", "Наименование врача", "Doctor label")}><Input value={item.verordnender_arzt ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { verordnender_arzt: event.target.value }))} className="h-10 rounded-xl bg-white" placeholder={caseText("Altbestand / manuelle Angabe", "Устаревшее / ручной ввод", "Legacy / manual fallback")} /></Field>
                        <Field label={t.patients_notes}><Input value={item.anmerkung ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { anmerkung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      {item.is_expired ? (
                        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full border-amber-300 bg-white text-amber-700">
                              Expired
                            </Badge>
                            {item.pending_expiry_confirmation ? (
                              <Badge variant="outline" className="rounded-full border-rose-300 bg-white text-rose-700">
                                Confirmation required
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full border-emerald-300 bg-white text-emerald-700">
                                Review confirmed
                              </Badge>
                            )}
                            <span>
                              {caseText(
                                `Die Gültigkeit des Medikaments endete am ${formatDate(item.expiry_date)}.`,
                                `Срок действия лекарства закончился ${formatDate(item.expiry_date)}.`,
                                `Medication validity ended on ${formatDate(item.expiry_date)}.`,
                              )}
                            </span>
                          </div>
                          {item.pending_expiry_notification_sent_at ? (
                            <p className="mt-2 text-xs text-amber-700">
                              Notification sent {formatDateTime(item.pending_expiry_notification_sent_at)}.
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
                            className="rounded-2xl"
                            onClick={() => {
                              if (item.id) {
                                void handleConfirmMedicationExpiry(item.id);
                              }
                            }}
                            disabled={sectionBusy === "medikamente"}
                          >
                            Confirm expiry review
                          </Button>
                        ) : null}
                        <Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setMedikamente((current) => removeItemAtIndex(current, index))}>{caseText("Entfernen", "Удалить", "Remove")}</Button>
                      </div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_pain} description={t.cases_subtitle} count={countFilled(painRecords, "lokalisierung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "pain"} error={sectionErrors.pain ?? ""} canEdit={permissions.canEdit} onAdd={() => setPainRecords((current) => [...current, blankPainItem()])} onSave={handleSavePain}>
                  {painRecords.map((item, index) => (
                    <div key={`pain-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        <Field label={t.appointments_location}><Input value={item.lokalisierung} onChange={(event) => setPainRecords((current) => updateItemAtIndex(current, index, { lokalisierung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
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
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setPainRecords((current) => removeItemAtIndex(current, index))}>{caseText("Entfernen", "Удалить", "Remove")}</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_symptoms} description={t.cases_subtitle} count={countFilled(symptome, "beschreibung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "symptome"} error={sectionErrors.symptome ?? ""} canEdit={permissions.canEdit} onAdd={() => setSymptome((current) => [...current, blankSymptom()])} onSave={handleSaveSymptome}>
                  {symptome.map((item, index) => (
                    <div key={`sym-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.patients_notes}><Input value={item.beschreibung} onChange={(event) => setSymptome((current) => updateItemAtIndex(current, index, { beschreibung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_title}><Input value={item.fachrichtung ?? ""} onChange={(event) => setSymptome((current) => updateItemAtIndex(current, index, { fachrichtung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setSymptome((current) => removeItemAtIndex(current, index))}>{caseText("Entfernen", "Удалить", "Remove")}</Button></div>
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
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
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
                        <Input value={cardiology.known_diagnosis} onChange={(event) => setCardiology((current) => ({ ...current, known_diagnosis: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label={caseText("Vorbefunde (EKG / Echo / Diagnostik)", "Предыдущие ЭКГ / Эхо / обследования", "Prior ECG / echo / workup")}>
                        <Input value={cardiology.prior_cardiac_workup} onChange={(event) => setCardiology((current) => ({ ...current, prior_cardiac_workup: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label={caseText("Antikoagulation", "Антикоагуляция", "Anticoagulation")}>
                        <Input value={cardiology.anticoagulation} onChange={(event) => setCardiology((current) => ({ ...current, anticoagulation: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label={caseText("Kardiovaskuläre Risikofaktoren", "Сердечно-сосудистые факторы риска", "CV risk factors")}>
                        <Input value={cardiology.cardiovascular_risk_factors} onChange={(event) => setCardiology((current) => ({ ...current, cardiovascular_risk_factors: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label={caseText("Familienanamnese", "Семейный анамнез", "Family history")}>
                        <Input value={cardiology.family_history} onChange={(event) => setCardiology((current) => ({ ...current, family_history: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label={caseText("Warnzeichen", "Красные флаги", "Red flags")}>
                        <Input value={cardiology.red_flags} onChange={(event) => setCardiology((current) => ({ ...current, red_flags: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
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
                      <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={sectionBusy === "cardiology" || !permissions.canEdit}>
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
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                        className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                        className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                        className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                        className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
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
                          className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700"
                        >
                          <input
                            type="checkbox"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                          className="h-10 rounded-xl bg-slate-50"
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
                        className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                      <Field label={t.cases_symptoms}><Input value={vegetative.appetit_durst} onChange={(event) => setVegetative((current) => ({ ...current, appetit_durst: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                      <Field label={t.cases_symptoms}><Input value={vegetative.koerpergroesse} onChange={(event) => setVegetative((current) => ({ ...current, koerpergroesse: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                      <Field label={t.cases_symptoms}><Input value={vegetative.gewicht} onChange={(event) => setVegetative((current) => ({ ...current, gewicht: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                      <Field label={t.cases_symptoms}><Input value={vegetative.gewichtsveraenderung} onChange={(event) => setVegetative((current) => ({ ...current, gewichtsveraenderung: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                      <Field label={t.cases_reason}><Input value={vegetative.grund} onChange={(event) => setVegetative((current) => ({ ...current, grund: event.target.value }))} className="h-10 rounded-xl bg-slate-50" /></Field>
                    </div>
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={sectionBusy === "vegetative" || !permissions.canEdit}>
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
                      <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={sectionBusy === "impfstatus" || !permissions.canEdit}>
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
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h4 className="text-sm font-semibold text-slate-950">
                                {historySectionLabel(entry.section)}
                              </h4>
                              <p className="mt-1 text-xs text-slate-600">
                                {entry.changed_by_name} · {entry.changed_by_role} ·{" "}
                                {formatDateTime(entry.created_at)}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="rounded-full border-slate-200 bg-white text-slate-700"
                            >
                              #{entry.id}
                            </Badge>
                          </div>
                          <div className="mt-3 grid gap-3 md:grid-cols-2">
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                {caseText("Vorher", "Было", "Previous")}
                              </div>
                              <p className="mt-2 break-words font-mono text-xs text-slate-700">
                                {historyValuePreview(entry.old_value)}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                {caseText("Neu", "Стало", "New")}
                              </div>
                              <p className="mt-2 break-words font-mono text-xs text-slate-700">
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
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                {caseText("Wählen Sie einen Fall aus der Liste aus.", "Выберите кейс из списка.", "Select a case from the roster.")}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function MetricCard({ label, value, description, icon }: MetricCardProps) {
  return (
    <div className="rounded-[1.5rem] border border-white/90 bg-white/88 p-4 shadow-sm backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{label}</span>
        <span className="rounded-2xl bg-slate-100 p-2 text-slate-700">{icon}</span>
      </div>
      <p className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
    </div>
  );
}

function Panel({ title, description, action, children, className }: PanelProps) {
  return (
    <section className={cardClass(cn("p-5", className))}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: FieldProps) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-foreground leading-tight">
        {label}
      </span>
      {children}
    </label>
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
    <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50/70 px-5 py-8 text-center">
      <div className="mx-auto max-w-md">
        <h3 className="text-base font-semibold text-slate-950">{title}</h3>
        <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
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
  return (
    <Panel
      title={title}
      description={description}
      action={
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-[0.12em] text-slate-500">{count} items</span>
          {canEdit ? (
            <Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={onAdd}>
              <Plus className="size-4" />
              {addLabel}
            </Button>
          ) : null}
        </div>
      }
    >
      <form onSubmit={onSave} className="space-y-4">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {!hasContent ? <EmptyPanel title={emptyTitle} text={emptyText} /> : children}
        <div className="flex justify-end border-t border-border/70 pt-4">
          <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={busy || !canEdit}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            Save section
          </Button>
        </div>
      </form>
    </Panel>
  );
}
