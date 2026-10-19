import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Check,
  CircleAlert,
  FileText,
  LoaderCircle,
  Upload,
} from "lucide-react";

import {
  Banner,
  checkboxClass,
  inputClass,
  Section,
  selectClass,
  StatusBadge,
  textareaClass,
  tokens,
} from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusChip } from "@/components/ui/status-chip";
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect, countryLabel } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { ApiRequestError } from "@/lib/api";
import { isValidEmailAddress } from "@/lib/contact-validation";
import { isKnownNoMailEmail } from "@/lib/email-domain-check";
import { EmailDomainWarning } from "@/components/email-domain-warning";
import { useAuth } from "@/lib/auth";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { generateDocument, uploadDocument } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { useSignatureSummary } from "@/pages/documents/data/use-signature-summary";
import { SignatureProgressChips } from "@/pages/documents/ui/signature-progress-chips";
import { normalizeLeadPortalBilling, type LeadPortalEnhancedDetails, type LeadPortalIntake, type PatientFieldMarker } from "../data/lead-portal-intake-api";
import { billingStatements, payerOrganisationStatements, portalInvoiceTo } from "../model/lead-gwg-statements";
import { createPayerAutosave, type PayerAutosave, type PayerAutosaveState } from "../model/lead-payer-autosave";
import { standaloneCostAssumptionKept } from "../model/lead-payer-package";
import type { LeadPayerLinkController } from "../model/use-lead-payer-link";
import { useLeadPayerPackage } from "../model/use-lead-payer-package";
import { LeadPayerLinkPanel } from "./lead-payer-link-panel";
import { LeadPayerPackagePanel } from "./lead-payer-package-panel";
import { sortWizardDocumentsNewestFirst } from "./lead-wizard-document-metadata";
import { PatientFieldBadge } from "./lead-wizard-portal-intake";

import {
  PAYER_RELATIONSHIP_KINDS,
  PAYER_SECTION_ID,
  PAYER_TYPES,
  SOURCE_OF_FUNDS,
  chosenPayerRepresentative,
  costEstimateConsentLine,
  invoiceTaxFieldsShown,
  isOrganisationPayerForm,
  payerDeclarationPrefillForm,
  payerDeclarationToForm,
  payerFormMissing,
  payerKindOptions,
  payerReasonLabel,
  payerRelationshipKindLabel,
  payerRelationshipTextShown,
  payerSignatureSequence,
  payerStatusBadge,
  payerTypeLabel,
  statedFundsSourcesLabel,
  sourceOfFundsLabel,
  withPayerDeclarationField,
  type PayerDeclaration,
  type PayerDeclarationForm,
  type PayerDeclarationResponse,
  type PayerDeclarationStatus,
  type PayerRepresentative,
  type SignatureStepState,
  type SourceOfFunds,
  type Tx,
} from "../model/lead-payer";

const MAX_EVIDENCE_FILE_SIZE = 25 * 1024 * 1024;

/** A typed third-party e-mail that is not name@domain.tld. */
const payerEmailFormatInvalid = (form: PayerDeclarationForm) =>
  form.kind === "third_party" && Boolean(form.email.trim()) && !isValidEmailAddress(form.email);

/** A typed third-party e-mail the server would reject (format, or a domain known to receive no mail): kept in the form, never autosaved. */
const payerEmailInvalid = (form: PayerDeclarationForm) =>
  payerEmailFormatInvalid(form) || (form.kind === "third_party" && isKnownNoMailEmail(form.email));

function PayerField({
  label,
  children,
  className,
  required = false,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  required?: boolean;
}) {
  return (
    <label className={cn("min-w-0 space-y-1.5", className)}>
      <span className={cn(tokens.text.label, "block")}>
        {label}
        {required ? <span aria-hidden="true" className="ml-0.5 text-destructive">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function PayerCheckbox({
  id,
  checked,
  label,
  disabled,
  onChange,
}: {
  id?: string;
  checked: boolean;
  label: ReactNode;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 py-1.5">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={cn(checkboxClass, "mt-0.5")}
      />
      <span className="text-[13px] leading-5 text-foreground">{label}</span>
    </label>
  );
}

function PayerReadOnlyStatement({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <dt className="text-[11.5px] font-medium leading-snug text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] font-medium leading-5 text-foreground">{value || "—"}</dd>
    </div>
  );
}

/**
 * The minor's parent or legal representative who pays, read-only: the full
 * name, the date of birth, the address in its fields and the citizenships as
 * the representative block holds them (owner decision 2026-10-19). The
 * parent signs as the contracting party; no Kostenübernahmeerklärung.
 */
export function PayerRepresentativeCard({ person, lang, tx }: { person: PayerRepresentative; lang: string; tx: Tx }) {
  const rows: Array<[string, string, string]> = [
    ["name", tx("Имя и фамилия", "Vor- und Nachname"), person.name],
    ["date_of_birth", tx("Дата рождения", "Geburtsdatum"), person.date_of_birth ? formatAppDate(person.date_of_birth) : ""],
    ["street", tx("Улица и дом", "Straße und Hausnummer"), person.street ?? ""],
    ["zip", tx("Почтовый индекс", "Postleitzahl"), person.zip ?? ""],
    ["city", tx("Город", "Ort"), person.city ?? ""],
    ["country", tx("Страна проживания", "Wohnsitzland"), countryLabel(person.country, lang)],
    ["citizenships", tx("Гражданство", "Staatsangehörigkeit"), person.citizenships.map((code) => countryLabel(code, lang)).join(", ")],
  ];
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5" data-testid="lead-payer-representative-card">
      <p className="text-[13px] font-medium text-foreground">
        {person.guardian
          ? tx("Платит законный представитель (опекун) — сторона договора", "Es zahlt der Vormund – Vertragspartei")
          : tx("Платит родитель — законный представитель и сторона договора", "Es zahlt ein Elternteil – gesetzlicher Vertreter und Vertragspartei")}
      </p>
      <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([key, label, value]) => (
          <PayerReadOnlyStatement key={key} label={label} value={value} testId={`lead-payer-representative-${key}`} />
        ))}
      </dl>
      <p className="text-xs leading-5 text-muted-foreground">
        {tx(
          "Данные меняются в блоке законных представителей. Отдельное согласие плательщика (Kostenübernahmeerklärung) не нужно: родитель подписывает договор сам.",
          "Die Angaben werden im Block der gesetzlichen Vertreter geändert. Eine Kostenübernahmeerklärung ist nicht nötig: der Elternteil unterschreibt den Vertrag selbst.",
        )}
      </p>
    </div>
  );
}

