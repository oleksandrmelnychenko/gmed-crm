import { useState, type ReactNode } from "react";
import { Check, FileSignature, FileText, LoaderCircle, Send, ShieldCheck } from "lucide-react";

import { Banner, StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";

import type { LeadPayerPackageState } from "../data/lead-payer-package-api";
import {
  payerPackageActions,
  payerPackageBlockedReasonText,
  payerPackageErrorText,
  payerPackageIdentificationText,
  payerPackageLanguageOf,
  payerPackageLanguages,
  payerPackageOutdatedHeading,
  payerPackageOutdatedReasonText,
  payerPackageRows,
  payerPackageSignatureDisabledText,
  payerPackageSignerText,
  payerPackageSlotLabel,
  payerPackageStatusLine,
  payerPackageTestModeLabel,
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
}) {
  const [language, setLanguage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"prepare" | "send" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const pkg = state.package;
  const actions = payerPackageActions(state, canEdit);
  const rows = payerPackageRows(pkg);
  const status = pkg ? payerPackageStatusLine(pkg, tx) : null;
  const chosenLanguage = payerPackageLanguageOf(state, language);
  const signer = payerPackageSignerText(state.signer, tx);
  const identification = payerPackageIdentificationText(state.payer_identification, tx);
  const outdated = pkg?.outdated_reasons ?? [];
  const locked = disabled || busy !== null;
  const firstDocument = rows[0]?.document ?? null;
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
    <div className="min-w-0 space-y-2.5 rounded-lg border border-border/70 bg-background/60 p-3" data-testid="lead-payer-package">
      <div className="flex flex-wrap items-center gap-2">
        <FileSignature aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">
          {tx("Документы плательщику на подпись", "Unterlagen für den Zahler zur Unterschrift")}
        </span>
        {status ? (
          <span className="inline-flex" data-testid="lead-payer-package-badge" data-status={pkg?.status}>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
        ) : null}
        {pkg?.test_mode ? (
          <span className="inline-flex" data-testid="lead-payer-package-test-mode">
            <StatusBadge tone="warning">{payerPackageTestModeLabel(tx)}</StatusBadge>
          </span>
        ) : null}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {tx(
          "Плательщик получает один пакет из четырёх документов для квалифицированной электронной подписи (QES) через Skribble. QES одновременно идентифицирует плательщика по GwG.",
          "Der Zahler erhält ein Paket mit vier Dokumenten zur qualifizierten elektronischen Signatur (QES) über Skribble. Die QES identifiziert den Zahler zugleich nach dem GwG.",
        )}
      </p>
      {signer ? (
        <p className="break-words text-xs leading-5 text-foreground" data-testid="lead-payer-package-signer">
          <span className="text-muted-foreground">{tx("Подписывает: ", "Unterschreibt: ")}</span>
          {signer}
        </p>
      ) : null}

      <ol className="divide-y divide-border/70 rounded-lg border border-border/70 bg-card" data-testid="lead-payer-package-documents">
        {rows.map(({ slot, document }, index) => {
          const label = payerPackageSlotLabel(slot, tx);
          return (
            <li
              key={slot}
              className="flex min-w-0 items-start gap-2 px-3 py-2"
              data-testid={`lead-payer-package-document-${slot}`}
              data-document-id={document?.document_id}
            >
              <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 font-mono text-[11px] text-muted-foreground">{index + 1}.</span>
              <div className="min-w-0 flex-1">
                {document && onOpenDocument ? (
                  <button
                    type="button"
                    className="max-w-full break-words text-left text-sm font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-60"
                    disabled={disabled}
                    title={document.title ?? undefined}
                    onClick={() => onOpenDocument(document.document_id, document.title ?? label)}
                  >
                    {label}
                  </button>
                ) : (
                  <span className={cn("break-words text-sm", document ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {document ? (
                    <>
                      {document.version !== null ? (
                        <span className="font-mono">{tx("Версия", "Version")} {document.version}</span>
                      ) : null}
                      {document.signed_at ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700" data-testid={`lead-payer-package-signed-${slot}`}>
                          <Check aria-hidden="true" className="size-3.5" />
                          {tx(`подписан ${formatAppDate(document.signed_at)}`, `unterschrieben am ${formatAppDate(document.signed_at)}`)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span>{tx("ещё не создан", "noch nicht erstellt")}</span>
                  )}
                </div>
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
      {state.blocked_reason ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-payer-package-blocked" data-reason={state.blocked_reason}>
          {payerPackageBlockedReasonText(state.blocked_reason, tx, state.missing)}
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
      {!state.signature_enabled ? (
        <p className="text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-payer-package-signature-disabled">
          {payerPackageSignatureDisabledText(tx)}
        </p>
      ) : null}
      {identification ? (
        <p
          className={cn(
            "inline-flex items-start gap-1.5 break-words text-xs leading-5",
            identification.tone === "success" ? "text-emerald-700" : "text-muted-foreground",
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
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="whitespace-nowrap text-muted-foreground" id={`lead-payer-package-language-${leadId}`}>
                {tx("Язык приглашения", "Sprache der Einladung")}
              </span>
              <div className="flex gap-1" role="group" aria-labelledby={`lead-payer-package-language-${leadId}`}>
                {payerPackageLanguages(state).map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={chosenLanguage === option}
                    disabled={locked}
                    className={
                      chosenLanguage === option
                        ? "rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        : "rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    }
                    onClick={() => setLanguage(option)}
                  >
                    {option.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {actions.prepare ? (
              <Button
                type="button"
                size="sm"
                variant={actions.prepare === "first" ? "default" : "outline"}
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
                onClick={() => setConfirm(true)}
              >
                {busy === "send" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {tx("Отправить плательщику на подпись", "An den Zahler zur Unterschrift senden")}
              </Button>
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
