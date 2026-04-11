import {
  startTransition,
  useDeferredValue,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  LoaderCircle,
  Pencil,
  Plus,
  Printer,
  UserX,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  buildPatientLabelPrintHtml,
  buildPatientTimelineSummary,
  DEFAULT_PATIENT_LABEL_FORMAT_ID,
  filterPatientTimelineItems,
  formatRelatedPatientName,
  formatRelatedPatientOption,
  PATIENT_LABEL_FORMAT_OPTIONS,
  type PatientLabelFormatId,
  type PatientLabelPayload,
  type PatientTimelineRangeFilter,
} from "./patient-detail.helpers";
import {
  PATIENT_CONTRACT_STATUS_OPTIONS,
  getPatientLegalStatusChecklist,
  getPatientLegalStatusCompletion,
  getPatientLegalStatusSummary,
  normalizePatientLegalStatus,
  serializePatientLegalStatus,
  type PatientLegalStatus,
} from "./patient-legal-status";

type PatientDetail = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
  gender: string;
  nationality?: string | null;
  residence_country?: string | null;
  languages?: string[];
  phone_primary?: string | null;
  phone_secondary?: string | null;
  email?: string | null;
  insurance_provider?: string | null;
  insurance_type?: string | null;
  insurance_number?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  address_street?: string | null;
  address_city?: string | null;
  address_zip?: string | null;
  address_country?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  emergency_contact_relation?: string | null;
  legal_status?: unknown;
  notes?: string | null;
};

type PatientAssignment = {
  user_id: string;
  user_name: string;
  user_role: string;
  user_active: boolean;
  assigned_by_name: string | null;
  assigned_at: string;
  revoked_at: string | null;
};

type StaffOption = { id: string; name: string; role: string };

type PatientLookupItem = {
  id: string;
  patient_id: string;
  title?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

type CaseItem = {
  id: string;
  case_id: string;
  status: string;
  hauptanfragegrund?: string | null;
  created_at: string;
};

type OrderItem = {
  id: string;
  order_number: string;
  phase: string;
  status: string;
  needs_description?: string | null;
  created_at: string;
};

type AppointmentItem = {
  id: string;
  title: string;
  date: string;
  time_start?: string | null;
  apt_type: string;
  status: string;
  provider_name?: string | null;
  doctor_name?: string | null;
};

type RelationItem = {
  id: string;
  related_patient_id?: string | null;
  related_patient_pid?: string | null;
  related_name: string;
  related_display_name?: string | null;
  relation_type: string;
  is_emergency_contact: boolean;
  phone?: string | null;
  notes?: string | null;
  created_at: string;
};

type TimelineItem = {
  entity_type: string;
  entity_id: string;
  title: string;
  category: string;
  status: string;
  happened_at: string;
  source_label?: string | null;
};

type DocumentItem = {
  id: string;
  filename: string;
  category?: string | null;
  status?: string | null;
  uploaded_by_name?: string | null;
  created_at: string;
};

type DocumentAlertRule = {
  key: string;
  label: string;
  fulfilled: boolean;
  matching_documents: Array<{
    id: string;
    filename: string;
    art: string;
    category?: string | null;
    status: string;
  }>;
};

type DocumentAlerts = {
  configured_rule_count: number;
  document_pack_complete: boolean;
  stored_document_pack_complete: boolean;
  out_of_sync: boolean;
  required_documents: DocumentAlertRule[];
  missing_documents: Array<{ key: string; label: string }>;
  missing_count: number;
};

type ContractItem = {
  id: string;
  contract_number: string;
  status: string;
  signed_at?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
  created_at: string;
};

type InvoiceItem = {
  id: string;
  invoice_number: string;
  invoice_type: string;
  status: string;
  issued_at: string;
  due_date?: string | null;
  total_gross?: string | null;
  paid_amount?: string | null;
  balance_due?: string | null;
  order_number?: string | null;
  quote_number?: string | null;
};

type RelationFormState = {
  relatedPatientId: string;
  relatedName: string;
  relationType: string;
  isEmergencyContact: boolean;
  phone: string;
  notes: string;
};

type DocumentStatus = "draft" | "active" | "archived";
type DocumentVisibility =
  | "internal"
  | "released_internal"
  | "released_external"
  | "patient_visible";

type DocumentUploadFormState = {
  file: File | null;
  autoName: string;
  art: string;
  category: string;
  status: DocumentStatus;
  visibility: DocumentVisibility;
  isMedical: boolean;
  notes: string;
  orderId: string;
  appointmentId: string;
};

type ContractStatus = "draft" | "sent" | "signed" | "expired" | "terminated";

type ContractFormState = {
  status: ContractStatus;
  validFrom: string;
  validTo: string;
  signedAt: string;
};

type InvoiceStatus = "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "cancelled";

type InvoiceStatusFormState = {
  status: InvoiceStatus;
  dueDate: string;
  paidAmount: string;
  notes: string;
};

type DunningEvent = {
  id: string;
  invoice_id: string;
  level: "first" | "second" | "collections";
  note?: string | null;
  due_date_snapshot?: string | null;
  balance_due: string;
  sent_at: string;
  created_at: string;
  created_by_name: string;
  created_by_role: string;
};

type DunningLevel = "first" | "second" | "collections";

type PatientEditFormState = {
  title: string;
  firstName: string;
  lastName: string;
  phonePrimary: string;
  phoneSecondary: string;
  email: string;
  nationality: string;
  residenceCountry: string;
  languages: string;
  addressStreet: string;
  addressCity: string;
  addressZip: string;
  addressCountry: string;
  insuranceProvider: string;
  insuranceNumber: string;
  insuranceType: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  legalStatus: PatientLegalStatus;
  notes: string;
};

function patientName(p: PatientDetail) {
  const t = p.title ? `${p.title} ` : "";
  const n = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return `${t}${n || p.patient_id}`.trim();
}

function fmtDate(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v.includes("T") ? v : `${v}T00:00:00`));
  } catch { return v; }
}

function fmtDateTime(v?: string | null, fb = "") {
  if (!v) return fb;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v));
  } catch { return v; }
}

function fieldVal(v: string | string[] | null | undefined, fb: string) {
  if (Array.isArray(v)) return v.length ? v.join(", ") : fb;
  return v && v.trim() ? v : fb;
}

function fmtMoney(v?: string | null, currency = "EUR") {
  if (!v) return "Not set";
  const numeric = Number(v);
  if (Number.isNaN(numeric)) return `${v} ${currency}`;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(numeric);
  } catch {
    return `${v} ${currency}`;
  }
}

function toOptional(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toDateTimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0, 16);
}

function genderLbl(v: string | null | undefined, tr: Record<string, string>) {
  switch (v) { case "male": return tr.gender_male; case "female": return tr.gender_female; case "diverse": return tr.gender_diverse; default: return tr.common_not_set; }
}

function insuranceLbl(v: string | null | undefined, tr: Record<string, string>) {
  switch (v) { case "private": return tr.insurance_private; case "public": return tr.insurance_public; case "self_pay": return tr.insurance_self_pay; case "foreign": return tr.insurance_foreign; default: return tr.common_not_set; }
}

function roleLbl(v: string | null | undefined, tr: Record<string, string>) {
  if (!v) return tr.common_unknown;
  return tr[`role_${v}`] ?? v.replaceAll("_", " ");
}

