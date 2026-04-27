import {
  getLang,
  t as translateCatalog,
  type Translations,
} from "@/lib/i18n";

import type {
  AllergieItem,
  CardiologyAssessment,
  CaseCreateFormState,
  CaseFilters,
  CaseOverviewFormState,
  CasePermissions,
  CaseStatus,
  CaseTextSnippetFormState,
  DoctorOption,
  GastroenterologyAssessment,
  MedikamentItem,
  NeurologyAssessment,
  OperationItem,
  OrthopedicsAssessment,
  PainItem,
  PatientOption,
  PulmonologyAssessment,
  SymptomItem,
  UrologyAssessment,
  VegetativeState,
  VorerkrankungItem,
} from "./types";

export const CASE_STATUSES: CaseStatus[] = ["open", "in_progress", "closed"];

export const DEFAULT_FILTERS: CaseFilters = {
  search: "",
  status: "",
  patientId: "",
};

export const DEFAULT_CREATE_FORM: CaseCreateFormState = {
  patientId: "",
  hauptanfragegrund: "",
  aktuelleAnamnese: "",
  zuweiserDoctorId: "",
  zuweiser: "",
};

export const DEFAULT_OVERVIEW_FORM: CaseOverviewFormState = {
  hauptanfragegrund: "",
  aktuelle_anamnese: "",
  zuweiser_doctor_id: "",
  zuweiser: "",
};

export const DEFAULT_CASE_TEXT_SNIPPET_FORM: CaseTextSnippetFormState = {
  id: "",
  label: "",
  category: "general",
  body: "",
  is_active: true,
};

export function casePermissions(role?: string): CasePermissions {
  return {
    canViewPage: role === "ceo" || role === "patient_manager",
    canCreate: role === "ceo" || role === "patient_manager",
    canEdit: role === "ceo" || role === "patient_manager",
  };
}

export function caseStatusLabel(
  status: string,
  tr: {
    cases_open: string;
    cases_in_progress: string;
    cases_closed: string;
  },
) {
  switch (status) {
    case "open":
      return tr.cases_open;
    case "in_progress":
      return tr.cases_in_progress;
    case "closed":
      return tr.cases_closed;
    default:
      return status;
  }
}

export function blankVorerkrankung(): VorerkrankungItem {
  return { erkrankung: "", erstdiagnose: "", notiz: "" };
}

export function blankAllergie(): AllergieItem {
  return { allergie: "", reaktion: "" };
}

export function blankOperation(): OperationItem {
  return { datum: "", grund: "", arzt_id: "", arzt: "", notiz: "" };
}

export function blankMedikament(): MedikamentItem {
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

export function blankPainItem(): PainItem {
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

export function blankSymptom(): SymptomItem {
  return { beschreibung: "", fachrichtung: "" };
}

export function blankVegetative(): VegetativeState {
  return {
    appetit_durst: "",
    koerpergroesse: "",
    gewicht: "",
    gewichtsveraenderung: "",
    grund: "",
  };
}

export function blankCardiology(): CardiologyAssessment {
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

export function blankGastroenterology(): GastroenterologyAssessment {
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

export function blankOrthopedics(): OrthopedicsAssessment {
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

export function blankNeurology(): NeurologyAssessment {
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

export function blankPulmonology(): PulmonologyAssessment {
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

export function blankUrology(): UrologyAssessment {
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

export function buildCasesPath(filters: CaseFilters) {
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

export function caseText(de: string, ru: string, _en: string) {
  switch (getLang()) {
    case "ru":
      return ru;
    case "de":
      return de;
    default:
      return _en;
  }
}

export function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || caseText("Patient", "Пациент", "Patient")} (${patient.patient_id})`;
}

export function doctorOptionLabel(doctor: DoctorOption) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialty = doctor.fachbereich?.trim()
    ? ` · ${doctor.fachbereich.trim()}`
    : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(runtimeLocale(), { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return runtimeTranslations().common_not_set;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(runtimeLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function historyValuePreview(value: unknown) {
  if (value == null) return caseText("leer", "пусто", "empty");
  if (typeof value === "string") return value || caseText("leer", "пусто", "empty");
  const serialized = JSON.stringify(value);
  if (!serialized) return caseText("leer", "пусто", "empty");
  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

export function historySectionLabel(section: string) {
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

export function numericInputToValue(value: string) {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toOptionalText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function parsePainNumber(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function countFilled(items: Array<{ [key: string]: unknown }>, key: string) {
  return items.filter((item) => {
    const value = item[key];
    return typeof value === "string" ? value.trim().length > 0 : Boolean(value);
  }).length;
}

export function updateItemAtIndex<T>(
  items: T[],
  index: number,
  patch: Partial<T>,
): T[] {
  return items.map((item, currentIndex) =>
    currentIndex === index ? { ...item, ...patch } : item,
  );
}

export function removeItemAtIndex<T>(items: T[], index: number) {
  return items.filter((_, currentIndex) => currentIndex !== index);
}

export function bannerText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function sanitizeVorerkrankungen(items: VorerkrankungItem[]) {
  return items
    .filter((item) => item.erkrankung.trim())
    .map((item) => ({
      erkrankung: item.erkrankung.trim(),
      erstdiagnose: toOptionalText(item.erstdiagnose ?? ""),
      notiz: toOptionalText(item.notiz ?? ""),
    }));
}

export function sanitizeAllergien(items: AllergieItem[]) {
  return items
    .filter((item) => item.allergie.trim())
    .map((item) => ({
      allergie: item.allergie.trim(),
      reaktion: toOptionalText(item.reaktion ?? ""),
    }));
}

export function sanitizeOperationen(items: OperationItem[]) {
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

export function sanitizeMedikamente(items: MedikamentItem[]) {
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

export function sanitizePainRecords(items: PainItem[]) {
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

export function sanitizeSymptome(items: SymptomItem[]) {
  return items
    .filter((item) => item.beschreibung.trim())
    .map((item) => ({
      beschreibung: item.beschreibung.trim(),
      fachrichtung: toOptionalText(item.fachrichtung ?? ""),
    }));
}

export function cardiologyToPayload(cardiology: CardiologyAssessment) {
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

export function gastroenterologyToPayload(gastroenterology: GastroenterologyAssessment) {
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

export function orthopedicsToPayload(orthopedics: OrthopedicsAssessment) {
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

export function neurologyToPayload(neurology: NeurologyAssessment) {
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

export function pulmonologyToPayload(pulmonology: PulmonologyAssessment) {
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

export function urologyToPayload(urology: UrologyAssessment) {
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
