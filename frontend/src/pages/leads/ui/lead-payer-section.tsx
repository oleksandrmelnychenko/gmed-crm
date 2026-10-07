import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Circle,
  FileText,
  LoaderCircle,
  Save,
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
import { CitizenshipMultiSelect } from "@/components/ui/citizenship-multi-select";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { ApiRequestError } from "@/lib/api";
import { appDateKey, formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { generateDocument, uploadDocument } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import type { LeadPortalEnhancedDetails, PatientFieldMarker } from "../data/lead-portal-intake-api";
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
  costEstimateConsentLine,
  invoiceTaxFieldsShown,
  invoiceToLabel,
  isOrganisationPayerForm,
  payerDeclarationToForm,
  payerFormMissing,
  payerReasonLabel,
  payerRelationshipKindLabel,
  payerRelationshipTextShown,
  payerSignatureSequence,
  payerStatusBadge,
  payerTypeLabel,
  statedFundsSourcesLabel,
  sourceOfFundsLabel,
  type PayerDeclarationForm,
  type PayerDeclarationResponse,
  type PayerDeclarationStatus,
  type SignatureStepState,
  type SourceOfFunds,
  type Tx,
} from "../model/lead-payer";

const MAX_EVIDENCE_FILE_SIZE = 25 * 1024 * 1024;

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
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={cn(checkboxClass, "mt-0.5")}
      />
      <span className="text-sm text-foreground">{label}</span>
    </label>
  );
}

