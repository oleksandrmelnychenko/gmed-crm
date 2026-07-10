import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileCheck2,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
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
  fetchContracts,
  fetchQuotes,
  updateContractStatus,
  updateQuoteStatus,
} from "@/pages/contracts/data/contracts-api";
import type { ContractItem, QuoteItem } from "@/pages/contracts/model/types";
import {
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
  referrer: string;
  specialties: string[];
  privacyConsent: boolean;
  healthcareConsent: boolean;
};

type ServiceLine = {
  id: string;
  clientReference: string | null;
  description: string;
  quantity: string;
  price: string;
  vat: string;
};

const STEPS: Array<{ id: StepId; ru: string; de: string }> = [
  { id: "master_data", ru: "Данные", de: "Stammdaten" },
  { id: "need", ru: "Запрос", de: "Bedarf" },
  { id: "documents", ru: "Документы", de: "Unterlagen" },
  { id: "commercial", ru: "Договор и заказ", de: "Vertrag & Auftrag" },
  { id: "release", ru: "Подтверждение", de: "Freigabe" },
];

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
    referrer: "",
    specialties: lead.requested_specialties ?? [],
    privacyConsent: lead.consent_privacy_practices,
    healthcareConsent: lead.consent_healthcare,
  };
}

function newLine(index = 1): ServiceLine {
  return {
    id: "line-" + Date.now().toString(36) + "-" + index,
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

function validLine(line: ServiceLine): boolean {
  return line.description.trim().length > 0 && money(line.quantity) > 0 && money(line.price) >= 0 && money(line.vat) >= 0 && money(line.vat) <= 100;
}

function lineFromOrderLeistung(item: Leistung): ServiceLine {
  return {
    id: item.id,
    clientReference: item.client_reference ?? null,
    description: item.description,
    quantity: String(item.quantity ?? "1"),
    price: String(item.unit_price ?? ""),
    vat: String(item.vat_rate ?? "19"),
  };
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Request failed";
}

function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)}>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
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

