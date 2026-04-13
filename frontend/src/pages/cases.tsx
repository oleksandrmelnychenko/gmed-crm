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
import { useNavigate, useSearchParams } from "react-router-dom";

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
import { Label } from "@/components/ui/label";
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
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

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

type MedikamentItem = {
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

const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const nativeSelectClassName =
  "h-10 w-full rounded-xl border border-input bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

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

function buildCasesPath(filters: CaseFilters) {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set("search", filters.search.trim());
  if (filters.status) params.set("status", filters.status);
  if (filters.patientId) params.set("patient_id", filters.patientId);
  const query = params.toString();
  return `/cases${query ? `?${query}` : ""}`;
}

function patientLabel(patient: PatientOption) {
  const name = [patient.first_name, patient.last_name].filter(Boolean).join(" ").trim();
  return `${name || "Patient"} (${patient.patient_id})`;
}

function doctorOptionLabel(doctor: DoctorOption) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialty = doctor.fachbereich?.trim() ? ` · ${doctor.fachbereich.trim()}` : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function historyValuePreview(value: unknown) {
  if (value == null) return "empty";
  if (typeof value === "string") return value || "empty";
  const serialized = JSON.stringify(value);
  if (!serialized) return "empty";
  return serialized.length > 180 ? `${serialized.slice(0, 177)}...` : serialized;
}

function historySectionLabel(section: string) {
  switch (section) {
    case "overview":
      return "Overview";
    case "vorerkrankungen":
      return "Preconditions";
    case "allergien":
      return "Allergies";
    case "operationen":
      return "Operations";
    case "medikamente":
      return "Medication";
    case "pain_records":
      return "Pain records";
    case "symptome":
      return "Symptoms";
    case "cardiology":
      return "Cardiology";
    case "vegetative":
      return "Vegetative";
    case "impfstatus":
      return "Vaccination";
    default:
      return section;
  }
}

function textValue(value: string | null | undefined) {
  return value?.trim() ? value : "Not set";
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

export function CasesPage() {
  const { t } = useLang();
  const { user } = useAuth();
  const navigate = useNavigate();
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
  const [vegetative, setVegetative] = useState<VegetativeState>(blankVegetative());
  const [impfstatus, setImpfstatus] = useState("");
  const [sectionBusy, setSectionBusy] = useState<SectionStatusKey | "">("");
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});

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
          setListError(bannerText(error, "Failed to load cases"));
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
          setDetailError(bannerText(error, "Failed to load case"));
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
      setCreateError(bannerText(error, "Failed to create case"));
    } finally {
      setCreateBusy(false);
    }
  }

  function openPatientWorkspace() {
    if (!detail) return;
    navigate(`/patients?patient=${detail.patient_id}`);
  }

  function openOrdersWorkspace() {
    if (!detail) return;
    navigate(`/orders?patient=${detail.patient_id}`);
  }

  function openAppointmentsWorkspace() {
    if (!detail) return;
    navigate(`/appointments?patient=${detail.patient_id}`);
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
            Case workspace
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            Case management is currently limited to CEO and Patient Manager roles in the backend.
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
                  Cases
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
                Refresh
              </Button>
              {permissions.canCreate ? (
                <Button
                  type="button"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
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
                Reset
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
            <Field label={`${t.cases_referrer} label`}>
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
                            Reference code
                          </div>
                          <div className="mt-2 font-mono text-sm text-slate-900">{detail.case_id}</div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            System case UUID
                          </div>
                          <div className="mt-2 break-all font-mono text-xs text-slate-900">
                            {detail.case_uuid ?? detail.id}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Retention until
                          </div>
                          <div className="mt-2 text-sm text-slate-900">
                            {formatDate(detail.retention_until)}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                            Last clinical update
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
                        Patient
                      </Button>
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={openOrdersWorkspace}>
                        <ClipboardList className="size-4" />
                        Orders
                      </Button>
                      <Button type="button" variant="outline" className="rounded-2xl" onClick={openAppointmentsWorkspace}>
                        <CalendarClock className="size-4" />
                        Appointments
                      </Button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label={t.cases_preconditions} value={detail.vorerkrankungen.length.toString()} description={t.cases_subtitle} icon={<Stethoscope className="size-4" />} />
                    <MetricCard label={t.cases_allergies} value={detail.allergien.length.toString()} description={t.cases_subtitle} icon={<Plus className="size-4" />} />
                    <MetricCard label={t.cases_medication} value={detail.medikamente.length.toString()} description={t.cases_subtitle} icon={<ClipboardList className="size-4" />} />
                    <MetricCard label={t.cases_symptoms} value={detail.symptome.length.toString()} description={t.cases_subtitle} icon={<Search className="size-4" />} />
                    <MetricCard label="Clinical revisions" value={String(detail.version_count ?? detail.history?.length ?? 0)} description="Append-only case history entries" icon={<RefreshCw className="size-4" />} />
                  </div>
                </section>

                <Panel
                  title={t.cases_core_anamnesis}
                  description={t.cases_subtitle}
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
                      <Field label={`${t.cases_referrer} label`}>
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
                    <div className="flex justify-end border-t border-border/70 pt-4">
                      <Button type="submit" className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800" disabled={sectionBusy === "overview" || !permissions.canEdit}>
                        {sectionBusy === "overview" ? <LoaderCircle className="size-4 animate-spin" /> : null}
                        Save overview
                      </Button>
                    </div>
                  </form>
                </Panel>

                <ItemEditorSection title={t.cases_preconditions} description={t.cases_subtitle} count={countFilled(vorerkrankungen, "erkrankung")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "vorerkrankungen"} error={sectionErrors.vorerkrankungen ?? ""} canEdit={permissions.canEdit} onAdd={() => setVorerkrankungen((current) => [...current, blankVorerkrankung()])} onSave={handleSaveVorerkrankungen}>
                  {vorerkrankungen.map((item, index) => (
                    <div key={`vor-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <Field label={t.cases_preconditions}><Input value={item.erkrankung} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { erkrankung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_preconditions}><Input value={item.erstdiagnose ?? ""} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { erstdiagnose: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <Field label={t.cases_note}>
                        <textarea value={item.notiz ?? ""} onChange={(event) => setVorerkrankungen((current) => updateItemAtIndex(current, index, { notiz: event.target.value }))} className="mt-2 min-h-[90px] w-full rounded-xl border border-input bg-white px-3 py-2 text-sm outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100" />
                      </Field>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setVorerkrankungen((current) => removeItemAtIndex(current, index))}>Remove</Button></div>
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
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setAllergien((current) => removeItemAtIndex(current, index))}>Remove</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <ItemEditorSection title={t.cases_operations} description={t.cases_subtitle} count={countFilled(operationen, "grund")} addLabel={t.providers_add_service} emptyTitle={t.common_not_set} emptyText={t.cases_subtitle} busy={sectionBusy === "operationen"} error={sectionErrors.operationen ?? ""} canEdit={permissions.canEdit} onAdd={() => setOperationen((current) => [...current, blankOperation()])} onSave={handleSaveOperationen}>
                  {operationen.map((item, index) => (
                    <div key={`op-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <Field label={t.appointments_date}><Input type="date" value={item.datum ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { datum: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_reason}><Input value={item.grund} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { grund: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={`${t.common_doctor} registry`}>
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
                        <Field label={`${t.common_doctor} label`}><Input value={item.arzt ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { arzt: event.target.value }))} className="h-10 rounded-xl bg-white" placeholder="Legacy / manual fallback" /></Field>
                        <Field label={t.cases_note}><Input value={item.notiz ?? ""} onChange={(event) => setOperationen((current) => updateItemAtIndex(current, index, { notiz: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setOperationen((current) => removeItemAtIndex(current, index))}>Remove</Button></div>
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
                        <Field label={t.cases_medications}><Input value={item.dosis ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { dosis: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.dosis_einheit ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { dosis_einheit: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.einnahmeschema ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { einnahmeschema: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.documents_category}><Input value={item.darreichungsform ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { darreichungsform: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_medications}><Input value={item.einheit ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { einheit: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.providers_service_valid_from}><Input value={item.seit ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { seit: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={t.cases_reason}><Input value={item.grund ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { grund: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                        <Field label={`${t.common_doctor} registry`}>
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
                        <Field label={`${t.common_doctor} label`}><Input value={item.verordnender_arzt ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { verordnender_arzt: event.target.value }))} className="h-10 rounded-xl bg-white" placeholder="Legacy / manual fallback" /></Field>
                        <Field label={t.patients_notes}><Input value={item.anmerkung ?? ""} onChange={(event) => setMedikamente((current) => updateItemAtIndex(current, index, { anmerkung: event.target.value }))} className="h-10 rounded-xl bg-white" /></Field>
                      </div>
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setMedikamente((current) => removeItemAtIndex(current, index))}>Remove</Button></div>
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
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setPainRecords((current) => removeItemAtIndex(current, index))}>Remove</Button></div>
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
                      <div className="mt-3 flex justify-end"><Button type="button" variant="outline" size="sm" className="rounded-2xl" onClick={() => setSymptome((current) => removeItemAtIndex(current, index))}>Remove</Button></div>
                    </div>
                  ))}
                </ItemEditorSection>

                <Panel
                  title="Cardiology sub-flow"
                  description={
                    cardiologyTriggered
                      ? "Specialty branch for cardiology-related symptoms and prior cardiac workup."
                      : "Enable when symptoms or referral indicate cardiology."
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
                        Cardiology relevant
                      </label>
                      {[
                        ["chest_pain", "Chest pain"],
                        ["dyspnea", "Dyspnea"],
                        ["palpitations", "Palpitations"],
                        ["syncope", "Syncope"],
                        ["edema", "Edema"],
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
                      <Field label="Known diagnosis">
                        <Input value={cardiology.known_diagnosis} onChange={(event) => setCardiology((current) => ({ ...current, known_diagnosis: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label="Prior ECG / echo / workup">
                        <Input value={cardiology.prior_cardiac_workup} onChange={(event) => setCardiology((current) => ({ ...current, prior_cardiac_workup: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label="Anticoagulation">
                        <Input value={cardiology.anticoagulation} onChange={(event) => setCardiology((current) => ({ ...current, anticoagulation: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label="CV risk factors">
                        <Input value={cardiology.cardiovascular_risk_factors} onChange={(event) => setCardiology((current) => ({ ...current, cardiovascular_risk_factors: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label="Family history">
                        <Input value={cardiology.family_history} onChange={(event) => setCardiology((current) => ({ ...current, family_history: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                      <Field label="Red flags">
                        <Input value={cardiology.red_flags} onChange={(event) => setCardiology((current) => ({ ...current, red_flags: event.target.value }))} className="h-10 rounded-xl bg-slate-50" />
                      </Field>
                    </div>
                    <Field label="Cardiology notes">
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
                        Save cardiology
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
                        Save vegetative
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
                        Save vaccination
                      </Button>
                    </div>
                  </form>
                </Panel>

                <Panel
                  title="Clinical history"
                  description="Append-only section history with retention metadata for audit and review."
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
                                Previous
                              </div>
                              <p className="mt-2 break-words font-mono text-xs text-slate-700">
                                {historyValuePreview(entry.old_value)}
                              </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                              <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                                New
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
                      title="No clinical revisions yet"
                      text="The case has no persisted section history at the moment."
                    />
                  )}
                </Panel>
              </>
            ) : (
              <div className="flex min-h-[320px] items-center justify-center text-sm text-slate-500">
                Select a case from the roster.
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
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
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
