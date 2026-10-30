import { useState, type ReactNode } from "react";
import { CalendarDays, Check, FileText, Info, LoaderCircle, Send, ShieldCheck, UserRound } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
import { PaperSignatureConfirmButton } from "@/pages/documents/ui/paper-signature-confirm";

import type { LeadPayerPackageState, PayerPackageDocument, PayerPackageSlot } from "../data/lead-payer-package-api";
import type { PayerIdentificationStatus } from "../model/lead-payer-paper";
import {
  payerAnsweredOnPaper,
  payerPackageActions,
  payerPackageBlockedText,
  payerPackageErrorText,
  payerPackageIdentificationText,
  payerPackageLanguageHint,
  payerPackageLanguageOf,
  payerPackageLanguages,
  payerPackageOutdatedHeading,
  payerPackageOutdatedReasonText,
  payerPackageRows,
  payerPackageSignatureDisabledText,
  payerPackageSignerText,
  payerPackageSlotLabel,
  payerPackageSlotPurpose,
  payerPackageStatusLine,
  payerPackageTestModeLabel,
  payerPaperSelfDisclosureText,
  type Tx,
} from "../model/lead-payer-package";
import type { LeadPayerPackageController } from "../model/use-lead-payer-package";
import { LeadConfirmDialog } from "./lead-confirm-dialog";

/**
 * "Unterlagen für den Zahler zur Unterschrift" (contract phase 3b, 6.1): the
 * four documents of the payer's package with version and signature, who
 * signs, the language of Skribble's invitation, prepare / prepare again and
 * send (after the app's question), the state of the sent request with its
 * details, why nothing can be done now, and the payer's identification by
 * the QES. Writes only for `canEdit` (leads.edit) and what the server allows
 * (`can_prepare`, `can_send`).
 */