export function LeadWizard({ leadId, open, onOpenChange, onConverted }: LeadWizardProps) {
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
  const [lines, setLines] = useState<ServiceLine[]>([newLine()]);
  const [prepayment, setPrepayment] = useState(false);
  const [paidAmount, setPaidAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const hydrated = useRef<string | null>(null);

  const reload = useCallback(async (hydrateDraft: boolean, hydrateCommercial = false) => {
    if (!leadId) return;
    setLoading(true);
    setError("");
    try {
      const leadPromise = fetchLeadDetail(leadId);
      const [nextLead, nextDocuments, nextCases, nextContracts, nextOrders, nextQuotes, nextSpecialties] = await Promise.all([
        leadPromise,
        fetchDocuments("/documents?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchCases("/cases?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchContracts("/framework-contracts?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchOrders("/orders?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchQuotes("/quotes?lead_id=" + encodeURIComponent(leadId)).catch(() => []),
        fetchSpecializations().catch(() => []),
      ]);
      const nextOrder = nextOrders[0] ?? null;
      const nextOrderDetail = nextOrder && (hydrateDraft || hydrateCommercial)
        ? await fetchOrder(nextOrder.id).catch(() => null)
        : null;
      const paymentQuote = nextQuotes.find((item) => item.status === "accepted") ?? nextQuotes[0];

      setLead(nextLead);
      setDocuments(nextDocuments);
      setCases(nextCases as CaseListItem[]);
      setContracts(nextContracts);
      setOrders(nextOrders);
      setQuotes(nextQuotes);
      setSpecialties(nextSpecialties);
      if (hydrateDraft || hydrated.current !== leadId) {
        hydrated.current = leadId;
        setDraft(draftFromLead(nextLead));
        const savedStep = nextLead.wizard_state?.["step"];
        setStep(typeof savedStep === "string" && STEPS.some((item) => item.id === savedStep) ? savedStep as StepId : "master_data");
      }
      if (hydrateDraft || hydrateCommercial) {
        setLines(nextOrderDetail?.leistungen.length ? nextOrderDetail.leistungen.map(lineFromOrderLeistung) : [newLine()]);
        setPrepayment(Boolean(nextOrder?.prepayment_required));
        setPaidAmount(paymentQuote?.paid_amount == null ? "" : String(paymentQuote.paid_amount));
      }
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    if (open && leadId) void reload(true);
  }, [leadId, open, reload]);

  useEffect(() => {
    if (open) return;
    hydrated.current = null;
    setLead(null);
    setDraft(null);
    setError("");
  }, [open]);

  const order = orders[0] ?? null;
  const contract = contracts.find((item) => item.status !== "terminated") ?? null;
  const orderQuotes = useMemo(
    () => quotes.filter((item) => !order || item.order_id === order.id),
    [order, quotes],
  );
  const quote = orderQuotes[0] ?? null;
  const acceptedQuote = orderQuotes.find((item) => item.status === "accepted") ?? null;
  const caseId = cases[0]?.id ?? null;
  const identity = documents.find((item) => item.compliance_kind === "identity");
  const dsgvo = documents.find((item) => item.compliance_kind === "dsgvo");
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

  const patch = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  async function save(target = step, trackBusy = true): Promise<boolean> {
    if (!leadId || !draft) return false;
    if (trackBusy) setBusy("save");
    setError("");
    try {
      await updateLeadWizard(leadId, {
        first_name: draft.firstName.trim(),
        last_name: draft.lastName.trim(),
        date_of_birth: draft.birthDate || null,
        legal_sex: draft.legalSex || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        street_address: draft.street.trim(),
        city: draft.city.trim(),
        zip_code: draft.zip.trim(),
        country: draft.country.trim() || null,
        primary_language: draft.language.trim() || null,
        primary_concern_text: draft.concern.trim(),
        additional_concerns: draft.anamnese.trim(),
        requested_specialties: draft.specialties,
        consent_privacy_practices: draft.privacyConsent,
        consent_healthcare: draft.healthcareConsent,
        wizard_state: { step: target, onboarding_version: 2 },
      });
      await reload(false);
      return true;
    } catch (nextError) {
      setError(errorText(nextError));
      return false;
    } finally {
      if (trackBusy) setBusy(null);
    }
  }

  async function qualify() {
    if (!leadId || !(await save("need", false))) return;
    setBusy("qualify");
    try {
      await updateLeadStatus(leadId, "qualified");
      await reload(false);
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function finishIntake() {
    if (!leadId || !draft) return;
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
      await save("documents", false);
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function upload(kind: "identity" | "dsgvo", file: File) {
    if (!leadId) return;
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
      setError(errorText(nextError));
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
      setError(errorText(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function ensureCommercial() {
    if (!leadId || !draft) throw new Error("Lead is not selected");
    if (!lines.some(validLine)) throw new Error(tx("Добавьте корректную услугу", "Mindestens eine gültige Leistung ist erforderlich"));
    if (!(await save("commercial", false))) throw new Error("Lead could not be saved");
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
      prepayment_required: prepayment,
      signed_patient: Boolean(order?.signed_patient),
      signed_agency: Boolean(order?.signed_agency),
    });
    return { contractId, orderId };
  }

  async function prepareCommercial() {
    setBusy("commercial");
    try {
      await ensureCommercial();
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError));
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
      setError(errorText(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function saveFlags(patchValue: { signed_patient?: boolean; signed_agency?: boolean; prepayment_required?: boolean }) {
    setBusy("flags");
    try {
      const result = await ensureCommercial();
      await updateOrderCommercialBasis(result.orderId, patchValue);
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(null);
    }
  }

  async function createOrAcceptQuote(accept: boolean) {
    setBusy(accept ? "accept" : "quote");
    try {
      let quoteId = quote?.id;
      if (!accept || !quoteId) {
        const result = await ensureCommercial();
        quoteId = (await createQuote(result.orderId, {})).id;
      }
      if (accept) {
        await updateQuoteStatus(quoteId, {
          status: "accepted",
          paid_amount: prepayment ? money(paidAmount) : undefined,
        });
      }
      await reload(false, true);
    } catch (nextError) {
      setError(errorText(nextError));
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
      setError(errorText(nextError));
      await reload(false);
    } finally {
      setBusy(null);
    }
  }

  function next() {
    const target = STEPS[index + 1];
    if (!target) return;
    void save(target.id).then((saved) => {
      if (saved) setStep(target.id);
    });
  }

  function updateLine(id: string, patchValue: Partial<ServiceLine>) {
    setLines((current) => current.map((line) => line.id === id ? { ...line, ...patchValue } : line));
  }

  if (!leadId) return null;
  const isBusy = busy !== null;
  const masterReady = Boolean(draft?.firstName.trim() && draft.lastName.trim() && draft.birthDate && draft.legalSex && (draft.email.trim() || draft.phone.trim()) && draft.street.trim() && draft.city.trim() && draft.zip.trim());

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 border-l border-border p-0 sm:max-w-4xl">
        <SheetTitle className="sr-only">{tx("Онбординг лида", "Lead-Onboarding")}</SheetTitle>
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">{lead ? [lead.first_name, lead.last_name].filter(Boolean).join(" ") : tx("Онбординг лида", "Lead-Onboarding")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{tx("Пациент появится только после финального подтверждения.", "Ein Patient wird erst nach der finalen Freigabe angelegt.")}</p>
          </div>
          <Button type="button" variant="outline" size="icon-sm" title={tx("Обновить", "Aktualisieren")} aria-label={tx("Обновить", "Aktualisieren")} disabled={loading || isBusy} onClick={() => void reload(false)}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          </Button>
        </header>

        <nav className="grid grid-cols-5 border-b border-border" aria-label={tx("Этапы онбординга", "Onboarding-Schritte")}>
          {STEPS.map((item, itemIndex) => {
            const selected = item.id === step;
            const done = readiness.get(item.id) ?? false;
            return (
              <button key={item.id} type="button" onClick={() => setStep(item.id)} aria-current={selected ? "step" : undefined} className={cn("min-w-0 border-r border-border px-2 py-3 text-left last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", selected ? "bg-muted/50" : "hover:bg-muted/30")}>
                <span className="flex items-center gap-1.5">
                  <span className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px]", done ? "border-emerald-600 text-emerald-700" : "border-muted-foreground/50 text-muted-foreground")}>{done ? <Check className="size-3" /> : itemIndex + 1}</span>
                  <span className="hidden text-[11px] font-medium leading-tight text-foreground lg:inline">{lang === "de" ? item.de : item.ru}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {error ? <div className="mb-5 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div> : null}
          {loading && !lead ? <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{tx("Загрузка", "Wird geladen")}</div> : null}

          {draft && step === "master_data" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Сведения о клиенте", "Personendaten")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("Проверьте данные, которые станут основой карточки пациента.", "Diese Angaben werden zur Grundlage der Patientenakte.")}</p></div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={tx("Имя", "Vorname")}><Input value={draft.firstName} onChange={(event) => patch("firstName", event.target.value)} /></Field>
                <Field label={tx("Фамилия", "Nachname")}><Input value={draft.lastName} onChange={(event) => patch("lastName", event.target.value)} /></Field>
                <Field label={tx("Дата рождения", "Geburtsdatum")}><Input type="date" value={draft.birthDate} onChange={(event) => patch("birthDate", event.target.value)} /></Field>
                <Field label={tx("Юридический пол", "Rechtliches Geschlecht")}><NativeComboboxSelect value={draft.legalSex} onChange={(event) => patch("legalSex", event.target.value)} className={selectClass}><option value="">{tx("Выберите", "Auswählen")}</option><option value="female">{tx("Женский", "Weiblich")}</option><option value="male">{tx("Мужской", "Männlich")}</option><option value="diverse">{tx("Разное", "Divers")}</option><option value="no_entry">{tx("Без указания", "Keine Angabe")}</option></NativeComboboxSelect></Field>
                <Field label="E-mail"><Input type="email" value={draft.email} onChange={(event) => patch("email", event.target.value)} /></Field>
                <Field label={tx("Телефон", "Telefon")}><Input value={draft.phone} onChange={(event) => patch("phone", event.target.value)} /></Field>
                <Field label={tx("Улица и дом", "Straße und Hausnummer")}><Input value={draft.street} onChange={(event) => patch("street", event.target.value)} /></Field>
                <Field label={tx("Город", "Ort")}><Input value={draft.city} onChange={(event) => patch("city", event.target.value)} /></Field>
                <Field label={tx("Индекс", "Postleitzahl")}><Input value={draft.zip} onChange={(event) => patch("zip", event.target.value)} /></Field>
                <Field label={tx("Страна", "Land")}><Input value={draft.country} onChange={(event) => patch("country", event.target.value)} /></Field>
                <Field label={tx("Основной язык", "Primärsprache")}><Input value={draft.language} onChange={(event) => patch("language", event.target.value)} /></Field>
              </div>
              <StateMark done={masterReady && Boolean(readiness.get("master_data"))} label={readiness.get("master_data") ? tx("Этап подтвержден", "Schritt erfüllt") : tx("Заполните обязательные поля", "Pflichtfelder ausfüllen")} />
            </section>
          ) : null}

          {draft && step === "need" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Запрос и специалисты", "Bedarf und Fachrichtungen")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("Специальность выбирается из актуального справочника.", "Fachrichtungen werden aus dem aktuellen Verzeichnis gewählt.")}</p></div>
              <Field label={tx("Основная причина обращения", "Hauptanliegen")}><textarea className={cn(textareaClass, "min-h-28")} value={draft.concern} onChange={(event) => patch("concern", event.target.value)} /></Field>
              <Field label={tx("Дополнительный контекст", "Zusätzlicher Kontext")}><textarea className={cn(textareaClass, "min-h-24")} value={draft.anamnese} onChange={(event) => patch("anamnese", event.target.value)} /></Field>
              <div className="space-y-2">
                <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{tx("Специалисты", "Fachrichtungen")}</span>
                <div className="flex flex-wrap gap-2">{draft.specialties.map((value) => <span key={value} className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground">{value}<button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => patch("specialties", draft.specialties.filter((item) => item !== value))} aria-label={tx("Удалить", "Entfernen")}><X className="size-3" /></button></span>)}</div>
                <NativeComboboxSelect value="" onChange={(event) => { const selected = specialties.find((item) => item.id === event.target.value); if (selected) { const value = selected.code || selected.name_en; if (!draft.specialties.includes(value)) patch("specialties", [...draft.specialties, value]); } }} className={selectClass}>
                  <option value="">{tx("Добавить специальность", "Fachrichtung hinzufügen")}</option>
                  {specialties.map((item) => <option key={item.id} value={item.id}>{lang === "de" ? item.name_de || item.name_en : item.name_ru || item.name_de || item.name_en}</option>)}
                </NativeComboboxSelect>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <StateMark done={lead?.qualification_status === "qualified"} label={lead?.qualification_status === "qualified" ? tx("Лид квалифицирован", "Lead qualifiziert") : tx("Квалификация ожидается", "Qualifizierung ausstehend")} />
                <Button type="button" variant="outline" disabled={isBusy || !draft.concern.trim() || draft.specialties.length === 0} onClick={() => void qualify()}>{busy === "qualify" ? <LoaderCircle className="size-3.5 animate-spin" /> : <UserRoundCheck className="size-3.5" />}{tx("Квалифицировать", "Qualifizieren")}</Button>
              </div>
            </section>
          ) : null}

          {draft && step === "documents" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Документы и анамнез", "Unterlagen und Anamnese")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("Документы остаются у лида до финальной конвертации.", "Die Dokumente bleiben bis zur finalen Konvertierung am Lead.")}</p></div>
              {(["identity", "dsgvo"] as const).map((kind) => {
                const document = kind === "identity" ? identity : dsgvo;
                const signed = Boolean(document?.signed_at && document?.compliance_kind === kind);
                const label = kind === "identity" ? tx("Документ личности", "Identitätsnachweis") : tx("Согласие DSGVO", "DSGVO-Einwilligung");
                const fileId = "lead-file-" + kind;
                return <div key={kind} className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
                  <div><div className="text-sm font-medium text-foreground">{label}</div><div className="mt-1 text-xs text-muted-foreground">{document ? document.original_filename || document.auto_name : tx("Файл еще не загружен", "Noch keine Datei hochgeladen")}</div></div>
                  <div className="flex flex-wrap items-center gap-2"><input id={fileId} type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png" disabled={isBusy} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) { void upload(kind, file); event.currentTarget.value = ""; } }} /><label htmlFor={fileId} className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground shadow-xs hover:bg-accent", isBusy && "pointer-events-none opacity-50")}><Upload className="size-3.5" />{tx("Загрузить", "Hochladen")}</label><Button type="button" variant="outline" size="icon-sm" title={tx("Подтвердить", "Bestätigen")} aria-label={tx("Подтвердить", "Bestätigen")} disabled={!document || signed || isBusy} onClick={() => document && void signDocument(document.id, kind)}><FileCheck2 className={cn("size-3.5", signed && "text-emerald-700")} /></Button><StateMark done={signed} label={signed ? tx("Подтвержден", "Bestätigt") : tx("Ожидается", "Ausstehend")} /></div>
                </div>;
              })}
              <div className="border-y border-border"><ToggleRow checked={draft.privacyConsent} disabled={isBusy} onChange={(checked) => patch("privacyConsent", checked)} label={tx("Приняты правила конфиденциальности", "Datenschutzhinweise akzeptiert")} /><ToggleRow checked={draft.healthcareConsent} disabled={isBusy} onChange={(checked) => patch("healthcareConsent", checked)} label={tx("Согласие на обработку медицинских данных", "Einwilligung zur Verarbeitung medizinischer Daten")} /></div>
              <Field label={tx("Текущий анамнез", "Aktuelle Anamnese")}><textarea className={cn(textareaClass, "min-h-28")} value={draft.anamnese} onChange={(event) => patch("anamnese", event.target.value)} /></Field>
              <Field label={tx("Направивший врач / источник", "Zuweiser / Quelle")}><Input value={draft.referrer} onChange={(event) => patch("referrer", event.target.value)} /></Field>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><StateMark done={Boolean(readiness.get("documents"))} label={readiness.get("documents") ? tx("Этап подтвержден", "Schritt erfüllt") : tx("Нужны документы и завершенный анамнез", "Dokumente und Anamnese erforderlich")} /><Button type="button" variant="outline" disabled={isBusy || !draft.concern.trim() || !draft.anamnese.trim()} onClick={() => void finishIntake()}>{busy === "intake" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />}{tx("Завершить анамнез", "Anamnese abschließen")}</Button></div>
            </section>
          ) : null}

          {draft && step === "commercial" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Договор, заказ и кошторис", "Vertrag, Auftrag und Kostenvoranschlag")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("Эти артефакты принадлежат лиду до финальной конвертации.", "Diese Unterlagen gehören bis zur Freigabe dem Lead.")}</p></div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3"><div><div className="text-sm font-medium text-foreground">{tx("Рамочный договор", "Rahmenvertrag")}</div><div className="mt-1 text-xs text-muted-foreground">{contract?.contract_number ?? tx("Еще не подготовлен", "Noch nicht vorbereitet")}</div></div><div className="flex items-center gap-2"><StateMark done={contract?.status === "signed"} label={contract?.status === "signed" ? tx("Подписан", "Unterzeichnet") : tx("Не подписан", "Nicht unterzeichnet")} /><Button type="button" variant="outline" size="sm" disabled={isBusy} onClick={() => void signContract()}>{busy === "contract" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />}{tx("Подписать", "Unterzeichnen")}</Button></div></div>
              <div className="space-y-3"><div className="flex items-center justify-between"><span className="text-sm font-medium text-foreground">{tx("Услуги заказа", "Auftragsleistungen")}</span><Button type="button" variant="outline" size="icon-sm" title={tx("Добавить услугу", "Leistung hinzufügen")} aria-label={tx("Добавить услугу", "Leistung hinzufügen")} onClick={() => setLines((current) => [...current, newLine(current.length + 1)])}><Plus className="size-3.5" /></Button></div>
                {lines.map((line) => <div key={line.id} className="grid gap-2 border-b border-border/70 pb-3 md:grid-cols-[minmax(0,1fr)_72px_100px_72px_auto]"><Input placeholder={tx("Описание услуги", "Leistungsbeschreibung")} value={line.description} onChange={(event) => updateLine(line.id, { description: event.target.value })} /><Input inputMode="decimal" aria-label={tx("Количество", "Menge")} value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} /><Input inputMode="decimal" aria-label={tx("Цена", "Preis")} value={line.price} onChange={(event) => updateLine(line.id, { price: event.target.value })} /><Input inputMode="decimal" aria-label={tx("НДС", "MwSt.")} value={line.vat} onChange={(event) => updateLine(line.id, { vat: event.target.value })} /><Button type="button" variant="ghost" size="icon-sm" title={tx("Удалить услугу", "Leistung entfernen")} aria-label={tx("Удалить услугу", "Leistung entfernen")} disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><X className="size-3.5" /></Button></div>)}
                <div className="flex flex-wrap justify-end gap-4 text-sm tabular-nums text-muted-foreground"><span>{tx("Нетто", "Netto")}: {estimate.net.toFixed(2)} EUR</span><span>{tx("НДС", "MwSt.")}: {estimate.vat.toFixed(2)} EUR</span><span className="font-semibold text-foreground">{tx("Итого", "Gesamt")}: {estimate.gross.toFixed(2)} EUR</span></div>
              </div>
              <div className="border-y border-border"><ToggleRow checked={Boolean(order?.signed_patient)} disabled={isBusy} onChange={(checked) => void saveFlags({ signed_patient: checked })} label={tx("Подпись клиента на заказе", "Unterschrift der Kundin / des Kunden")} /><ToggleRow checked={Boolean(order?.signed_agency)} disabled={isBusy} onChange={(checked) => void saveFlags({ signed_agency: checked })} label={tx("Подпись агентства на заказе", "Unterschrift der Agentur")} /><ToggleRow checked={prepayment} disabled={isBusy} onChange={(checked) => { setPrepayment(checked); void saveFlags({ prepayment_required: checked }); }} label={tx("Требуется предоплата", "Vorauszahlung erforderlich")} /></div>
              <div className="grid gap-3 border-b border-border pb-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"><Field label={tx("Получено предоплаты", "Erhaltene Vorauszahlung")}><Input inputMode="decimal" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)} disabled={!prepayment} placeholder="0.00" /></Field><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={isBusy || !lines.some(validLine)} onClick={() => void createOrAcceptQuote(false)}>{busy === "quote" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}{quote ? tx("Новый кошторис", "Neuer Kostenvoranschlag") : tx("Создать кошторис", "Kostenvoranschlag erstellen")}</Button><Button type="button" variant="outline" disabled={isBusy || !quote} onClick={() => void createOrAcceptQuote(true)}>{busy === "accept" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{tx("Принять", "Annehmen")}</Button></div></div>
              <div className="flex flex-wrap items-center justify-between gap-3"><StateMark done={Boolean(readiness.get("commercial"))} label={acceptedQuote ? tx("Кошторис принят", "Kostenvoranschlag angenommen") : tx("Кошторис ожидает подтверждения", "Kostenvoranschlag ausstehend")} /><Button type="button" disabled={isBusy || !lines.some(validLine)} onClick={() => void prepareCommercial()}>{busy === "commercial" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}{tx("Сохранить коммерческие данные", "Kommerzielle Daten speichern")}</Button></div>
            </section>
          ) : null}

          {lead && step === "release" ? (
            <section className="space-y-5">
              <div><h3 className="text-sm font-semibold text-foreground">{tx("Финальное подтверждение", "Finale Freigabe")}</h3><p className="mt-1 text-sm text-muted-foreground">{tx("После подтверждения будет создан пациент и перенесены все onboarding-артефакты.", "Nach der Freigabe werden Patient und alle Onboarding-Artefakte atomar angelegt bzw. übertragen.")}</p></div>
              <div className="border-y border-border">{lead.readiness.steps.map((item) => <div key={item.key} className="flex items-center justify-between gap-4 border-b border-border/70 py-3 last:border-b-0"><span className="text-sm text-foreground">{item.label}</span><StateMark done={item.ready} label={item.ready ? tx("Готово", "Bereit") : tx("Не готово", "Nicht bereit")} /></div>)}</div>
              {lead.readiness.blocking_reasons.length > 0 ? <div className="border-l-2 border-amber-500 bg-amber-50/50 px-3 py-3 text-sm text-amber-900"><div className="font-medium">{tx("Что еще нужно завершить", "Noch zu erledigen")}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5">{lead.readiness.blocking_reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></div> : null}
              <div className="flex justify-end"><Button type="button" disabled={isBusy || !lead.readiness.conversion_ready} onClick={() => void convert()}>{busy === "convert" ? <LoaderCircle className="size-4 animate-spin" /> : <UserRoundCheck className="size-4" />}{tx("Создать пациента", "Patient anlegen")}</Button></div>
            </section>
          ) : null}
        </main>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <Button type="button" variant="outline" size="sm" disabled={isBusy || index === 0} onClick={() => setStep(STEPS[index - 1].id)}><ChevronLeft className="size-3.5" />{tx("Назад", "Zurück")}</Button>
          {step !== "release" ? <Button type="button" size="sm" disabled={isBusy || (step === "master_data" && !masterReady)} onClick={next}>{busy === "save" ? <LoaderCircle className="size-3.5 animate-spin" /> : null}{tx("Сохранить и далее", "Speichern und weiter")}<ChevronRight className="size-3.5" /></Button> : null}
        </footer>
      </SheetContent>
    </Sheet>
  );
}
