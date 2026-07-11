import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  Eye,
  FileCheck2,
  FileText,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { selectClass, textareaClass } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import type { LeadDetail } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import {
  completeCaseIntake,
  createCase,
  fetchCases,
  saveCaseOverview,
} from "@/pages/cases/data/case-api";
import {
  createContract,
  createQuote,
  fetchAgencyServices,
  fetchContracts,
  fetchQuotes,
  updateContractStatus,
  updateQuoteStatus,
} from "@/pages/contracts/data/contracts-api";
import type { AgencyServiceItem, ContractItem, QuoteItem } from "@/pages/contracts/model/types";
import {
  deleteStoredDocumentFile,
  downloadDocumentFile,
  fetchDocuments,
  markDocumentSigned,
  uploadDocument,
  type DocumentComplianceKind,
} from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import {
  createOrder,
  createOrderLeistung,
  fetchOrder,
  fetchOrders,
  updateOrderCommercialBasis,
} from "@/pages/orders/data/order-api";
import type { Leistung, OrderSummary } from "@/pages/orders/model/types";
import { fetchSpecializations } from "@/pages/providers/data/provider-api";
import type { SpecializationItem } from "@/pages/providers/model/types";

import {
  fetchLeadDetail,
  resolveFailedLead,
  updateLeadStatus,
  updateLeadWizard,
  wizardConvertLead,
} from "../data/leads-api";

type Tx = (ru: string, de: string) => string;
type StepId = "master_data" | "need" | "documents" | "commercial" | "release";
type CaseListItem = { id: string };

type LeadWizardProps = {
  leadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConverted?: (patientId: string) => void;
  onArchived?: () => void;
  onShowDetails?: (leadId: string) => void;
  onOrderCreated?: (orderId: string) => void;
};

type Draft = {
  firstName: string;
  lastName: string;
  birthDate: string;
  legalSex: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  zip: string;
  country: string;
  language: string;
  concern: string;
  anamnese: string;
  discoverySource: string;
  referrer: string;
  specialties: string[];
  privacyConsent: boolean;
  healthcareConsent: boolean;
};

type ServiceLine = {
  id: string;
  agencyServiceId: string | null;
  clientReference: string | null;
  description: string;
  quantity: string;
  price: string;
  vat: string;
};

type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
type WizardDocumentKind = "identity" | "dsgvo";

type AutosaveSnapshot = {
  draft: Draft;
  lines: ServiceLine[];
  paidAmount: string;
  prepayment: boolean;
  step: StepId;
};

type StoredCommercialDraft = {
  lines: ServiceLine[];
  paidAmount: string;
  prepayment: boolean;
};

type CommercialFlagsPatch = {
  signed_patient?: boolean;
  signed_agency?: boolean;
  prepayment_required?: boolean;
};

type MasterFieldKey =
  | "firstName"
  | "lastName"
  | "birthDate"
  | "legalSex"
  | "email"
  | "phone"
  | "street"
  | "city"
  | "zip";

type MasterValidationErrors = Partial<Record<MasterFieldKey, string>>;

const AUTOSAVE_DELAY_MS = 800;
const MAX_DOCUMENT_FILE_SIZE = 25 * 1024 * 1024;
const NEED_CONCERN_ID = "lead-wizard-concern";
const NEED_SPECIALTIES_ID = "lead-wizard-specialties";
const DOCUMENT_ANAMNESE_ID = "lead-wizard-anamnese";

const MASTER_FIELD_ORDER: MasterFieldKey[] = [
  "firstName",
  "lastName",
  "birthDate",
  "legalSex",
  "email",
  "phone",
  "street",
  "city",
  "zip",
];

const MASTER_FIELD_IDS: Record<MasterFieldKey, string> = {
  firstName: "lead-wizard-first-name",
  lastName: "lead-wizard-last-name",
  birthDate: "lead-wizard-birth-date",
  legalSex: "lead-wizard-legal-sex",
  email: "lead-wizard-email",
  phone: "lead-wizard-phone",
  street: "lead-wizard-street",
  city: "lead-wizard-city",
  zip: "lead-wizard-zip",
};

const STEPS: Array<{ id: StepId; ru: string; de: string }> = [
  { id: "master_data", ru: "Данные клиента", de: "Personendaten" },
  { id: "need", ru: "Обращение", de: "Anliegen" },
  { id: "documents", ru: "Документы", de: "Unterlagen" },
  { id: "commercial", ru: "Договор и смета", de: "Vertrag & Angebot" },
  { id: "release", ru: "Создание пациента", de: "Freigabe" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function inputString(value: unknown, fallback = "") {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function storedCommercialDraftFromLead(lead: LeadDetail): StoredCommercialDraft | null {
  const stored = asRecord(lead.wizard_state?.["commercial_draft"]);
  if (!stored) return null;

  const lines = Array.isArray(stored.lines)
    ? stored.lines.flatMap((value, index) => {
        const line = asRecord(value);
        if (!line) return [];
        return [{
          id: inputString(line.id, `stored-line-${index + 1}`),
          agencyServiceId:
            typeof line.agency_service_id === "string" ? line.agency_service_id : null,
          clientReference:
            typeof line.client_reference === "string" ? line.client_reference : null,
          description: inputString(line.description),
          quantity: inputString(line.quantity, "1"),
          price: inputString(line.price),
          vat: inputString(line.vat, "19"),
        }];
      })
    : [];

  return {
    lines,
    paidAmount: inputString(stored.paid_amount),
    prepayment: stored.prepayment === true,
  };
}

function autosaveSnapshotSignature(snapshot: AutosaveSnapshot) {
  return JSON.stringify(snapshot);
}

function autosavePayload(
  snapshot: AutosaveSnapshot,
  previousWizardState: Record<string, unknown>,
) {
  const { draft, lines, paidAmount, prepayment, step } = snapshot;
  const payload: Record<string, unknown> & { wizard_state: Record<string, unknown> } = {
    date_of_birth: draft.birthDate || undefined,
    legal_sex: draft.legalSex || undefined,
    email: draft.email.trim(),
    phone: draft.phone.trim(),
    street_address: draft.street.trim(),
    city: draft.city.trim(),
    zip_code: draft.zip.trim(),
    country: draft.country.trim(),
    primary_language: draft.language.trim(),
    primary_concern_text: draft.concern.trim(),
    additional_concerns: draft.anamnese.trim(),
    requested_specialties: draft.specialties,
    consent_privacy_practices: draft.privacyConsent,
    consent_healthcare: draft.healthcareConsent,
    wizard_state: {
      ...previousWizardState,
      step,
      onboarding_version: 2,
      discovery_source: draft.discoverySource,
      referrer: draft.referrer,
      commercial_draft: {
        lines: lines.map((line) => ({
          id: line.id,
          agency_service_id: line.agencyServiceId,
          client_reference: line.clientReference,
          description: line.description,
          quantity: line.quantity,
          price: line.price,
          vat: line.vat,
        })),
        paid_amount: paidAmount,
        prepayment,
      },
    },
  };

  if (draft.firstName.trim()) payload.first_name = draft.firstName.trim();
  if (draft.lastName.trim()) payload.last_name = draft.lastName.trim();

  return payload;
}

function draftFromLead(lead: LeadDetail): Draft {
  return {
    firstName: lead.first_name ?? "",
    lastName: lead.last_name ?? "",
    birthDate: lead.date_of_birth ?? "",
    legalSex: lead.legal_sex ?? "",
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    street: lead.street_address ?? "",
    city: lead.city ?? "",
    zip: lead.zip_code ?? "",
    country: lead.country ?? "",
    language: lead.primary_language ?? "",
    concern: lead.primary_concern_text ?? "",
    anamnese: lead.additional_concerns ?? "",
    discoverySource: inputString(lead.wizard_state?.["discovery_source"]),
    referrer: inputString(lead.wizard_state?.["referrer"]),
    specialties: lead.requested_specialties ?? [],
    privacyConsent: lead.consent_privacy_practices,
    healthcareConsent: lead.consent_healthcare,
  };
}

function newLine(index = 1): ServiceLine {
  return {
    id: "line-" + Date.now().toString(36) + "-" + index,
    agencyServiceId: null,
    clientReference: null,
    description: "",
    quantity: "1",
    price: "",
    vat: "19",
  };
}

function money(value: string): number {
  const parsed = Number(value.replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

const MONEY_FORMATTERS = {
  de: new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }),
  ru: new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }),
};

function formatMoneyValue(value: number, lang: string) {
  return (lang === "de" ? MONEY_FORMATTERS.de : MONEY_FORMATTERS.ru).format(value);
}

function validLine(line: ServiceLine): boolean {
  return line.description.trim().length > 0 && money(line.quantity) > 0 && money(line.price) >= 0 && money(line.vat) >= 0 && money(line.vat) <= 100;
}

function lineFromOrderLeistung(item: Leistung): ServiceLine {
  return {
    id: item.id,
    agencyServiceId: item.agency_service_id ?? null,
    clientReference: item.client_reference ?? null,
    description: item.description,
    quantity: String(item.quantity ?? "1"),
    price: String(item.unit_price ?? ""),
    vat: String(item.vat_rate ?? "19"),
  };
}

function wizardDocumentKind(item: DocumentItem): WizardDocumentKind | null {
  const complianceKind = item.compliance_kind?.trim().toLowerCase();
  if (complianceKind === "identity" || complianceKind === "dsgvo") return complianceKind;

  const classification = [item.art, item.category, item.auto_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (classification.includes("identity") || classification.includes("passport") || classification.includes("ausweis")) {
    return "identity";
  }
  if (classification.includes("dsgvo") || classification.includes("datenschutz")) {
    return "dsgvo";
  }
  return null;
}

function formatFileSize(size: number | null, lang: string) {
  if (!size || size <= 0) return "";
  const formatter = new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", {
    maximumFractionDigits: size >= 1024 * 1024 ? 1 : 0,
  });
  if (size >= 1024 * 1024) return `${formatter.format(size / (1024 * 1024))} MB`;
  return `${formatter.format(size / 1024)} KB`;
}

