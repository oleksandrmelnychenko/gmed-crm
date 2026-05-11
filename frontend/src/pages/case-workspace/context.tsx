import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";

import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

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
  notiz?: string | null;
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
  med_typ?: string | null;
  expiry_date?: string | null;
  is_expired?: boolean;
  pending_expiry_confirmation?: boolean;
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

export type VegetativeForm = {
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

export type CaseWorkspaceDetail = {
  id: string;
  case_uuid?: string;
  case_id: string;
  status: string;
  patient_id: string;
  hauptanfragegrund: string | null;
  aktuelle_anamnese: string | null;
  zuweiser_doctor_id?: string | null;
  zuweiser: string | null;
  created_at?: string;
  updated_at?: string;
  last_clinical_update_at?: string | null;
  version_count?: number | null;
  vorerkrankungen?: VorerkrankungItem[];
  allergien?: AllergieItem[];
  operationen?: OperationItem[];
  medikamente?: MedikamentItem[];
  pain_records?: PainItem[];
  symptome?: SymptomItem[];
  vegetative_anamnese?: {
    appetit_durst?: string | null;
    koerpergroesse?: number | null;
    gewicht?: number | null;
    gewichtsveraenderung?: string | null;
    grund?: string | null;
  } | null;
  cardiology?: Partial<CardiologyAssessment> | null;
  gastroenterology?: Partial<GastroenterologyAssessment> | null;
  orthopedics?: Partial<OrthopedicsAssessment> | null;
  neurology?: Partial<NeurologyAssessment> | null;
  pulmonology?: Partial<PulmonologyAssessment> | null;
  urology?: Partial<UrologyAssessment> | null;
  history?: CaseHistoryEntry[];
};

export type CaseWorkspaceDoctor = {
  id: string;
  provider_id: string;
  provider_name: string;
  name: string;
  title?: string | null;
  fachbereich?: string | null;
};

export type CaseWorkspaceSnippet = {
  id: string;
  label: string;
  category: string;
  body: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type CaseWorkspacePermissions = {
  canViewPage: boolean;
  canEdit: boolean;
};

export type CaseOverviewForm = {
  hauptanfragegrund: string;
  aktuelle_anamnese: string;
  zuweiser_doctor_id: string;
  zuweiser: string;
};

type SectionBusyKey =
  | "overview"
  | "preconditions"
  | "allergies"
  | "surgeries"
  | "medications"
  | "pain"
  | "symptoms"
  | "vegetative"
  | "cardiology"
  | "gastroenterology"
  | "orthopedics"
  | "neurology"
  | "pulmonology"
  | "urology";

type CaseWorkspaceContextValue = {
  caseId: string;
  detail: CaseWorkspaceDetail | null;
  doctors: CaseWorkspaceDoctor[];
  snippets: CaseWorkspaceSnippet[];
  loading: boolean;
  error: string;
  permissions: CaseWorkspacePermissions;
  sectionBusy: SectionBusyKey | null;
  sectionError: string;
  reload: () => void;
  saveOverview: (form: CaseOverviewForm) => Promise<boolean>;
  savePreconditions: (items: VorerkrankungItem[]) => Promise<boolean>;
  saveAllergies: (items: AllergieItem[]) => Promise<boolean>;
  saveSurgeries: (items: OperationItem[]) => Promise<boolean>;
  saveMedications: (items: MedikamentItem[]) => Promise<boolean>;
  savePain: (items: PainItem[]) => Promise<boolean>;
  saveSymptoms: (items: SymptomItem[]) => Promise<boolean>;
  saveVegetative: (form: VegetativeForm) => Promise<boolean>;
  saveCardiology: (form: CardiologyAssessment) => Promise<boolean>;
  saveGastroenterology: (form: GastroenterologyAssessment) => Promise<boolean>;
  saveOrthopedics: (form: OrthopedicsAssessment) => Promise<boolean>;
  saveNeurology: (form: NeurologyAssessment) => Promise<boolean>;
  savePulmonology: (form: PulmonologyAssessment) => Promise<boolean>;
  saveUrology: (form: UrologyAssessment) => Promise<boolean>;
};

type CaseWorkspaceState = {
  detail: CaseWorkspaceDetail | null;
  doctors: CaseWorkspaceDoctor[];
  snippets: CaseWorkspaceSnippet[];
  loading: boolean;
  error: string;
  version: number;
  sectionBusy: SectionBusyKey | null;
  sectionError: string;
};

type CaseWorkspacePatch =
  | Partial<CaseWorkspaceState>
  | ((current: CaseWorkspaceState) => Partial<CaseWorkspaceState>);

const CaseWorkspaceContext = createContext<CaseWorkspaceContextValue | null>(null);

export function useCaseWorkspace() {
  const ctx = use(CaseWorkspaceContext);
  if (!ctx) {
    throw new Error("useCaseWorkspace must be used inside CaseWorkspaceProvider");
  }
  return ctx;
}

function toOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeAssessment<T extends Record<string, unknown>>(form: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(form)) {
    if (typeof value === "boolean" || typeof value === "number" || value == null) {
      out[key] = value;
    } else if (typeof value === "string") {
      out[key] = toOptionalText(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizePainNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim().replace(",", ".");
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolvePermissions(role: string | undefined): CaseWorkspacePermissions {
  const canManage = role === "ceo" || role === "patient_manager";
  return {
    canViewPage: canManage,
    canEdit: canManage,
  };
}

function createCaseWorkspaceState(): CaseWorkspaceState {
  return {
    detail: null,
    doctors: [],
    snippets: [],
    loading: true,
    error: "",
    version: 0,
    sectionBusy: null,
    sectionError: "",
  };
}

function caseWorkspaceReducer(
  state: CaseWorkspaceState,
  patch: CaseWorkspacePatch,
): CaseWorkspaceState {
  return {
    ...state,
    ...(typeof patch === "function" ? patch(state) : patch),
  };
}

function useCaseWorkspaceProviderContent({
  caseId,
  children,
}: {
  caseId: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const permissions = useMemo(() => resolvePermissions(user?.role), [user?.role]);

  const [workspaceState, dispatchWorkspaceState] = useReducer(
    caseWorkspaceReducer,
    undefined,
    createCaseWorkspaceState,
  );
  const {
    detail,
    doctors,
    snippets,
    loading,
    error,
    version,
    sectionBusy,
    sectionError,
  } = workspaceState;

  const bootstrapRef = useRef(false);
  useEffect(() => {
    if (bootstrapRef.current) return;
    bootstrapRef.current = true;
    const controller = new AbortController();
    const { signal } = controller;

    Promise.all([
      apiFetch<CaseWorkspaceDoctor[]>("/cases/meta/doctors", { signal }).catch(
        () => [],
      ),
      apiFetch<CaseWorkspaceSnippet[]>("/cases/text-snippets", { signal }).catch(
        () => [],
      ),
    ]).then(([doctorItems, snippetItems]) => {
      if (signal.aborted) return;
      dispatchWorkspaceState({
        doctors: doctorItems,
        snippets: snippetItems,
      });
    });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!caseId) {
      dispatchWorkspaceState({ loading: false });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    dispatchWorkspaceState({
      loading: true,
      error: "",
    });

    apiFetch<CaseWorkspaceDetail>(`/cases/${caseId}`, { signal })
      .then((result) => {
        if (signal.aborted) return;
        dispatchWorkspaceState({
          detail: result,
          loading: false,
        });
      })
      .catch((err: unknown) => {
        if (signal.aborted) return;
        dispatchWorkspaceState({
          detail: null,
          error: err instanceof Error ? err.message : String(err),
          loading: false,
        });
      });

    return () => controller.abort();
  }, [caseId, version]);

  const reload = useCallback(() => {
    dispatchWorkspaceState((current) => ({ version: current.version + 1 }));
  }, []);

  const saveOverview = useCallback(
    async (form: CaseOverviewForm) => {
      if (!caseId) return false;
      dispatchWorkspaceState({
        sectionBusy: "overview",
        sectionError: "",
      });
      try {
        await apiFetch(`/cases/${caseId}/anamnesis`, {
          method: "POST",
          body: JSON.stringify({
            hauptanfragegrund: toOptionalText(form.hauptanfragegrund),
            aktuelle_anamnese: toOptionalText(form.aktuelle_anamnese),
            zuweiser_doctor_id: toOptionalText(form.zuweiser_doctor_id),
            zuweiser: toOptionalText(form.zuweiser),
          }),
        });
        dispatchWorkspaceState((current) => ({ version: current.version + 1 }));
        return true;
      } catch (err: unknown) {
        dispatchWorkspaceState({
          sectionError: err instanceof Error ? err.message : String(err),
        });
        return false;
      } finally {
        dispatchWorkspaceState({ sectionBusy: null });
      }
    },
    [caseId],
  );

  const runListSave = useCallback(
    async <T,>(
      busyKey: SectionBusyKey,
      endpoint: string,
      sanitize: (items: T[]) => unknown[],
      items: T[],
    ): Promise<boolean> => {
      if (!caseId) return false;
      dispatchWorkspaceState({
        sectionBusy: busyKey,
        sectionError: "",
      });
      try {
        await apiFetch(`/cases/${caseId}/${endpoint}`, {
          method: "POST",
          body: JSON.stringify({ items: sanitize(items) }),
        });
        dispatchWorkspaceState((current) => ({ version: current.version + 1 }));
        return true;
      } catch (err: unknown) {
        dispatchWorkspaceState({
          sectionError: err instanceof Error ? err.message : String(err),
        });
        return false;
      } finally {
        dispatchWorkspaceState({ sectionBusy: null });
      }
    },
    [caseId],
  );

  const savePreconditions = useCallback(
    (items: VorerkrankungItem[]) =>
      runListSave<VorerkrankungItem>(
        "preconditions",
        "vorerkrankungen",
        (list) =>
          list.flatMap((item) => {
            const erkrankung = item.erkrankung.trim();
            if (!erkrankung) return [];
            return [{
              erkrankung,
              erstdiagnose: toOptionalText(item.erstdiagnose ?? ""),
              notiz: toOptionalText(item.notiz ?? ""),
            }];
          }),
        items,
      ),
    [runListSave],
  );

  const saveAllergies = useCallback(
    (items: AllergieItem[]) =>
      runListSave<AllergieItem>(
        "allergies",
        "allergien",
        (list) =>
          list.flatMap((item) => {
            const allergie = item.allergie.trim();
            if (!allergie) return [];
            return [{
              allergie,
              reaktion: toOptionalText(item.reaktion ?? ""),
            }];
          }),
        items,
      ),
    [runListSave],
  );

  const saveSurgeries = useCallback(
    (items: OperationItem[]) =>
      runListSave<OperationItem>(
        "surgeries",
        "operationen",
        (list) =>
          list.flatMap((item) => {
            const grund = item.grund.trim();
            if (!grund) return [];
            return [{
              datum: toOptionalText(item.datum ?? ""),
              grund,
              arzt_id: toOptionalText(item.arzt_id ?? ""),
              arzt: toOptionalText(item.arzt ?? ""),
              notiz: toOptionalText(item.notiz ?? ""),
            }];
          }),
        items,
      ),
    [runListSave],
  );

  const saveMedications = useCallback(
    (items: MedikamentItem[]) =>
      runListSave<MedikamentItem>(
        "medications",
        "medikamente",
        (list) =>
          list.flatMap((item) => {
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
          }),
        items,
      ),
    [runListSave],
  );

  const savePain = useCallback(
    (items: PainItem[]) =>
      runListSave<PainItem>(
        "pain",
        "pain",
        (list) =>
          list.flatMap((item) => {
            const lokalisierung = item.lokalisierung.trim();
            if (!lokalisierung) return [];
            return [{
              lokalisierung,
              seit_wann: toOptionalText(item.seit_wann ?? ""),
              ursache: toOptionalText(item.ursache ?? ""),
              qualitaet: toOptionalText(item.qualitaet ?? ""),
              kontinuitaet: toOptionalText(item.kontinuitaet ?? ""),
              entwicklung: toOptionalText(item.entwicklung ?? ""),
              nrs_aktuell: normalizePainNumber(item.nrs_aktuell),
              nrs_anfang: normalizePainNumber(item.nrs_anfang),
              dauer_anfang: toOptionalText(item.dauer_anfang ?? ""),
              dauer_aktuell: toOptionalText(item.dauer_aktuell ?? ""),
              ausstrahlung: toOptionalText(item.ausstrahlung ?? ""),
              auftreten: toOptionalText(item.auftreten ?? ""),
            }];
          }),
        items,
      ),
    [runListSave],
  );

  const saveSymptoms = useCallback(
    (items: SymptomItem[]) =>
      runListSave<SymptomItem>(
        "symptoms",
        "symptome",
        (list) =>
          list.flatMap((item) => {
            const beschreibung = item.beschreibung.trim();
            if (!beschreibung) return [];
            return [{
              beschreibung,
              fachrichtung: toOptionalText(item.fachrichtung ?? ""),
            }];
          }),
        items,
      ),
    [runListSave],
  );

  const runFormSave = useCallback(
    async (
      busyKey: SectionBusyKey,
      endpoint: string,
      payload: unknown,
    ): Promise<boolean> => {
      if (!caseId) return false;
      dispatchWorkspaceState({
        sectionBusy: busyKey,
        sectionError: "",
      });
      try {
        await apiFetch(`/cases/${caseId}/${endpoint}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        dispatchWorkspaceState((current) => ({ version: current.version + 1 }));
        return true;
      } catch (err: unknown) {
        dispatchWorkspaceState({
          sectionError: err instanceof Error ? err.message : String(err),
        });
        return false;
      } finally {
        dispatchWorkspaceState({ sectionBusy: null });
      }
    },
    [caseId],
  );

  const saveVegetative = useCallback(
    (form: VegetativeForm) =>
      runFormSave("vegetative", "vegetative", {
        appetit_durst: toOptionalText(form.appetit_durst),
        koerpergroesse: normalizePainNumber(form.koerpergroesse),
        gewicht: normalizePainNumber(form.gewicht),
        gewichtsveraenderung: toOptionalText(form.gewichtsveraenderung),
        grund: toOptionalText(form.grund),
      }),
    [runFormSave],
  );

  const saveCardiology = useCallback(
    (form: CardiologyAssessment) =>
      runFormSave("cardiology", "cardiology", sanitizeAssessment(form)),
    [runFormSave],
  );

  const saveGastroenterology = useCallback(
    (form: GastroenterologyAssessment) =>
      runFormSave("gastroenterology", "gastroenterology", sanitizeAssessment(form)),
    [runFormSave],
  );

  const saveOrthopedics = useCallback(
    (form: OrthopedicsAssessment) =>
      runFormSave("orthopedics", "orthopedics", sanitizeAssessment(form)),
    [runFormSave],
  );

  const saveNeurology = useCallback(
    (form: NeurologyAssessment) =>
      runFormSave("neurology", "neurology", sanitizeAssessment(form)),
    [runFormSave],
  );

  const savePulmonology = useCallback(
    (form: PulmonologyAssessment) =>
      runFormSave("pulmonology", "pulmonology", sanitizeAssessment(form)),
    [runFormSave],
  );

  const saveUrology = useCallback(
    (form: UrologyAssessment) =>
      runFormSave("urology", "urology", sanitizeAssessment(form)),
    [runFormSave],
  );

  const value = useMemo<CaseWorkspaceContextValue>(
    () => ({
      caseId,
      detail,
      doctors,
      snippets,
      loading,
      error,
      permissions,
      sectionBusy,
      sectionError,
      reload,
      saveOverview,
      savePreconditions,
      saveAllergies,
      saveSurgeries,
      saveMedications,
      savePain,
      saveSymptoms,
      saveVegetative,
      saveCardiology,
      saveGastroenterology,
      saveOrthopedics,
      saveNeurology,
      savePulmonology,
      saveUrology,
    }),
    [
      caseId,
      detail,
      doctors,
      error,
      loading,
      permissions,
      reload,
      saveAllergies,
      saveCardiology,
      saveGastroenterology,
      saveMedications,
      saveNeurology,
      saveOrthopedics,
      saveOverview,
      savePain,
      savePreconditions,
      savePulmonology,
      saveSurgeries,
      saveSymptoms,
      saveUrology,
      saveVegetative,
      sectionBusy,
      sectionError,
      snippets,
    ],
  );

  return (
    <CaseWorkspaceContext.Provider value={value}>
      {children}
    </CaseWorkspaceContext.Provider>
  );
}

export function CaseWorkspaceProvider(...args: Parameters<typeof useCaseWorkspaceProviderContent>) {
  return useCaseWorkspaceProviderContent(...args);
}
