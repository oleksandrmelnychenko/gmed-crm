import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, FileText, LoaderCircle, Upload } from "lucide-react";

import { Banner, inputClass, selectClass, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import type { DocumentItem } from "@/pages/documents/model/types";
import { PaperSignatureConfirmButton } from "@/pages/documents/ui/paper-signature-confirm";

import {
  fetchPayerPaperDocuments,
  generatePaperSelfDisclosure,
  uploadPayerIdentity,
} from "../data/lead-payer-paper-api";
import type { Tx } from "../model/lead-payer";
import {
  EMPTY_PAYER_IDENTITY_FIELDS,
  PAYER_ID_DOCUMENT_TYPES,
  PAYER_PAPER_PATH_ID,
  payerIdDocumentTypeLabel,
  payerIdentificationLine,
  payerPaperDocuments,
  type PayerIdentificationStatus,
  type PayerIdentityFields,
} from "../model/lead-payer-paper";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ACCEPTED_TYPES = "application/pdf,image/jpeg,image/png";
/** Roles the server lets file a lead's documents and record a paper signature. */
const FILING_ROLES = new Set(["ceo", "patient_manager"]);

/**
 * The staff paper path of a third-party payer (DEV re-check V-A7): beside the
 * payer link, which goes out by e-mail only, staff identify a payer without
 * e-mail (or who prefers paper) themselves — (a) upload the payer's identity
 * document ("Ausweis (Zahler/in)") with its optional data, (b) create the
 * Selbstauskunft as a paper form and record it «Подписано на бумаге» with the
 * scan. Both count for the readiness check `payer_identified`.
 */
export function LeadPayerPaperPath({
  leadId,
  identification,
  payerName,
  canEdit,
  disabled = false,
  lang,
  tx,
  errorText,
  onChanged,
  onOpenDocument,
}: {
  leadId: string;
  identification: PayerIdentificationStatus;
  payerName: string;
  canEdit: boolean;
  disabled?: boolean;
  lang: "de" | "ru";
  tx: Tx;
  errorText: (error: unknown) => string;
  /** The payer's identification changed: the declaration is read afresh. */
  onChanged?: () => void;
  /** Opens a document in the wizard's preview (a download without it). */
  onOpenDocument?: (documentId: string, title: string) => void;
}) {
  const { user } = useAuth();
  const mayFile = canEdit && Boolean(user && FILING_ROLES.has(user.role));
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [busy, setBusy] = useState<"upload" | "generate" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fields, setFields] = useState<PayerIdentityFields>(EMPTY_PAYER_IDENTITY_FIELDS);
  const activeLead = useRef(leadId);
  activeLead.current = leadId;

  const reload = useCallback(async () => {
    try {
      const next = await fetchPayerPaperDocuments(leadId);
      if (activeLead.current === leadId) setDocuments(next);
    } catch {
      // The list is a convenience: the status line still says what is missing.
    }
  }, [leadId]);

  useEffect(() => {
    setDocuments([]);
    void reload();
  }, [reload]);

  const { selfDisclosure, identity } = payerPaperDocuments(documents);
  const line = payerIdentificationLine(identification, tx);
  const disclosureDone = identification.statement_sent || identification.self_disclosure_signed;
  const locked = disabled || busy !== null;
  const title = (document: DocumentItem) => document.auto_name || document.original_filename || tx("Документ", "Dokument");

  const changed = async (message: string) => {
    await reload();
    if (activeLead.current !== leadId) return;
    setNotice(message);
    onChanged?.();
  };

  async function upload() {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError(tx("Файл больше 25 МБ", "Datei größer als 25 MB"));
      return;
    }
    setBusy("upload");
    setError("");
    setNotice("");
    try {
      await uploadPayerIdentity(leadId, file, payerName, fields);
      setUploadOpen(false);
      setFile(null);
      setFields(EMPTY_PAYER_IDENTITY_FIELDS);
      await changed(tx("Документ плательщика загружен", "Ausweis des Zahlers hochgeladen"));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    setBusy("generate");
    setError("");
    setNotice("");
    try {
      await generatePaperSelfDisclosure(leadId, selfDisclosure && !selfDisclosure.signed_at ? selfDisclosure.id : null);
      await changed(tx(
        "Selbstauskunft создана — распечатайте, дайте плательщику заполнить и подписать, затем загрузите скан",
        "Selbstauskunft erstellt – ausdrucken, vom Zahler ausfüllen und unterschreiben lassen, dann den Scan hochladen",
      ));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(null);
    }
  }

  const patchField = <K extends keyof PayerIdentityFields>(key: K, value: PayerIdentityFields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  return (
    <div
      id={PAYER_PAPER_PATH_ID}
      tabIndex={-1}
      className="min-w-0 space-y-2.5 rounded-lg border border-border/70 bg-background/60 p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid="lead-payer-paper-path"
      data-identified={identification.identified ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <FileText aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">
          {tx("Бумажный путь (без ссылки)", "Papierweg (ohne Link)")}
        </span>
      </div>
      <p className="break-words text-xs leading-5 text-muted-foreground">
        {tx(
          "Если у плательщика нет e-mail или он предпочитает бумагу: загрузите его документ и подписанную на бумаге Selbstauskunft.",
          "Hat der Zahler keine E-Mail oder bevorzugt er Papier: seinen Ausweis und die auf Papier unterschriebene Selbstauskunft hochladen.",
        )}
      </p>
      {line ? (
        <p
          className={cn(
            "inline-flex items-start gap-1.5 break-words text-xs leading-5",
            line.tone === "success" ? "text-emerald-700" : line.tone === "warning" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground",
          )}
          data-testid="lead-payer-paper-status"
          data-tone={line.tone}
        >
          {line.tone === "success" ? <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : line.tone === "warning" ? <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /> : null}
          <span>{line.text}</span>
        </p>
      ) : null}

      <ol className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card">
        {/* (b) The Selbstauskunft: the link's questionnaire or the paper form signed by hand. */}
        <li className="flex min-w-0 flex-wrap items-start gap-2 px-3 py-2" data-testid="lead-payer-paper-self-disclosure" data-done={disclosureDone ? "true" : "false"}>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-medium text-foreground">
              {tx("Selbstauskunft плательщика", "Selbstauskunft des Zahlers")}
            </p>
            <p className="break-words text-xs leading-5 text-muted-foreground">
              {identification.statement_sent
                ? tx("Анкета отправлена плательщиком по ссылке", "Fragebogen vom Zahler über den Link gesendet")
                : selfDisclosure?.signed_at
                  ? tx(`подписана на бумаге ${formatAppDate(selfDisclosure.signed_at)}`, `auf Papier unterschrieben am ${formatAppDate(selfDisclosure.signed_at)}`)
                  : selfDisclosure
                    ? tx("создана, ждёт подписи плательщика", "erstellt, wartet auf die Unterschrift des Zahlers")
                    : tx("ещё не создана", "noch nicht erstellt")}
            </p>
            {selfDisclosure ? (
              <button
                type="button"
                className="max-w-full break-words text-left text-xs text-foreground underline underline-offset-2 disabled:opacity-60"
                disabled={disabled}
                data-testid="lead-payer-paper-self-disclosure-open"
                onClick={() => onOpenDocument?.(selfDisclosure.id, title(selfDisclosure))}
              >
                {title(selfDisclosure)}
              </button>
            ) : null}
          </div>
          {mayFile && !identification.statement_sent && !selfDisclosure?.signed_at ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant={selfDisclosure ? "outline" : "default"}
                disabled={locked}
                data-testid="lead-payer-paper-generate"
                onClick={() => void generate()}
              >
                {busy === "generate" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <FileText aria-hidden="true" className="size-3.5" />}
                {selfDisclosure
                  ? tx("Новая версия для бумаги", "Neue Papierfassung")
                  : tx("Создать Selbstauskunft для подписи на бумаге", "Selbstauskunft für die Papierunterschrift erstellen")}
              </Button>
              {selfDisclosure ? (
                <PaperSignatureConfirmButton
                  documentId={selfDisclosure.id}
                  title={title(selfDisclosure)}
                  lang={lang}
                  disabled={locked}
                  label={tx("Подписано на бумаге", "Auf Papier unterschrieben")}
                  errorText={(cause) => errorText(cause)}
                  onDone={() => void changed(tx("Подписанная Selbstauskunft сохранена", "Unterschriebene Selbstauskunft gespeichert"))}
                />
              ) : null}
            </div>
          ) : null}
        </li>

        {/* (a) The payer's identity document. */}
        <li className="min-w-0 space-y-2 px-3 py-2" data-testid="lead-payer-paper-identity" data-done={identification.identity_document ? "true" : "false"}>
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-medium text-foreground">
                {tx("Документ плательщика (Ausweis)", "Ausweis des Zahlers")}
              </p>
              {identity.length > 0 ? (
                <ul className="space-y-0.5">
                  {identity.map((document) => (
                    <li key={document.id} className="break-words text-xs leading-5 text-muted-foreground">
                      <button
                        type="button"
                        className="max-w-full break-words text-left text-foreground underline underline-offset-2 disabled:opacity-60"
                        disabled={disabled}
                        onClick={() => onOpenDocument?.(document.id, title(document))}
                      >
                        {title(document)}
                      </button>
                      {document.notes ? <span> · {document.notes}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  {identification.identity_document
                    ? tx("документ есть в документах заявки", "Ausweis liegt in den Dokumenten der Anfrage")
                    : tx("ещё не загружен", "noch nicht hochgeladen")}
                </p>
              )}
            </div>
            {mayFile && !uploadOpen ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={locked}
                data-testid="lead-payer-paper-upload-open"
                onClick={() => {
                  setError("");
                  setNotice("");
                  setUploadOpen(true);
                }}
              >
                <Upload aria-hidden="true" className="size-3.5" />
                {tx("Загрузить документ плательщика (бумажный путь)", "Ausweis des Zahlers hochladen (Papierweg)")}
              </Button>
            ) : null}
          </div>
          {mayFile && uploadOpen ? (
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3" data-testid="lead-payer-paper-upload-form">
              <label className="block min-w-0 space-y-1.5">
                <span className={cn(tokens.text.label, "block")}>
                  {tx("Скан или фото документа", "Scan oder Foto des Ausweises")}
                  <span aria-hidden="true" className="ml-0.5 text-destructive">*</span>
                </span>
                <input
                  type="file"
                  accept={ACCEPTED_TYPES}
                  disabled={locked}
                  data-testid="lead-payer-paper-upload-file"
                  className="block w-full max-w-full text-xs"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                {tx("Данные документа — по желанию:", "Angaben zum Ausweis – optional:")}
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="min-w-0 space-y-1.5">
                  <span className={cn(tokens.text.label, "block")}>{tx("Вид документа", "Art des Ausweises")}</span>
                  <select
                    className={selectClass}
                    value={fields.type}
                    disabled={locked}
                    data-testid="lead-payer-paper-id-type"
                    onChange={(event) => patchField("type", event.target.value as PayerIdentityFields["type"])}
                  >
                    <option value="">{tx("— не указан —", "— keine Angabe —")}</option>
                    {PAYER_ID_DOCUMENT_TYPES.map((type) => (
                      <option key={type} value={type}>{payerIdDocumentTypeLabel(type, tx)}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-0 space-y-1.5">
                  <span className={cn(tokens.text.label, "block")}>{tx("Номер", "Nummer")}</span>
                  <Input
                    className={inputClass}
                    value={fields.number}
                    maxLength={40}
                    disabled={locked}
                    autoComplete="off"
                    data-testid="lead-payer-paper-id-number"
                    onChange={(event) => patchField("number", event.target.value)}
                  />
                </label>
                <label className="min-w-0 space-y-1.5">
                  <span className={cn(tokens.text.label, "block")}>{tx("Страна выдачи (код ISO)", "Ausstellungsstaat (ISO-Code)")}</span>
                  <Input
                    className={inputClass}
                    value={fields.issuingCountry}
                    maxLength={2}
                    disabled={locked}
                    autoComplete="off"
                    placeholder="DE"
                    data-testid="lead-payer-paper-id-country"
                    onChange={(event) => patchField("issuingCountry", event.target.value.toUpperCase())}
                  />
                </label>
                <label className="min-w-0 space-y-1.5">
                  <span className={cn(tokens.text.label, "block")}>{tx("Действителен до", "Gültig bis")}</span>
                  <Input
                    type="date"
                    className={inputClass}
                    value={fields.validUntil}
                    disabled={locked}
                    data-testid="lead-payer-paper-id-valid-until"
                    onChange={(event) => patchField("validUntil", event.target.value)}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg"
                  disabled={locked || !file}
                  data-testid="lead-payer-paper-upload-submit"
                  onClick={() => void upload()}
                >
                  {busy === "upload" ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Upload aria-hidden="true" className="size-3.5" />}
                  {tx("Загрузить", "Hochladen")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg"
                  disabled={busy !== null}
                  onClick={() => {
                    setUploadOpen(false);
                    setFile(null);
                    setFields(EMPTY_PAYER_IDENTITY_FIELDS);
                  }}
                >
                  {tx("Отмена", "Abbrechen")}
                </Button>
              </div>
            </div>
          ) : null}
        </li>
      </ol>

      {canEdit && !mayFile ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-payer-paper-role-hint">
          {tx(
            "Документы плательщика загружает менеджер пациентов или CEO.",
            "Die Unterlagen des Zahlers lädt das Patientenmanagement oder der CEO hoch.",
          )}
        </p>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? (
        <p role="status" className="text-xs text-emerald-700" data-testid="lead-payer-paper-notice">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
