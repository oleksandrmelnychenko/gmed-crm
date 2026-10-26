import { useState } from "react";
import { ChevronRight, CircleAlert, FileSignature, FileText, History, LoaderCircle, Mail, Undo2 } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, checkboxClass } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusChipTone } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { downloadDocumentFile } from "@/pages/documents/data/document-api";

import {
  PAYER_LINK_LANGUAGES,
  type LeadPayerLinkState,
  type PayerLinkLanguage,
} from "../data/lead-payer-link-api";
import type { PayerPackageStatus, PayerPackageSummary } from "../data/lead-payer-package-api";
import { payerPackageSummaryText } from "../model/lead-payer-package";
import {
  payerLinkActions,
  payerLinkCabinetNote,
  payerLinkEmailLines,
  payerLinkErrorText,
  payerLinkResendAsksFirst,
  payerLinkResendQuestion,
  payerLinkStatusLine,
  previousQuestionnaireSummary,
  type Tx,
} from "../model/lead-payer-link";
import type { LeadPayerLinkController } from "../model/use-lead-payer-link";
import { LeadConfirmDialog } from "./lead-confirm-dialog";
import { LeadPayerQuestionnairePreview } from "./lead-payer-questionnaire-preview";

const LANGUAGE_LABELS: Record<PayerLinkLanguage, string> = { de: "DE", en: "EN", uk: "UA", ru: "RU" };
const PACKAGE_TONES: Record<PayerPackageStatus, StatusChipTone> = {
  prepared: "success", sending: "info", pending: "info", signed: "success",
  needs_review: "warning", declined: "error", withdrawn: "neutral", expired: "warning", error: "error",
};