function errorText(error: unknown, tx: Tx): string {
  const message = error instanceof Error && error.message ? error.message : "Request failed";
  const labels: Record<string, string> = {
    "Request failed": tx("Не удалось выполнить действие", "Aktion konnte nicht abgeschlossen werden"),
    "Lead is not selected": tx("Обращение не выбрано", "Kein Lead ausgewählt"),
    "Lead could not be saved": tx("Не удалось сохранить обращение", "Lead konnte nicht gespeichert werden"),
    "No order services available for quote": tx("Добавьте хотя бы одну услугу", "Mindestens eine Leistung hinzufügen"),
    "Failed to create quote": tx("Не удалось создать смету", "Kostenvoranschlag konnte nicht erstellt werden"),
    "Case intake is incomplete": tx("Заполните причину обращения и анамнез", "Anliegen und Anamnese vollständig ausfüllen"),
  };
  return labels[message] ?? message;
}

function readinessStepLabel(key: string, tx: Tx) {
  const labels: Record<string, string> = {
    master_data: tx("Данные клиента", "Personendaten"),
    need: tx("Причина обращения", "Anliegen"),
    documents: tx("Документы и анамнез", "Unterlagen und Anamnese"),
    commercial: tx("Договор, заказ и смета", "Vertrag, Auftrag und Kostenvoranschlag"),
    release: tx("Готовность к созданию пациента", "Bereit zur Patientenanlage"),
  };
  return labels[key] ?? tx("Проверка данных", "Datenprüfung");
}

function readinessReasonLabel(reason: string, tx: Tx) {
  const labels: Record<string, string> = {
    "Lead must be qualified before conversion": tx("Подтвердите данные обращения", "Angaben zum Anliegen bestätigen"),
    "Compliance is not signed yet": tx("Подтвердите необходимые согласия", "Erforderliche Einwilligungen bestätigen"),
    "Birth date is missing": tx("Укажите дату рождения", "Geburtsdatum angeben"),
    "Legal sex is missing": tx("Укажите пол по документам", "Geschlecht laut Ausweisdokument angeben"),
    "Email or phone is required": tx("Укажите электронную почту или телефон", "E-Mail-Adresse oder Telefonnummer angeben"),
    "Privacy practices consent is missing": tx("Подтвердите ознакомление с политикой конфиденциальности", "Datenschutzhinweise bestätigen"),
    "Healthcare consent is missing": tx("Получите согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten einholen"),
    "Complete street, city and postal code": tx("Заполните улицу, город и почтовый индекс", "Straße, Ort und Postleitzahl vollständig angeben"),
    "Primary concern is missing": tx("Укажите причину обращения", "Anliegen angeben"),
    "Requested specialty is missing": tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen"),
    "Identity document is not verified": tx("Подтвердите документ, удостоверяющий личность", "Ausweisdokument bestätigen"),
    "Signed DSGVO document is missing": tx("Загрузите и подтвердите согласие на обработку персональных данных", "Datenschutzeinwilligung hochladen und bestätigen"),
    "Anamnesis intake is incomplete": tx("Заполните и сохраните анамнез", "Anamnese ausfüllen und abschließen"),
    "Framework contract is not signed": tx("Подпишите рамочный договор", "Rahmenvertrag unterzeichnen"),
    "Onboarding order is missing": tx("Создайте заказ", "Auftrag erstellen"),
    "Order needs at least one valid service": tx("Добавьте в заказ хотя бы одну услугу", "Mindestens eine Leistung zum Auftrag hinzufügen"),
    "Customer order signature is missing": tx("Получите подпись клиента на заказе", "Unterschrift des Kunden für den Auftrag einholen"),
    "Agency order signature is missing": tx("Подтвердите заказ со стороны агентства", "Auftrag durch die Agentur bestätigen"),
    "Quote is not accepted": tx("Подтвердите смету", "Kostenvoranschlag annehmen"),
    "Required prepayment is not complete": tx("Укажите полученную предоплату", "Erforderliche Vorauszahlung erfassen"),
    "Lead is already converted": tx("Пациент уже создан", "Patient wurde bereits angelegt"),
  };
  return labels[reason] ?? tx("Проверьте незавершённые данные", "Unvollständige Angaben prüfen");
}

function validateMasterDraft(draft: Draft | null, tx: Tx): MasterValidationErrors {
  if (!draft) return {};

  const errors: MasterValidationErrors = {};
  const required = tx("Обязательное поле", "Pflichtfeld");
  if (!draft.firstName.trim()) errors.firstName = required;
  if (!draft.lastName.trim()) errors.lastName = required;
  if (!draft.birthDate) {
    errors.birthDate = required;
  } else if (draft.birthDate > new Date().toISOString().slice(0, 10)) {
    errors.birthDate = tx(
      "Дата рождения не может быть в будущем",
      "Das Geburtsdatum darf nicht in der Zukunft liegen",
    );
  }
  if (!draft.legalSex) errors.legalSex = required;

  const email = draft.email.trim();
  const phone = draft.phone.trim();
  if (!email && !phone) {
    const contactRequired = tx(
      "Укажите электронную почту или телефон",
      "E-Mail oder Telefonnummer angeben",
    );
    errors.email = contactRequired;
    errors.phone = contactRequired;
  } else {
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = tx(
        "Введите корректный адрес электронной почты",
        "Gültige E-Mail-Adresse eingeben",
      );
    }
    if (phone && phone.replace(/\D/g, "").length < 6) {
      errors.phone = tx(
        "Введите корректный номер телефона",
        "Gültige Telefonnummer eingeben",
      );
    }
  }

  if (!draft.street.trim()) errors.street = required;
  if (!draft.city.trim()) errors.city = required;
  if (!draft.zip.trim()) errors.zip = required;
  return errors;
}