export function LeadPayerPackagePanel({
  leadId,
  state,
  controller,
  canEdit,
  disabled = false,
  tx,
  errorText,
  onOpenDocument,
  renderDetails,
  fallbackDocuments,
  paperIdentification,
  lang,
  onPaperSigned,
}: {
  leadId: string;
  state: LeadPayerPackageState;
  controller: Pick<LeadPayerPackageController, "prepare" | "send">;
  canEdit: boolean;
  disabled?: boolean;
  tx: Tx;
  errorText: (error: unknown) => string;
  /** Opens a document of the package (the wizard's preview). */
  onOpenDocument?: (documentId: string, title: string) => void;
  /** The details of the sent request (withdraw, refresh, review, report) on the first document. */
  renderDetails?: (documentId: string, title: string) => ReactNode;
  /** A document of a slot made outside the package (the standalone Kostenübernahmeerklärung). */
  fallbackDocuments?: Partial<Record<PayerPackageSlot, PayerPackageDocument | null>>;
  /**
   * `status.identification` of the payer declaration: a payer identified on
   * the paper path shows the signed paper Selbstauskunft as his statement
   * (QA 2026-10-25, F-F2).
   */
  paperIdentification?: PayerIdentificationStatus | null;
  /**
   * The wizard's language and a reload after a document was recorded as
   * signed on paper: every prepared document of the package can be signed on
   * paper instead of the QES request (DEV QA 2026-10-30: items 3 and 4 had no
   * action on the paper path).
   */
  lang?: "de" | "ru";
  onPaperSigned?: () => void;
}) {
  const [language, setLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prepare" | "send" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const pkg = state.package;
  const actions = payerPackageActions(state, canEdit);
  const rows = payerPackageRows(pkg, fallbackDocuments);
  const status = pkg ? payerPackageStatusLine(pkg, tx) : null;
  const chosenLanguage = payerPackageLanguageOf(state, language);
  const languageHint = payerPackageLanguageHint(state, chosenLanguage, tx);
  const signer = payerPackageSignerText(state.signer, tx);
  const identification = payerPackageIdentificationText(state.payer_identification, tx, paperIdentification);
  const answeredOnPaper = payerAnsweredOnPaper(paperIdentification);
  const blockedText = payerPackageBlockedText(state, paperIdentification, tx);
  const outdated = pkg?.outdated_reasons ?? [];
  // Why the QES button is off, said beside it (QA 2026-10-25).
  const sendDisabledHint = !state.signature_enabled
    ? payerPackageSignatureDisabledText(tx)
    : state.risk_hold === "rejected"
      ? tx("Оценка риска отклонила лида: пакет плательщику отправить нельзя.", "Die Risikobewertung hat den Lead abgelehnt: Das Zahlerpaket kann nicht gesendet werden.")
      : state.risk_hold === "review"
        ? tx("Оценка риска ждёт решения сотрудника: пакет отправляется после него («Оценка риска»).", "Die Risikobewertung wartet auf eine Entscheidung: Das Paket wird danach gesendet („Risikobewertung“).")
    : pkg && outdated.length > 0
      ? tx("Пакет устарел — пересоздайте документы", "Paket veraltet – Unterlagen neu erstellen")
      : blockedText;
  const locked = disabled || busy !== null;
  const firstDocument = rows[0]?.document ?? null;
  // Out for the QES: the request decides; otherwise a prepared document can be signed on paper.
  const paperSignable = canEdit && Boolean(onPaperSigned) && !(pkg && ["sending", "pending", "needs_review"].includes(pkg.status));
  const message = (cause: unknown) => payerPackageErrorText(cause, tx) ?? errorText(cause);

  async function prepare() {
    setBusy("prepare");
    setError("");
    setNotice("");
    try {
      await controller.prepare();
      setNotice(tx("Документы подготовлены — проверьте их перед отправкой", "Unterlagen erstellt – bitte vor dem Senden prüfen"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!pkg) return;
    setConfirm(false);
    setBusy("send");
    setError("");
    setNotice("");
    try {
      await controller.send({ package_id: pkg.id, language: chosenLanguage });
      setNotice(
        state.signer?.email
          ? tx(`Пакет отправлен через Skribble на ${state.signer.email}`, `Paket über Skribble an ${state.signer.email} gesendet`)
          : tx("Пакет отправлен через Skribble", "Paket über Skribble gesendet"),
      );
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-border/50 bg-card p-3.5" data-testid="lead-payer-package">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSectionTitle>
          {tx("Документы плательщику на подпись", "Unterlagen für den Zahler zur Unterschrift")}
        </AdminSectionTitle>
        {status ? (
          <span className="inline-flex" data-testid="lead-payer-package-badge" data-status={pkg?.status}>
            <StatusChip tone={pkg?.status === "prepared" ? "success" : status.tone === "brand" ? "info" : status.tone}>{status.label}</StatusChip>
          </span>
        ) : null}
        {pkg?.test_mode ? (
          <span className="inline-flex" data-testid="lead-payer-package-test-mode">
            <StatusBadge tone="warning">{payerPackageTestModeLabel(tx)}</StatusBadge>
          </span>
        ) : null}
      </div>
      {signer ? (
        <p className="flex flex-wrap items-center gap-2 text-xs leading-5 text-foreground" data-testid="lead-payer-package-signer">
          <span className="font-mono text-muted-foreground">{tx("Подписывает:", "Unterschreibt:")}</span>
          <StatusChip tone="warning"><UserRound aria-hidden="true" /><span className="min-w-0 break-words">{signer}</span></StatusChip>
        </p>
      ) : null}

      <ol className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50" data-testid="lead-payer-package-documents">
        {rows.map(({ slot, document }, index) => {
          const label = payerPackageSlotLabel(slot, tx);
          return (
            <li
              key={slot}
              className="flex min-w-0 items-start gap-3 px-3 py-3"
              data-testid={`lead-payer-package-document-${slot}`}
              data-document-id={document?.document_id}
            >
              <span aria-hidden="true" className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] font-mono text-[11px] font-semibold text-white">{index + 1}</span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {document && onOpenDocument ? (
                    <button
                      type="button"
                      className="max-w-full break-words text-left text-sm font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                      disabled={disabled}
                      title={document.title ?? undefined}
                      onClick={() => onOpenDocument(document.document_id, document.title ?? label)}
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="break-words text-sm font-semibold text-foreground">{label}</span>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {document ? (
                      <>
                        {document.version !== null ? (
                          <StatusChip className="border-violet-200 bg-violet-50 font-mono text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-200">{tx("Версия", "Version")} {document.version}</StatusChip>
                        ) : null}
                        {document.signed_at ? (
                          <span className="inline-flex flex-wrap items-center gap-1.5" data-testid={`lead-payer-package-signed-${slot}`}>
                            <StatusChip tone="success"><Check aria-hidden="true" />{tx("Подписан", "Unterschrieben")}</StatusChip>
                            <StatusChip tone="info"><CalendarDays aria-hidden="true" />{formatAppDate(document.signed_at)}</StatusChip>
                          </span>
                        ) : null}
                      </>
                    ) : slot === "self_disclosure" && answeredOnPaper ? (
                      <StatusChip tone="success" data-testid="lead-payer-package-paper-self_disclosure">
                        <Check aria-hidden="true" className="size-3.5" />
                        {payerPaperSelfDisclosureText(tx)}
                      </StatusChip>
                    ) : (
                      <StatusChip tone="warning">{tx("ещё не создан", "noch nicht erstellt")}</StatusChip>
                    )}
                  </div>
                </div>
                <p className="break-words text-xs leading-5 text-foreground/75" data-testid={`lead-payer-package-purpose-${slot}`}>
                  {payerPackageSlotPurpose(slot, tx)}
                </p>
                {document && !document.signed_at && paperSignable ? (
                  <span className="inline-flex" data-testid={`lead-payer-package-paper-sign-${slot}`}>
                    <PaperSignatureConfirmButton
                      documentId={document.document_id}
                      title={document.title ?? label}
                      lang={lang ?? "ru"}
                      disabled={locked}
                      label={tx("Подписано на бумаге", "Auf Papier unterschrieben")}
                      errorText={(cause) => payerPackageErrorText(cause, tx) ?? errorText(cause)}
                      onDone={() => {
                        setNotice(tx("Подписанный документ сохранён", "Unterschriebenes Dokument gespeichert"));
                        onPaperSigned?.();
                      }}
                    />
                  </span>
                ) : null}
              </div>
              {document ? <FileText aria-hidden="true" className="mt-1 size-3.5 shrink-0 text-muted-foreground" /> : null}
            </li>
          );
        })}
      </ol>
      {pkg && pkg.attachments.length > 0 ? (
        <p className="break-words text-xs leading-5 text-muted-foreground" data-testid="lead-payer-package-attachments">
          {tx("Приложение для ознакомления: ", "Anlage zur Kenntnisnahme: ")}
          {pkg.attachments.map((item) => item.title ?? item.document_id).join(", ")}
        </p>
      ) : null}

      {status ? (
        <p className="break-words text-xs leading-5 text-muted-foreground" data-testid="lead-payer-package-status">{status.text}</p>
      ) : null}
      {blockedText ? (
        <p
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          data-testid="lead-payer-package-blocked"
          data-reason={state.blocked_reason ?? undefined}
        >
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" /><span>{blockedText}</span>
        </p>
      ) : null}
      {pkg && outdated.length > 0 ? (
        <div className="text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-payer-package-outdated">
          <p className="font-medium">{payerPackageOutdatedHeading(pkg.status, tx)}</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {outdated.map((reason) => (
              <li key={reason}>{payerPackageOutdatedReasonText(reason, tx)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {!state.signature_enabled && !actions.sendShown ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-payer-package-signature-disabled">
          {payerPackageSignatureDisabledText(tx)}
        </p>
      ) : null}
      {identification ? (
        <p
          className={cn(
            "flex w-fit max-w-full items-start gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-5",
            identification.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
          )}
          data-testid="lead-payer-package-qes"
        >
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{identification.text}</span>
        </p>
      ) : null}

      {actions.sendShown || actions.prepare || (actions.details && firstDocument && renderDetails) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {actions.sendShown ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="whitespace-nowrap text-[13px] text-muted-foreground" id={`lead-payer-package-language-${leadId}`}>
                {tx("Язык приглашения", "Sprache der Einladung")}
              </span>
              {/* The same segmented control as "Кто платит" (owner 2026-10-19). */}
              <div className="flex w-fit gap-1 rounded-lg bg-muted/40 p-1" role="group" aria-labelledby={`lead-payer-package-language-${leadId}`}>
                {payerPackageLanguages(state).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={chosenLanguage === option}
                    disabled={locked}
                    className={cn(
                      "min-h-7 min-w-9 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors disabled:cursor-default disabled:opacity-60",
                      chosenLanguage === option
                        ? "bg-[var(--brand)] text-white shadow-sm"
                        : "text-foreground hover:bg-muted",
                    )}
                    onClick={() => setLanguage(option)}
                  >
                    {option.toUpperCase()}
                  </button>
                ))}
              </div>
              {languageHint ? (
                <p className="w-full text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-payer-package-language-hint">
                  {languageHint}
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {actions.prepare ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-8 rounded-lg"
                disabled={locked}
                onClick={() => void prepare()}
              >
                {busy === "prepare" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
                {actions.prepare === "first"
                  ? tx("Подготовить документы", "Unterlagen erstellen")
                  : tx("Пересоздать документы", "Unterlagen neu erstellen")}
              </Button>
            ) : null}
            {actions.sendShown ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg"
                disabled={locked || !actions.sendEnabled}
                aria-describedby={!actions.sendEnabled && sendDisabledHint ? `lead-payer-package-send-hint-${leadId}` : undefined}
                onClick={() => setConfirm(true)}
              >
                {busy === "send" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {tx("Отправить плательщику на подпись", "An den Zahler zur Unterschrift senden")}
              </Button>
            ) : null}
            {actions.sendShown && !actions.sendEnabled && sendDisabledHint ? (
              // Why the QES button is off, next to it (QA 2026-10-25): the
              // signature is not connected, or the package has to be remade.
              <span
                id={`lead-payer-package-send-hint-${leadId}`}
                className="text-xs leading-5 text-amber-700 dark:text-amber-300"
                data-testid="lead-payer-package-send-hint"
              >
                {sendDisabledHint}
              </span>
            ) : null}
            {actions.details && firstDocument && renderDetails ? (
              <span className="inline-flex" data-testid="lead-payer-package-details">
                {renderDetails(firstDocument.document_id, firstDocument.title ?? payerPackageSlotLabel(firstDocument.slot, tx))}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      {busy === "prepare" ? (
        <p className="text-xs text-muted-foreground" data-testid="lead-payer-package-preparing">
          {tx("Создаются четыре документа…", "Vier Dokumente werden erstellt…")}
        </p>
      ) : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? (
        <p role="status" className="text-xs text-emerald-700" data-testid="lead-payer-package-notice">
          {notice}
        </p>
      ) : null}

      <LeadConfirmDialog
        open={confirm}
        testId="lead-payer-package-send-dialog"
        title={tx("Отправить документы плательщику?", "Unterlagen an den Zahler senden?")}
        description={[
          state.signer?.email
            ? tx(
                `Skribble пришлёт приглашение на ${state.signer.email}: четыре документа для квалифицированной электронной подписи (QES).`,
                `Skribble sendet die Einladung an ${state.signer.email}: vier Dokumente zur qualifizierten elektronischen Signatur (QES).`,
              )
            : tx(
                "Skribble пришлёт приглашение: четыре документа для квалифицированной электронной подписи (QES).",
                "Skribble sendet die Einladung: vier Dokumente zur qualifizierten elektronischen Signatur (QES).",
              ),
          tx(`Язык приглашения: ${chosenLanguage.toUpperCase()}.`, `Sprache der Einladung: ${chosenLanguage.toUpperCase()}.`),
        ].join(" ")}
        confirmLabel={tx("Отправить на подпись", "Zur Unterschrift senden")}
        cancelLabel={tx("Отмена", "Abbrechen")}
        onConfirm={() => void send()}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
