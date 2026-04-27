export type CaseStatus = "open" | "in_progress" | "closed";

export type VorerkrankungItem = {
  erkrankung: string;
  erstdiagnose?: string | null;
  notiz?: string | null;
};

export type AllergieItem = {
  allergie: string;
  reaktion?: string | null;
};

export type OperationItem = {
  datum?: string | null;
  grund: string;
  arzt_id?: string | null;
  arzt?: string | null;
  arzt_registry_name?: string | null;
  arzt_provider_name?: string | null;
  notiz?: string | null;
};

export type CaseHistoryEntry = {
  id: number;
  section: string;
  old_value?: unknown;
  new_value?: unknown;
  created_at: string;
  changed_by: string;
  changed_by_name: string;
  changed_by_role: string;
};

export type CaseTextSnippet = {
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

export type CaseTextSnippetFormState = {
  id: string;
  label: string;
  category: string;
  body: string;
  is_active: boolean;
};

export type MedikamentItem = {
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

export type PainItem = {
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

export type SymptomItem = {
  beschreibung: string;
  fachrichtung?: string | null;
};

export type VegetativeState = {
  appetit_durst: string;
  koerpergroesse: string;
  gewicht: string;
  gewichtsveraenderung: string;
  grund: string;
};

export type CardiologyAssessment = {
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

export type GastroenterologyAssessment = {
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

export type OrthopedicsAssessment = {
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

export type NeurologyAssessment = {
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

export type PulmonologyAssessment = {
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

export type UrologyAssessment = {
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

export type CaseDetail = {
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

export type PatientOption = {
  id: string;
  patient_id: string;
  first_name?: string;
  last_name?: string;
};

export type DoctorOption = {
  id: string;
  provider_id: string;
  provider_name: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
};

export type CaseFilters = {
  search: string;
  status: string;
  patientId: string;
};

export type CaseCreateFormState = {
  patientId: string;
  hauptanfragegrund: string;
  aktuelleAnamnese: string;
  zuweiserDoctorId: string;
  zuweiser: string;
};

export type CaseOverviewFormState = {
  hauptanfragegrund: string;
  aktuelle_anamnese: string;
  zuweiser_doctor_id: string;
  zuweiser: string;
};

export type CasePermissions = {
  canViewPage: boolean;
  canCreate: boolean;
  canEdit: boolean;
};

export type SectionStatusKey =
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