function Field({
  label,
  children,
  className,
  error,
  errorId,
  required = false,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  error?: string;
  errorId?: string;
  required?: boolean;
}) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
      {error ? (
        <span id={errorId} role="alert" className="block text-xs leading-4 text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

function StateMark({ done, label }: { done: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", done ? "text-emerald-700" : "text-muted-foreground")}>
      {done ? <Check className="size-3.5" /> : <span className="size-3.5 rounded-full border border-current" />}
      {label}
    </span>
  );
}

function ToggleRow({
  checked,
  label,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="size-4 accent-[var(--brand)]" />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

export function LeadWizard({
  leadId,
  open,
  onOpenChange,
  onConverted,
  onArchived,
  onShowDetails,
}: LeadWizardProps) {
  const { lang } = useLang();
  const tx: Tx = useCallback((ru, de) => (lang === "de" ? de : ru), [lang]);
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState<StepId>("master_data");
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [contracts, setContracts] = useState<ContractItem[]>([]);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [quotes, setQuotes] = useState<QuoteItem[]>([]);
  const [specialties, setSpecialties] = useState<SpecializationItem[]>([]);
  const [agencyServices, setAgencyServices] = useState<AgencyServiceItem[]>([]);
  const [lines, setLines] = useState<ServiceLine[]>([]);
  const [prepayment, setPrepayment] = useState(false);
  const [signedPatient, setSignedPatient] = useState(false);
  const [signedAgency, setSignedAgency] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>("idle");
  const [autosaveError, setAutosaveError] = useState("");
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [deleteDocument, setDeleteDocument] = useState<DocumentItem | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [touchedMasterFields, setTouchedMasterFields] = useState<Set<MasterFieldKey>>(
    () => new Set(),
  );
  const [masterValidationAttempted, setMasterValidationAttempted] = useState(false);
  const [needValidationAttempted, setNeedValidationAttempted] = useState(false);
  const [documentsValidationAttempted, setDocumentsValidationAttempted] = useState(false);
  const hydrated = useRef<string | null>(null);
  const stepNavRef = useRef<HTMLElement | null>(null);
  const wizardStateBaseRef = useRef<Record<string, unknown>>({});
  const currentAutosaveSignatureRef = useRef("");
  const lastSavedAutosaveSignatureRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const reload = useCallback(async (hydrateDraft: boolean, hydrateCommercial = false) => {
    if (!leadId) return;
    setLoading(true);
    setError("");
    try {
      const leadPromise = fetchLeadDetail(leadId);
      const [nextLead, nextDocuments, nextCases, nextContracts, nextOrders, nextQuotes, nextSpecialties, nextAgencyServices] = await Promise.all([
        leadPromise,
        fetchDocuments("/documents?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchCases("/cases?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchContracts("/framework-contracts?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchOrders("/orders?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchQuotes("/quotes?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchSpecializations().catch(() => []),
        fetchAgencyServices("/agency-services?active_only=true").catch(() => []),
      ]);
      const nextOrder = nextOrders[0] ?? null;
      const nextOrderDetail = nextOrder && (hydrateDraft || hydrateCommercial)
        ? await fetchOrder(nextOrder.id).catch(() => null)
        : null;
      const paymentQuote = nextQuotes.find((item) => item.status === "accepted") ?? nextQuotes[0];
      const storedCommercialDraft = storedCommercialDraftFromLead(nextLead);
      const nextDraft = draftFromLead(nextLead);
      const savedStep = nextLead.wizard_state?.["step"];
      const nextStep =
        typeof savedStep === "string" && STEPS.some((item) => item.id === savedStep)
          ? savedStep as StepId
          : "master_data";
      const nextLines = storedCommercialDraft?.lines.length
        ? storedCommercialDraft.lines
        : nextOrderDetail?.leistungen.length
          ? nextOrderDetail.leistungen.map(lineFromOrderLeistung)
          : [];
      const nextPrepayment = storedCommercialDraft
        ? storedCommercialDraft.prepayment
        : Boolean(nextOrder?.prepayment_required);
      const nextPaidAmount = storedCommercialDraft
        ? storedCommercialDraft.paidAmount
        : paymentQuote?.paid_amount == null
          ? ""
          : String(paymentQuote.paid_amount);

      setLead(nextLead);
      setDocuments(nextDocuments);
      setCases(nextCases as CaseListItem[]);
      setContracts(nextContracts);
      setOrders(nextOrders);
      setQuotes(nextQuotes);
      setSpecialties(nextSpecialties);
      setAgencyServices(nextAgencyServices.filter((item) => item.is_active));
      wizardStateBaseRef.current = nextLead.wizard_state ?? {};
      if (hydrateDraft || hydrated.current !== leadId) {
        hydrated.current = leadId;
        setDraft(nextDraft);
        setStep(nextStep);
        setTouchedMasterFields(new Set());
        setMasterValidationAttempted(false);
        setNeedValidationAttempted(false);
        setDocumentsValidationAttempted(false);
      }
      if (hydrateDraft || hydrateCommercial) {
        setLines(nextLines);
        setPrepayment(nextPrepayment);
        setSignedPatient(Boolean(nextOrder?.signed_patient));
        setSignedAgency(Boolean(nextOrder?.signed_agency));
        setPaidAmount(nextPaidAmount);
      }
      if (hydrateDraft) {
        const signature = autosaveSnapshotSignature({
          draft: nextDraft,
          lines: nextLines,
          paidAmount: nextPaidAmount,
          prepayment: nextPrepayment,
          step: nextStep,
        });
        currentAutosaveSignatureRef.current = signature;
        lastSavedAutosaveSignatureRef.current = signature;
        setAutosaveError("");
        setAutosaveStatus("saved");
      }
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setLoading(false);
    }
  }, [leadId, tx]);

  useEffect(() => {
    if (open && leadId) void reload(true);
  }, [leadId, open, reload]);

  useEffect(() => {
    if (open) return;
    hydrated.current = null;
    setLead(null);
    setDraft(null);
    setError("");
    setAutosaveError("");
    setAutosaveStatus("idle");
    setArchiveConfirmOpen(false);
    setDeleteDocument(null);
    setDeleteReason("");
    setDeleteError("");
    setTouchedMasterFields(new Set());
    setMasterValidationAttempted(false);
    setNeedValidationAttempted(false);
    setDocumentsValidationAttempted(false);
    currentAutosaveSignatureRef.current = "";
    lastSavedAutosaveSignatureRef.current = "";
    wizardStateBaseRef.current = {};
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const activeStep = stepNavRef.current?.querySelector<HTMLElement>(
      `[data-step="${step}"]`,
    );
    if (!activeStep) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    activeStep.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [open, step]);

  const order = orders[0] ?? null;
  const contract = contracts.find((item) => item.status !== "terminated") ?? null;
  const orderQuotes = useMemo(
    () => quotes.filter((item) => !order || item.order_id === order.id),
    [order, quotes],
  );
  const quote = orderQuotes[0] ?? null;
  const acceptedQuote = orderQuotes.find((item) => item.status === "accepted") ?? null;
  const caseId = cases[0]?.id ?? null;
  const wizardDocuments = useMemo(() => {
    const grouped: Record<WizardDocumentKind, DocumentItem[]> = {
      identity: [],
      dsgvo: [],
    };
    documents.forEach((item) => {
      if (item.file_deleted_at || item.has_stored_file === false) return;
      const kind = wizardDocumentKind(item);
      if (kind) grouped[kind].push(item);
    });
    return grouped;
  }, [documents]);
  const readiness = useMemo(() => new Map((lead?.readiness.steps ?? []).map((item) => [item.key, item.ready])), [lead?.readiness.steps]);
  const index = STEPS.findIndex((item) => item.id === step);
  const estimate = useMemo(() => {
    let net = 0;
    let vat = 0;
    lines.filter(validLine).forEach((line) => {
      const lineNet = money(line.quantity) * money(line.price);
      net += lineNet;
      vat += lineNet * money(line.vat) / 100;
    });
    return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, gross: Math.round((net + vat) * 100) / 100 };
  }, [lines]);
  const masterErrors = useMemo(() => validateMasterDraft(draft, tx), [draft, tx]);

  const persistSnapshot = useCallback((snapshot: AutosaveSnapshot, force = false) => {
    if (!leadId) return Promise.reject(new Error(tx("Обращение не выбрано", "Kein Lead ausgewählt")));

    const targetLeadId = leadId;
    const signature = autosaveSnapshotSignature(snapshot);
    const previousWizardState = wizardStateBaseRef.current;
    const payload = autosavePayload(snapshot, previousWizardState);

    const run = async () => {
      if (!force && currentAutosaveSignatureRef.current !== signature) return;

      if (
        hydrated.current === targetLeadId &&
        currentAutosaveSignatureRef.current === signature
      ) {
        setAutosaveError("");
        setAutosaveStatus("saving");
      }

      try {
        await updateLeadWizard(targetLeadId, payload);
        if (hydrated.current !== targetLeadId) return;

        wizardStateBaseRef.current = payload.wizard_state;
        lastSavedAutosaveSignatureRef.current = signature;
        if (currentAutosaveSignatureRef.current === signature) {
          setAutosaveError("");
          setAutosaveStatus("saved");
        } else {
          setAutosaveStatus("dirty");
        }
      } catch (nextError) {
        if (
          hydrated.current === targetLeadId &&
          currentAutosaveSignatureRef.current === signature
        ) {
          setAutosaveError(errorText(nextError, tx));
          setAutosaveStatus("error");
        }
        throw nextError;
      }
    };

    const queued = saveQueueRef.current.then(run, run);
    saveQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }, [leadId, tx]);

  useEffect(() => {
    if (!open || !leadId || !draft || loading) return;

    const snapshot: AutosaveSnapshot = {
      draft,
      lines,
      paidAmount,
      prepayment,
      step,
    };
    const signature = autosaveSnapshotSignature(snapshot);
    currentAutosaveSignatureRef.current = signature;

    if (signature === lastSavedAutosaveSignatureRef.current) {
      setAutosaveError("");
      setAutosaveStatus("saved");
      return;
    }

    setAutosaveError("");
    setAutosaveStatus("dirty");
    const timer = window.setTimeout(() => {
      void persistSnapshot(snapshot).catch(() => undefined);
    }, AUTOSAVE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [draft, leadId, lines, loading, open, paidAmount, persistSnapshot, prepayment, step]);

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const touchMasterField = (field: MasterFieldKey) => {
    setTouchedMasterFields((current) => {
      if (current.has(field)) return current;
      const nextFields = new Set(current);
      nextFields.add(field);
      return nextFields;
    });
  };

  const visibleMasterError = (field: MasterFieldKey) =>
    masterValidationAttempted || touchedMasterFields.has(field)
      ? masterErrors[field]
      : undefined;

  async function save(target = step, trackBusy = true): Promise<boolean> {
    if (!leadId || !draft) return false;
    if (trackBusy) setBusy("save");
    setError("");
    try {
      const snapshot: AutosaveSnapshot = {
        draft,
        lines,
        paidAmount,
        prepayment,
        step: target,
      };
      currentAutosaveSignatureRef.current = autosaveSnapshotSignature(snapshot);
      await persistSnapshot(snapshot, true);
      await reload(false);
      return true;
    } catch (nextError) {
      setError(errorText(nextError, tx));
      return false;
    } finally {
      if (trackBusy) setBusy(null);
    }
  }

  async function qualify() {
    if (!leadId || !draft) return;
    if (!draft.concern.trim() || draft.specialties.length === 0) {
      setNeedValidationAttempted(true);
      const targetId = !draft.concern.trim() ? NEED_CONCERN_ID : NEED_SPECIALTIES_ID;
      window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      return;
    }
    if (!(await save("need", false))) return;
    setBusy("qualify");
    try {
      await updateLeadStatus(leadId, "qualified");
      await reload(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function finishIntake(targetStep: StepId): Promise<boolean> {
    if (!leadId || !draft) return false;
    if (!draft.concern.trim()) {
      setNeedValidationAttempted(true);
      setStep("need");
      window.requestAnimationFrame(() => document.getElementById(NEED_CONCERN_ID)?.focus());
      return false;
    }
    if (!draft.anamnese.trim()) {
      setDocumentsValidationAttempted(true);
      window.requestAnimationFrame(() => document.getElementById(DOCUMENT_ANAMNESE_ID)?.focus());
      return false;
    }
    setBusy("intake");
    try {
      const id = caseId ?? (await createCase({
        lead_id: leadId,
        hauptanfragegrund: draft.concern.trim(),
        aktuelle_anamnese: draft.anamnese.trim(),
        zuweiser: draft.referrer.trim(),
      })).id;
      await saveCaseOverview(id, {
        hauptanfragegrund: draft.concern.trim(),
        aktuelle_anamnese: draft.anamnese.trim(),
        zuweiser: draft.referrer.trim(),
      });
      await completeCaseIntake(id);
      const saved = await save(targetStep, false);
      if (saved) setDocumentsValidationAttempted(false);
      return saved;
    } catch (nextError) {
      setError(errorText(nextError, tx));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: "identity" | "dsgvo", file: File) {
    if (!leadId) return;
    if (file.size > MAX_DOCUMENT_FILE_SIZE) {
      setError(tx("Размер файла не должен превышать 25 МБ", "Die Datei darf höchstens 25 MB groß sein"));
      return;
    }
    setBusy("upload-" + kind);
    try {
      const form = new FormData();
      form.set("lead_id", leadId);
      form.set("file", file);
      form.set("auto_name", kind === "identity" ? "Identity document" : "DSGVO consent");
      form.set("art", kind === "identity" ? "identity" : "consent");
      form.set("category", kind === "identity" ? "identity" : "consent");
      await uploadDocument(form);
      await reload(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function downloadDocument(document: DocumentItem) {
    setBusy(`download-${document.id}`);
    setError("");
    try {
      await downloadDocumentFile(
        document.id,
        document.original_filename || document.auto_name || "document",
      );
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function deleteWizardDocument() {
    if (!deleteDocument) return;
    const reason = deleteReason.trim();
    if (!reason) {
      setDeleteError(tx("Укажите причину удаления", "Löschgrund angeben"));
      return;
    }

    setBusy(`delete-${deleteDocument.id}`);
    setDeleteError("");
    try {
      await deleteStoredDocumentFile(deleteDocument.id, reason);
      setDeleteDocument(null);
      setDeleteReason("");
      await reload(false);
    } catch (nextError) {
      setDeleteError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function signDocument(id: string, kind: DocumentComplianceKind) {
    setBusy("sign-" + kind);
    try {
      await markDocumentSigned(id, kind);
      await reload(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function ensureCommercial(flags: CommercialFlagsPatch = {}) {
    if (!leadId || !draft) throw new Error(tx("Обращение не выбрано", "Kein Lead ausgewählt"));
    if (!lines.some(validLine)) throw new Error(tx("Добавьте корректную услугу", "Mindestens eine gültige Leistung ist erforderlich"));
    if (!(await save("commercial", false))) throw new Error(tx("Не удалось сохранить обращение", "Lead konnte nicht gespeichert werden"));
    let contractId = contract?.id;
    if (!contractId) {
      contractId = (await createContract({
        lead_id: leadId,
        status: "sent",
        client_reference: "lead-onboarding:" + leadId + ":framework",
      })).id;
    }
    let orderId = order?.id;
    if (!orderId) {
      orderId = (await createOrder({
        source_lead_id: leadId,
        contract_id: contractId,
        needs_description: draft.concern.trim(),
      })).id;
    }
    for (const line of lines.filter(validLine)) {
      await createOrderLeistung(orderId, {
        agency_service_id: line.agencyServiceId,
        description: line.description.trim(),
        quantity: money(line.quantity),
        unit_price: money(line.price),
        vat_rate: money(line.vat),
        client_reference: line.clientReference ?? "lead-wizard:" + leadId + ":" + line.id,
      });
    }
    await updateOrderCommercialBasis(orderId, {
      contract_id: contractId,
      total_estimated: estimate.gross.toFixed(2),
      prepayment_required: flags.prepayment_required ?? prepayment,
      signed_patient: flags.signed_patient ?? signedPatient,
      signed_agency: flags.signed_agency ?? signedAgency,
    });
    return { contractId, orderId };
  }

  async function prepareCommercial() {
    setBusy("commercial");
    try {
      await ensureCommercial();
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function signContract() {
    setBusy("contract");
    try {
      const result = await ensureCommercial();
      await updateContractStatus(result.contractId, { status: "signed" });
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function saveFlags(patchValue: CommercialFlagsPatch) {
    setBusy("flags");
    try {
      await ensureCommercial(patchValue);
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError, tx));
      await reload(false, true);
    } finally {
      setBusy(null);
    }
  }

  async function createOrAcceptQuote(accept: boolean) {
    setBusy(accept ? "accept" : "quote");
    try {
      let quoteId = quote?.id;
      let createdQuote: QuoteItem | null = null;
      if (!accept || !quoteId) {
        const result = await ensureCommercial();
        const created = await createQuote(result.orderId, {});
        quoteId = created.id;
        createdQuote = {
          id: created.id,
          order_id: created.order_id,
          order_number: order?.order_number ?? "",
          contract_id: created.contract_id ?? result.contractId,
          patient_id: created.patient_id ?? null,
          lead_id: created.lead_id ?? leadId,
          patient_name: lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : "",
          patient_pid: "",
          quote_number: created.quote_number,
          status: created.status,
          total_net: created.total_net,
          total_vat: created.total_vat,
          total_gross: created.total_gross,
          valid_until: created.valid_until ?? null,
          paid_amount: created.paid_amount ?? "0",
          paid_at: created.paid_at ?? null,
          notes: created.notes ?? null,
          version_count: created.version_count,
          current_version_number: created.current_version_number,
          created_at: created.created_at,
          updated_at: created.updated_at,
          line_items: created.line_items,
        };
      }
      if (accept) {
        const accepted = await updateQuoteStatus(quoteId, {
          status: "accepted",
          paid_amount: prepayment ? money(paidAmount) : undefined,
        });
        setQuotes((current) => [accepted, ...current.filter((item) => item.id !== accepted.id)]);
      } else if (createdQuote) {
        setQuotes((current) => [createdQuote, ...current.filter((item) => item.id !== createdQuote.id)]);
      }
      void reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  async function convert() {
    if (!leadId) return;
    setBusy("convert");
    try {
      if (!(await save("release", false))) return;
      const result = await wizardConvertLead(leadId);
      onConverted?.(result.patient_id);
      onOpenChange(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
      await reload(false);
    } finally {
      setBusy(null);
    }
  }

  async function archiveLead() {
    if (!leadId) return;
    setBusy("archive");
    setError("");
    try {
      await resolveFailedLead(leadId, {
        resolution: "archive",
        reason: "not_our_lead",
      });
      setArchiveConfirmOpen(false);
      if (onArchived) onArchived();
      else onOpenChange(false);
    } catch (nextError) {
      setError(errorText(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  function next() {
    if (step === "master_data" && Object.keys(masterErrors).length > 0) {
      setMasterValidationAttempted(true);
      const firstInvalid = MASTER_FIELD_ORDER.find((field) => masterErrors[field]);
      if (firstInvalid) {
        window.requestAnimationFrame(() => {
          document.getElementById(MASTER_FIELD_IDS[firstInvalid])?.focus();
        });
      }
      return;
    }

    const target = STEPS[index + 1];
    if (!target) return;
    if (step === "documents") {
      void finishIntake(target.id).then((saved) => {
        if (saved) setStep(target.id);
      });
      return;
    }
    void save(target.id).then((saved) => {
      if (saved) setStep(target.id);
    });
  }

  function updateLine(id: string, patchValue: Partial<ServiceLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patchValue } : line));
  }

  function addAgencyService(serviceId: string) {
    const service = agencyServices.find((item) => item.id === serviceId);
    if (!service) return;
    setLines((current) => {
      if (current.some((line) => line.agencyServiceId === service.id)) return current;
      return [
        ...current,
        {
          ...newLine(current.length + 1),
          agencyServiceId: service.id,
          description: service.service_name,
          price: inputString(service.unit_price),
          vat: inputString(service.vat_rate, "19"),
        },
      ];
    });
  }

  function specialtyLabel(value: string) {
    const specialty = specialties.find(
      (item) => (item.code || item.name_en) === value,
    );
    if (!specialty) return value;
    return lang === "de"
      ? specialty.name_de || specialty.name_en
      : specialty.name_ru || specialty.name_de || specialty.name_en;
  }

  if (!leadId) return null;
  const isBusy = busy !== null;
  const renderedAutosaveSignature = draft
    ? autosaveSnapshotSignature({ draft, lines, paidAmount, prepayment, step })
    : "";
  const autosaveIsDirty = Boolean(
    draft && renderedAutosaveSignature !== lastSavedAutosaveSignatureRef.current,
  ) || autosaveStatus === "saving" || autosaveStatus === "error";
  return (
    <>
      <Dialog open={open} dirty={autosaveIsDirty} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] w-[calc(100vw-1rem)] max-w-none flex-col gap-0 overflow-hidden rounded-lg p-0 sm:h-[min(88vh,52rem)] sm:w-[min(92vw,64rem)] sm:max-w-5xl">
        <DialogTitle className="sr-only">{tx("Оформление обращения", "Lead-Aufnahme")}</DialogTitle>
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-4 py-3 pr-14 sm:px-5 sm:pr-14">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : tx("Оформление обращения", "Lead-Aufnahme")}</h2>
            {autosaveStatus === "error" ? (
              <div
                role="alert"
                aria-live="polite"
                title={autosaveError || undefined}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-destructive"
              >
                <CircleAlert aria-hidden="true" className="size-3" />
                {tx("Не удалось сохранить изменения", "Änderungen konnten nicht gespeichert werden")}
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              title={tx("Архивировать обращение", "Lead archivieren")}
              aria-label={tx("Архивировать обращение", "Lead archivieren")}
              disabled={loading || isBusy}
              onClick={() => setArchiveConfirmOpen(true)}
            >
              <Archive aria-hidden="true" className="size-3.5" />
            </Button>
            {onShowDetails && leadId ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title={tx("Подробности обращения", "Lead-Details")}
                aria-label={tx("Подробности обращения", "Lead-Details")}
                disabled={loading || isBusy}
                onClick={() => onShowDetails(leadId)}
              >
                <Eye aria-hidden="true" className="size-3.5" />
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="icon-sm" title={tx("Обновить", "Aktualisieren")} aria-label={tx("Обновить", "Aktualisieren")} disabled={loading || isBusy} onClick={() => void reload(false)}>
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            </Button>
          </div>
        </header>

        <nav
          ref={stepNavRef}
          className="overflow-x-auto overscroll-x-contain border-b border-border"
          aria-label={tx("Этапы оформления", "Schritte der Lead-Aufnahme")}
        >
          <div className="grid min-w-[42rem] grid-cols-5 sm:min-w-0">
            {STEPS.map((item, itemIndex) => {
              const selected = item.id === step;
              const done = readiness.get(item.id) ?? false;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-step={item.id}
                  onClick={() => {
                    if (step === "documents" && itemIndex > index) {
                      void finishIntake(item.id).then((saved) => {
                        if (saved) setStep(item.id);
                      });
                      return;
                    }
                    setStep(item.id);
                  }}
                  aria-current={selected ? "step" : undefined}
                  className={cn(
                    "relative min-w-0 border-r border-border px-3 py-3 text-left last:border-r-0 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected && "bg-muted/50 after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-[var(--brand)]",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]", done ? "border-emerald-600 text-emerald-700" : "border-muted-foreground/50 text-muted-foreground")}>
                      {done ? <Check aria-hidden="true" className="size-3" /> : itemIndex + 1}
                    </span>
                    <span className="min-w-0 break-words text-[11px] font-medium leading-tight text-foreground">
                      {lang === "de" ? item.de : item.ru}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <main aria-busy={loading || isBusy} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
          {error ? <div role="alert" className="mb-5 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {loading && !lead ? <div role="status" aria-live="polite" className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-4 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</div> : null}

          {draft && step === "master_data" ? (
            <section className="space-y-5">
              <h3 className="text-sm font-semibold text-foreground">{tx("Данные клиента", "Personendaten")}</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label={tx("Имя", "Vorname")}
                  required
                  error={visibleMasterError("firstName")}
                  errorId={`${MASTER_FIELD_IDS.firstName}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.firstName}
                    name="first_name"
                    autoComplete="given-name"
                    required
                    aria-invalid={Boolean(visibleMasterError("firstName"))}
                    aria-describedby={visibleMasterError("firstName") ? `${MASTER_FIELD_IDS.firstName}-error` : undefined}
                    className={cn(visibleMasterError("firstName") && "border-destructive")}
                    value={draft.firstName}
                    onBlur={() => touchMasterField("firstName")}
                    onChange={(event) => patch("firstName", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Фамилия", "Nachname")}
                  required
                  error={visibleMasterError("lastName")}
                  errorId={`${MASTER_FIELD_IDS.lastName}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.lastName}
                    name="last_name"
                    autoComplete="family-name"
                    required
                    aria-invalid={Boolean(visibleMasterError("lastName"))}
                    aria-describedby={visibleMasterError("lastName") ? `${MASTER_FIELD_IDS.lastName}-error` : undefined}
                    className={cn(visibleMasterError("lastName") && "border-destructive")}
                    value={draft.lastName}
                    onBlur={() => touchMasterField("lastName")}
                    onChange={(event) => patch("lastName", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Дата рождения", "Geburtsdatum")}
                  required
                  error={visibleMasterError("birthDate")}
                  errorId={`${MASTER_FIELD_IDS.birthDate}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.birthDate}
                    name="birth_date"
                    autoComplete="bday"
                    type="date"
                    max={new Date().toISOString().slice(0, 10)}
                    required
                    aria-invalid={Boolean(visibleMasterError("birthDate"))}
                    aria-describedby={visibleMasterError("birthDate") ? `${MASTER_FIELD_IDS.birthDate}-error` : undefined}
                    className={cn(visibleMasterError("birthDate") && "border-destructive")}
                    value={draft.birthDate}
                    onBlur={() => touchMasterField("birthDate")}
                    onChange={(event) => patch("birthDate", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Пол по документам", "Geschlecht laut Ausweisdokument")}
                  required
                  error={visibleMasterError("legalSex")}
                  errorId={`${MASTER_FIELD_IDS.legalSex}-error`}
                >
                  <NativeComboboxSelect
                    id={MASTER_FIELD_IDS.legalSex}
                    name="legal_sex"
                    value={draft.legalSex}
                    required
                    aria-invalid={Boolean(visibleMasterError("legalSex"))}
                    aria-describedby={visibleMasterError("legalSex") ? `${MASTER_FIELD_IDS.legalSex}-error` : undefined}
                    onBlur={() => touchMasterField("legalSex")}
                    onChange={(event) => patch("legalSex", event.target.value)}
                    className={cn(selectClass, visibleMasterError("legalSex") && "border-destructive")}
                  >
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    <option value="female">{tx("Женский", "Weiblich")}</option>
                    <option value="male">{tx("Мужской", "Männlich")}</option>
                    <option value="diverse">{tx("Другой", "Divers")}</option>
                    <option value="no_entry">{tx("Без указания", "Keine Angabe")}</option>
                  </NativeComboboxSelect>
                </Field>
                <Field
                  label="E-Mail"
                  required={!draft.phone.trim()}
                  error={visibleMasterError("email")}
                  errorId={`${MASTER_FIELD_IDS.email}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.email}
                    name="email"
                    autoComplete="email"
                    spellCheck={false}
                    type="email"
                    aria-required={!draft.phone.trim()}
                    aria-invalid={Boolean(visibleMasterError("email"))}
                    aria-describedby={visibleMasterError("email") ? `${MASTER_FIELD_IDS.email}-error` : undefined}
                    className={cn(visibleMasterError("email") && "border-destructive")}
                    value={draft.email}
                    onBlur={() => touchMasterField("email")}
                    onChange={(event) => patch("email", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Телефон", "Telefon")}
                  required={!draft.email.trim()}
                  error={visibleMasterError("phone")}
                  errorId={`${MASTER_FIELD_IDS.phone}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.phone}
                    name="phone"
                    autoComplete="tel"
                    type="tel"
                    aria-required={!draft.email.trim()}
                    aria-invalid={Boolean(visibleMasterError("phone"))}
                    aria-describedby={visibleMasterError("phone") ? `${MASTER_FIELD_IDS.phone}-error` : undefined}
                    className={cn(visibleMasterError("phone") && "border-destructive")}
                    value={draft.phone}
                    onBlur={() => touchMasterField("phone")}
                    onChange={(event) => patch("phone", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Улица и дом", "Straße und Hausnummer")}
                  required
                  error={visibleMasterError("street")}
                  errorId={`${MASTER_FIELD_IDS.street}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.street}
                    name="street_address"
                    autoComplete="street-address"
                    required
                    aria-invalid={Boolean(visibleMasterError("street"))}
                    aria-describedby={visibleMasterError("street") ? `${MASTER_FIELD_IDS.street}-error` : undefined}
                    className={cn(visibleMasterError("street") && "border-destructive")}
                    value={draft.street}
                    onBlur={() => touchMasterField("street")}
                    onChange={(event) => patch("street", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Город", "Ort")}
                  required
                  error={visibleMasterError("city")}
                  errorId={`${MASTER_FIELD_IDS.city}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.city}
                    name="city"
                    autoComplete="address-level2"
                    required
                    aria-invalid={Boolean(visibleMasterError("city"))}
                    aria-describedby={visibleMasterError("city") ? `${MASTER_FIELD_IDS.city}-error` : undefined}
                    className={cn(visibleMasterError("city") && "border-destructive")}
                    value={draft.city}
                    onBlur={() => touchMasterField("city")}
                    onChange={(event) => patch("city", event.target.value)}
                  />
                </Field>
                <Field
                  label={tx("Почтовый индекс", "Postleitzahl")}
                  required
                  error={visibleMasterError("zip")}
                  errorId={`${MASTER_FIELD_IDS.zip}-error`}
                >
                  <Input
                    id={MASTER_FIELD_IDS.zip}
                    name="postal_code"
                    autoComplete="postal-code"
                    required
                    aria-invalid={Boolean(visibleMasterError("zip"))}
                    aria-describedby={visibleMasterError("zip") ? `${MASTER_FIELD_IDS.zip}-error` : undefined}
                    className={cn(visibleMasterError("zip") && "border-destructive")}
                    value={draft.zip}
                    onBlur={() => touchMasterField("zip")}
                    onChange={(event) => patch("zip", event.target.value)}
                  />
                </Field>
                <Field label={tx("Страна", "Land")}><Input name="country" autoComplete="country-name" value={draft.country} onChange={(event) => patch("country", event.target.value)} /></Field>
                <Field label={tx("Предпочитаемый язык", "Bevorzugte Sprache")}><Input name="primary_language" autoComplete="off" value={draft.language} onChange={(event) => patch("language", event.target.value)} /></Field>
              </div>
            </section>
          ) : null}

          {draft && step === "need" ? (
            <section className="space-y-5">
              <Field
                required
                label={tx("Причина обращения", "Anliegen")}
                error={needValidationAttempted && !draft.concern.trim() ? tx("Обязательное поле", "Pflichtfeld") : undefined}
                errorId={`${NEED_CONCERN_ID}-error`}
              >
                <textarea
                  id={NEED_CONCERN_ID}
                  className={cn(
                    textareaClass,
                    "min-h-28",
                    needValidationAttempted && !draft.concern.trim() && "border-destructive",
                  )}
                  aria-invalid={needValidationAttempted && !draft.concern.trim()}
                  aria-describedby={needValidationAttempted && !draft.concern.trim() ? `${NEED_CONCERN_ID}-error` : undefined}
                  value={draft.concern}
                  onChange={(event) => patch("concern", event.target.value)}
                />
              </Field>
              <Field label={tx("Дополнительная информация", "Weitere Informationen")}><textarea className={cn(textareaClass, "min-h-24")} value={draft.anamnese} onChange={(event) => patch("anamnese", event.target.value)} /></Field>
              <Field label={tx("Откуда вы о нас узнали?", "Wie sind Sie auf uns aufmerksam geworden?")}>
                <Input
                  name="discovery_source"
                  autoComplete="off"
                  value={draft.discoverySource}
                  onChange={(event) => patch("discoverySource", event.target.value)}
                />
              </Field>
              <div className="space-y-3 pt-2">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {tx("Специализации", "Fachrichtungen")}
                  <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
                </span>
                <NativeComboboxSelect
                  id={NEED_SPECIALTIES_ID}
                  aria-label={tx("Добавить специализацию", "Fachrichtung hinzufügen")}
                  aria-invalid={needValidationAttempted && draft.specialties.length === 0}
                  aria-describedby={needValidationAttempted && draft.specialties.length === 0 ? `${NEED_SPECIALTIES_ID}-error` : undefined}
                  name="specialty"
                  value=""
                  onChange={(event) => {
                    const selected = specialties.find((item) => item.id === event.target.value);
                    if (!selected) return;
                    const value = selected.code || selected.name_en;
                    if (!draft.specialties.includes(value)) patch("specialties", [...draft.specialties, value]);
                  }}
                  className={cn(selectClass, needValidationAttempted && draft.specialties.length === 0 && "border-destructive")}
                >
                  <option value="">{tx("Добавить специализацию", "Fachrichtung hinzufügen")}</option>
                  {specialties.map((item) => <option key={item.id} value={item.id}>{lang === "de" ? item.name_de || item.name_en : item.name_ru || item.name_de || item.name_en}</option>)}
                </NativeComboboxSelect>
                {needValidationAttempted && draft.specialties.length === 0 ? (
                  <span id={`${NEED_SPECIALTIES_ID}-error`} role="alert" className="block text-xs leading-4 text-destructive">
                    {tx("Выберите хотя бы одну специализацию", "Mindestens eine Fachrichtung auswählen")}
                  </span>
                ) : null}
                {draft.specialties.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {draft.specialties.map((value) => (
                      <div key={value} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-border bg-muted/25 px-3 py-2">
                        <span className="min-w-0 break-words text-sm text-foreground">{specialtyLabel(value)}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          title={tx("Удалить специализацию", "Fachrichtung entfernen")}
                          aria-label={tx("Удалить специализацию", "Fachrichtung entfernen")}
                          onClick={() => patch("specialties", draft.specialties.filter((item) => item !== value))}
                        >
                          <X aria-hidden="true" className="size-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex justify-end border-t border-border pt-4">
                <Button type="button" variant="outline" disabled={isBusy || lead?.qualification_status === "qualified"} onClick={() => void qualify()}>{busy === "qualify" ? <LoaderCircle className="size-3.5 animate-spin" /> : <UserRoundCheck className="size-3.5" />}{tx("Подтвердить данные", "Angaben bestätigen")}</Button>
              </div>
            </section>
          ) : null}

          {draft && step === "documents" ? (
            <section className="space-y-5">
              {(["identity", "dsgvo"] as const).map((kind) => {
                const kindDocuments = wizardDocuments[kind];
                const label = kind === "identity" ? tx("Документ, удостоверяющий личность", "Ausweisdokument") : tx("Согласие на обработку персональных данных", "Datenschutzeinwilligung (DSGVO)");
                const fileId = "lead-file-" + kind;
                return (
                  <div key={kind} className="space-y-3 border-y border-border py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="text-sm font-medium text-foreground">{label}</div>
                      <input
                        id={fileId}
                        type="file"
                        className="peer sr-only"
                        accept=".pdf,.jpg,.jpeg,.png"
                        disabled={isBusy}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          if (file) {
                            void upload(kind, file);
                            event.currentTarget.value = "";
                          }
                        }}
                      />
                      <label
                        htmlFor={fileId}
                        className={cn(
                          "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-xs hover:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                          isBusy && "pointer-events-none opacity-50",
                        )}
                      >
                        <Upload aria-hidden="true" className="size-3.5" />
                        {kindDocuments.length > 0 ? tx("Добавить файл", "Datei hinzufügen") : tx("Загрузить файл", "Datei hochladen")}
                      </label>
                    </div>

                    {kindDocuments.length > 0 ? (
                      <div className="divide-y divide-border rounded-md border border-border">
                        {kindDocuments.map((document) => {
                          const signed = Boolean(document.signed_at && document.compliance_kind === kind);
                          const sizeLabel = formatFileSize(document.file_size, lang);
                          return (
                            <div key={document.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                              <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-sm font-medium text-foreground">
                                  {document.original_filename || document.auto_name}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                  {sizeLabel ? <span className="font-mono tabular-nums">{sizeLabel}</span> : null}
                                  <StateMark done={signed} label={signed ? tx("Подтверждён", "Bestätigt") : tx("Не подтверждён", "Nicht bestätigt")} />
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <Button type="button" variant="ghost" size="icon-sm" title={tx("Скачать файл", "Datei herunterladen")} aria-label={tx("Скачать файл", "Datei herunterladen")} disabled={isBusy} onClick={() => void downloadDocument(document)}>
                                  {busy === `download-${document.id}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                                </Button>
                                <Button type="button" variant="ghost" size="icon-sm" title={tx("Подтвердить документ", "Dokument bestätigen")} aria-label={tx("Подтвердить документ", "Dokument bestätigen")} disabled={signed || isBusy} onClick={() => void signDocument(document.id, kind)}>
                                  <FileCheck2 className={cn("size-3.5", signed && "text-emerald-700")} />
                                </Button>
                                <Button type="button" variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" title={tx("Удалить файл", "Datei löschen")} aria-label={tx("Удалить файл", "Datei löschen")} disabled={isBusy} onClick={() => { setDeleteError(""); setDeleteReason(""); setDeleteDocument(document); }}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">{tx("Файлы не добавлены", "Keine Dateien hinzugefügt")}</div>
                    )}
                  </div>
                );
              })}
              <div className="border-y border-border"><ToggleRow checked={draft.privacyConsent} disabled={isBusy} onChange={(checked) => patch("privacyConsent", checked)} label={tx("Клиент ознакомлен с политикой конфиденциальности", "Datenschutzhinweise wurden bestätigt")} /><ToggleRow checked={draft.healthcareConsent} disabled={isBusy} onChange={(checked) => patch("healthcareConsent", checked)} label={tx("Получено согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung von Gesundheitsdaten liegt vor")} /></div>
              <Field
                required
                label={tx("Анамнез", "Aktuelle Anamnese")}
                error={documentsValidationAttempted && !draft.anamnese.trim() ? tx("Обязательное поле", "Pflichtfeld") : undefined}
                errorId={`${DOCUMENT_ANAMNESE_ID}-error`}
              >
                <textarea
                  id={DOCUMENT_ANAMNESE_ID}
                  className={cn(textareaClass, "min-h-28", documentsValidationAttempted && !draft.anamnese.trim() && "border-destructive")}
                  aria-invalid={documentsValidationAttempted && !draft.anamnese.trim()}
                  aria-describedby={documentsValidationAttempted && !draft.anamnese.trim() ? `${DOCUMENT_ANAMNESE_ID}-error` : undefined}
                  value={draft.anamnese}
                  onChange={(event) => patch("anamnese", event.target.value)}
                />
              </Field>
              <Field label={tx("Направивший врач", "Zuweisender Arzt")}><Input value={draft.referrer} onChange={(event) => patch("referrer", event.target.value)} /></Field>
            </section>
          ) : null}

          {draft && step === "commercial" ? (
            <section className="space-y-5">
              <h3 className="text-sm font-semibold text-foreground">{tx("Договор, заказ и смета", "Vertrag, Auftrag und Kostenvoranschlag")}</h3>
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3"><div><div className="text-sm font-medium text-foreground">{tx("Рамочный договор", "Rahmenvertrag")}</div><div className="mt-1 text-xs text-muted-foreground">{contract?.contract_number ?? tx("Договор ещё не создан", "Vertrag noch nicht erstellt")}</div></div><div className="flex items-center gap-2"><StateMark done={contract?.status === "signed"} label={contract?.status === "signed" ? tx("Договор подписан", "Vertrag unterzeichnet") : tx("Договор не подписан", "Vertrag nicht unterzeichnet")} /><Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void signContract()}>{busy === "contract" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />}{tx("Подписать договор", "Vertrag unterzeichnen")}</Button></div></div>
              <div className="space-y-3">
                <span className="text-sm font-medium text-foreground">{tx("Услуги", "Leistungen")}</span>
                <NativeComboboxSelect
                  aria-label={tx("Выбрать услугу из каталога", "Leistung aus dem Katalog auswählen")}
                  name="agency_service"
                  value=""
                  onChange={(event) => addAgencyService(event.target.value)}
                  className={selectClass}
                >
                  <option value="">{tx("Выберите услугу из каталога", "Leistung aus dem Katalog auswählen")}</option>
                  {agencyServices.map((service) => (
                    <option
                      key={service.id}
                      value={service.id}
                      disabled={lines.some((line) => line.agencyServiceId === service.id)}
                    >
                      {service.service_name} · {formatMoneyValue(money(inputString(service.unit_price)), lang)} {service.currency}
                    </option>
                  ))}
                </NativeComboboxSelect>
                {lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{tx("Услуги не выбраны", "Keine Leistungen ausgewählt")}</p>
                ) : null}
                {lines.map((line) => {
                  const catalogService = agencyServices.find((service) => service.id === line.agencyServiceId);
                  return (
                    <div key={line.id} className="grid gap-3 rounded-md border border-border px-3 py-3 sm:grid-cols-[minmax(0,1fr)_90px_110px_80px_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-medium text-foreground">{line.description}</div>
                        {catalogService?.unit_label ? <div className="mt-0.5 text-xs text-muted-foreground">{catalogService.unit_label}</div> : null}
                      </div>
                      <Field label={tx("Количество", "Menge")}>
                        <Input name={`service_quantity_${line.id}`} autoComplete="off" inputMode="decimal" aria-label={tx("Количество", "Menge")} value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} />
                      </Field>
                      <div className="font-mono text-sm tabular-nums text-foreground sm:text-right">
                        <div className="font-sans text-[11px] uppercase text-muted-foreground">{tx("Цена за единицу", "Einzelpreis")}</div>
                        {formatMoneyValue(money(line.price), lang)} {catalogService?.currency || "EUR"}
                      </div>
                      <div className="font-mono text-sm tabular-nums text-foreground sm:text-right">
                        <div className="font-sans text-[11px] uppercase text-muted-foreground">{tx("НДС", "MwSt.")}</div>
                        {formatMoneyValue(money(line.vat), lang)}%
                      </div>
                      <Button type="button" variant="ghost" size="icon-sm" title={tx("Удалить услугу", "Leistung entfernen")} aria-label={tx("Удалить услугу", "Leistung entfernen")} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><X className="size-3.5" /></Button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 text-sm text-muted-foreground">
                  <span>{tx("Нетто", "Netto")}: <span className="font-mono tabular-nums">{formatMoneyValue(estimate.net, lang)} EUR</span></span>
                  <span>{tx("НДС", "MwSt.")}: <span className="font-mono tabular-nums">{formatMoneyValue(estimate.vat, lang)} EUR</span></span>
                  <span className="font-semibold text-foreground">{tx("Итого", "Gesamt")}: <span className="font-mono tabular-nums">{formatMoneyValue(estimate.gross, lang)} EUR</span></span>
                </div>
              </div>
              <div className="border-y border-border">
                <ToggleRow
                  checked={signedPatient}
                  disabled={isBusy}
                  onChange={(checked) => {
                    setSignedPatient(checked);
                    void saveFlags({ signed_patient: checked });
                  }}
                  label={tx("Клиент подписал заказ", "Auftrag vom Kunden unterzeichnet")}
                />
                <ToggleRow
                  checked={signedAgency}
                  disabled={isBusy}
                  onChange={(checked) => {
                    setSignedAgency(checked);
                    void saveFlags({ signed_agency: checked });
                  }}
                  label={tx("Агентство подтвердило заказ", "Auftrag von der Agentur bestätigt")}
                />
                <ToggleRow
                  checked={prepayment}
                  disabled={isBusy}
                  onChange={(checked) => {
                    setPrepayment(checked);
                    void saveFlags({ prepayment_required: checked });
                  }}
                  label={tx("Требуется предоплата", "Vorauszahlung erforderlich")}
                />
              </div>
              <div className="grid gap-3 border-b border-border pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><Field label={tx("Полученная предоплата", "Erhaltene Vorauszahlung")}><Input className="font-mono tabular-nums" inputMode="decimal" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} disabled={!prepayment} placeholder="0.00" /></Field><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={isBusy || !lines.some(validLine)} onClick={() => void createOrAcceptQuote(false)}>{busy === "quote" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}{quote ? tx("Создать новую смету", "Neuen Kostenvoranschlag erstellen") : tx("Создать смету", "Kostenvoranschlag erstellen")}</Button><Button type="button" variant="outline" disabled={isBusy || !quote} onClick={() => void createOrAcceptQuote(true)}>{busy === "accept" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{tx("Подтвердить смету", "Kostenvoranschlag annehmen")}</Button></div></div>
              <div className="flex flex-wrap items-center justify-between gap-3"><StateMark done={Boolean(readiness.get("commercial"))} label={acceptedQuote ? tx("Смета подтверждена", "Kostenvoranschlag angenommen") : quote ? tx("Смета создана и ожидает подтверждения", "Kostenvoranschlag erstellt, Annahme ausstehend") : tx("Смета ещё не создана", "Kostenvoranschlag noch nicht erstellt")} /><Button type="button" disabled={isBusy || !lines.some(validLine)} onClick={() => void prepareCommercial()}>{busy === "commercial" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}{tx("Сохранить договор и заказ", "Vertrag und Auftrag speichern")}</Button></div>
            </section>
          ) : null}

          {lead && step === "release" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Создание пациента", "Patient anlegen")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("Проверьте все этапы. После подтверждения система создаст карточку пациента и перенесёт в неё данные обращения.", "Prüfen Sie alle Schritte. Nach der Bestätigung wird die Patientenakte angelegt und die Angaben aus dem Lead werden übernommen.")}</p></div>
              <div className="border-y border-border">{lead.readiness.steps.map((item) => <div key={item.key} className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-b-0"><span className="text-sm text-foreground">{readinessStepLabel(item.key, tx)}</span><StateMark done={item.ready} label={item.ready ? tx("Выполнено", "Erledigt") : tx("Не завершено", "Noch offen")} /></div>)}</div>
              {lead.readiness.blocking_reasons.length > 0 ? <div className="border-l-2 border-amber-500 bg-amber-50/50 px-3 py-3 text-sm text-amber-900"><div className="font-medium">{tx("Что осталось заполнить", "Was noch fehlt")}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{lead.readiness.blocking_reasons.map((reason) => <li key={reason}>{readinessReasonLabel(reason, tx)}</li>)}</ul></div> : null}
              <div className="flex justify-end"><Button type="button" disabled={isBusy || !lead.readiness.conversion_ready} onClick={() => void convert()}>{busy === "convert" ? <LoaderCircle className="size-4 animate-spin" /> : <UserRoundCheck className="size-4" />}{tx("Создать пациента", "Patient anlegen")}</Button></div>
            </section>
          ) : null}
        </main>

        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <Button type="button" variant="outline" size="sm" disabled={isBusy || index === 0} onClick={() => setStep(STEPS[index - 1].id)}><ChevronLeft className="size-3.5" />{tx("Назад", "Zurück")}</Button>
          {step !== "release" ? <Button type="button" size="sm" disabled={isBusy} onClick={next}>{busy === "save" || busy === "intake" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{tx("Далее", "Weiter")}<ChevronRight className="size-3.5" /></Button> : null}
        </footer>
      </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(deleteDocument)}
        allowImplicitDismissal
        onOpenChange={(nextOpen) => {
          if (nextOpen) return;
          setDeleteDocument(null);
          setDeleteReason("");
          setDeleteError("");
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Удалить файл?", "Datei löschen?")}</DialogTitle>
            <DialogDescription>
              {deleteDocument?.original_filename || deleteDocument?.auto_name}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void deleteWizardDocument();
            }}
          >
            <Field
              required
              label={tx("Причина удаления", "Löschgrund")}
              error={deleteError || undefined}
              errorId="lead-wizard-delete-reason-error"
            >
              <textarea
                className={cn(textareaClass, "min-h-20", deleteError && "border-destructive")}
                value={deleteReason}
                aria-invalid={Boolean(deleteError)}
                aria-describedby={deleteError ? "lead-wizard-delete-reason-error" : undefined}
                onChange={(event) => {
                  setDeleteReason(event.target.value);
                  if (deleteError) setDeleteError("");
                }}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy?.startsWith("delete-")} onClick={() => setDeleteDocument(null)}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy?.startsWith("delete-")}>
                {busy?.startsWith("delete-") ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {tx("Удалить файл", "Datei löschen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{tx("Переместить обращение в архив?", "Lead archivieren?")}</DialogTitle>
            <DialogDescription>
              {tx(
                "Обращение исчезнет из активного списка, но останется доступным в архиве.",
                "Der Lead wird aus der aktiven Liste entfernt und bleibt im Archiv verfügbar.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy === "archive"}
              onClick={() => setArchiveConfirmOpen(false)}
            >
              {tx("Отмена", "Abbrechen")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy === "archive"}
              onClick={() => void archiveLead()}
            >
              {busy === "archive" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Archive className="size-3.5" />}
              {tx("Архивировать", "Archivieren")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
