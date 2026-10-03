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
import { appDateKey, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { generateDocument, uploadDocument } from "@/pages/documents/data/document-api";
import type { DocumentItem } from "@/pages/documents/model/types";
import { sortWizardDocumentsNewestFirst } from "./lead-wizard-document-metadata";

import {
  EMPTY_PAYER_DECLARATION_FORM,
  PAYER_SECTION_ID,
  SOURCE_OF_FUNDS,
  payerDeclarationToForm,
  payerFormMissing,
  payerReasonLabel,
  payerSignatureSequence,
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
}) {
  const [form, setForm] = useState<PayerDeclarationForm>(EMPTY_PAYER_DECLARATION_FORM);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "upload" | null>(null);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [evidenceName, setEvidenceName] = useState("");
  const loadedFor = useRef<string | null>(null);

  // Take the stored declaration unless the user is editing it.
  useEffect(() => {
    const key = `${leadId}:${data?.declaration?.updated_at ?? "none"}`;
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
  const missing = payerFormMissing(form);
  const informedAt = data?.declaration?.payer_informed_at ?? null;

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

  return (
    <div id={PAYER_SECTION_ID} tabIndex={-1} className="focus:outline-none">
      <Section
        className="rounded-xl border border-border/70 bg-card p-4"
        title={(
          <span className="inline-flex flex-wrap items-center gap-2">
            <span>{tx("Кто платит", "Wer zahlt")}</span>
            <StatusBadge tone={data?.status.complete ? "success" : "warning"}>
              {data?.status.complete ? tx("Заполнено", "Vollständig") : tx("Не заполнено", "Unvollständig")}
            </StatusBadge>
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
            required
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

        {thirdParty ? (
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/10 p-3">
            <div className="text-xs font-semibold text-foreground">
              {tx("Плательщик (третье лицо)", "Kostenübernehmer (Dritter)")}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
              <PayerField label={tx("Улица и дом", "Straße und Hausnummer")} required>
                <Input className={inputClass} value={form.street} disabled={readOnly} onChange={(event) => patch("street", event.target.value)} />
              </PayerField>
              <PayerField label={tx("Почтовый индекс", "Postleitzahl")} required>
                <Input className={inputClass} value={form.zip} disabled={readOnly} onChange={(event) => patch("zip", event.target.value)} />
              </PayerField>
              <PayerField label={tx("Город", "Ort")} required>
                <Input className={inputClass} value={form.city} disabled={readOnly} onChange={(event) => patch("city", event.target.value)} />
              </PayerField>
              <PayerField label={tx("Страна проживания", "Wohnsitzland")} required>
                <CountrySelect
                  value={form.country}
                  lang={lang}
                  className={selectClass}
                  disabled={readOnly}
                  aria-label={tx("Страна проживания плательщика", "Wohnsitzland des Kostenübernehmers")}
                  onChange={(value) => patch("country", value ?? "")}
                />
              </PayerField>
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
              <PayerField label={tx("Кем приходится пациенту", "Beziehung zum Patienten")}>
                <Input className={inputClass} value={form.relationship} disabled={readOnly} onChange={(event) => patch("relationship", event.target.value)} />
              </PayerField>
              <PayerField label={tx("Электронная почта", "E-Mail")}>
                <Input className={inputClass} type="email" value={form.email} disabled={readOnly} onChange={(event) => patch("email", event.target.value)} />
              </PayerField>
              <PayerField label={tx("Телефон", "Telefon")}>
                <Input className={inputClass} type="tel" value={form.phone} disabled={readOnly} onChange={(event) => patch("phone", event.target.value)} />
              </PayerField>
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
            <p className="text-xs text-muted-foreground">
              {tx(
                "Плательщик подписывает согласие на оплату (Kostenübernahmeerklärung, присоединение к долгу). Документ создаётся на шаге «Договор и смета», когда заказ уже есть.",
                "Der Kostenübernehmer unterschreibt die Kostenübernahmeerklärung (Schuldbeitritt). Sie wird im Schritt „Vertrag & Angebot“ erstellt, sobald der Auftrag besteht.",
              )}
            </p>
          </div>
        ) : null}

        {missing.length > 0 ? (
          <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-300">
            {missing.map((code) => (
              <li key={code} className="flex items-start gap-1.5">
                <Circle aria-hidden="true" className="mt-1 size-2 shrink-0" />
                {payerReasonLabel(code, tx)}
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

/**
 * The signing order in the commercial step: "Клиент подписал ✓ → Плательщик
 * подписал согласие ✓ → GMED подписывает", the payer's
 * Kostenübernahmeerklärung and why GMED may not sign yet. The server enforces
 * the same order (409 `payer_gate_blocked`).
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
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = payerSignatureSequence(status);
  const required = Boolean(status?.cost_assumption.required);
  const orderId = status?.order_id ?? null;

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
      accessory={required && canGenerate ? (
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
