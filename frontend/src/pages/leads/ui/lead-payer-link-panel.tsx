import { useState } from "react";
import { Link2, LoaderCircle, Mail, Undo2 } from "lucide-react";

import { Banner, checkboxClass, inputClass, StatusBadge, tokens } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  PAYER_LINK_LANGUAGES,
  type LeadPayerLinkState,
  type PayerLinkLanguage,
} from "../data/lead-payer-link-api";
import {
  estimatedTotalInput,
  parseEstimatedTotal,
  payerLinkActions,
  payerLinkCabinetNote,
  payerLinkErrorText,
  payerLinkResendAsksFirst,
  payerLinkResendQuestion,
  payerLinkStatusLine,
  type Tx,
} from "../model/lead-payer-link";
import type { LeadPayerLinkController } from "../model/use-lead-payer-link";
import { LeadConfirmDialog } from "./lead-confirm-dialog";

const LANGUAGE_LABELS: Record<PayerLinkLanguage, string> = { de: "DE", en: "EN", uk: "UA", ru: "RU" };

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
 * who answers in the cabinet; and the expected total amount, which decides
 * whether the payer must prove the source of the funds. Writes only for
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
}: {
  leadId: string;
  state: LeadPayerLinkState;
  controller: Pick<LeadPayerLinkController, "send" | "revoke" | "saveEstimatedTotal" | "reload">;
  canEdit: boolean;
  disabled?: boolean;
  /** The lead's language: the first choice for the invitation. */
  leadLanguage?: string | null;
  tx: Tx;
  errorText: (error: unknown) => string;
  /** After a link went out: the server marked the payer as informed. */
  onSent?: () => void;
}) {
  const [language, setLanguage] = useState<PayerLinkLanguage | null>(null);
  const [reopen, setReopen] = useState(false);
  const [busy, setBusy] = useState<"send" | "revoke" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The question asked before revoking, or before a new link replaces one the payer is filling in.
  const [confirm, setConfirm] = useState<"revoke" | "resend" | null>(null);

  const link = state.link;
  const actions = payerLinkActions(state, reopen, tx);
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
    <div className="space-y-2.5 rounded-lg border border-border/70 bg-background/60 p-3" data-testid="lead-payer-link">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">{tx("Ссылка для плательщика", "Zahler-Link")}</span>
        {status && !actions.cabinet ? (
          <span className="inline-flex" data-testid="lead-payer-link-badge" data-status={link?.status}>
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          </span>
        ) : null}
      </div>

      {actions.cabinet ? (
        <p className="text-xs leading-5 text-muted-foreground" data-testid="lead-payer-link-cabinet">
          {payerLinkCabinetNote(tx)}
        </p>
      ) : (
        <>
          <p className="break-words text-xs leading-5 text-muted-foreground" data-testid="lead-payer-link-status">
            {status ? status.text : tx("Ссылка ещё не отправлялась", "Noch kein Link gesendet")}
          </p>
          {actions.highlight ? (
            <p className="text-xs font-medium leading-5 text-[var(--brand)]" data-testid="lead-payer-link-ready">
              {tx(
                "Пациент отправил заявку: теперь можно отправить ссылку плательщику",
                "Die Anfrage ist eingegangen: Der Zahler-Link kann jetzt gesendet werden",
              )}
            </p>
          ) : null}
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="whitespace-nowrap text-muted-foreground" id={`lead-payer-link-language-${leadId}`}>
                  {tx("Язык письма", "Sprache der E-Mail")}
                </span>
                <div className="flex gap-1" role="group" aria-labelledby={`lead-payer-link-language-${leadId}`}>
                  {PAYER_LINK_LANGUAGES.map((option) => (
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
                  variant={actions.highlight ? "default" : actions.sendKind === "resend" ? "outline" : "default"}
                  className={cn("h-8 rounded-lg", actions.highlight && "ring-2 ring-[var(--brand)]/40 ring-offset-1")}
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
                    className="h-8 rounded-lg text-rose-700"
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
            <p className="text-xs leading-5 text-amber-700 dark:text-amber-300" data-testid="lead-payer-link-blocked">
              {actions.sendBlockedText}
            </p>
          ) : null}
        </>
      )}

      <EstimatedTotalField
        key={state.estimated_total_eur ?? "none"}
        leadId={leadId}
        stored={state.estimated_total_eur}
        canEdit={canEdit}
        disabled={disabled}
        tx={tx}
        save={controller.saveEstimatedTotal}
        errorText={message}
      />

      {error ? <Banner tone="error">{error}</Banner> : null}
      {notice ? (
        <p role="status" className="text-xs text-emerald-700" data-testid="lead-payer-link-notice">
          {notice}
        </p>
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

/**
 * The expected total amount in EUR, saved when the field is left; an empty
 * field clears it. The stored value is the field's start (the parent gives a
 * new key when it changes). Information for staff only: since the owner's
 * rule of 2026-10-07 no amount asks the payer for a proof of funds.
 */
function EstimatedTotalField({
  leadId,
  stored,
  canEdit,
  disabled,
  tx,
  save,
  errorText,
}: {
  leadId: string;
  stored: string | null;
  canEdit: boolean;
  disabled: boolean;
  tx: Tx;
  save: (value: string | null) => Promise<unknown>;
  errorText: (error: unknown) => string;
}) {
  const [value, setValue] = useState(() => estimatedTotalInput(stored));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const id = `lead-payer-estimated-total-${leadId}`;

  async function commit() {
    const parsed = parseEstimatedTotal(value);
    if (parsed === undefined) {
      setError(
        tx(
          "Проверьте сумму: число от 0, не больше двух знаков после запятой",
          "Bitte den Betrag prüfen: eine Zahl ab 0 mit höchstens zwei Nachkommastellen",
        ),
      );
      return;
    }
    setError("");
    if (parsed === stored) {
      setValue(estimatedTotalInput(parsed));
      return;
    }
    setSaving(true);
    try {
      await save(parsed);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1 border-t border-border/60 pt-2.5">
      <label htmlFor={id} className={cn(tokens.text.label, "block")}>
        {tx("Ожидаемая общая сумма, EUR", "Voraussichtlicher Gesamtbetrag, EUR")}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          className={cn(inputClass, "w-full max-w-[12rem]")}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          readOnly={!canEdit}
          disabled={disabled || saving}
          aria-invalid={error ? true : undefined}
          data-testid="lead-payer-estimated-total"
          onChange={(event) => {
            setError("");
            setValue(event.target.value);
          }}
          onBlur={() => {
            if (canEdit) void commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
        {saving ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive" data-testid="lead-payer-estimated-total-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