function canAssignTarget(managerRole: string | undefined, targetRole: string) {
  switch (managerRole) {
    case "ceo": return ["patient_manager", "teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "patient_manager": return ["teamlead_interpreter", "interpreter", "concierge"].includes(targetRole);
    case "teamlead_interpreter": return targetRole === "interpreter";
    default: return false;
  }
}

function card(extra?: string) {
  return cn("rounded-[1.75rem] border border-border/70 bg-card shadow-[0_20px_60px_rgba(15,23,42,0.05)]", extra);
}

const selectClassName =
  "h-10 w-full rounded-xl border border-input bg-slate-50 px-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";
const textareaClassName =
  "min-h-[104px] w-full rounded-xl border border-input bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100";

const RELATION_TYPE_OPTIONS = [
  "spouse",
  "parent",
  "child",
  "sibling",
  "relative",
  "guardian",
  "caregiver",
  "friend",
  "other",
] as const;
const DOCUMENT_STATUS_OPTIONS: DocumentStatus[] = ["draft", "active", "archived"];
const DOCUMENT_VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "internal",
  "released_internal",
  "released_external",
  "patient_visible",
];
const CONTRACT_STATUS_OPTIONS: ContractStatus[] = [
  "draft",
  "sent",
  "signed",
  "expired",
  "terminated",
];
const INVOICE_STATUS_OPTIONS: InvoiceStatus[] = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
];
const TIMELINE_RANGE_OPTIONS: Array<{ value: PatientTimelineRangeFilter; label: string }> = [
  { value: "all", label: "All time" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 180 days" },
  { value: "365d", label: "Last 365 days" },
];

function blankRelationForm(): RelationFormState {
  return {
    relatedPatientId: "",
    relatedName: "",
    relationType: "other",
    isEmergencyContact: false,
    phone: "",
    notes: "",
  };
}

function relationToForm(relation: RelationItem): RelationFormState {
  return {
    relatedPatientId: relation.related_patient_id ?? "",
    relatedName: relation.related_name,
    relationType: relation.relation_type,
    isEmergencyContact: relation.is_emergency_contact,
    phone: relation.phone ?? "",
    notes: relation.notes ?? "",
  };
}

function blankDocumentUploadForm(): DocumentUploadFormState {
  return {
    file: null,
    autoName: "",
    art: "report",
    category: "",
    status: "active",
    visibility: "internal",
    isMedical: true,
    notes: "",
    orderId: "",
    appointmentId: "",
  };
}

function blankContractForm(): ContractFormState {
  return {
    status: "draft",
    validFrom: "",
    validTo: "",
    signedAt: "",
  };
}

function contractToForm(contract: ContractItem): ContractFormState {
  return {
    status: (contract.status as ContractStatus) ?? "draft",
    validFrom: contract.valid_from ?? "",
    validTo: contract.valid_to ?? "",
    signedAt: toDateTimeLocal(contract.signed_at),
  };
}

function invoiceToStatusForm(invoice: InvoiceItem): InvoiceStatusFormState {
  return {
    status: (invoice.status as InvoiceStatus) ?? "draft",
    dueDate: invoice.due_date ?? "",
    paidAmount: invoice.paid_amount ?? "",
    notes: "",
  };
}

function nextDunningLevel(events: DunningEvent[]): DunningLevel | null {
  const levels = new Set(events.map((event) => event.level));
  if (!levels.has("first")) return "first";
  if (!levels.has("second")) return "second";
  if (!levels.has("collections")) return "collections";
  return null;
}

function patientToEditForm(detail: PatientDetail): PatientEditFormState {
  return {
    title: detail.title ?? "",
    firstName: detail.first_name ?? "",
    lastName: detail.last_name ?? "",
    phonePrimary: detail.phone_primary ?? "",
    phoneSecondary: detail.phone_secondary ?? "",
    email: detail.email ?? "",
    nationality: detail.nationality ?? "",
    residenceCountry: detail.residence_country ?? "",
    languages: detail.languages?.join(", ") ?? "",
    addressStreet: detail.address_street ?? "",
    addressCity: detail.address_city ?? "",
    addressZip: detail.address_zip ?? "",
    addressCountry: detail.address_country ?? "",
    insuranceProvider: detail.insurance_provider ?? "",
    insuranceNumber: detail.insurance_number ?? "",
    insuranceType: detail.insurance_type ?? "",
    emergencyContactName: detail.emergency_contact_name ?? "",
    emergencyContactPhone: detail.emergency_contact_phone ?? "",
    emergencyContactRelation: detail.emergency_contact_relation ?? "",
    legalStatus: normalizePatientLegalStatus(detail.legal_status),
    notes: detail.notes ?? "",
  };
}

function Lbl({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{children}</span>;
}

function InfoRow({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <div className="group flex flex-col gap-1 relative">
      <Lbl>{label}</Lbl>
      <span className="text-sm text-slate-900">{value}</span>
      {onEdit && (
        <button type="button" onClick={onEdit} className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg p-1 hover:bg-slate-100">
          <Pencil className="size-3 text-slate-400" />
        </button>
      )}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  open: "border-sky-200 bg-sky-50 text-sky-700",
  in_progress: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  draft: "border-slate-200 bg-slate-50 text-slate-700",
  sent: "border-sky-200 bg-sky-50 text-sky-700",
  signed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  overdue: "border-rose-200 bg-rose-50 text-rose-700",
  partially_paid: "border-amber-200 bg-amber-50 text-amber-700",
  paid: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expired: "border-slate-200 bg-slate-50 text-slate-600",
  terminated: "border-red-200 bg-red-50 text-red-700",
  cancelled: "border-red-200 bg-red-50 text-red-700",
  planned: "border-sky-200 bg-sky-50 text-sky-700",
  confirmed: "border-sky-200 bg-sky-50 text-sky-700",
};

const ROLE_COLORS: Record<string, string> = {
  ceo: "bg-purple-100 text-purple-700",
  ceo_assistant: "bg-purple-100 text-purple-700",
  patient_manager: "bg-blue-100 text-blue-700",
  teamlead_interpreter: "bg-cyan-100 text-cyan-700",
  interpreter: "bg-cyan-100 text-cyan-700",
  concierge: "bg-teal-100 text-teal-700",
  billing: "bg-amber-100 text-amber-700",
  sales: "bg-amber-100 text-amber-700",
  it_admin: "bg-slate-100 text-slate-700",
  patient: "bg-emerald-100 text-emerald-700",
};

export function PatientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;

  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [assignments, setAssignments] = useState<PatientAssignment[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);

  const [cases, setCases] = useState<CaseItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [relations, setRelations] = useState<RelationItem[]>([]);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [documentAlerts, setDocumentAlerts] = useState<DocumentAlerts | null>(null);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [tabLoading, setTabLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [version, setVersion] = useState(0);
  const [tabVersion, setTabVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [tabActionError, setTabActionError] = useState("");
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileEditorBusy, setProfileEditorBusy] = useState(false);
  const [profileEditForm, setProfileEditForm] = useState<PatientEditFormState | null>(null);

  const [relationEditorOpen, setRelationEditorOpen] = useState(false);
  const [editingRelation, setEditingRelation] = useState<RelationItem | null>(null);
  const [relationForm, setRelationForm] = useState<RelationFormState>(blankRelationForm);
  const [relationBusy, setRelationBusy] = useState(false);
  const [relationPatientOptions, setRelationPatientOptions] = useState<PatientLookupItem[]>([]);
  const [relationPatientSearch, setRelationPatientSearch] = useState("");
  const [relationPatientOptionsLoading, setRelationPatientOptionsLoading] = useState(false);

  const [documentUploadOpen, setDocumentUploadOpen] = useState(false);
  const [documentUploadForm, setDocumentUploadForm] = useState<DocumentUploadFormState>(blankDocumentUploadForm);
  const [documentUploadBusy, setDocumentUploadBusy] = useState(false);

  const [contractCreateOpen, setContractCreateOpen] = useState(false);
  const [contractCreateForm, setContractCreateForm] = useState<ContractFormState>(blankContractForm);
  const [contractBusy, setContractBusy] = useState(false);
  const [contractStatusId, setContractStatusId] = useState("");
  const [contractStatusForm, setContractStatusForm] = useState<ContractFormState>(blankContractForm);

  const [invoiceManageId, setInvoiceManageId] = useState("");
  const [invoiceStatusForm, setInvoiceStatusForm] = useState<InvoiceStatusFormState>({
    status: "draft",
    dueDate: "",
    paidAmount: "",
    notes: "",
  });
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [dunningBusy, setDunningBusy] = useState(false);
  const [dunningNote, setDunningNote] = useState("");
  const [dunningEvents, setDunningEvents] = useState<DunningEvent[]>([]);
  const [complianceExportBusy, setComplianceExportBusy] = useState(false);
  const [patientLabelBusy, setPatientLabelBusy] = useState(false);
  const [patientLabelFormat, setPatientLabelFormat] =
    useState<PatientLabelFormatId>(DEFAULT_PATIENT_LABEL_FORMAT_ID);
  const [timelineEntityFilter, setTimelineEntityFilter] = useState("all");
  const [timelineCategoryFilter, setTimelineCategoryFilter] = useState("all");
  const [timelineSourceFilter, setTimelineSourceFilter] = useState("all");
  const [timelineRangeFilter, setTimelineRangeFilter] = useState<PatientTimelineRangeFilter>("all");
  const [timelineSearch, setTimelineSearch] = useState("");

  const canManage = user?.role === "ceo" || user?.role === "patient_manager" || user?.role === "teamlead_interpreter";
  const assignableStaff = useMemo(() => staff.filter((s) => canAssignTarget(user?.role, s.role)), [staff, user?.role]);
  const canManageRelations = user?.role === "ceo" || user?.role === "patient_manager";
  const canManageDocuments = user?.role === "ceo" || user?.role === "patient_manager";
  const canManageContracts = user?.role === "patient_manager" || user?.role === "billing";
  const canManageInvoices = user?.role === "ceo" || user?.role === "billing";
  const canEditPatientProfile = user?.role === "ceo" || user?.role === "patient_manager";
  const canExportPatientCompliance = user?.role === "patient_manager";
  const canOpenComplianceWorkspace = user?.role === "patient_manager";
  const canPrintPatientLabel = user?.role === "ceo" || user?.role === "patient_manager";
  const canCreateCase = user?.role === "ceo" || user?.role === "patient_manager";
  const canCreateOrder = user?.role === "ceo" || user?.role === "patient_manager";
  const canCreateAppointment =
    user?.role === "ceo" ||
    user?.role === "patient_manager" ||
    user?.role === "teamlead_interpreter" ||
    user?.role === "concierge";
  const deferredRelationPatientSearch = useDeferredValue(relationPatientSearch);
  const deferredTimelineSearch = useDeferredValue(timelineSearch);

  const relationPatientOptionsFiltered = useMemo(() => {
    const normalizedSearch = deferredRelationPatientSearch.trim().toLowerCase();

    return relationPatientOptions.filter((option) => {
      if (option.id === id) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return formatRelatedPatientOption(option).toLowerCase().includes(normalizedSearch);
    });
  }, [deferredRelationPatientSearch, id, relationPatientOptions]);

  const selectedRelatedPatient = useMemo(
    () =>
      relationPatientOptions.find((option) => option.id === relationForm.relatedPatientId) ?? null,
    [relationForm.relatedPatientId, relationPatientOptions]
  );
  const timelineCategoryOptions = useMemo(
    () =>
      [...new Set(timeline.map((item) => item.category).filter((value) => Boolean(value?.trim())))]
        .toSorted((left, right) => left.localeCompare(right)),
    [timeline]
  );
  const timelineSourceOptions = useMemo(
    () =>
      [...new Set(timeline.map((item) => item.source_label ?? "").filter((value) => Boolean(value.trim())))]
        .toSorted((left, right) => left.localeCompare(right)),
    [timeline]
  );

  const filteredTimeline = useMemo(
    () =>
      filterPatientTimelineItems(timeline, {
        entityFilter: timelineEntityFilter,
        categoryFilter: timelineCategoryFilter,
        sourceFilter: timelineSourceFilter === "all" ? "" : timelineSourceFilter,
        search: deferredTimelineSearch,
        rangeFilter: timelineRangeFilter,
      }),
    [
      deferredTimelineSearch,
      timeline,
      timelineCategoryFilter,
      timelineEntityFilter,
      timelineRangeFilter,
      timelineSourceFilter,
    ]
  );

  const timelineSummary = useMemo(() => buildPatientTimelineSummary(timeline), [timeline]);
  const legalStatus = useMemo(
    () => normalizePatientLegalStatus(detail?.legal_status),
    [detail?.legal_status]
  );
  const legalStatusChecklist = useMemo(
    () => getPatientLegalStatusChecklist(legalStatus),
    [legalStatus]
  );
  const legalStatusCompletion = useMemo(
    () => getPatientLegalStatusCompletion(legalStatus),
    [legalStatus]
  );
  const hasTimelineFilters =
    timelineEntityFilter !== "all" ||
    timelineCategoryFilter !== "all" ||
    timelineSourceFilter !== "all" ||
    timelineRangeFilter !== "all" ||
    deferredTimelineSearch.trim().length > 0;

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const reloadTab = useCallback(() => setTabVersion((v) => v + 1), []);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);

    Promise.all([
      apiFetch<PatientDetail>(`/patients/${id}`),
      apiFetch<PatientAssignment[]>(`/patients/${id}/assignments`).catch(() => []),
      apiFetch<StaffOption[]>("/users?assignable_only=true&active_only=true").catch(() => []),
    ]).then(([d, a, s]) => {
      if (cancelled) return;
      startTransition(() => {
        setDetail(d);
        setAssignments(a);
        setStaff(s);
      });
    }).catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [id, version]);

  useEffect(() => {
    setNotice("");
    setTabActionError("");
  }, [activeTab]);

  useEffect(() => {
    if (!id || activeTab === "profile") return;
    let cancelled = false;
    setTabLoading(true);

    async function loadTabData() {
      try {
        switch (activeTab) {
          case "relations": {
            const result = await apiFetch<RelationItem[]>(`/patients/${id}/relations`);
            if (!cancelled) setRelations(result);
            break;
          }
          case "cases": {
            const result = await apiFetch<CaseItem[]>(`/patients/${id}/cases`);
            if (!cancelled) setCases(result);
            break;
          }
          case "orders": {
            const result = await apiFetch<OrderItem[]>(`/patients/${id}/orders`);
            if (!cancelled) setOrders(result);
            break;
          }
          case "appointments": {
            const result = await apiFetch<AppointmentItem[]>(`/patients/${id}/appointments`);
            if (!cancelled) setAppointments(result);
            break;
          }
          case "documents": {
            const [result, patientOrders, patientAppointments, alerts] = await Promise.all([
              apiFetch<DocumentItem[]>(`/patients/${id}/documents`),
              apiFetch<OrderItem[]>(`/patients/${id}/orders`).catch(() => []),
              apiFetch<AppointmentItem[]>(`/patients/${id}/appointments`).catch(() => []),
              apiFetch<DocumentAlerts>(`/patients/${id}/document-alerts`).catch(() => null),
            ]);
            if (!cancelled) {
              setDocuments(result);
              setOrders(patientOrders);
              setAppointments(patientAppointments);
              setDocumentAlerts(alerts);
            }
            break;
          }
          case "contracts": {
            const result = await apiFetch<ContractItem[]>(`/patients/${id}/framework-contracts`);
            if (!cancelled) setContracts(result);
            break;
          }
          case "invoices": {
            const result = await apiFetch<InvoiceItem[]>(`/patients/${id}/invoices`);
            if (!cancelled) setInvoices(result);
            break;
          }
          case "timeline": {
            const result = await apiFetch<TimelineItem[]>(`/patients/${id}/timeline`);
            if (!cancelled) setTimeline(result);
            break;
          }
          default:
            break;
        }
      } catch {
        if (cancelled) return;
        if (activeTab === "relations") setRelations([]);
        if (activeTab === "cases") setCases([]);
        if (activeTab === "orders") setOrders([]);
        if (activeTab === "appointments") setAppointments([]);
        if (activeTab === "documents") {
          setDocuments([]);
          setDocumentAlerts(null);
        }
        if (activeTab === "contracts") setContracts([]);
        if (activeTab === "invoices") setInvoices([]);
        if (activeTab === "timeline") setTimeline([]);
      } finally {
        if (!cancelled) setTabLoading(false);
      }
    }

    void loadTabData();

    return () => { cancelled = true; };
  }, [id, activeTab, tabVersion]);

  useEffect(() => {
    if (!invoiceManageId) {
      setDunningEvents([]);
      return;
    }
    let cancelled = false;
    apiFetch<DunningEvent[]>(`/invoices/${invoiceManageId}/dunning`)
      .then((items) => {
        if (!cancelled) setDunningEvents(items);
      })
      .catch(() => {
        if (!cancelled) setDunningEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceManageId]);

  useEffect(() => {
    if (!relationEditorOpen || !canManageRelations) {
      return;
    }

    let cancelled = false;
    setRelationPatientOptionsLoading(true);

    apiFetch<PatientLookupItem[]>("/patients?active_only=true")
      .then((items) => {
        if (cancelled) {
          return;
        }
        setRelationPatientOptions(items);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRelationPatientOptions([]);
      })
      .finally(() => {
        if (!cancelled) {
          setRelationPatientOptionsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canManageRelations, relationEditorOpen]);

  const handleAssign = async () => {
    if (!id || !selectedAssignee) return;
    setAssignBusy(true);
    try {
      await apiFetch(`/patients/${id}/assign`, { method: "POST", body: JSON.stringify({ user_id: selectedAssignee }) });
      setSelectedAssignee("");
      reload();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally { setAssignBusy(false); }
  };

  function openCreateRelation() {
    setEditingRelation(null);
    setRelationForm(blankRelationForm());
    setRelationPatientSearch("");
    setRelationEditorOpen(true);
  }

  function openEditRelation(relation: RelationItem) {
    setEditingRelation(relation);
    setRelationForm(relationToForm(relation));
    setRelationPatientSearch(relation.related_display_name || relation.related_name);
    setRelationEditorOpen(true);
  }

  function handleDocumentFileChange(event: ChangeEvent<HTMLInputElement>) {
    setDocumentUploadForm((current) => ({
      ...current,
      file: event.target.files?.[0] ?? null,
    }));
  }

  async function handleSaveRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || (!relationForm.relatedPatientId && !relationForm.relatedName.trim())) {
      setTabActionError(t.common_failed_create);
      return;
    }
    setRelationBusy(true);
    setTabActionError("");
    try {
      const selectedPatientName = selectedRelatedPatient
        ? formatRelatedPatientName(selectedRelatedPatient)
        : null;
      const payload = {
        related_patient_id: relationForm.relatedPatientId || undefined,
        related_name: (selectedPatientName ?? relationForm.relatedName).trim(),
        relation_type: relationForm.relationType,
        is_emergency_contact: relationForm.isEmergencyContact,
        phone: toOptional(relationForm.phone),
        notes: toOptional(relationForm.notes),
      };
      if (editingRelation) {
        await apiFetch(`/patients/${id}/relations/${editingRelation.id}/update`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice(t.common_active);
      } else {
        await apiFetch(`/patients/${id}/relations`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setNotice(t.common_active);
      }
      setRelationEditorOpen(false);
      setEditingRelation(null);
      setRelationForm(blankRelationForm());
      setRelationPatientSearch("");
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setRelationBusy(false);
    }
  }

  async function handleDeleteRelation(relationId: string) {
    if (!id || !window.confirm(t.common_delete)) return;
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/relations/${relationId}/delete`, {
        method: "POST",
      });
      setNotice(t.common_active);
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    }
  }

  async function handleUploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !documentUploadForm.file || !documentUploadForm.art.trim()) {
      setTabActionError(t.common_failed_create);
      return;
    }
    setDocumentUploadBusy(true);
    setTabActionError("");
    try {
      const formData = new FormData();
      formData.append("file", documentUploadForm.file);
      formData.append("patient_id", id);
      if (documentUploadForm.orderId) formData.append("order_id", documentUploadForm.orderId);
      if (documentUploadForm.appointmentId) formData.append("appointment_id", documentUploadForm.appointmentId);
      if (documentUploadForm.autoName.trim()) formData.append("auto_name", documentUploadForm.autoName.trim());
      formData.append("art", documentUploadForm.art.trim());
      if (documentUploadForm.category.trim()) formData.append("category", documentUploadForm.category.trim());
      formData.append("status", documentUploadForm.status);
      formData.append("visibility", documentUploadForm.visibility);
      if (documentUploadForm.isMedical) formData.append("is_medical", "true");
      if (documentUploadForm.notes.trim()) formData.append("notes", documentUploadForm.notes.trim());
      await apiFetch("/documents/upload", {
        method: "POST",
        body: formData,
      });
      setNotice(t.common_active);
      setDocumentUploadOpen(false);
      setDocumentUploadForm(blankDocumentUploadForm());
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setDocumentUploadBusy(false);
    }
  }

  async function handleCreateContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id) return;
    setContractBusy(true);
    setTabActionError("");
    try {
      await apiFetch("/framework-contracts", {
        method: "POST",
        body: JSON.stringify({
          patient_id: id,
          status: contractCreateForm.status,
          valid_from: toOptional(contractCreateForm.validFrom),
          valid_to: toOptional(contractCreateForm.validTo),
          signed_at: toOptional(contractCreateForm.signedAt)
            ? new Date(contractCreateForm.signedAt).toISOString()
            : null,
        }),
      });
      setNotice(t.common_active);
      setContractCreateOpen(false);
      setContractCreateForm(blankContractForm());
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setContractBusy(false);
    }
  }

  function openContractStatusEditor(contract: ContractItem) {
    setContractStatusId(contract.id);
    setContractStatusForm(contractToForm(contract));
  }

  async function handleSaveContractStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!contractStatusId) return;
    setContractBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/framework-contracts/${contractStatusId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: contractStatusForm.status,
          valid_from: toOptional(contractStatusForm.validFrom),
          valid_to: toOptional(contractStatusForm.validTo),
          signed_at: toOptional(contractStatusForm.signedAt)
            ? new Date(contractStatusForm.signedAt).toISOString()
            : null,
        }),
      });
      setNotice(t.common_active);
      setContractStatusId("");
      setContractStatusForm(blankContractForm());
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setContractBusy(false);
    }
  }

  function openInvoiceManager(invoice: InvoiceItem) {
    setInvoiceManageId(invoice.id);
    setInvoiceStatusForm(invoiceToStatusForm(invoice));
    setDunningNote("");
  }

  async function handleSaveInvoiceStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoiceManageId) return;
    setInvoiceBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/invoices/${invoiceManageId}/status`, {
        method: "POST",
        body: JSON.stringify({
          status: invoiceStatusForm.status,
          due_date: toOptional(invoiceStatusForm.dueDate),
          paid_amount: toOptional(invoiceStatusForm.paidAmount)
            ? Number(invoiceStatusForm.paidAmount)
            : null,
          notes: toOptional(invoiceStatusForm.notes),
        }),
      });
      setNotice(t.common_active);
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setInvoiceBusy(false);
    }
  }

  async function handleCreateDunning() {
    const nextLevel = nextDunningLevel(dunningEvents);
    if (!invoiceManageId || !nextLevel) return;
    setDunningBusy(true);
    setTabActionError("");
    try {
      const created = await apiFetch<DunningEvent>(`/invoices/${invoiceManageId}/dunning`, {
        method: "POST",
        body: JSON.stringify({
          level: nextLevel,
          note: toOptional(dunningNote),
        }),
      });
      setDunningEvents((current) => [...current, created]);
      setDunningNote("");
      setNotice(t.common_active);
      reloadTab();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_create);
    } finally {
      setDunningBusy(false);
    }
  }

  async function handleExportPatientCompliance() {
    if (!id) return;
    setComplianceExportBusy(true);
    setTabActionError("");

    try {
      const payload = await apiFetch<unknown>(`/admin/compliance/patient/${id}/export`);
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `${detail?.patient_id ?? "patient"}-dsgvo-export.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice(t.common_active);
    } catch (error) {
      setTabActionError(
        error instanceof Error ? error.message : t.common_failed_create
      );
    } finally {
      setComplianceExportBusy(false);
    }
  }

  async function handlePrintPatientLabel() {
    if (!id) return;

    const printWindow = window.open("", "_blank", "noopener,noreferrer");
    if (!printWindow) {
      setTabActionError("Allow pop-ups to print the patient label.");
      return;
    }

    setPatientLabelBusy(true);
    setTabActionError("");

    try {
      const payload = await apiFetch<PatientLabelPayload>(
        `/patients/${id}/label?format=${encodeURIComponent(patientLabelFormat)}`
      );
      printWindow.document.open();
      printWindow.document.write(buildPatientLabelPrintHtml(payload));
      printWindow.document.close();
      setNotice("Patient label opened for print.");
    } catch (error) {
      printWindow.close();
      setTabActionError(
        error instanceof Error ? error.message : t.common_failed_create
      );
    } finally {
      setPatientLabelBusy(false);
    }
  }

  function openProfileEditor() {
    if (!detail) return;
    setProfileEditForm(patientToEditForm(detail));
    setProfileEditorOpen(true);
  }

  async function handleSavePatientProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!id || !profileEditForm) return;
    setProfileEditorBusy(true);
    setTabActionError("");
    try {
      await apiFetch(`/patients/${id}/update`, {
        method: "POST",
        body: JSON.stringify({
          title: profileEditForm.title,
          first_name: profileEditForm.firstName,
          last_name: profileEditForm.lastName,
          phone_primary: profileEditForm.phonePrimary,
          phone_secondary: profileEditForm.phoneSecondary,
          email: profileEditForm.email,
          nationality: profileEditForm.nationality,
          residence_country: profileEditForm.residenceCountry,
          languages: profileEditForm.languages
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          address_street: profileEditForm.addressStreet,
          address_city: profileEditForm.addressCity,
          address_zip: profileEditForm.addressZip,
          address_country: profileEditForm.addressCountry,
          insurance_provider: profileEditForm.insuranceProvider,
          insurance_number: profileEditForm.insuranceNumber,
          insurance_type: profileEditForm.insuranceType,
          emergency_contact_name: profileEditForm.emergencyContactName,
          emergency_contact_phone: profileEditForm.emergencyContactPhone,
          emergency_contact_relation: profileEditForm.emergencyContactRelation,
          legal_status: serializePatientLegalStatus(profileEditForm.legalStatus),
          notes: profileEditForm.notes,
        }),
      });
      setNotice(t.common_active);
      setProfileEditorOpen(false);
      reload();
    } catch (error) {
      setTabActionError(error instanceof Error ? error.message : t.common_failed_update);
    } finally {
      setProfileEditorBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoaderCircle className="size-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" className="gap-2" onClick={() => navigate("/patients")}>
          <ArrowLeft className="size-4" /> {t.patients_title}
        </Button>
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {error || t.common_failed_load}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={() => navigate("/patients")}>
          <ArrowLeft className="size-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center size-12 rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
              {patientName(detail).split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-slate-950">{patientName(detail)}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                <span className="font-mono">{detail.patient_id}</span>
                <Badge variant="outline" className={cn("rounded-full", detail.is_active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600")}>
                  {detail.is_active ? t.common_active : t.common_inactive}
                </Badge>
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEditPatientProfile ? (
            <Button variant="outline" size="sm" className="gap-2 rounded-xl" onClick={openProfileEditor}>
              <Pencil className="size-3.5" />
              Edit profile
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 rounded-xl"
            onClick={async () => {
              const path = detail.is_active ? `/patients/${id}/deactivate` : `/patients/${id}/activate`;
              try {
                await apiFetch(path, { method: "POST" });
              } catch (error) {
                setError(error instanceof Error ? error.message : String(error));
              }
              reload();
            }}
          >
            <UserX className="size-3.5" />
            {detail.is_active ? t.users_deactivate : t.users_activate}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {canCreateCase ? (
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/cases?patient=${id}&create=1`)}>
            <Plus className="mr-2 size-4" />
            New case
          </Button>
        ) : null}
        {canCreateOrder ? (
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/orders?patient=${id}&create=1`)}>
            <Plus className="mr-2 size-4" />
            New order
          </Button>
        ) : null}
        {canCreateAppointment ? (
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/appointments?patient=${id}&create=1`)}>
            <Plus className="mr-2 size-4" />
            New appointment
          </Button>
        ) : null}
        {canPrintPatientLabel ? (
          <div className="flex flex-wrap items-center gap-2">
            <ShadSelect
              value={patientLabelFormat}
              onValueChange={(value) =>
                setPatientLabelFormat(
                  (value as PatientLabelFormatId) ?? DEFAULT_PATIENT_LABEL_FORMAT_ID
                )
              }
            >
              <SelectTrigger className="w-[210px] rounded-xl bg-white">
                <SelectValue placeholder="Label format" />
              </SelectTrigger>
              <SelectContent>
                {PATIENT_LABEL_FORMAT_OPTIONS.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              disabled={patientLabelBusy}
              onClick={() => void handlePrintPatientLabel()}
            >
              {patientLabelBusy ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : (
                <Printer className="mr-2 size-4" />
              )}
              Print sticker
            </Button>
          </div>
        ) : null}
      </div>

      {/* Quick info cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.patients_birth_date}</Lbl>
          <p className="mt-1 text-sm font-medium text-slate-900">{fmtDate(detail.birth_date, t.common_not_set)}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.patients_gender}</Lbl>
          <p className="mt-1 text-sm font-medium text-slate-900">{genderLbl(detail.gender, tr)}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.patients_insurance_type}</Lbl>
          <p className="mt-1 text-sm font-medium text-slate-900">{insuranceLbl(detail.insurance_type, tr)}</p>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-3">
          <Lbl>{t.patients_nationality}</Lbl>
          <p className="mt-1 text-sm font-medium text-slate-900">{fieldVal(detail.nationality, t.common_not_set)}</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="border-b border-slate-200 flex justify-center">
          <TabsList variant="line" className="w-auto">
            <TabsTrigger value="profile" className="px-4 py-2">{t.patients_profile}</TabsTrigger>
            <TabsTrigger value="relations" className="px-4 py-2">Relations</TabsTrigger>
            <TabsTrigger value="cases" className="px-4 py-2">{t.cases_title}</TabsTrigger>
            <TabsTrigger value="orders" className="px-4 py-2">{t.orders_title}</TabsTrigger>
            <TabsTrigger value="appointments" className="px-4 py-2">{t.appointments_title}</TabsTrigger>
            <TabsTrigger value="documents" className="px-4 py-2">Documents</TabsTrigger>
            <TabsTrigger value="contracts" className="px-4 py-2">Contracts</TabsTrigger>
            <TabsTrigger value="invoices" className="px-4 py-2">Invoices</TabsTrigger>
            <TabsTrigger value="timeline" className="px-4 py-2">Timeline</TabsTrigger>
          </TabsList>
        </div>

        {notice ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {notice}
          </div>
        ) : null}

        {tabActionError ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {tabActionError}
          </div>
        ) : null}

        {/* Profile tab */}
        <TabsContent value="profile" className="space-y-6 mt-4 min-h-[400px]">
          {/* Contact & Demographics */}
          <div className={card("p-6")}>
            <h2 className="text-sm font-semibold text-slate-950 mb-4">{t.patients_profile}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <InfoRow label={t.patients_phone_primary} value={fieldVal(detail.phone_primary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_phone_secondary} value={fieldVal(detail.phone_secondary, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_email} value={fieldVal(detail.email, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_languages} value={fieldVal(detail.languages, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_residence_country} value={fieldVal(detail.residence_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_insurance_provider} value={fieldVal(detail.insurance_provider, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_insurance_number} value={fieldVal(detail.insurance_number, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
            </div>
          </div>

          {/* Address */}
          <div className={card("p-6")}>
            <h2 className="text-sm font-semibold text-slate-950 mb-4">{t.patients_address_street}</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <InfoRow label={t.patients_address_street} value={fieldVal(detail.address_street, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_address_city} value={fieldVal(detail.address_city, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_address_zip} value={fieldVal(detail.address_zip, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_address_country} value={fieldVal(detail.address_country, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
            </div>
          </div>

          {/* Emergency */}
          <div className={card("p-6")}>
            <h2 className="text-sm font-semibold text-slate-950 mb-4">{t.patients_emergency_name}</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <InfoRow label={t.patients_emergency_name} value={fieldVal(detail.emergency_contact_name, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_emergency_phone} value={fieldVal(detail.emergency_contact_phone, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
              <InfoRow label={t.patients_emergency_relation} value={fieldVal(detail.emergency_contact_relation, t.common_not_set)} onEdit={canEditPatientProfile ? openProfileEditor : undefined} />
            </div>
          </div>

          <div className={card("p-6")}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">{t.patients_legal_status}</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {getPatientLegalStatusSummary(legalStatus)}
                </p>
              </div>
              {canEditPatientProfile ? (
                <Button type="button" variant="outline" className="rounded-xl" onClick={openProfileEditor}>
                  <Pencil className="mr-2 size-3.5" />
                  Update compliance
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 xl:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Contract status
                </p>
                <p className="mt-3 text-lg font-semibold text-slate-950">
                  {legalStatus.contractStatus.replaceAll("_", " ")}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {legalStatusCompletion.completed}/{legalStatusCompletion.total} compliance checks done
                </p>
              </div>
              {legalStatusChecklist.map((item) => (
                <div key={item.key} className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                    {item.label}
                  </p>
                  <Badge
                    variant="outline"
                    className={cn(
                      "mt-3 rounded-full text-[10px]",
                      item.done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                    )}
                  >
                    {item.done ? t.common_active : t.mfa_pending}
                  </Badge>
                </div>
              ))}
            </div>

            {legalStatus.notes ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Compliance notes
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{legalStatus.notes}</p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Compliance handoff
                </p>
                <p className="mt-2 text-sm text-slate-600">
                  Use the patient profile as the operational source for DSGVO readiness, then continue consent, erasure and restriction handling in the dedicated compliance workspace.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {canExportPatientCompliance ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      disabled={complianceExportBusy}
                      onClick={() => void handleExportPatientCompliance()}
                    >
                      {complianceExportBusy ? (
                        <LoaderCircle className="mr-2 size-4 animate-spin" />
                      ) : null}
                      DSGVO export
                    </Button>
                  ) : null}
                  {canOpenComplianceWorkspace ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => navigate(`/admin/compliance?patient=${id}`)}
                    >
                      Open DSGVO workspace
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => navigate(`/documents?patient=${id}`)}
                  >
                    Open documents
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => navigate(`/contracts?patient=${id}`)}
                  >
                    Open contracts
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                  Operational boundary
                </p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  <li>Legal readiness is patient-bound here.</li>
                  <li>Consent register still lives in the DSGVO admin workspace.</li>
                  <li>Execution should not start before compliance is complete.</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Notes */}
          {detail.notes && (
            <div className={card("p-6")}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-950">{t.patients_notes}</h2>
                {canEditPatientProfile ? (
                  <Button type="button" variant="ghost" className="rounded-xl px-3 text-slate-500 hover:text-slate-900" onClick={openProfileEditor}>
                    <Pencil className="mr-2 size-3.5" />
                    Edit
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{detail.notes}</p>
            </div>
          )}

          {/* Assignments */}
          <div className={card("p-6")}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-slate-950">{t.patients_assign_owner}</h2>
              <span className="text-xs text-slate-400">{assignments.length} {t.patients_records}</span>
            </div>

            {assignments.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">{t.patients_no_assignments}</p>
            ) : (
              <div className="space-y-3">
                {assignments.map((item) => (
                  <div key={`${item.user_id}-${item.assigned_at}`} className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white p-4">
                    <div className="flex items-center justify-center size-10 shrink-0 rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                      {item.user_name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-900">{item.user_name}</span>
                        <Badge className={cn("text-[10px]", ROLE_COLORS[item.user_role] ?? "bg-slate-100 text-slate-700")}>
                          {roleLbl(item.user_role, tr)}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-slate-500">
                        <span>{fmtDateTime(item.assigned_at)}</span>
                        <span>{t.patients_assigned_by} {item.assigned_by_name || t.common_unknown}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={cn("rounded-full", item.revoked_at ? "border-red-200 bg-red-50 text-red-600" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                        {item.revoked_at ? t.patients_revoked : t.common_active}
                      </Badge>
                      {canManage && !item.revoked_at && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"
                          onClick={async () => {
                            await apiFetch(`/patients/${id}/revoke`, {
                              method: "POST",
                              body: JSON.stringify({ user_id: item.user_id }),
                            }).catch(() => {});
                            reload();
                          }}
                        >
                          <UserX className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {canManage && (
              <div className="mt-4 pt-4 border-t border-slate-100 flex gap-3">
                <ShadSelect value={selectedAssignee} onValueChange={(v) => setSelectedAssignee(v ?? "")}>
                  <SelectTrigger className="h-10 rounded-xl bg-slate-50 flex-1">
                    <SelectValue>
                      {selectedAssignee
                        ? (() => { const s = assignableStaff.find((i) => i.id === selectedAssignee); return s ? `${s.name} · ${roleLbl(s.role, tr)}` : selectedAssignee; })()
                        : t.patients_assign_owner}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {assignableStaff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} · {roleLbl(s.role, tr)}</SelectItem>
                    ))}
                  </SelectContent>
                </ShadSelect>
                <Button className="rounded-xl bg-slate-950 text-white hover:bg-slate-800 h-10 px-5" disabled={assignBusy || !selectedAssignee} onClick={handleAssign}>
                  {assignBusy ? <LoaderCircle className="size-4 animate-spin" /> : t.patients_assign_owner}
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="relations" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Patient chain</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">Relations and emergency contacts</h3>
            </div>
            {canManageRelations ? (
              <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={openCreateRelation}>
                <Plus className="mr-2 size-4" />
                New relation
              </Button>
            ) : null}
          </div>
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : relations.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">No linked relations yet.</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {relations.map((relation) => (
                <div key={relation.id} className={card("p-5")}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-950">{relation.related_display_name || relation.related_name}</p>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full text-[10px]">{relation.relation_type}</Badge>
                      {relation.is_emergency_contact ? <Badge className="rounded-full bg-rose-100 text-rose-700">Emergency</Badge> : null}
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-sm text-slate-600">
                    {relation.related_patient_pid ? <p className="font-mono text-xs text-slate-400">{relation.related_patient_pid}</p> : null}
                    {relation.phone ? <p>{relation.phone}</p> : null}
                    {relation.notes ? <p>{relation.notes}</p> : null}
                    <p className="text-xs text-slate-400">{fmtDateTime(relation.created_at)}</p>
                  </div>
                  {canManageRelations || relation.related_patient_id ? (
                    <div className="mt-4 flex gap-2">
                      {relation.related_patient_id ? (
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => navigate(`/patients/${relation.related_patient_id}`)}
                        >
                          Open patient
                        </Button>
                      ) : null}
                      {canManageRelations ? (
                        <>
                          <Button type="button" variant="outline" className="rounded-xl" onClick={() => openEditRelation(relation)}>
                            Edit
                          </Button>
                          <Button type="button" variant="outline" className="rounded-xl border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => void handleDeleteRelation(relation.id)}>
                            Delete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Cases tab */}
        <TabsContent value="cases" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : cases.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.cases_no_match}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {cases.map((c) => (
                <button key={c.id} type="button" onClick={() => navigate(`/cases?case=${c.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">{c.case_id}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[c.status] ?? "")}>{tr[`cases_${c.status}`] ?? c.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{c.hauptanfragegrund || t.common_not_set}</p>
                  <p className="mt-1 text-xs text-slate-400">{fmtDate(c.created_at)}</p>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Orders tab */}
        <TabsContent value="orders" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : orders.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {orders.map((o) => (
                <button key={o.id} type="button" onClick={() => navigate(`/orders?order=${o.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-400">{o.order_number}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[o.status] ?? "")}>{o.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{o.needs_description || o.order_number}</p>
                  <div className="flex gap-2 mt-1 text-xs text-slate-400">
                    <span>{o.phase}</span>
                    <span>{fmtDate(o.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Appointments tab */}
        <TabsContent value="appointments" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : appointments.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {appointments.map((a) => (
                <button key={a.id} type="button" onClick={() => navigate(`/appointments?appointment=${a.id}`)} className={card("p-5 text-left hover:-translate-y-0.5 hover:shadow-lg transition")}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{a.apt_type}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[a.status] ?? "")}>{a.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm font-medium text-slate-900">{a.title}</p>
                  <div className="flex gap-2 mt-1 text-xs text-slate-400">
                    <span>{fmtDate(a.date)}</span>
                    {a.time_start && <span>{a.time_start}</span>}
                    {a.provider_name && <span>· {a.provider_name}</span>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Documents tab */}
        <TabsContent value="documents" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Patient files</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">Documents linked to this patient</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/documents?patient=${id}`)}>
                Open workspace
              </Button>
              {canManageDocuments ? (
                <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => setDocumentUploadOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  Upload document
                </Button>
              ) : null}
            </div>
          </div>
          {!tabLoading && documentAlerts && documentAlerts.configured_rule_count > 0 ? (
            <div
              className={cn(
                "mb-4 rounded-[1.6rem] border px-5 py-4",
                documentAlerts.document_pack_complete
                  ? "border-emerald-200 bg-emerald-50"
                  : "border-amber-200 bg-amber-50"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Required documents
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-slate-950">
                    {documentAlerts.document_pack_complete
                      ? "Minimum document pack is complete"
                      : `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} missing`}
                  </h4>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "rounded-full text-[10px]",
                    documentAlerts.document_pack_complete
                      ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                      : "border-amber-200 bg-amber-100 text-amber-800"
                  )}
                >
                  {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
                  {documentAlerts.configured_rule_count} fulfilled
                </Badge>
              </div>
              {documentAlerts.missing_count > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {documentAlerts.missing_documents.map((item) => (
                    <Badge
                      key={item.key}
                      variant="outline"
                      className="rounded-full border-amber-300 bg-white text-amber-800"
                    >
                      {item.label}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {documentAlerts.out_of_sync ? (
                <p className="mt-3 text-xs text-slate-600">
                  The stored compliance flag for “Document pack complete” is not aligned with the current document inventory.
                </p>
              ) : null}
            </div>
          ) : null}
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : documents.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">{t.common_not_set}</p></div>
          ) : (
            <div className={card("overflow-hidden")}>
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-5 py-3 border-b bg-slate-900">
                {[t.documents_filename, t.appointments_type, t.users_status, t.patients_assigned_by, t.users_created].map((h) => (
                  <span key={h} className="text-[11px] font-semibold uppercase tracking-wider text-white/80">{h}</span>
                ))}
              </div>
              {documents.map((doc, idx) => (
                <div
                  key={doc.id}
                  className={cn(
                    "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 items-center px-5 py-3 hover:bg-slate-50/60 transition-colors cursor-pointer",
                    idx < documents.length - 1 && "border-b border-border/30"
                  )}
                  onClick={() => window.open(`/api/v1/documents/${doc.id}/download`, "_blank")}
                >
                  <span className="text-sm font-medium text-slate-900 truncate">{doc.filename}</span>
                  <span className="text-xs text-slate-500">{doc.category ?? t.common_not_set}</span>
                  <Badge variant="outline" className={cn("rounded-full text-[10px] w-fit", STATUS_COLORS[doc.status ?? ""] ?? "border-slate-200 bg-slate-50 text-slate-600")}>
                    {doc.status ?? t.common_not_set}
                  </Badge>
                  <span className="text-xs text-slate-500">{doc.uploaded_by_name ?? t.common_unknown}</span>
                  <span className="text-xs text-slate-400">{fmtDate(doc.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Framework billing</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">Contracts for this patient</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/contracts?patient=${id}`)}>
                Open workspace
              </Button>
              {canManageContracts ? (
                <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => setContractCreateOpen(true)}>
                  <Plus className="mr-2 size-4" />
                  New contract
                </Button>
              ) : null}
            </div>
          </div>
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : contracts.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">No framework contracts yet.</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {contracts.map((contract) => (
                <div
                  key={contract.id}
                  className={card("p-5")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-mono text-slate-400">{contract.contract_number}</span>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[contract.status] ?? "")}>
                      {contract.status}
                    </Badge>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-slate-600">
                    <p>Signed: {fmtDateTime(contract.signed_at, t.common_not_set)}</p>
                    <p>Valid from: {fmtDate(contract.valid_from, t.common_not_set)}</p>
                    <p>Valid to: {fmtDate(contract.valid_to, t.common_not_set)}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/contracts?contract=${contract.id}`)}>
                      Open
                    </Button>
                    {canManageContracts ? (
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => openContractStatusEditor(contract)}>
                        Update status
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="invoices" className="mt-4 min-h-[400px]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Patient billing</p>
              <h3 className="mt-1 text-sm font-semibold text-slate-950">Invoices and payment follow-up</h3>
            </div>
            <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/invoices?patient=${id}`)}>
              Open workspace
            </Button>
          </div>
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : invoices.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">No invoices yet.</p></div>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className={card("w-full p-5 text-left")}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{invoice.invoice_number}</span>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[invoice.status] ?? "")}>
                        {invoice.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400">{fmtDateTime(invoice.issued_at)}</p>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4 text-sm text-slate-600">
                    <p>Type: {invoice.invoice_type}</p>
                    <p>Total: {fmtMoney(invoice.total_gross)}</p>
                    <p>Paid: {fmtMoney(invoice.paid_amount)}</p>
                    <p>Open: {fmtMoney(invoice.balance_due)}</p>
                    <p>Due: {fmtDate(invoice.due_date, t.common_not_set)}</p>
                    <p>Order: {invoice.order_number ?? t.common_not_set}</p>
                    <p>Quote: {invoice.quote_number ?? t.common_not_set}</p>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button type="button" variant="outline" className="rounded-xl" onClick={() => navigate(`/invoices?invoice=${invoice.id}`)}>
                      Open
                    </Button>
                    {canManageInvoices ? (
                      <Button type="button" variant="outline" className="rounded-xl" onClick={() => openInvoiceManager(invoice)}>
                        Manage billing
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="timeline" className="mt-4 min-h-[400px]">
          {tabLoading ? (
            <div className="flex items-center justify-center py-16"><LoaderCircle className="size-5 animate-spin text-slate-400" /></div>
          ) : timeline.length === 0 ? (
            <div className={card("p-8 text-center")}><p className="text-sm text-slate-500">No timeline events yet.</p></div>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Total events</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.total}</p>
                  <p className="mt-1 text-xs text-slate-500">All recorded patient workflow touchpoints.</p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Open items</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.open}</p>
                  <p className="mt-1 text-xs text-slate-500">Events that still require operational follow-through.</p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Last 30 days</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.recent}</p>
                  <p className="mt-1 text-xs text-slate-500">Recent movement across care, billing and documents.</p>
                </div>
                <div className={card("p-4")}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Domains active</p>
                  <p className="mt-3 text-2xl font-semibold text-slate-950">{timelineSummary.entityCounts.length}</p>
                  <p className="mt-1 text-xs text-slate-500">Unique workstreams already touching this patient.</p>
                </div>
              </div>

              <div className={card("p-4")}>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant={timelineEntityFilter === "all" ? "default" : "outline"}
                    className={cn(
                      "rounded-full",
                      timelineEntityFilter === "all"
                        ? "bg-slate-950 text-white hover:bg-slate-800"
                        : ""
                    )}
                    onClick={() => setTimelineEntityFilter("all")}
                  >
                    All · {timelineSummary.total}
                  </Button>
                  {timelineSummary.entityCounts.map((entry) => (
                    <Button
                      key={entry.entityType}
                      type="button"
                      variant={timelineEntityFilter === entry.entityType ? "default" : "outline"}
                      className={cn(
                        "rounded-full",
                        timelineEntityFilter === entry.entityType
                          ? "bg-slate-950 text-white hover:bg-slate-800"
                          : ""
                      )}
                      onClick={() => setTimelineEntityFilter(entry.entityType)}
                    >
                      {entry.entityType} · {entry.count}
                    </Button>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-[180px_220px_240px_minmax(0,1fr)_auto]">
                  <ShadSelect value={timelineRangeFilter} onValueChange={(value) => setTimelineRangeFilter((value as PatientTimelineRangeFilter) ?? "all")}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIMELINE_RANGE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <ShadSelect value={timelineCategoryFilter} onValueChange={(value) => setTimelineCategoryFilter(value ?? "all")}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-50">
                      <SelectValue placeholder={t.providers_all} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {timelineCategoryOptions.map((category) => (
                        <SelectItem key={category} value={category}>
                          {category}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <ShadSelect value={timelineSourceFilter} onValueChange={(value) => setTimelineSourceFilter(value ?? "all")}>
                    <SelectTrigger className="h-10 rounded-xl bg-slate-50">
                      <SelectValue placeholder={t.providers_all} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {timelineSourceOptions.map((source) => (
                        <SelectItem key={source} value={source}>
                          {source}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </ShadSelect>
                  <Input
                    value={timelineSearch}
                    onChange={(event) => setTimelineSearch(event.target.value)}
                    placeholder={t.common_search}
                    className="w-full"
                  />
                  {hasTimelineFilters ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => {
                        setTimelineEntityFilter("all");
                        setTimelineCategoryFilter("all");
                        setTimelineSourceFilter("all");
                        setTimelineRangeFilter("all");
                        setTimelineSearch("");
                      }}
                    >
                      Reset filters
                    </Button>
                  ) : null}
                </div>
              </div>

              {filteredTimeline.length === 0 ? (
                <div className={card("p-8 text-center")}>
                  <p className="text-sm text-slate-500">No timeline events match the current filters.</p>
                </div>
              ) : (
                <div className="space-y-3">
              {filteredTimeline.map((item) => (
                <button
                  key={`${item.entity_type}-${item.entity_id}`}
                  type="button"
                  onClick={() => {
                    if (item.entity_type === "case") navigate(`/cases?case=${item.entity_id}`);
                    else if (item.entity_type === "order") navigate(`/orders?order=${item.entity_id}`);
                    else if (item.entity_type === "appointment") navigate(`/appointments?appointment=${item.entity_id}`);
                    else if (item.entity_type === "document") navigate(`/documents?document=${item.entity_id}`);
                    else if (item.entity_type === "contract") navigate(`/contracts?contract=${item.entity_id}`);
                    else if (item.entity_type === "invoice") navigate(`/invoices?invoice=${item.entity_id}`);
                    else if (item.entity_type === "compliance" && canOpenComplianceWorkspace) navigate("/admin/compliance");
                  }}
                  className={card(
                    cn(
                      "w-full p-5 text-left transition",
                      item.entity_type === "compliance" && !canOpenComplianceWorkspace
                        ? ""
                        : "hover:-translate-y-0.5 hover:shadow-lg"
                    )
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full text-[10px]">{item.entity_type}</Badge>
                      <Badge variant="outline" className={cn("rounded-full text-[10px]", STATUS_COLORS[item.status] ?? "")}>{item.status}</Badge>
                    </div>
                    <p className="text-xs text-slate-400">{fmtDateTime(item.happened_at)}</p>
                  </div>
                  <p className="mt-3 text-sm font-semibold text-slate-950">{item.title}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{item.category}</span>
                    {item.source_label ? <span>· {item.source_label}</span> : null}
                  </div>
                </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={profileEditorOpen} onOpenChange={setProfileEditorOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Edit patient profile</DialogTitle>
            <DialogDescription>
              Update operational contact data, insurance context, legal compliance and emergency chain without leaving the patient card.
            </DialogDescription>
          </DialogHeader>
          {profileEditForm ? (
            <form className="space-y-5" onSubmit={handleSavePatientProfile}>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="patient-title-edit">Title</Label>
                  <Input id="patient-title-edit" value={profileEditForm.title} onChange={(event) => setProfileEditForm((current) => current ? { ...current, title: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-first-name-edit">First name</Label>
                  <Input id="patient-first-name-edit" value={profileEditForm.firstName} onChange={(event) => setProfileEditForm((current) => current ? { ...current, firstName: event.target.value } : current)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-last-name-edit">Last name</Label>
                  <Input id="patient-last-name-edit" value={profileEditForm.lastName} onChange={(event) => setProfileEditForm((current) => current ? { ...current, lastName: event.target.value } : current)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-phone-primary-edit">Primary phone</Label>
                  <Input id="patient-phone-primary-edit" value={profileEditForm.phonePrimary} onChange={(event) => setProfileEditForm((current) => current ? { ...current, phonePrimary: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-phone-secondary-edit">Secondary phone</Label>
                  <Input id="patient-phone-secondary-edit" value={profileEditForm.phoneSecondary} onChange={(event) => setProfileEditForm((current) => current ? { ...current, phoneSecondary: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-email-edit">Email</Label>
                  <Input id="patient-email-edit" value={profileEditForm.email} onChange={(event) => setProfileEditForm((current) => current ? { ...current, email: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-languages-edit">Languages</Label>
                  <Input id="patient-languages-edit" value={profileEditForm.languages} onChange={(event) => setProfileEditForm((current) => current ? { ...current, languages: event.target.value } : current)} placeholder="de, uk, en" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-nationality-edit">Nationality</Label>
                  <Input id="patient-nationality-edit" value={profileEditForm.nationality} onChange={(event) => setProfileEditForm((current) => current ? { ...current, nationality: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-residence-edit">Residence country</Label>
                  <Input id="patient-residence-edit" value={profileEditForm.residenceCountry} onChange={(event) => setProfileEditForm((current) => current ? { ...current, residenceCountry: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-address-street-edit">Street</Label>
                  <Input id="patient-address-street-edit" value={profileEditForm.addressStreet} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressStreet: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-address-city-edit">City</Label>
                  <Input id="patient-address-city-edit" value={profileEditForm.addressCity} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressCity: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-address-zip-edit">ZIP</Label>
                  <Input id="patient-address-zip-edit" value={profileEditForm.addressZip} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressZip: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-address-country-edit">Address country</Label>
                  <Input id="patient-address-country-edit" value={profileEditForm.addressCountry} onChange={(event) => setProfileEditForm((current) => current ? { ...current, addressCountry: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-insurance-provider-edit">Insurance provider</Label>
                  <Input id="patient-insurance-provider-edit" value={profileEditForm.insuranceProvider} onChange={(event) => setProfileEditForm((current) => current ? { ...current, insuranceProvider: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-insurance-number-edit">Insurance number</Label>
                  <Input id="patient-insurance-number-edit" value={profileEditForm.insuranceNumber} onChange={(event) => setProfileEditForm((current) => current ? { ...current, insuranceNumber: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-insurance-type-edit">Insurance type</Label>
                  <select id="patient-insurance-type-edit" className={selectClassName} value={profileEditForm.insuranceType} onChange={(event) => setProfileEditForm((current) => current ? { ...current, insuranceType: event.target.value } : current)}>
                    <option value="">Not set</option>
                    <option value="private">private</option>
                    <option value="public">public</option>
                    <option value="self_pay">self_pay</option>
                    <option value="foreign">foreign</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-emergency-name-edit">Emergency contact</Label>
                  <Input id="patient-emergency-name-edit" value={profileEditForm.emergencyContactName} onChange={(event) => setProfileEditForm((current) => current ? { ...current, emergencyContactName: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-emergency-phone-edit">Emergency phone</Label>
                  <Input id="patient-emergency-phone-edit" value={profileEditForm.emergencyContactPhone} onChange={(event) => setProfileEditForm((current) => current ? { ...current, emergencyContactPhone: event.target.value } : current)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="patient-emergency-relation-edit">Emergency relation</Label>
                  <Input id="patient-emergency-relation-edit" value={profileEditForm.emergencyContactRelation} onChange={(event) => setProfileEditForm((current) => current ? { ...current, emergencyContactRelation: event.target.value } : current)} />
                </div>
              </div>
              <div className={card("p-4")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">{t.patients_legal_status}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      Capture the DSGVO, contract and document-readiness state directly on the patient record.
                    </p>
                  </div>
                  <Badge variant="outline" className="rounded-full border-slate-200 bg-slate-50 text-slate-700">
                    {getPatientLegalStatusSummary(profileEditForm.legalStatus)}
                  </Badge>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={profileEditForm.legalStatus.dsgvoSigned}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? {
                                ...current,
                                legalStatus: {
                                  ...current.legalStatus,
                                  dsgvoSigned: event.target.checked,
                                },
                              }
                            : current
                        )
                      }
                    />
                    DSGVO signed
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={profileEditForm.legalStatus.confidentialityReleaseSigned}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? {
                                ...current,
                                legalStatus: {
                                  ...current.legalStatus,
                                  confidentialityReleaseSigned: event.target.checked,
                                },
                              }
                            : current
                        )
                      }
                    />
                    Schweigepflicht released
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={profileEditForm.legalStatus.identityVerified}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? {
                                ...current,
                                legalStatus: {
                                  ...current.legalStatus,
                                  identityVerified: event.target.checked,
                                },
                              }
                            : current
                        )
                      }
                    />
                    Identity verified
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={profileEditForm.legalStatus.documentPackComplete}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? {
                                ...current,
                                legalStatus: {
                                  ...current.legalStatus,
                                  documentPackComplete: event.target.checked,
                                },
                              }
                            : current
                        )
                      }
                    />
                    Document pack complete
                  </label>
                  <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={profileEditForm.legalStatus.complianceCompleted}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? {
                                ...current,
                                legalStatus: {
                                  ...current.legalStatus,
                                  complianceCompleted: event.target.checked,
                                },
                              }
                            : current
                        )
                      }
                    />
                    Compliance completed
                  </label>
                  <div className="space-y-2">
                    <Label htmlFor="patient-contract-status-edit">Contract status</Label>
                    <select
                      id="patient-contract-status-edit"
                      className={selectClassName}
                      value={profileEditForm.legalStatus.contractStatus}
                      onChange={(event) =>
                        setProfileEditForm((current) =>
                          current
                            ? {
                                ...current,
                                legalStatus: {
                                  ...current.legalStatus,
                                  contractStatus: event.target.value,
                                },
                              }
                            : current
                        )
                      }
                    >
                      {PATIENT_CONTRACT_STATUS_OPTIONS.map((status) => (
                        <option key={status} value={status}>
                          {status.replaceAll("_", " ")}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <Label htmlFor="patient-legal-notes-edit">Compliance notes</Label>
                  <textarea
                    id="patient-legal-notes-edit"
                    className={textareaClassName}
                    value={profileEditForm.legalStatus.notes}
                    onChange={(event) =>
                      setProfileEditForm((current) =>
                        current
                          ? {
                              ...current,
                              legalStatus: {
                                ...current.legalStatus,
                                notes: event.target.value,
                              },
                            }
                          : current
                      )
                    }
                    placeholder="Pending signatures, missing IDs, open compliance questions"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="patient-notes-edit">Notes</Label>
                <textarea id="patient-notes-edit" className={textareaClassName} value={profileEditForm.notes} onChange={(event) => setProfileEditForm((current) => current ? { ...current, notes: event.target.value } : current)} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" className="rounded-xl" onClick={() => setProfileEditorOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={profileEditorBusy}>
                  {profileEditorBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  Save patient
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={relationEditorOpen} onOpenChange={setRelationEditorOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingRelation ? "Edit relation" : "Add relation"}</DialogTitle>
            <DialogDescription>
              Keep relatives, caregivers and emergency contacts directly on the patient profile.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveRelation}>
            <div className={card("p-4")}>
              <div className="grid gap-4 md:grid-cols-[1.2fr_1.8fr]">
                <div className="space-y-2">
                  <Label htmlFor="relation-patient-search">Search existing patient</Label>
                  <Input
                    id="relation-patient-search"
                    value={relationPatientSearch}
                    onChange={(event) => setRelationPatientSearch(event.target.value)}
                    placeholder="PID or patient name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="relation-linked-patient">Link patient in system</Label>
                  <select
                    id="relation-linked-patient"
                    className={selectClassName}
                    value={relationForm.relatedPatientId}
                    onChange={(event) => {
                      const nextPatientId = event.target.value;
                      const selectedPatient =
                        relationPatientOptions.find((option) => option.id === nextPatientId) ?? null;
                      setRelationPatientSearch(
                        selectedPatient ? formatRelatedPatientOption(selectedPatient) : ""
                      );
                      setRelationForm((current) => ({
                        ...current,
                        relatedPatientId: nextPatientId,
                        relatedName: selectedPatient
                          ? formatRelatedPatientName(selectedPatient)
                          : current.relatedName,
                      }));
                    }}
                    disabled={relationPatientOptionsLoading}
                  >
                    <option value="">Standalone contact</option>
                    {relationPatientOptionsFiltered.map((option) => (
                      <option key={option.id} value={option.id}>
                        {formatRelatedPatientOption(option)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    {relationPatientOptionsLoading
                      ? "Loading patient directory..."
                      : selectedRelatedPatient
                        ? "Linked relations stay synced to an existing patient record."
                        : "Keep this empty for relatives or caregivers who are not patients in the system."}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="relation-name">Name</Label>
                <Input
                  id="relation-name"
                  value={relationForm.relatedName}
                  onChange={(event) => setRelationForm((current) => ({ ...current, relatedName: event.target.value }))}
                  placeholder="Relative or caregiver name"
                  disabled={Boolean(relationForm.relatedPatientId)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="relation-type">Relation type</Label>
                <select
                  id="relation-type"
                  className={selectClassName}
                  value={relationForm.relationType}
                  onChange={(event) => setRelationForm((current) => ({ ...current, relationType: event.target.value }))}
                >
                  {RELATION_TYPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="relation-phone">Phone</Label>
                <Input
                  id="relation-phone"
                  value={relationForm.phone}
                  onChange={(event) => setRelationForm((current) => ({ ...current, phone: event.target.value }))}
                  placeholder="+49 ..."
                />
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={relationForm.isEmergencyContact}
                  onChange={(event) =>
                    setRelationForm((current) => ({
                      ...current,
                      isEmergencyContact: event.target.checked,
                    }))
                  }
                />
                Emergency contact
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="relation-notes">Notes</Label>
              <textarea
                id="relation-notes"
                className={textareaClassName}
                value={relationForm.notes}
                onChange={(event) => setRelationForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Availability, contact notes or special instructions"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setRelationEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={relationBusy}>
                {relationBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {editingRelation ? t.common_save : t.common_save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={documentUploadOpen} onOpenChange={setDocumentUploadOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Upload patient document</DialogTitle>
            <DialogDescription>
              Files uploaded here are linked directly to this patient and can also be attached to an order or appointment.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleUploadDocument}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="document-file">File</Label>
                <Input id="document-file" type="file" onChange={handleDocumentFileChange} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-name">Display name</Label>
                <Input
                  id="document-name"
                  value={documentUploadForm.autoName}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, autoName: event.target.value }))}
                  placeholder="Optional patient-facing name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-art">Type</Label>
                <Input
                  id="document-art"
                  value={documentUploadForm.art}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, art: event.target.value }))}
                  placeholder="report"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-category">Category</Label>
                <Input
                  id="document-category"
                  value={documentUploadForm.category}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, category: event.target.value }))}
                  placeholder="medical"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-status">Status</Label>
                <select
                  id="document-status"
                  className={selectClassName}
                  value={documentUploadForm.status}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
                      ...current,
                      status: event.target.value as DocumentStatus,
                    }))
                  }
                >
                  {DOCUMENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-visibility">Visibility</Label>
                <select
                  id="document-visibility"
                  className={selectClassName}
                  value={documentUploadForm.visibility}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
                      ...current,
                      visibility: event.target.value as DocumentVisibility,
                    }))
                  }
                >
                  {DOCUMENT_VISIBILITY_OPTIONS.map((visibility) => (
                    <option key={visibility} value={visibility}>
                      {visibility}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-order">Order</Label>
                <select
                  id="document-order"
                  className={selectClassName}
                  value={documentUploadForm.orderId}
                  onChange={(event) => setDocumentUploadForm((current) => ({ ...current, orderId: event.target.value }))}
                >
                  <option value="">No order link</option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="document-appointment">Appointment</Label>
                <select
                  id="document-appointment"
                  className={selectClassName}
                  value={documentUploadForm.appointmentId}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
                      ...current,
                      appointmentId: event.target.value,
                    }))
                  }
                >
                  <option value="">No appointment link</option>
                  {appointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.title} · {fmtDate(appointment.date)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={documentUploadForm.isMedical}
                  onChange={(event) =>
                    setDocumentUploadForm((current) => ({
                      ...current,
                      isMedical: event.target.checked,
                    }))
                  }
                />
                Medical document
              </label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-notes">Notes</Label>
              <textarea
                id="document-notes"
                className={textareaClassName}
                value={documentUploadForm.notes}
                onChange={(event) => setDocumentUploadForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional processing or visibility notes"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setDocumentUploadOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={documentUploadBusy}>
                {documentUploadBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                Upload document
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={contractCreateOpen} onOpenChange={setContractCreateOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create framework contract</DialogTitle>
            <DialogDescription>
              Start a patient-bound contract directly from the profile without leaving the patient loop.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleCreateContract}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-status">Status</Label>
                <select
                  id="contract-status"
                  className={selectClassName}
                  value={contractCreateForm.status}
                  onChange={(event) =>
                    setContractCreateForm((current) => ({
                      ...current,
                      status: event.target.value as ContractStatus,
                    }))
                  }
                >
                  {CONTRACT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-signed-at">Signed at</Label>
                <Input
                  id="contract-signed-at"
                  type="datetime-local"
                  value={contractCreateForm.signedAt}
                  onChange={(event) => setContractCreateForm((current) => ({ ...current, signedAt: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-from">Valid from</Label>
                <Input
                  id="contract-valid-from"
                  type="date"
                  value={contractCreateForm.validFrom}
                  onChange={(event) => setContractCreateForm((current) => ({ ...current, validFrom: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-to">Valid to</Label>
                <Input
                  id="contract-valid-to"
                  type="date"
                  value={contractCreateForm.validTo}
                  onChange={(event) => setContractCreateForm((current) => ({ ...current, validTo: event.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setContractCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={contractBusy}>
                {contractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                Create contract
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(contractStatusId)} onOpenChange={(open) => { if (!open) setContractStatusId(""); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Update contract status</DialogTitle>
            <DialogDescription>
              Adjust lifecycle and validity dates without leaving the patient profile.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSaveContractStatus}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-status-edit">Status</Label>
                <select
                  id="contract-status-edit"
                  className={selectClassName}
                  value={contractStatusForm.status}
                  onChange={(event) =>
                    setContractStatusForm((current) => ({
                      ...current,
                      status: event.target.value as ContractStatus,
                    }))
                  }
                >
                  {CONTRACT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-signed-at-edit">Signed at</Label>
                <Input
                  id="contract-signed-at-edit"
                  type="datetime-local"
                  value={contractStatusForm.signedAt}
                  onChange={(event) => setContractStatusForm((current) => ({ ...current, signedAt: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-from-edit">Valid from</Label>
                <Input
                  id="contract-valid-from-edit"
                  type="date"
                  value={contractStatusForm.validFrom}
                  onChange={(event) => setContractStatusForm((current) => ({ ...current, validFrom: event.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-to-edit">Valid to</Label>
                <Input
                  id="contract-valid-to-edit"
                  type="date"
                  value={contractStatusForm.validTo}
                  onChange={(event) => setContractStatusForm((current) => ({ ...current, validTo: event.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setContractStatusId("")}>
                Cancel
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={contractBusy}>
                {contractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                Save status
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(invoiceManageId)} onOpenChange={(open) => { if (!open) setInvoiceManageId(""); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Manage invoice</DialogTitle>
            <DialogDescription>
              Update billing status and continue dunning flow directly from the patient profile.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <form className="space-y-4" onSubmit={handleSaveInvoiceStatus}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="invoice-status-edit">Status</Label>
                  <select
                    id="invoice-status-edit"
                    className={selectClassName}
                    value={invoiceStatusForm.status}
                    onChange={(event) =>
                      setInvoiceStatusForm((current) => ({
                        ...current,
                        status: event.target.value as InvoiceStatus,
                      }))
                    }
                  >
                    {INVOICE_STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-due-date-edit">Due date</Label>
                  <Input
                    id="invoice-due-date-edit"
                    type="date"
                    value={invoiceStatusForm.dueDate}
                    onChange={(event) => setInvoiceStatusForm((current) => ({ ...current, dueDate: event.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-paid-amount-edit">Paid amount</Label>
                  <Input
                    id="invoice-paid-amount-edit"
                    value={invoiceStatusForm.paidAmount}
                    onChange={(event) => setInvoiceStatusForm((current) => ({ ...current, paidAmount: event.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-notes-edit">Notes</Label>
                <textarea
                  id="invoice-notes-edit"
                  className={textareaClassName}
                  value={invoiceStatusForm.notes}
                  onChange={(event) => setInvoiceStatusForm((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Billing notes or payment confirmation details"
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={invoiceBusy}>
                  {invoiceBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  Save invoice
                </Button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Mahnwesen</p>
                  <p className="mt-1 text-xs text-slate-500">Track sent reminders and escalate overdue invoices.</p>
                </div>
                {canManageInvoices && nextDunningLevel(dunningEvents) ? (
                  <Button type="button" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" onClick={() => void handleCreateDunning()} disabled={dunningBusy}>
                    {dunningBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                    Send {nextDunningLevel(dunningEvents)}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="dunning-note">Reminder note</Label>
                <textarea
                  id="dunning-note"
                  className={textareaClassName}
                  value={dunningNote}
                  onChange={(event) => setDunningNote(event.target.value)}
                  placeholder="Optional note for billing trail"
                />
              </div>
              <div className="mt-4 space-y-3">
                {dunningEvents.length === 0 ? (
                  <p className="text-sm text-slate-500">No dunning events yet.</p>
                ) : (
                  dunningEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {event.level}
                        </Badge>
                        <span className="text-xs text-slate-400">{fmtDateTime(event.sent_at)}</span>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-slate-600">
                        <p>Balance due: {fmtMoney(event.balance_due)}</p>
                        <p>Created by: {event.created_by_name}</p>
                        {event.note ? <p>{event.note}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={() => setInvoiceManageId("")}>
                Close
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