/**
 * "Кто платит" in the compliance step: who pays, own economic interest or a
 * beneficial owner, the source of funds and the third-party payer's data. The
 * form saves changed drafts automatically; the server records the declaration with an audit
 * row and makes a third party the payer of the lead's orders.
 *
 * A third party is a private person (personal identity, address,
 * citizenships) or a company, an organisation or an insurer (name and seat).
 * The lead's consent that GMED contacts the payer is shown, never edited:
 * only the lead gives it in the cabinet. The same holds for where the invoice
 * goes (section 7 of the form): staff add only USt-IdNr. / Steuernummer of
 * the invoice recipient. A stored third-party payer gets the payer's own
 * link (phase 3a) below the payer's data.
 */
export function LeadPayerDeclarationSection({
  leadId,
  data,
  loading,
  loadError,
  disabled,
  canEdit,
  lang,
  tx,
  onSave,
  registerAutosave,
  errorText,
  patientMarker,
  payerLink,
  payerLinkCanEdit,
  leadLanguage,
  onPayerLinkSent,
  enhancedDetails,
  portalIntake = null,
  prefill = null,
  amlSlot = null,
  amlPartHidden = false,
}: {
  leadId: string;
  data: PayerDeclarationResponse | null;
  loading: boolean;
  loadError: unknown;
  disabled: boolean;
  canEdit: boolean;
  lang: string;
  tx: Tx;
  onSave: (form: PayerDeclarationForm) => Promise<unknown>;
  /** Parent transitions await this queue before disabling or unmounting it. */
  registerAutosave?: (flush: () => Promise<boolean>) => (() => void);
  errorText: (error: unknown) => string;
  /** Set while the payer is the one the patient stated in the lead cabinet. */
  patientMarker?: PatientFieldMarker | null;
  /** The payer's own link; absent where it is not loaded (the panel then stays away). */
  payerLink?: LeadPayerLinkController | null;
  /** Whether the link may be sent, revoked and the amount entered (leads.edit); `canEdit` when absent. */
  payerLinkCanEdit?: boolean;
  /** The lead's language: the first choice for the payer's invitation. */
  leadLanguage?: string | null;
  /** A payer link went out: the server marked the payer as informed, the declaration is to be reloaded. */
  onPayerLinkSent?: () => void;
  /**
   * The cabinet's extra step with the self-payer's proofs (the portal state);
   * without it the declaration's answers are shown without files.
   */
  enhancedDetails?: LeadPortalEnhancedDetails | null;
  /** Cabinet snapshots are read-only and are hidden with the identification privacy guard. */
  portalIntake?: LeadPortalIntake | null;
  /**
   * A repeat intake without a declaration of its own: the patient's declaration
   * fixed at the conversion of the last request. It only fills the form; staff
   * check it before editing; untouched prefill is not written (QA B-18, 2026-10-11).
   */
  prefill?: PayerDeclaration | null;
  /**
   * The wizard's enhanced AML block (owner 2026-10-19): the own economic
   * interest and the source of funds are shown there; inline without it.
   */
  amlSlot?: HTMLElement | null;
  /** The part lives in the AML form only: while that form is closed it is not shown here. */
  amlPartHidden?: boolean;
}) {
  const inAmlBlock = (node: ReactNode) => (amlSlot ? createPortal(node, amlSlot) : amlPartHidden ? null : node);
  const prefillActive = !data?.declaration && Boolean(prefill);
  const initialForm = (): PayerDeclarationForm =>
    !data?.declaration && prefill ? payerDeclarationPrefillForm(prefill) : payerDeclarationToForm(data?.declaration);
  // The stored declaration is the first form state as well, so a render
  // without effects (static markup) already shows it.
  const [form, setForm] = useState<PayerDeclarationForm>(initialForm);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"upload" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [autosave, setAutosave] = useState<PayerAutosaveState>({ status: "idle", dirty: false, error: null });
  const [evidenceName, setEvidenceName] = useState("");
  const loadedFor = useRef<string | null>(null);
  const formRef = useRef(form);
  const autosaveRef = useRef<PayerAutosave | null>(null);
  const mayFlushRef = useRef(false);
  const activeLeadRef = useRef(leadId);
  activeLeadRef.current = leadId;
  mayFlushRef.current = canEdit && !disabled;

  useEffect(() => {
    const initial = prefillActive && prefill ? payerDeclarationPrefillForm(prefill) : payerDeclarationToForm(data?.declaration);
    formRef.current = initial;
    setForm(initial);
    setDirty(false);
    setMessage(null);
    setEvidenceName("");
    setAutosave({ status: "idle", dirty: false, error: null });
    const queue = createPayerAutosave(initial, (next) => {
      if (activeLeadRef.current !== leadId) return;
      setAutosave(next);
      setDirty(next.dirty);
    });
    autosaveRef.current = queue;
    // An invalid payer e-mail blocks the wizard's save instead of being dropped silently.
    const unregister = registerAutosave?.(() => (payerEmailInvalid(formRef.current) ? Promise.resolve(false) : queue.flush()));
    return () => {
      // Closing the wizard or moving to another step must not drop the last edit.
      queue.setEnabled(mayFlushRef.current);
      void queue.dispose(mayFlushRef.current);
      unregister?.();
      if (autosaveRef.current === queue) autosaveRef.current = null;
    };
  }, [leadId]);

  useEffect(() => {
    autosaveRef.current?.setEnabled(canEdit && !disabled && busy !== "upload" && !(loading && !data));
  }, [leadId, canEdit, disabled, busy, loading, data]);

  // Take the stored declaration unless the user is editing it. Sending the
  // payer link marks the payer as informed without another change.
  useEffect(() => {
    const prefillKey = prefillActive ? `prefill-${prefill?.updated_at ?? ""}` : "";
    const key = `${leadId}:${data?.declaration?.updated_at ?? "none"}:${data?.declaration?.payer_informed_at ?? ""}:${prefillKey}`;
    if (dirty && loadedFor.current?.startsWith(`${leadId}:`)) return;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    const next = prefillActive && prefill ? payerDeclarationPrefillForm(prefill) : payerDeclarationToForm(data?.declaration);
    formRef.current = next;
    setForm(next);
    autosaveRef.current?.setBaseline(next);
  }, [data, dirty, leadId, prefill, prefillActive]);

  const patch = <K extends keyof PayerDeclarationForm>(key: K, value: PayerDeclarationForm[K]) => {
    const next = withPayerDeclarationField(formRef.current, key, value);
    formRef.current = next;
    setDirty(true);
    setMessage(null);
    setForm(next);
    if (payerEmailInvalid(next)) return;
    // Capture this lead's save callback: a later lead must never receive this draft.
    const queue = autosaveRef.current;
    queue?.schedule(next, async (snapshot) => {
      await onSave(snapshot);
      // Another payer or e-mail revokes the link; a third party may make it sendable.
      if (activeLeadRef.current === leadId && autosaveRef.current === queue) void payerLink?.reload();
    });
  };

  // A minor's parent or legal representative pays, never the child (owner
  // decision 2026-10-19); the parent is named, the data are the representative block's.
  const minor = data?.status.minor === true;
  const representatives = data?.status.representatives ?? [];
  const chosenRepresentative = chosenPayerRepresentative(form, data?.status);
  const chooseKind = (kind: PayerDeclarationForm["kind"]) => {
    patch("kind", kind);
    // One parent on file: that one; otherwise staff choose.
    if (kind === "representative" && !formRef.current.representativeId && representatives.length === 1) {
      patch("representativeId", representatives[0].id);
    }
  };

  const readOnly = disabled || !canEdit || busy !== null || (loading && !data);
  const thirdParty = form.kind === "third_party";
  // An older server knows neither the payer type nor the relationship kind
  // nor the lead's contact consent: the form then stays the one for a person.
  const typed = form.payerTypeSupport !== "unsupported";
  const organisation = isOrganisationPayerForm(form);
  const relationshipTextShown = payerRelationshipTextShown(form, data?.declaration);
  const missing = payerFormMissing(form);
  const emailInvalid = payerEmailFormatInvalid(form);
  const statusBadge = payerStatusBadge(data?.status, tx);
  const informedAt = data?.declaration?.payer_informed_at ?? null;
  const contactConsentAt = data?.declaration?.contact_consent_at ?? null;
  // Phase 3b: the lead's consent to pass the cost estimate on; an older server has none.
  const costEstimateConsent = costEstimateConsentLine(data, tx);
  // Section 7: the lead chose where the invoice goes; an older server does
  // not send the key, and a lead who has not answered yet has it null.
  const cabinetHidden = portalIntake?.identification_hidden === true;
  const cabinet = cabinetHidden ? null : portalIntake;
  const cabinetBilling = cabinet?.billing ?? null;
  const organisationMask = cabinet?.payer_organisation ?? null;
  const invoiceTo = cabinetBilling ? portalInvoiceTo(cabinetBilling) : data?.declaration?.invoice_to;
  const invoiceToKnown = invoiceTo !== undefined;
  const invoiceTaxShown = invoiceTaxFieldsShown(form);
  const recipientBilling = cabinetHidden
    ? null
    : cabinetBilling ?? (data?.declaration && invoiceToKnown ? normalizeLeadPortalBilling(data.declaration) : null);
  const recipientStatements = recipientBilling
    ? billingStatements(recipientBilling, tx, lang).invoice.filter((row) => row.key !== "invoice_to" && row.key !== "invoice_tax")
    : [];
  // The self-paying lead's own source of funds (read-only): shown while the
  // stored declaration says the patient pays and the server knows the answer.
  const storedSource = data?.declaration?.self_funds_source?.trim();
  const leadSelfFunds = data?.declaration?.payer_kind === "self"
    && (data.declaration.self_funds_source !== undefined || Boolean(enhancedDetails))
    ? {
        sources: enhancedDetails?.answers.funds_sources ?? (storedSource ? [storedSource] : []),
        description: enhancedDetails?.answers.funds_description ?? data.declaration.self_funds_description ?? null,
        proofDocuments: enhancedDetails?.funds_proof_documents ?? null,
        proofRequired: enhancedDetails?.asks.funds_proof ?? false,
        updatedAt: enhancedDetails?.updated_at ?? null,
      }
    : null;
  // Nothing stated and no proof asked: no block at all (owner 2026-10-19,
  // no "not stated yet" label).
  const selfFundsShown = Boolean(leadSelfFunds && (
    leadSelfFunds.sources.length > 0
    || leadSelfFunds.description
    || (leadSelfFunds.proofDocuments && (leadSelfFunds.proofDocuments.length > 0 || leadSelfFunds.proofRequired))
  ));
  // A source the lead stated is the declaration's: staff need not choose one.
  // Asked only by a trigger of the enhanced check (2026-10-19); an older server requires it.
  const sourceRequired = data?.status.source_of_funds_required !== false
    && !(form.kind === "self" && form.leadSelfFundsStated);
  // The proof is required while the enhanced check (block A) asks the lead for
  // it; the lead's own upload counts (QA 2026-10-10: "(необязательно)" here,
  // "обязательно" below).
  const staffProofLabel = !leadSelfFunds?.proofRequired
    ? tx("Подтверждение источника средств (необязательно)", "Nachweis der Herkunft der Mittel (optional)")
    : (leadSelfFunds.proofDocuments?.length ?? 0) > 0
      ? tx(
        "Подтверждение источника средств обязательно (усиленная проверка): загружено пациентом, см. ниже",
        "Nachweis der Herkunft der Mittel erforderlich (verstärkte Prüfung): vom Patienten hochgeladen, siehe unten",
      )
      : tx(
        "Подтверждение источника средств обязательно (усиленная проверка): пациент ещё не загрузил",
        "Nachweis der Herkunft der Mittel erforderlich (verstärkte Prüfung): vom Patienten noch nicht hochgeladen",
      );

  async function uploadEvidence(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_EVIDENCE_FILE_SIZE) {
      setMessage({
        tone: "error",
        text: tx("Размер файла не должен превышать 25 МБ", "Die Datei darf höchstens 25 MB groß sein"),
      });
      return;
    }
    setBusy("upload");
    setMessage(null);
    const uploadQueue = autosaveRef.current;
    const uploadIsCurrent = () => activeLeadRef.current === leadId && autosaveRef.current === uploadQueue;
    try {
      const body = new FormData();
      body.set("lead_id", leadId);
      body.set("file", file);
      body.set("auto_name", "Nachweis Herkunft der Mittel");
      body.set("art", "source_of_funds_evidence");
      body.set("category", "finance_source_of_funds");
      body.set("access_category", "financial");
      const uploaded = await uploadDocument(body);
      if (!uploadIsCurrent()) return;
      setEvidenceName(file.name);
      patch("sourceOfFundsDocumentId", uploaded.id);
    } catch (error) {
      if (uploadIsCurrent()) setMessage({ tone: "error", text: errorText(error) });
    } finally {
      if (uploadIsCurrent()) setBusy(null);
    }
  }

  // The address of a person, the seat of an organisation: same fields, placed
  // differently in the form.
  const addressFields = (
    <>
      <PayerField label={tx("Улица и дом", "Straße und Hausnummer")} required>
        <Input className={inputClass} value={form.street} disabled={readOnly} onChange={(event) => patch("street", event.target.value)} />
      </PayerField>
      <PayerField label={tx("Почтовый индекс", "Postleitzahl")} required>
        <Input className={inputClass} value={form.zip} disabled={readOnly} onChange={(event) => patch("zip", event.target.value)} />
      </PayerField>
      <PayerField label={tx("Город", "Ort")} required>
        <Input className={inputClass} value={form.city} disabled={readOnly} onChange={(event) => patch("city", event.target.value)} />
      </PayerField>
      <PayerField label={organisation ? tx("Страна", "Land") : tx("Страна проживания", "Wohnsitzland")} required>
        <CountrySelect
          value={form.country}
          lang={lang}
          className={selectClass}
          disabled={readOnly}
          aria-label={organisation
            ? tx("Страна юридического адреса плательщика", "Sitzland des Kostenübernehmers")
            : tx("Страна проживания плательщика", "Wohnsitzland des Kostenübernehmers")}
          onChange={(value) => patch("country", value ?? "")}
        />
      </PayerField>
    </>
  );

  return (
    <div id={PAYER_SECTION_ID} tabIndex={-1} className="focus:outline-none">
      <Section
        className="rounded-xl border border-border/50 bg-card p-3.5"
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{tx("Кто платит", "Wer zahlt")}</span>
            <span className="inline-flex" data-testid="lead-payer-status-badge">
              <StatusBadge tone={statusBadge.tone}>{statusBadge.label}</StatusBadge>
            </span>
            {patientMarker && !dirty ? <PatientFieldBadge marker={patientMarker} tx={tx} /> : null}
          </span>
        )}
        accessory={canEdit && autosave.status !== "idle" ? (
          <StatusChip
            tone={autosave.status === "error" ? "warning" : autosave.status === "saved" ? "success" : "neutral"}
            role="status"
            data-testid="lead-payer-autosave-status"
            data-status={autosave.status}
          >
            {autosave.status === "saving" ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {autosave.status === "saving" ? tx("Сохраняется…", "Wird gespeichert…")
              : autosave.status === "saved" ? tx("Сохранено", "Gespeichert")
                : autosave.status === "error" ? tx("Не сохранено", "Nicht gespeichert")
                  : !form.kind ? tx("Выберите, кто платит", "Bitte wählen, wer zahlt")
                    : tx("Есть несохранённые изменения", "Ungespeicherte Änderungen")}
          </StatusChip>
        ) : undefined}
      >
        {loadError && !data && !(loadError instanceof ApiRequestError && loadError.status === 404)
          ? <Banner tone="error">{errorText(loadError)}</Banner>
          : null}
        {loading && !data ? (
          <p className="text-xs text-muted-foreground">{tx("Загружается…", "Wird geladen…")}</p>
        ) : null}
        {prefillActive && canEdit ? (
          <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800" data-testid="lead-payer-prefill-note">
            {tx(
              "Заполнено по декларации плательщика, зафиксированной при конвертации прошлого обращения. Проверьте данные: внесённые изменения сохраняются автоматически.",
              "Aus der Zahlererklärung übernommen, die bei der Umwandlung der letzten Anfrage festgehalten wurde. Bitte prüfen: Änderungen werden automatisch gespeichert.",
            )}
          </p>
        ) : null}

        <div role="radiogroup" aria-label={tx("Кто платит", "Wer zahlt")} className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-muted/40 p-1">
          {payerKindOptions(minor, form.kind, tx).map(([kind, label]) => (
            <label
              key={kind}
              className={cn(
                "flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                form.kind === kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                readOnly && "cursor-default",
              )}
            >
              <input
                type="radio"
                name={`lead-payer-kind-${leadId}`}
                className="size-3.5 shrink-0 accent-[var(--brand)]"
                value={kind}
                checked={form.kind === kind}
                disabled={readOnly}
                onChange={() => chooseKind(kind)}
              />
              {label}
            </label>
          ))}
        </div>
        {form.kind === "representative" ? (
          <div className="space-y-3" data-testid="lead-payer-representative">
            {representatives.length > 0 ? (
              <PayerField label={tx("Кто из родителей / представителей платит", "Welcher Elternteil / Vertreter zahlt")} className="max-w-md" required>
                <NativeComboboxSelect
                  value={form.representativeId}
                  className={selectClass}
                  disabled={readOnly}
                  aria-label={tx("Кто из родителей / представителей платит", "Welcher Elternteil / Vertreter zahlt")}
                  onChange={(event) => patch("representativeId", event.target.value)}
                >
                  <option value="">{tx("Выберите", "Auswählen")}</option>
                  {representatives.map((person) => (
                    <option key={person.id} value={person.id}>{person.name || "—"}</option>
                  ))}
                </NativeComboboxSelect>
              </PayerField>
            ) : (
              <Banner tone="warning">
                {tx(
                  "Сначала укажите родителей / законных представителей ребёнка в блоке представителей.",
                  "Bitte zuerst die Eltern / gesetzlichen Vertreter des Kindes im Vertreterblock erfassen.",
                )}
              </Banner>
            )}
            {chosenRepresentative ? (
              <PayerRepresentativeCard person={chosenRepresentative} lang={lang} tx={tx} />
            ) : null}
          </div>
        ) : null}
        {form.kind === "third_party" && data?.status.paying_parent ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800" data-testid="lead-payer-paying-parent">
            {tx(
              "Платит один из родителей — законный представитель ребёнка. Он подписывает заказ сам, отдельное согласие плательщика (Kostenübernahmeerklärung) не нужно.",
              "Es zahlt ein Elternteil als gesetzlicher Vertreter des Kindes. Er unterschreibt den Auftrag selbst; eine gesonderte Kostenübernahmeerklärung ist nicht nötig.",
            )}
          </p>
        ) : null}

        {/* Own interest and source of funds: shown in the wizard's enhanced AML block (owner 2026-10-19), one form and one autosave. */}
        {inAmlBlock(<div className="space-y-4" data-testid="lead-payer-aml-part">
        {/* Own economic interest: Да / Нет, nothing chosen while nobody answered it. */}
        <div
          role="radiogroup"
          aria-label={tx(
            "Пациент действует в собственных экономических интересах",
            "Der Patient handelt im eigenen wirtschaftlichen Interesse",
          )}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/60 py-2.5"
          data-testid="lead-payer-own-account"
        >
          <span className="min-w-0 text-[13px] leading-5 text-foreground">
            {tx(
              "Пациент действует в собственных экономических интересах",
              "Der Patient handelt im eigenen wirtschaftlichen Interesse",
            )}
          </span>
          {([
            [true, tx("Да", "Ja")],
            [false, tx("Нет", "Nein")],
          ] as const).map(([value, label]) => (
            <label key={String(value)} className="flex cursor-pointer items-center gap-1.5 text-[13px]">
              <input
                type="radio"
                name={`lead-payer-own-account-${leadId}`}
                className="size-3.5 shrink-0 accent-[var(--brand)]"
                checked={form.actsOnOwnAccount === value}
                disabled={readOnly}
                onChange={() => patch("actsOnOwnAccount", value)}
              />
              {label}
            </label>
          ))}
          {form.actsOnOwnAccount === null ? (
            <StatusChip tone="warning">{tx("Не отвечено", "Nicht beantwortet")}</StatusChip>
          ) : null}
        </div>
        {form.actsOnOwnAccount === false ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <PayerField label={tx("В чьих интересах (экономический бенефициар)", "Wirtschaftlich Berechtigter (GwG)")} required>
              <Input
                className={inputClass}
                value={form.beneficialOwnerName}
                disabled={readOnly}
                onChange={(event) => patch("beneficialOwnerName", event.target.value)}
              />
            </PayerField>
            <PayerField label={tx("Примечание", "Anmerkung")}>
              <textarea
                className={textareaClass}
                rows={2}
                value={form.beneficialOwnerNote}
                disabled={readOnly}
                onChange={(event) => patch("beneficialOwnerNote", event.target.value)}
              />
            </PayerField>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <PayerField
            label={thirdParty
              ? tx("Источник средств плательщика", "Herkunft der Mittel des Kostenübernehmers")
              : tx("Источник средств", "Herkunft der Mittel")}
            required={sourceRequired}
          >
            <NativeComboboxSelect
              value={form.sourceOfFunds}
              className={selectClass}
              disabled={readOnly}
              aria-label={tx("Источник средств", "Herkunft der Mittel")}
              onChange={(event) => patch("sourceOfFunds", event.target.value as SourceOfFunds | "")}
            >
              <option value="">{tx("Выберите", "Auswählen")}</option>
              {SOURCE_OF_FUNDS.map((value) => (
                <option key={value} value={value}>{sourceOfFundsLabel(value, tx)}</option>
              ))}
            </NativeComboboxSelect>
          </PayerField>
          <PayerField label={tx("Описание", "Beschreibung")} required={form.sourceOfFunds === "other"}>
            <Input
              className={inputClass}
              value={form.sourceOfFundsDescription}
              disabled={readOnly}
              onChange={(event) => patch("sourceOfFundsDescription", event.target.value)}
            />
          </PayerField>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusChip tone={form.sourceOfFundsDocumentId ? "success" : leadSelfFunds?.proofRequired ? "warning" : "neutral"}>
            <FileText aria-hidden="true" />
            {form.sourceOfFundsDocumentId
              ? `${tx("Подтверждение приложено", "Nachweis beigefügt")}${evidenceName ? `: ${evidenceName}` : ""}`
              : amlSlot
                // One proof upload: the check's own (owner 2026-10-19), printed on its document.
                ? tx("Подтверждение загружается в форме проверки («Заполнить проверку»)", "Der Nachweis wird im Prüfbogen hochgeladen („Prüfung ausfüllen“)")
                : staffProofLabel}
          </StatusChip>
          {canEdit && !amlSlot ? (
            <label className={cn("inline-flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted/40", readOnly && "pointer-events-none opacity-50")}>
              {busy === "upload" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {tx("Загрузить", "Hochladen")}
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,image/*"
                disabled={readOnly}
                onChange={(event) => {
                  void uploadEvidence(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
          ) : null}
          {form.sourceOfFundsDocumentId && canEdit && !amlSlot ? (
            <Button type="button" variant="ghost" size="xs" disabled={readOnly} onClick={() => { setEvidenceName(""); patch("sourceOfFundsDocumentId", ""); }}>
              {tx("Убрать", "Entfernen")}
            </Button>
          ) : null}
        </div>

        {leadSelfFunds && selfFundsShown ? (
          <div className="space-y-1.5 border-t border-border/60 pt-3 text-xs" data-testid="lead-payer-self-funds">
            <div className="flex flex-wrap items-center gap-2">
              <AdminSectionTitle>
                {tx("Источник средств — указал пациент в кабинете", "Herkunft der Mittel – Angaben des Patienten im Portal")}
              </AdminSectionTitle>
              {leadSelfFunds.updatedAt ? (
                <PatientFieldBadge marker={{ at: leadSelfFunds.updatedAt, access_kind: null }} tx={tx} />
              ) : null}
            </div>
            {leadSelfFunds.sources.length > 0 ? (
              <p data-testid="lead-payer-self-funds-sources">
                <span className="text-muted-foreground">{tx("Источники", "Quellen")}: </span>
                {statedFundsSourcesLabel(leadSelfFunds.sources, tx)}
              </p>
            ) : null}
            {leadSelfFunds.description ? (
              <p className="whitespace-pre-line" data-testid="lead-payer-self-funds-description">
                <span className="text-muted-foreground">{tx("Описание", "Beschreibung")}: </span>
                {leadSelfFunds.description}
              </p>
            ) : null}
            {leadSelfFunds.proofDocuments ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="lead-payer-self-funds-proof">
                <StatusChip tone={leadSelfFunds.proofDocuments.length > 0 ? "success" : leadSelfFunds.proofRequired ? "warning" : "neutral"}>
                  {tx("Подтверждение", "Nachweis")}
                  {" · "}
                  {leadSelfFunds.proofRequired
                    ? tx("обязательно (усиленная проверка)", "erforderlich (verstärkte Prüfung)")
                    : tx("необязательно", "optional")}
                  {leadSelfFunds.proofDocuments.length === 0 ? `: ${tx("не загружено", "nicht hochgeladen")}` : null}
                </StatusChip>
                {leadSelfFunds.proofDocuments.length > 0
                  ? <span className="text-foreground">{leadSelfFunds.proofDocuments
                    .map((document) => [
                      document.file_name || "—",
                      document.uploaded_at ? formatAppDate(document.uploaded_at) : "",
                      document.reviewed ? tx("просмотрен", "geprüft") : "",
                    ].filter(Boolean).join(" · "))
                    .join(", ")}</span>
                  : null}
              </div>
            ) : null}
          </div>
        ) : null}

        </div>)}
        {thirdParty ? (
          <div className="space-y-3 border-t border-border/60 pt-3">
            <AdminSectionTitle>
              {tx("Плательщик (третье лицо)", "Kostenübernehmer (Dritter)")}
            </AdminSectionTitle>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {typed ? (
                <PayerField label={tx("Тип плательщика", "Art des Zahlers")} required>
                  <NativeComboboxSelect
                    value={form.payerType}
                    className={selectClass}
                    disabled={readOnly}
                    aria-label={tx("Тип плательщика", "Art des Zahlers")}
                    onChange={(event) => {
                      const next = PAYER_TYPES.find((value) => value === event.target.value);
                      if (next) patch("payerType", next);
                    }}
                  >
                    {PAYER_TYPES.map((value) => (
                      <option key={value} value={value}>{payerTypeLabel(value, tx)}</option>
                    ))}
                  </NativeComboboxSelect>
                </PayerField>
              ) : null}
              {organisation ? (
                <PayerField label={tx("Название", "Name")} className="lg:col-span-2" required>
                  <Input className={inputClass} value={form.organisationName} maxLength={200} disabled={readOnly} autoComplete="off" onChange={(event) => patch("organisationName", event.target.value)} />
                </PayerField>
              ) : (
                <>
                  <PayerField label={tx("Имя", "Vorname")} required>
                    <Input className={inputClass} value={form.firstName} disabled={readOnly} autoComplete="off" onChange={(event) => patch("firstName", event.target.value)} />
                  </PayerField>
                  <PayerField label={tx("Фамилия", "Nachname")} required>
                    <Input className={inputClass} value={form.lastName} disabled={readOnly} autoComplete="off" onChange={(event) => patch("lastName", event.target.value)} />
                  </PayerField>
                  <PayerField label={tx("Дата рождения", "Geburtsdatum")} required>
                    <Input className={inputClass} type="date" max={appDateKey()} value={form.birthDate} disabled={readOnly} onChange={(event) => patch("birthDate", event.target.value)} />
                  </PayerField>
                  <PayerField label={tx("Место рождения", "Geburtsort")}>
                    <Input className={inputClass} value={form.placeOfBirth} disabled={readOnly} onChange={(event) => patch("placeOfBirth", event.target.value)} />
                  </PayerField>
                  {addressFields}
                  <PayerField label={tx("Гражданство", "Staatsangehörigkeit")} required>
                    <CitizenshipMultiSelect
                      value={form.citizenships}
                      placeholder={tx("Гражданство", "Staatsangehörigkeit")}
                      className={selectClass}
                      disabled={readOnly}
                      invalid={form.citizenships.length === 0 && dirty}
                      onChange={(next) => patch("citizenships", next)}
                    />
                  </PayerField>
                </>
              )}
              {typed ? (
                <PayerField label={tx("Кем приходится пациенту", "Beziehung zum Patienten")}>
                  <NativeComboboxSelect
                    value={form.relationshipKind}
                    className={selectClass}
                    disabled={readOnly}
                    aria-label={tx("Кем приходится пациенту", "Beziehung zum Patienten")}
                    onChange={(event) => patch(
                      "relationshipKind",
                      PAYER_RELATIONSHIP_KINDS.find((value) => value === event.target.value) ?? "",
                    )}
                  >
                    <option value="">{tx("Выберите", "Auswählen")}</option>
                    {PAYER_RELATIONSHIP_KINDS.map((value) => (
                      <option key={value} value={value}>{payerRelationshipKindLabel(value, tx)}</option>
                    ))}
                  </NativeComboboxSelect>
                </PayerField>
              ) : null}
              {relationshipTextShown ? (
                <PayerField
                  label={typed
                    ? tx("Кем приходится — уточнение", "Beziehung – nähere Angabe")
                    : tx("Кем приходится пациенту", "Beziehung zum Patienten")}
                >
                  <Input className={inputClass} value={form.relationship} disabled={readOnly} onChange={(event) => patch("relationship", event.target.value)} />
                </PayerField>
              ) : null}
              <PayerField label={tx("Электронная почта", "E-Mail")}>
                <Input className={inputClass} type="email" value={form.email} disabled={readOnly} aria-invalid={emailInvalid || undefined} onChange={(event) => patch("email", event.target.value)} />
                {emailInvalid ? (
                  <span role="alert" className="block text-xs text-destructive">
                    {tx("Электронная почта указана неверно, изменения не сохраняются. Пример: name@example.de.", "Die E-Mail-Adresse ist ungültig, Änderungen werden nicht gespeichert. Beispiel: name@example.de.")}
                  </span>
                ) : null}
                <EmailDomainWarning email={form.email} lang={lang} enabled={form.kind === "third_party" && !emailInvalid} />
              </PayerField>
              <PayerField label={tx("Телефон", "Telefon")}>
                <Input className={inputClass} type="tel" value={form.phone} disabled={readOnly} onChange={(event) => patch("phone", event.target.value)} />
              </PayerField>
              {form.messengerSupport !== "unsupported" ? (
                canEdit ? (
                  <PayerField label={tx("WhatsApp / мессенджер", "WhatsApp / Messenger")}>
                    <Input
                      className={inputClass}
                      type="tel"
                      name="payer_messenger"
                      maxLength={60}
                      value={form.messenger}
                      disabled={readOnly}
                      onChange={(event) => patch("messenger", event.target.value)}
                    />
                  </PayerField>
                ) : (
                  <p className="min-w-0 self-end text-xs" data-testid="lead-payer-messenger">
                    <span className="text-muted-foreground">{tx("WhatsApp / мессенджер", "WhatsApp / Messenger")}: </span>
                    {form.messenger.trim() || "—"}
                  </p>
                )
              ) : null}
              {organisation ? (
                <fieldset className="col-span-full min-w-0 space-y-3">
                  <legend className="text-xs font-semibold text-foreground">
                    {tx("Юридический адрес", "Sitz")}
                  </legend>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{addressFields}</div>
                </fieldset>
              ) : null}
            </div>
            {organisation && organisationMask ? (
              <div className="space-y-2.5 border-t border-border/50 pt-3" data-testid="lead-payer-organisation-cabinet">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-foreground">
                    {tx("Данные организации из кабинета", "Organisationsangaben aus dem Portal")}
                  </span>
                  {cabinet?.patient_payer ? <PatientFieldBadge marker={cabinet.patient_payer} tx={tx} /> : null}
                </div>
                <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {payerOrganisationStatements(organisationMask, tx).map((row) => (
                    <PayerReadOnlyStatement key={row.key} label={row.label} value={row.value} testId={`lead-payer-organisation-${row.key}`} />
                  ))}
                </dl>
              </div>
            ) : null}
            <div className="border-t border-border/70">
              <PayerCheckbox
                checked={form.payerInformed}
                disabled={readOnly}
                onChange={(checked) => patch("payerInformed", checked)}
                label={(
                  <>
                    {tx("Плательщик проинформирован об обработке его данных", "Der Kostenübernehmer wurde über die Verarbeitung seiner Daten informiert")}
                    {informedAt && form.payerInformed ? (
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{formatAppDateTime(informedAt)}</span>
                    ) : null}
                  </>
                )}
              />
            </div>
            {typed && data?.status.contact_consent_required === false ? (
              // A parent with an own cabinet login pays: nobody else is told the contact.
              <StatusChip tone="neutral" data-testid="lead-payer-contact-consent" data-required="false">
                {tx(
                  "Согласие на передачу контактов: не требуется (платит родитель)",
                  "Einwilligung zur Kontaktweitergabe: nicht nötig (Elternteil zahlt)",
                )}
              </StatusChip>
            ) : typed ? (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] leading-5 text-muted-foreground" data-testid="lead-payer-contact-consent">
                {tx(
                  "Согласие пациента на передачу контактов плательщику:",
                  "Einverständnis zur Weitergabe der Kontaktdaten an den Zahler:",
                )}
                {" "}
                {contactConsentAt ? (
                  <StatusChip tone="success">
                    {tx("дано", "erteilt")}
                    <span className="font-mono">{formatAppDateTime(contactConsentAt)}</span>
                  </StatusChip>
                ) : (
                  <StatusChip tone="warning">
                    {tx("ещё не дано", "noch nicht erteilt")}
                  </StatusChip>
                )}
              </p>
            ) : null}
            {typed && costEstimateConsent ? (
              <p
                className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11.5px] leading-5 text-muted-foreground"
                data-testid="lead-payer-cost-estimate-consent"
                data-state={costEstimateConsent.state}
              >
                {costEstimateConsent.prefix}
                <StatusChip
                  tone={costEstimateConsent.state === "given" ? "success" : costEstimateConsent.state === "missing" ? "warning" : "neutral"}
                  className={costEstimateConsent.state === "given" ? "font-mono" : undefined}
                >
                  {costEstimateConsent.value}
                </StatusChip>
              </p>
            ) : null}
            {payerLink?.data ? (
              <LeadPayerLinkPanel
                leadId={leadId}
                state={payerLink.data}
                controller={payerLink}
                canEdit={payerLinkCanEdit ?? canEdit}
                disabled={disabled}
                leadLanguage={leadLanguage}
                tx={tx}
                errorText={errorText}
                onSent={onPayerLinkSent}
                packageSummary={data?.status.payer_package}
              />
            ) : payerLink?.error ? (
              <p className="text-xs text-rose-700" data-testid="lead-payer-link-error">
                {tx("Не удалось загрузить ссылку плательщика: ", "Zahler-Link konnte nicht geladen werden: ")}
                {errorText(payerLink.error)}
              </p>
            ) : null}
          </div>
        ) : null}

        {recipientStatements.length > 0 || invoiceTaxShown ? (
          <div className="space-y-3 border-t border-border/60 pt-3" data-testid="lead-payer-invoice-recipient">
            <AdminSectionTitle>
              {tx("Получатель счёта (раздел 7 анкеты)", "Rechnungsempfänger (Abschnitt 7)")}
            </AdminSectionTitle>
            {cabinetBilling?.recipient_updated_at ? (
              <span className="inline-flex" data-testid="lead-payer-recipient-updated">
                <PatientFieldBadge marker={{ at: cabinetBilling.recipient_updated_at, access_kind: null }} tx={tx} />
              </span>
            ) : null}
            {recipientStatements.length > 0 ? (
              <dl className="grid gap-x-5 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3" data-testid="lead-payer-recipient-snapshot">
                {recipientStatements.map((row) => (
                  <PayerReadOnlyStatement key={row.key} label={row.label} value={row.value} testId={`lead-payer-recipient-${row.key}`} />
                ))}
              </dl>
            ) : null}
            {invoiceTaxShown ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <PayerField label={tx("USt-IdNr. получателя счёта", "USt-IdNr. des Rechnungsempfängers")}>
                  <Input
                    className={inputClass}
                    value={form.invoiceVatId}
                    maxLength={20}
                    disabled={readOnly}
                    autoComplete="off"
                    onChange={(event) => patch("invoiceVatId", event.target.value)}
                  />
                </PayerField>
                <PayerField label={tx("Steuernummer получателя счёта", "Steuernummer des Rechnungsempfängers")}>
                  <Input
                    className={inputClass}
                    value={form.invoiceTaxNumber}
                    maxLength={30}
                    disabled={readOnly}
                    autoComplete="off"
                    onChange={(event) => patch("invoiceTaxNumber", event.target.value)}
                  />
                </PayerField>
              </div>
            ) : null}
          </div>
        ) : null}

        {missing.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {missing.map((code) => (
              <li key={code}>
                <StatusChip tone="warning">
                  <CircleAlert aria-hidden="true" />
                  {payerReasonLabel(code, tx, thirdParty ? form.payerType : null)}
                </StatusChip>
              </li>
            ))}
          </ul>
        ) : null}
        {message ? (
          message.tone === "error"
            ? <Banner tone="error">{message.text}</Banner>
            : <p role="status" className="text-xs text-emerald-700">{message.text}</p>
        ) : null}
        {autosave.status === "error" ? (
          <div className="space-y-2" data-testid="lead-payer-autosave-error">
            <Banner tone="error">{errorText(autosave.error)}</Banner>
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg text-xs" disabled={readOnly} onClick={() => autosaveRef.current?.retry()}>
              {tx("Повторить сохранение", "Speichern erneut versuchen")}
            </Button>
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function SequenceStep({ state, actor, tx }: { state: SignatureStepState; actor: "client" | "payer" | "agency"; tx: Tx }) {
  const label = actor === "client"
    ? state === "done" ? tx("Клиент подписал заказ", "Kunde hat den Auftrag unterzeichnet") : tx("Ожидается подпись клиента", "Unterschrift des Kunden ausstehend")
    : actor === "payer"
      ? state === "not_required" ? tx("Согласие плательщика не требуется", "Kostenübernahmeerklärung nicht erforderlich")
        : state === "done" ? tx("Плательщик подписал согласие", "Kostenübernehmer hat unterschrieben") : tx("Ожидается согласие плательщика", "Unterschrift des Kostenübernehmers ausstehend")
      : state === "done" ? tx("GMED подписал заказ", "GMED hat den Auftrag unterzeichnet")
        : state === "blocked" ? tx("GMED: подпись пока недоступна", "GMED: Unterschrift noch gesperrt") : tx("GMED: можно подписывать", "GMED: Unterschrift möglich");
  return <StatusChip data-signature-step={actor} data-step-state={state} tone={state === "done" ? "success" : state === "not_required" ? "neutral" : "warning"}>
    {state === "done" ? <Check aria-hidden="true" className="size-3.5" /> : null}{label}
  </StatusChip>;
}

/** The payer's signature package in the signing order (contract phase 3b). */
export type LeadPayerSignatureFlowPackage = {
  /** The package panel is shown here (the commercial step); elsewhere the package only hides the standalone button. */
  panel: boolean;
  /** leads.edit: prepare and send are offered (the server checks the role as well). */
  canEdit: boolean;
  /** Opens a document of the package (the wizard's preview). */
  onOpenDocument?: (documentId: string, title: string) => void;
  /** The package changed (prepared, sent, signed): the declaration and the documents are read afresh. */
  onChanged?: () => void;
};

/**
 * The actual legal document states in the commercial signing order, the payer's
 * Kostenübernahmeerklärung and why GMED may not sign yet. The server enforces
 * the same order (409 `payer_gate_blocked`).
 *
 * With `payerPackage` the payer's signature package of four documents is
 * loaded (phase 3b): once the payer has sent a statement the package replaces
 * the standalone "Kostenübernahmeerklärung erstellen", which stays for a
 * payer that staff filled in.
 */
export function LeadPayerSignatureFlow({
  leadId,
  status,
  documents,
  disabled,
  canGenerate,
  tx,
  renderDocuments,
  onChanged,
  errorText,
  payerPackage,
  signatureDocumentId,
  demoChecks = [],
}: {
  leadId: string;
  status: PayerDeclarationStatus | null;
  documents: DocumentItem[];
  disabled: boolean;
  canGenerate: boolean;
  tx: Tx;
  renderDocuments: (documents: DocumentItem[]) => ReactNode;
  onChanged: () => void;
  errorText: (error: unknown) => string;
  payerPackage?: LeadPayerSignatureFlowPackage | null;
  signatureDocumentId?: string;
  demoChecks?: readonly string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const packageController = useLeadPayerPackage(leadId, Boolean(payerPackage), payerPackage?.onChanged);
  const packageState = packageController.data;
  const packagePanelShown = Boolean(payerPackage?.panel && packageState?.mode);
  const sequence = payerSignatureSequence(status);
  const { user } = useAuth();
  const summary = useSignatureSummary(user && ["ceo", "patient_manager"].includes(user.role) ? user.id : undefined, signatureDocumentId);
  const operationalProgress = summary?.document_id === signatureDocumentId && summary?.status === "pending" && summary.progress?.total ? summary.progress : null;
  const completedDemo = summary?.document_id === signatureDocumentId && summary?.status === "completed" && summary.test_mode;
  const signatureEvidenceShown = Boolean(operationalProgress || completedDemo);
  const demoAccepted = completedDemo && demoChecks.length > 0;
  const agencyBlocking = status?.agency_blocking.filter((code) =>
    !(demoAccepted && ((code === "client_order_signature_missing" && demoChecks.includes("order_signed_patient"))
      || (code === "cost_assumption_unsigned" && demoChecks.includes("cost_assumption_signed"))))) ?? [];
  const required = Boolean(status?.cost_assumption.required);
  const orderId = status?.order_id ?? null;
  const standaloneKept = standaloneCostAssumptionKept(packageState);

  async function generate() {
    if (!orderId) return;
    setBusy(true);
    setError("");
    try {
      await generateDocument({
        template_id: "cost_coverage_declaration",
        lead_id: leadId,
        order_id: orderId,
        replace_document_id: sortWizardDocumentsNewestFirst(documents)
          .find((document) => document.is_latest_version)?.id,
        language: "de",
        document_language: "de",
        document_direction: "outgoing",
        document_variant: "original",
        access_category: "financial",
        status: "active",
      });
      onChanged();
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      className="rounded-xl border border-border/50 bg-card p-3.5"
      title={tx("Порядок подписания", "Reihenfolge der Unterschriften")}
      accessory={required && canGenerate && standaloneKept ? (
        <Button
          type="button"
          size="sm"
          className="h-8 rounded-lg"
          disabled={disabled || busy || !orderId}
          title={orderId ? undefined : tx("Сначала создайте заказ", "Zuerst den Auftrag erstellen")}
          onClick={() => void generate()}
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
          {documents.length > 0
            ? tx("Новая версия согласия плательщика", "Neue Kostenübernahmeerklärung")
            : tx("Создать согласие плательщика", "Kostenübernahmeerklärung erstellen")}
        </Button>
      ) : undefined}
    >
      {signatureEvidenceShown && summary ? <div className="space-y-2">
        {completedDemo
          ? <StatusChip tone="success">{tx("DEMO · Тестовый пакет подписан", "DEMO · Testpaket unterzeichnet")}</StatusChip>
          : operationalProgress ? <SignatureProgressChips progress={operationalProgress} testMode={summary.test_mode} lang={tx("ru", "de")} /> : null}
        <StatusChip tone="neutral">{demoAccepted
          ? tx("DEV · Тестовые подписи зачтены для оформления. Выполните остальные проверки готовности.", "DEV · Testunterschriften für die Aufnahme angerechnet. Die übrigen Bereitschaftsprüfungen abschließen.")
          : completedDemo
          ? tx("Для создания пациента нужны юридически действительные подписи. DEMO не подтверждает договор, заказ и согласия.", "Für die Patientenanlage sind rechtswirksame Unterschriften erforderlich. DEMO bestätigt Vertrag, Auftrag und Einwilligungen nicht.")
          : summary.test_mode
            ? tx("DEMO не подтверждает юридическую подпись заказа", "DEMO bestätigt keine rechtswirksame Auftragsunterschrift")
            : tx("Заказ: подписание пакета ещё не завершено", "Auftrag: Paketunterzeichnung noch nicht abgeschlossen")}</StatusChip>
      </div> : <div className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label={tx("Порядок подписания", "Reihenfolge der Unterschriften")}>
        <SequenceStep state={sequence.client} actor="client" tx={tx} />
        <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <SequenceStep state={sequence.payer} actor="payer" tx={tx} />
        <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <SequenceStep
          state={sequence.agency}
          actor="agency"
          tx={tx}
        />
      </div>}
      {required ? (
        documents.length > 0
          ? renderDocuments(documents)
          : <p className="text-xs text-muted-foreground">{tx("Согласие плательщика ещё не создано", "Kostenübernahmeerklärung wurde noch nicht erstellt")}</p>
      ) : null}
      {packagePanelShown && packageState ? (
        <LeadPayerPackagePanel
          leadId={leadId}
          state={packageState}
          controller={packageController}
          canEdit={Boolean(payerPackage?.canEdit)}
          disabled={disabled}
          tx={tx}
          errorText={errorText}
          onOpenDocument={payerPackage?.onOpenDocument}
          renderDetails={(documentId, title) => (
            <DocumentSignatureAction
              documentId={documentId}
              title={title}
              disabled={disabled}
              signed={Boolean(packageState.package?.documents.find((item) => item.document_id === documentId)?.signed_at)}
              onDone={() => {
                void packageController.reload();
              }}
            />
          )}
        />
      ) : payerPackage?.panel && packageController.error ? (
        <p className="text-xs text-rose-700" data-testid="lead-payer-package-error">
          {tx("Не удалось загрузить пакет на подпись: ", "Unterschriftenpaket konnte nicht geladen werden: ")}
          {errorText(packageController.error)}
        </p>
      ) : null}
      {status && !status.agency_signed_order && agencyBlocking.length > 0 ? (
        <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2">
          <CircleAlert aria-hidden="true" className="mt-0.5" />
          <span className="min-w-0">
            <span className="block font-semibold">{signatureEvidenceShown
              ? tx("Для юридического подтверждения заказа:", "Für die rechtswirksame Bestätigung des Auftrags:")
              : tx("GMED сможет подписать, когда:", "GMED kann unterschreiben, sobald:")}</span>
            <span role="list" className="mt-1 block space-y-0.5">
              {agencyBlocking.map((code) => (
                <span role="listitem" key={code} className="flex items-start gap-1.5">
                  <span aria-hidden="true">·</span>
                  <span>{signatureEvidenceShown && code === "client_order_signature_missing"
                    ? summary?.test_mode
                      ? tx("Нужна юридически действительная подпись заказа", "Eine rechtswirksame Auftragsunterschrift ist erforderlich")
                      : tx("Завершите подписание пакета в Skribble", "Paketunterzeichnung in Skribble abschließen")
                    : operationalProgress && code === "cost_assumption_unsigned"
                      ? tx("Юридический статус согласия плательщика ещё не подтверждён", "Die rechtswirksame Kostenübernahmeerklärung ist noch nicht bestätigt")
                      : payerReasonLabel(code, tx)}</span>
                </span>
              ))}
            </span>
          </span>
        </StatusChip>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Section>
  );
}