/** The lead's language as a language of the invitation; German when it is none of the four. */
export function payerLinkLanguageOf(value: string | null | undefined): PayerLinkLanguage {
  const code = (value ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (code === "ua") return "uk";
  return PAYER_LINK_LANGUAGES.find((language) => language === code) ?? "de";
}

/**
 * "Zahler-Link" in the payer section (contract phase 3a, 6.1): the state of
 * the payer's own link with its times, the language of the invitation, send,
 * send again (with "reopen for correction" once the payer answered) and
 * revoke, each disabled with the reason; a note instead for a paying parent
 * who answers in the cabinet. Amounts belong in the cost estimate. Writes only for
 * `canEdit` (leads.edit); the server checks the same.
 */
export function LeadPayerLinkPanel({
  leadId,
  state,
  controller,
  canEdit,
  disabled = false,
  leadLanguage,
  tx,
  errorText,
  onSent,
  packageSummary,
  leadSubmitted = true,
  onOpenDocument,
}: {
  leadId: string;
  state: LeadPayerLinkState;
  controller: Pick<LeadPayerLinkController, "send" | "revoke" | "reload">;
  canEdit: boolean;
  disabled?: boolean;
  /** The lead's language: the first choice for the invitation. */
  leadLanguage?: string | null;
  tx: Tx;
  errorText: (error: unknown) => string;
  /** After a link went out: the server marked the payer as informed. */
  onSent?: () => void;
  /**
   * The payer's signature package from the declaration's status (phase 3b):
   * named once the payer has answered; null while none is prepared, absent
   * (undefined) on an older server — then nothing is shown.
   */
  packageSummary?: PayerPackageSummary | null;
  /** The lead has sent the request; before that "теперь можно отправить ссылку" is not said (QA 2026-10-25). */
  leadSubmitted?: boolean;
  /** Opens a document of the lead (the wizard's preview): the archived identity document of a previous payer. */
  onOpenDocument?: (documentId: string, title: string) => void;
}) {
  const [language, setLanguage] = useState<PayerLinkLanguage | null>(null);
  const [reopen, setReopen] = useState(false);
  const [busy, setBusy] = useState<"send" | "revoke" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The question asked before revoking, or before a new link replaces one the payer is filling in.
  const [confirm, setConfirm] = useState<"revoke" | "resend" | null>(null);

  const link = state.link;
  const actions = payerLinkActions(state, reopen, tx, leadSubmitted);
  const chosenLanguage = language ?? link?.language ?? payerLinkLanguageOf(leadLanguage);
  const status = link ? payerLinkStatusLine(link, state.questionnaire?.submitted_at, tx) : null;
  const locked = disabled || busy !== null;
  const message = (cause: unknown) => payerLinkErrorText(cause, tx) ?? errorText(cause);

  async function send() {
    setConfirm(null);
    setBusy("send");
    setError("");
    setNotice("");
    try {
      const next = await controller.send({ language: chosenLanguage, reopen: actions.reopenOffered && reopen });
      setReopen(false);
      // The invitation informed the payer (Art. 14 DSGVO): the declaration says so now.
      onSent?.();
      const email = next?.link?.email ?? link?.email ?? "";
      setNotice(email ? tx(`Ссылка отправлена на ${email}`, `Link gesendet an ${email}`) : tx("Ссылка отправлена", "Link gesendet"));
    } catch (cause) {
      setError(message(cause));
      // A failed e-mail revokes the new link on the server: show that state.
      void controller.reload();
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    setConfirm(null);
    setBusy("revoke");
    setError("");
    setNotice("");
    try {
      await controller.revoke();
      setNotice(tx("Ссылка отозвана", "Link widerrufen"));
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-card p-3.5 text-[13px]" data-testid="lead-payer-link">
      <div className="flex flex-wrap items-center gap-2">
        <AdminSectionTitle>{tx("Ссылка для плательщика", "Zahler-Link")}</AdminSectionTitle>
        {status && !actions.cabinet ? (
          <StatusChip tone={status.tone} data-testid="lead-payer-link-badge" data-status={link?.status}>
            {status.label}
          </StatusChip>
        ) : null}
      </div>

      <LeadPayerQuestionnairePreview key={leadId} state={state} tx={tx} />

      {actions.cabinet ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-payer-link-cabinet">
          {actions.note ?? payerLinkCabinetNote(tx)}
        </p>
      ) : (
        <>
          {state.questionnaire?.submitted_at ? null : status ? (
            <p className="break-words text-xs leading-5 text-muted-foreground" data-testid="lead-payer-link-status">
              {status.text}
            </p>
          ) : (
            <StatusChip tone="neutral" data-testid="lead-payer-link-status">
              {tx("Ссылка ещё не отправлялась", "Noch kein Link gesendet")}
            </StatusChip>
          )}
          {link && link.emails.length > 0 ? (
            <ul className="space-y-0.5 text-xs leading-5" data-testid="lead-payer-link-emails">
              {payerLinkEmailLines(link.emails, tx).map((line) => (
                <li
                  key={line.kind}
                  data-testid={`lead-payer-link-email-${line.kind}`}
                  data-problem={line.problem ? "true" : undefined}
                  className={cn("break-words", line.problem ? "text-destructive" : "text-muted-foreground")}
                >
                  {line.text}
                </li>
              ))}
            </ul>
          ) : null}
          {actions.highlight ? (
            // Its own line, not glued to the "no link yet" chip (QA 2026-10-25).
            <div>
              <StatusChip tone="success" className="rounded-lg" data-testid="lead-payer-link-ready">
                {tx(
                  "Пациент отправил заявку: теперь можно отправить ссылку плательщику",
                  "Die Anfrage ist eingegangen: Der Zahler-Link kann jetzt gesendet werden",
                )}
              </StatusChip>
            </div>
          ) : null}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <span className="whitespace-nowrap text-[11.5px] leading-tight text-muted-foreground" id={`lead-payer-link-language-${leadId}`}>
                  {tx("Язык письма", "Sprache der E-Mail")}
                </span>
                <div className="flex gap-1" role="group" aria-labelledby={`lead-payer-link-language-${leadId}`}>
                  {PAYER_LINK_LANGUAGES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={chosenLanguage === option}
                      disabled={locked}
                      className={cn(
                        "h-7 min-w-9 rounded-lg border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                        chosenLanguage === option
                          ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                          : "border-border/50 bg-field text-muted-foreground hover:text-foreground",
                      )}
                      onClick={() => setLanguage(option)}
                    >
                      {LANGUAGE_LABELS[option]}
                    </button>
                  ))}
                </div>
              </div>
              {actions.reopenOffered ? (
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={reopen}
                    disabled={locked}
                    onChange={(event) => setReopen(event.target.checked)}
                  />
                  {tx("Открыть анкету для исправлений", "Zur Korrektur öffnen")}
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  className={cn("h-8 rounded-lg text-xs", actions.highlight && "ring-2 ring-[var(--brand)]/40 ring-offset-1")}
                  disabled={locked || !actions.sendEnabled}
                  data-highlight={actions.highlight ? "true" : undefined}
                  onClick={() => {
                    // A new link while the payer is filling in ends the payer's session: ask first.
                    if (actions.sendKind === "resend" && payerLinkResendAsksFirst(link)) setConfirm("resend");
                    else void send();
                  }}
                >
                  {busy === "send" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
                  {actions.sendKind === "resend"
                    ? tx("Отправить повторно", "Erneut senden")
                    : tx("Отправить ссылку плательщику", "Link an den Zahler senden")}
                </Button>
                {actions.revokeEnabled ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 rounded-lg text-xs text-rose-700"
                    disabled={locked}
                    onClick={() => setConfirm("revoke")}
                  >
                    {busy === "revoke" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Undo2 className="size-3.5" />}
                    {tx("Отозвать ссылку", "Link widerrufen")}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {canEdit && actions.sendBlockedText ? (
            <StatusChip tone="warning" className="w-full items-start rounded-xl px-3 py-2" data-testid="lead-payer-link-blocked">
              <CircleAlert aria-hidden="true" className="mt-0.5" />
              <span>{actions.sendBlockedText}</span>
            </StatusChip>
          ) : null}
        </>
      )}

      {state.previous_questionnaires.length > 0 ? (
        // The sent statements of previous payers (QA 2026-10-25, map item 95): one
        // collapsed line each, newest first; the archived identity document opens
        // through the wizard's document preview.
        <ul className="space-y-1 border-t border-border/50 pt-3" data-testid="lead-payer-link-previous">
          {state.previous_questionnaires.map((entry) => {
            const summary = previousQuestionnaireSummary(entry, tx);
            const documentId = entry.document_id;
            return (
              <li key={entry.statement_id}>
                <details
                  className="group rounded-lg border border-border/50 bg-field/40 text-xs"
                  data-testid="lead-payer-link-previous-entry"
                  data-statement-id={entry.statement_id}
                >
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 leading-5 text-foreground [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                    <History aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="break-words">{summary.title}</span>
                  </summary>
                  <div className="space-y-1.5 px-2.5 pb-2.5 pl-9 text-muted-foreground">
                    {summary.details.map((line) => (
                      <p key={line} className="break-words leading-5">
                        {line}
                      </p>
                    ))}
                    {summary.documentLabel && documentId ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-lg text-xs"
                        disabled={disabled}
                        data-testid="lead-payer-link-previous-document"
                        onClick={() => {
                          // The wizard's preview when it is wired; a download of the archived copy otherwise.
                          if (onOpenDocument) onOpenDocument(documentId, summary.title);
                          else downloadDocumentFile(documentId, `${summary.title}.pdf`).catch((cause) => setError(message(cause)));
                        }}
                      >
                        <FileText className="size-3.5" />
                        {summary.documentLabel}
                      </Button>
                    ) : null}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      ) : null}

      {state.questionnaire?.submitted_at && packageSummary !== undefined ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-border/50 pt-3" data-testid="lead-payer-link-package" data-status={packageSummary?.status ?? "none"}>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileSignature aria-hidden="true" className="size-3.5" />
            {tx("Пакет на подпись", "Unterschriftenpaket")}
          </span>
          <StatusChip tone={packageSummary?.outdated ? "warning" : packageSummary ? PACKAGE_TONES[packageSummary.status] : "neutral"}>
            {payerPackageSummaryText(packageSummary, tx)}
          </StatusChip>
          <StatusChip>{tx("Договор и смета", "Vertrag & Angebot")}</StatusChip>
        </div>
      ) : null}

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? (
        <StatusChip tone="success" role="status" data-testid="lead-payer-link-notice">
          {notice}
        </StatusChip>
      ) : null}

      <LeadConfirmDialog
        open={confirm === "revoke"}
        testId="lead-payer-link-revoke-dialog"
        title={tx("Отозвать ссылку плательщика?", "Link des Zahlers widerrufen?")}
        description={tx(
          "Открыть её больше будет нельзя; ответы плательщика сохраняются.",
          "Er lässt sich danach nicht mehr öffnen; die Angaben des Zahlers bleiben erhalten.",
        )}
        confirmLabel={tx("Отозвать ссылку", "Link widerrufen")}
        cancelLabel={tx("Отмена", "Abbrechen")}
        destructive
        onConfirm={() => void revoke()}
        onCancel={() => setConfirm(null)}
      />
      <LeadConfirmDialog
        open={confirm === "resend"}
        testId="lead-payer-link-resend-dialog"
        title={tx("Отправить новую ссылку?", "Neuen Link senden?")}
        description={payerLinkResendQuestion(tx)}
        confirmLabel={tx("Отправить новую", "Neuen Link senden")}
        cancelLabel={tx("Отмена", "Abbrechen")}
        onConfirm={() => void send()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