/**
 * "Кто платит" in the compliance step: who pays, own economic interest or a
 * beneficial owner, the source of funds and the third-party payer's data. The
 * form is saved explicitly; the server records the declaration with an audit
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
  errorText,
  patientMarker,
  payerLink,
  payerLinkCanEdit,
  leadLanguage,
  onPayerLinkSent,
  enhancedDetails,
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
}) {
  // The stored declaration is the first form state as well, so a render
  // without effects (static markup) already shows it.
  const [form, setForm] = useState<PayerDeclarationForm>(() => payerDeclarationToForm(data?.declaration));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "upload" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [evidenceName, setEvidenceName] = useState("");
  const loadedFor = useRef<string | null>(null);

  // Take the stored declaration unless the user is editing it. Sending the
  // payer link marks the payer as informed without another change.
  useEffect(() => {
    const key = `${leadId}:${data?.declaration?.updated_at ?? "none"}:${data?.declaration?.payer_informed_at ?? ""}`;
    if (dirty && loadedFor.current?.startsWith(`${leadId}:`)) return;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    setForm(payerDeclarationToForm(data?.declaration));
  }, [data, dirty, leadId]);

  const patch = <K extends keyof PayerDeclarationForm>(key: K, value: PayerDeclarationForm[K]) => {
    setDirty(true);
    setMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const readOnly = disabled || !canEdit || busy !== null;
  const thirdParty = form.kind === "third_party";
  // An older server knows neither the payer type nor the relationship kind
  // nor the lead's contact consent: the form then stays the one for a person.
  const typed = form.payerTypeSupport !== "unsupported";
  const organisation = isOrganisationPayerForm(form);
  const relationshipTextShown = payerRelationshipTextShown(form, data?.declaration);
  const missing = payerFormMissing(form);
  const statusBadge = payerStatusBadge(data?.status, tx);
  const informedAt = data?.declaration?.payer_informed_at ?? null;
  const contactConsentAt = data?.declaration?.contact_consent_at ?? null;
  // Phase 3b: the lead's consent to pass the cost estimate on; an older server has none.
  const costEstimateConsent = costEstimateConsentLine(data, tx);
  // Section 7: the lead chose where the invoice goes; an older server does
  // not send the key, and a lead who has not answered yet has it null.
  const invoiceTo = data?.declaration?.invoice_to;
  const invoiceToKnown = invoiceTo !== undefined;
  const invoiceTaxShown = invoiceTaxFieldsShown(form);
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
  // A source the lead stated is the declaration's: staff need not choose one.
  const sourceRequired = !(form.kind === "self" && form.leadSelfFundsStated);

  async function save() {
    if (!form.kind) {
      setMessage({ tone: "error", text: payerReasonLabel("payer_declaration_missing", tx) });
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      await onSave(form);
      setDirty(false);
      loadedFor.current = null;
      setMessage({
        tone: "success",
        text: tx("Данные о плательщике сохранены", "Angaben zum Zahler gespeichert"),
      });
      // Another payer or e-mail revokes the link; a third party may make it sendable.
      void payerLink?.reload();
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(null);
    }
  }

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
    try {
      const body = new FormData();
      body.set("lead_id", leadId);
      body.set("file", file);
      body.set("auto_name", "Nachweis Herkunft der Mittel");
      body.set("art", "source_of_funds_evidence");
      body.set("category", "finance_source_of_funds");
      body.set("access_category", "financial");
      const uploaded = await uploadDocument(body);
      setEvidenceName(file.name);
      patch("sourceOfFundsDocumentId", uploaded.id);
    } catch (error) {
      setMessage({ tone: "error", text: errorText(error) });
    } finally {
      setBusy(null);
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
        className="rounded-xl border border-border/70 bg-card p-4"
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{tx("Кто платит", "Wer zahlt")}</span>
            <span className="inline-flex" data-testid="lead-payer-status-badge">
              <StatusBadge tone={statusBadge.tone}>{statusBadge.label}</StatusBadge>
            </span>
            {patientMarker && !dirty ? <PatientFieldBadge marker={patientMarker} tx={tx} /> : null}
          </span>
        )}
        accessory={canEdit ? (
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-lg"
            disabled={readOnly || (!dirty && Boolean(data?.declaration))}
            onClick={() => void save()}
          >
            {busy === "save" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {tx("Сохранить", "Speichern")}
          </Button>
        ) : undefined}
      >
        {loadError && !data && !(loadError instanceof ApiRequestError && loadError.status === 404)
          ? <Banner tone="error">{errorText(loadError)}</Banner>
          : null}
        {loading && !data ? (
          <p className="text-xs text-muted-foreground">{tx("Загружается…", "Wird geladen…")}</p>
        ) : null}

        <div role="radiogroup" aria-label={tx("Кто платит", "Wer zahlt")} className="flex flex-wrap gap-2">
          {([
            ["self", tx("Пациент платит сам", "Patient zahlt selbst")],
            ["third_party", tx("Платит третье лицо", "Ein Dritter zahlt")],
          ] as const).map(([kind, label]) => (
            <label
              key={kind}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                form.kind === kind ? "border-[var(--brand)] bg-muted/40" : "border-border",
              )}
            >
              <input
                type="radio"
                name={`lead-payer-kind-${leadId}`}
                value={kind}
                checked={form.kind === kind}
                disabled={readOnly}
                onChange={() => patch("kind", kind)}
              />
              {label}
            </label>
          ))}
        </div>

        <div className="border-y border-border/70">
          <PayerCheckbox
            checked={form.actsOnOwnAccount}
            disabled={readOnly}
            onChange={(checked) => patch("actsOnOwnAccount", checked)}
            label={tx(
              "Пациент действует в собственных экономических интересах",
              "Der Patient handelt im eigenen wirtschaftlichen Interesse",
            )}
          />
        </div>
        {!form.actsOnOwnAccount ? (
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
          <FileText aria-hidden="true" className="size-3.5" />
          <span>
            {form.sourceOfFundsDocumentId
              ? `${tx("Подтверждение приложено", "Nachweis beigefügt")}${evidenceName ? `: ${evidenceName}` : ""}`
              : tx("Подтверждение источника средств (необязательно)", "Nachweis der Herkunft der Mittel (optional)")}
          </span>
          {canEdit ? (
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
          {form.sourceOfFundsDocumentId && canEdit ? (
            <Button type="button" variant="ghost" size="xs" disabled={readOnly} onClick={() => { setEvidenceName(""); patch("sourceOfFundsDocumentId", ""); }}>
              {tx("Убрать", "Entfernen")}
            </Button>
          ) : null}
        </div>

        {leadSelfFunds ? (
          <div className="space-y-1.5 rounded-lg border border-border/70 bg-muted/10 p-3 text-xs" data-testid="lead-payer-self-funds">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-foreground">
                {tx("Источник средств — указал пациент в кабинете", "Herkunft der Mittel – Angaben des Patienten im Portal")}
              </span>
              {leadSelfFunds.updatedAt ? (
                <PatientFieldBadge marker={{ at: leadSelfFunds.updatedAt, access_kind: null }} tx={tx} />
              ) : null}
            </div>
            <p data-testid="lead-payer-self-funds-sources">
              <span className="text-muted-foreground">{tx("Источники", "Quellen")}: </span>
              {leadSelfFunds.sources.length > 0
                ? statedFundsSourcesLabel(leadSelfFunds.sources, tx)
                : tx("ещё не указаны", "noch nicht angegeben")}
            </p>
            {leadSelfFunds.description ? (
              <p className="whitespace-pre-line" data-testid="lead-payer-self-funds-description">
                <span className="text-muted-foreground">{tx("Описание", "Beschreibung")}: </span>
                {leadSelfFunds.description}
              </p>
            ) : null}
            {leadSelfFunds.proofDocuments ? (
              <div data-testid="lead-payer-self-funds-proof">
                <span className="text-muted-foreground">
                  {tx("Подтверждение", "Nachweis")}
                  {" · "}
                  {leadSelfFunds.proofRequired
                    ? tx("обязательно (усиленная проверка)", "erforderlich (verstärkte Prüfung)")
                    : tx("необязательно", "optional")}
                  {": "}
                </span>
                {leadSelfFunds.proofDocuments.length > 0
                  ? leadSelfFunds.proofDocuments
                    .map((document) => [
                      document.file_name || "—",
                      document.uploaded_at ? formatAppDate(document.uploaded_at) : "",
                      document.reviewed ? tx("просмотрен", "geprüft") : "",
                    ].filter(Boolean).join(" · "))
                    .join(", ")
                  : tx("не загружено", "nicht hochgeladen")}
              </div>
            ) : null}
          </div>
        ) : null}

        {thirdParty ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
            <div className="text-xs font-semibold text-foreground">
              {tx("Плательщик (третье лицо)", "Kostenübernehmer (Dritter)")}
            </div>
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
                <Input className={inputClass} type="email" value={form.email} disabled={readOnly} onChange={(event) => patch("email", event.target.value)} />
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
              <p className="text-xs text-muted-foreground" data-testid="lead-payer-contact-consent" data-required="false">
                {tx(
                  "Согласие на передачу контактов: не требуется (платит родитель)",
                  "Einwilligung zur Kontaktweitergabe: nicht nötig (Elternteil zahlt)",
                )}
              </p>
            ) : typed ? (
              <p className="text-xs text-muted-foreground" data-testid="lead-payer-contact-consent">
                {tx(
                  "Согласие пациента на передачу контактов плательщику:",
                  "Einverständnis zur Weitergabe der Kontaktdaten an den Zahler:",
                )}
                {" "}
                {contactConsentAt ? (
                  <span className="font-mono text-foreground">{formatAppDateTime(contactConsentAt)}</span>
                ) : (
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {tx("ещё не дано", "noch nicht erteilt")}
                  </span>
                )}
              </p>
            ) : null}
            {typed && costEstimateConsent ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="lead-payer-cost-estimate-consent"
                data-state={costEstimateConsent.state}
              >
                {costEstimateConsent.prefix}
                <span
                  className={cn(
                    costEstimateConsent.state === "given" && "font-mono text-foreground",
                    costEstimateConsent.state === "missing" && "font-medium text-amber-700 dark:text-amber-300",
                  )}
                >
                  {costEstimateConsent.value}
                </span>
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
            <p className="text-xs text-muted-foreground">
              {tx(
                "Плательщик подписывает согласие на оплату (Kostenübernahmeerklärung, присоединение к долгу). Документ создаётся на шаге «Договор и смета», когда заказ уже есть.",
                "Der Kostenübernehmer unterschreibt die Kostenübernahmeerklärung (Schuldbeitritt). Sie wird im Schritt „Vertrag & Angebot“ erstellt, sobald der Auftrag besteht.",
              )}
            </p>
          </div>
        ) : null}

        {invoiceToKnown || invoiceTaxShown ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3" data-testid="lead-payer-invoice-recipient">
            <div className="text-xs font-semibold text-foreground">
              {tx("Получатель счёта (раздел 7 анкеты)", "Rechnungsempfänger (Abschnitt 7)")}
            </div>
            {invoiceToKnown ? (
              <p className="text-xs text-muted-foreground" data-testid="lead-payer-invoice-to">
                {tx("Счёт направляется: ", "Rechnung geht an: ")}
                <span className="font-medium text-foreground">{invoiceToLabel(invoiceTo, tx)}</span>
                {invoiceTo === "other" && data?.declaration?.invoice_name ? (
                  <span className="font-medium text-foreground">{` — ${data.declaration.invoice_name}`}</span>
                ) : null}
                {" · "}
                {invoiceTo
                  ? tx("выбрал пациент в кабинете", "vom Patienten im Portal gewählt")
                  : tx("выбирает пациент в кабинете", "wählt der Patient im Portal")}
              </p>
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
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
            {missing.map((code) => (
              <li key={code} className="flex items-start gap-1.5">
                <Circle aria-hidden="true" className="mt-1 size-2 shrink-0" />
                {payerReasonLabel(code, tx, thirdParty ? form.payerType : null)}
              </li>
            ))}
          </ul>
        ) : null}
        {message ? (
          message.tone === "error"
            ? <Banner tone="error">{message.text}</Banner>
            : <p role="status" className="text-xs text-emerald-700">{message.text}</p>
        ) : null}
      </Section>
    </div>
  );
}

function SequenceStep({ state, label, tx }: { state: SignatureStepState; label: string; tx: Tx }) {
  if (state === "not_required") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Check aria-hidden="true" className="size-3.5" />
        {label} · {tx("не требуется", "entfällt")}
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", state === "done" ? "text-emerald-700" : "text-muted-foreground")}>
      {state === "done"
        ? <Check aria-hidden="true" className="size-3.5" />
        : <span aria-hidden="true" className="size-3.5 rounded-full border border-current" />}
      {label}
    </span>
  );
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
 * The signing order in the commercial step: "Клиент подписал ✓ → Плательщик
 * подписал согласие ✓ → GMED подписывает", the payer's
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
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const packageController = useLeadPayerPackage(leadId, Boolean(payerPackage), payerPackage?.onChanged);
  const packageState = packageController.data;
  const packagePanelShown = Boolean(payerPackage?.panel && packageState?.mode);
  const sequence = payerSignatureSequence(status);
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
      className="rounded-xl border border-border/70 bg-card p-4"
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
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label={tx("Порядок подписания", "Reihenfolge der Unterschriften")}>
        <SequenceStep state={sequence.client} label={tx("Клиент подписал", "Kunde hat unterschrieben")} tx={tx} />
        <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <SequenceStep state={sequence.payer} label={tx("Плательщик подписал согласие", "Kostenübernehmer hat unterschrieben")} tx={tx} />
        <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <SequenceStep
          state={sequence.agency}
          label={sequence.agency === "done" ? tx("GMED подписал", "GMED hat unterschrieben") : tx("GMED подписывает", "GMED unterschreibt")}
          tx={tx}
        />
      </div>
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
      {status && !status.agency_signed_order && status.agency_blocking.length > 0 ? (
        <Banner tone="warning">
          <span className="font-medium">{tx("GMED сможет подписать, когда:", "GMED kann unterschreiben, sobald:")}</span>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {status.agency_blocking.map((code) => <li key={code}>{payerReasonLabel(code, tx)}</li>)}
          </ul>
        </Banner>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
    </Section>
  );
}
