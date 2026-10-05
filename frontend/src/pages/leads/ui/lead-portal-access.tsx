import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Copy, FileText, KeyRound, LoaderCircle, Mail, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/record-workspace/recipes/status-badge";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import type { Lead } from "@/lib/api/types";
import { copyText, selectElementText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";
import { downloadDocumentFile, fetchDocuments, generateDocument } from "@/pages/documents/data/document-api";

import {
  fetchLeadLoginEmails,
  issueLeadPortalAccess,
  sendLeadLoginEmail,
  type LeadLoginEmailInfo,
  type LeadLoginEmailSent,
  type LeadPortalAccountIssued,
} from "../data/leads-api";
import {
  leadPortalStatus,
  leadPortalStatusLabel,
  leadPortalStatusTone,
  loginEmailErrorMessage,
  patientMessageLanguage,
  portalCredentialsMessage,
  type PatientMessageLanguage,
} from "../model/lead-portal-access";
import { currentGwgSheet, gwgSheetRequest } from "../model/gwg-identification";
import { leadErrorMessage } from "../model/leads-model";
import {
  fetchLeadPortalIntake,
  issueLeadGuardianAccess,
  resetLeadGuardianPassword,
  revokeLeadGuardianAccess,
  type LeadGuardianAccessIssued,
  type LeadPortalIntake,
} from "../data/lead-portal-intake-api";

type Lang = string;

const MESSAGE_LANGUAGES: { value: PatientMessageLanguage; label: string }[] = [
  { value: "de", label: "DE" },
  { value: "en", label: "EN" },
  { value: "uk", label: "UA" },
  { value: "ru", label: "RU" },
];

/** One labelled fact of the portal row: small caption above, value below. */
function PortalFact({
  label,
  className,
  testId,
  children,
}: {
  label: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0", className)} data-testid={testId}>
      <dt className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] font-medium leading-snug text-foreground">{children}</dd>
    </div>
  );
}

/** Expanded row of the leads table: the state of the lead's patient login. */
export function LeadPortalAccessDetail({
  lead,
  lang,
  canIssue,
  onChanged,
}: {
  lead: Lead;
  lang: Lang;
  canIssue: boolean;
  onChanged?: () => void;
}) {
  const de = lang === "de";
  const status = leadPortalStatus(lead.portal_account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issued, setIssued] = useState<LeadPortalAccountIssued | null>(null);

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const result = await issueLeadPortalAccess(lead.id);
      setConfirmOpen(false);
      setIssued(result);
      onChanged?.();
    } catch (nextError) {
      setError(leadErrorMessage(nextError, (ru, de) => (lang === "de" ? de : ru)));
    } finally {
      setBusy(false);
    }
  }

  const lastLogin = lead.portal_account?.last_login_at;
  const intake = lead.portal_intake ?? null;
  const canCreate = status === "none" && Boolean(lead.email);
  const canReset = status !== "none" && status !== "disabled";
  const canOffer = canIssue && (canCreate || canReset);

  // Whether the sign-in data can go out by e-mail, and the lead's language.
  // `undefined` while loading; `null` when the answer could not be read.
  const [emailInfo, setEmailInfo] = useState<LeadLoginEmailInfo | null | undefined>(undefined);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [emailLanguage, setEmailLanguage] = useState<PatientMessageLanguage | null>(null);
  const [emailNotice, setEmailNotice] = useState("");

  useEffect(() => {
    if (!canOffer) return;
    let cancelled = false;
    fetchLeadLoginEmails(lead.id)
      .then((info) => {
        if (!cancelled) setEmailInfo(info);
      })
      .catch(() => {
        if (!cancelled) setEmailInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canOffer, lead.id]);

  const [sheetBusy, setSheetBusy] = useState(false);

  /**
   * The GwG identification sheet of the patient, filled by the server from
   * what the lead entered, as a file. It replaces the current sheet as its
   * next version, so the lead keeps one.
   */
  async function downloadGwgSheet() {
    setSheetBusy(true);
    setError("");
    try {
      const existing = await fetchDocuments(`/documents?lead_id=${encodeURIComponent(lead.id)}`);
      const generated = await generateDocument(
        gwgSheetRequest({
          leadId: lead.id,
          subject: "contract_partner",
          replaceDocumentId: currentGwgSheet(existing, "contract_partner")?.id,
        }),
      );
      await downloadDocumentFile(generated.id, generated.original_filename || generated.auto_name);
    } catch (nextError) {
      setError(leadErrorMessage(nextError, (ru, deText) => (de ? deText : ru)));
    } finally {
      setSheetBusy(false);
    }
  }

  const mailReady = emailInfo?.available === true && emailInfo.can_send === true;
  const language: PatientMessageLanguage = emailLanguage ?? emailInfo?.lead_language ?? "de";

  /**
   * One click instead of "new password, then send": the stored hash cannot be
   * e-mailed, so a new password is issued and goes out at once. If the e-mail
   * fails, the password is already the new one — the usual window shows it.
   */
  async function issueAndEmail() {
    setBusy(true);
    setError("");
    setEmailNotice("");
    let result: LeadPortalAccountIssued | null = null;
    try {
      result = await issueLeadPortalAccess(lead.id);
      if (!result.one_time_password) throw new Error("no password issued");
      const sent = await sendLeadLoginEmail(lead.id, {
        user_id: result.user_id,
        password: result.one_time_password,
        language,
      });
      setEmailConfirmOpen(false);
      setEmailNotice(
        de
          ? `Zugang gesendet an ${sent.sent_to} · ${formatAppDateTime(sent.sent_at)}`
          : `Доступ отправлен на ${sent.sent_to} · ${formatAppDateTime(sent.sent_at)}`,
      );
    } catch (nextError) {
      setEmailConfirmOpen(false);
      const reason =
        loginEmailErrorMessage(nextError, lang)
        ?? leadErrorMessage(nextError, (ru, deText) => (de ? deText : ru));
      if (result?.one_time_password) {
        setIssued(result);
        setError(
          de
            ? `E-Mail nicht gesendet: ${reason}. Das neue Passwort gilt bereits – bitte aus dem Fenster weitergeben oder dort erneut senden.`
            : `Письмо не отправлено: ${reason}. Новый пароль уже действует — передайте его из окна или отправьте оттуда ещё раз.`,
        );
      } else {
        setError(reason);
      }
    } finally {
      setBusy(false);
      if (result) onChanged?.();
    }
  }

  return (
    <div className="space-y-3 px-4 py-3 text-xs" data-testid="lead-portal-access">
      {/* Head line: what this is, its state, and the actions right beside the
          state (the row is as wide as the table, so a button at its far end
          is out of sight). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-foreground">{de ? "Patientenportal" : "Портал пациента"}</span>
          <StatusBadge tone={leadPortalStatusTone(status)}>{leadPortalStatusLabel(status, lang)}</StatusBadge>
        </div>
        {canIssue && (canCreate || canReset) ? (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 rounded-md px-2.5 text-xs"
            disabled={busy}
            onClick={() => (canReset ? setConfirmOpen(true) : void issue())}
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
            {canReset
              ? de
                ? "Neues Passwort"
                : "Новый пароль"
              : de
                ? "Zugang anlegen"
                : "Создать доступ"}
          </Button>
        ) : null}
        {canOffer ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 rounded-md px-2.5 text-xs"
            disabled={busy || emailInfo === undefined}
            onClick={() => {
              setEmailNotice("");
              setEmailConfirmOpen(true);
            }}
            data-testid="lead-portal-send-email"
          >
            <Mail className="size-3.5" />
            {de ? "Zugang per E-Mail senden" : "Отправить доступ на e-mail"}
          </Button>
        ) : null}
        {canIssue ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 rounded-md px-2.5 text-xs"
            disabled={busy || sheetBusy}
            title={de ? "Dokumentationsbogen natürliche Personen (GwG), aus der Anfrage ausgefüllt" : "Лист идентификации по GwG, заполненный из заявки"}
            onClick={() => void downloadGwgSheet()}
            data-testid="lead-gwg-sheet"
          >
            {sheetBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
            Doku-Bogen GwG
          </Button>
        ) : null}
        {emailNotice ? (
          <span className="text-emerald-700" role="status" data-testid="lead-portal-email-notice">
            {emailNotice}
          </span>
        ) : null}
      </div>
      {status !== "none" ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-7">
          <PortalFact label={de ? "Login" : "Логин"} className="col-span-2 sm:col-span-1 xl:col-span-2">
            <span className="break-all">{lead.email ?? "—"}</span>
          </PortalFact>
          <PortalFact label={de ? "Letzte Anmeldung" : "Последний вход"}>
            {lastLogin ? formatAppDateTime(lastLogin) : de ? "noch nie" : "ещё не было"}
          </PortalFact>
          {lead.portal_account?.login_emailed_at ? (
            <PortalFact label={de ? "Zugang per E-Mail" : "Доступ по e-mail"}>
              {formatAppDateTime(lead.portal_account.login_emailed_at)}
            </PortalFact>
          ) : null}
          {lead.retention_deadline_at && status !== "disabled" ? (
            <PortalFact label={de ? "Zugang bis" : "Доступ до"}>{formatAppDate(lead.retention_deadline_at)}</PortalFact>
          ) : null}
          {intake ? (
            <>
              <PortalFact label={de ? "Fragebogen" : "Анкета"} testId="lead-portal-progress">
                {de ? `${intake.filled} von ${intake.total} Feldern` : `${intake.filled} из ${intake.total} полей`}
                <span aria-hidden="true" className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-[var(--brand)]"
                    style={{ width: `${intake.total > 0 ? Math.round((intake.filled / intake.total) * 100) : 0}%` }}
                  />
                </span>
              </PortalFact>
              <PortalFact label={de ? "Dokumente" : "Документы"}>{intake.documents}</PortalFact>
              <PortalFact label={de ? "Gesendet" : "Отправлено"}>
                {intake.submitted_at ? formatAppDateTime(intake.submitted_at) : de ? "noch nicht" : "ещё нет"}
              </PortalFact>
            </>
          ) : null}
        </dl>
      ) : (
        <p className="text-muted-foreground">
          {lead.email
            ? de
              ? "Für diesen Lead wurde noch kein Zugang angelegt."
              : "Для этого лида доступ ещё не создан."
            : de
              ? "Ohne E-Mail-Adresse kann kein Zugang angelegt werden."
              : "Без электронной почты доступ создать нельзя."}
        </p>
      )}
      {error ? <p className="text-rose-700">{error}</p> : null}
      <LeadGuardianAccess lead={lead} lang={lang} canIssue={canIssue} onChanged={onChanged} />

      <Dialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{de ? "Neues Passwort ausgeben?" : "Выдать новый пароль?"}</DialogTitle>
            <DialogDescription>
              {de
                ? "Das bisherige Passwort funktioniert danach nicht mehr, offene Sitzungen des Patienten werden beendet."
                : "Старый пароль перестанет работать, открытые сессии пациента будут завершены."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  {de ? "Abbrechen" : "Отмена"}
                </Button>
              }
            />
            <Button type="button" disabled={busy} onClick={() => void issue()}>
              {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
              {de ? "Passwort ausgeben" : "Выдать пароль"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailConfirmOpen} onOpenChange={(open) => !busy && setEmailConfirmOpen(open)}>
        <DialogContent className="max-w-md" data-testid="lead-portal-email-dialog">
          <DialogHeader>
            <DialogTitle>{de ? "Zugang per E-Mail senden?" : "Отправить доступ на e-mail?"}</DialogTitle>
            <DialogDescription>
              {!mailReady
                ? de
                  ? "Der E-Mail-Versand ist nicht eingerichtet. Mittaro wird unter „API-Verbindungen“ → „E-Mail“ verbunden; bis dahin den Zugang per Nachricht weitergeben."
                  : "Отправка e-mail не настроена. Mittaro подключается в разделе «API-подключения» → «E-Mail»; пока передайте доступ сообщением."
                : canReset
                  ? de
                    ? `Der Patient erhält ein neues Passwort: Das bisherige funktioniert danach nicht mehr, offene Sitzungen des Patienten werden beendet. Die E-Mail mit Anmeldeadresse, Login und Passwort geht an ${lead.email}.`
                    : `Пациент получит новый пароль: старый перестанет работать, открытые сессии пациента будут завершены. Письмо с адресом входа, логином и паролем уйдёт на ${lead.email}.`
                  : de
                    ? `Der Zugang wird angelegt. Die E-Mail mit Anmeldeadresse, Login und Passwort geht an ${lead.email}.`
                    : `Доступ будет создан. Письмо с адресом входа, логином и паролем уйдёт на ${lead.email}.`}
            </DialogDescription>
          </DialogHeader>
          {mailReady ? (
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{de ? "Sprache der E-Mail" : "Язык письма"}</span>
              <div className="flex gap-1" role="group" aria-label={de ? "Sprache der E-Mail" : "Язык письма"}>
                {MESSAGE_LANGUAGES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={language === option.value}
                    className={
                      language === option.value
                        ? "rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                        : "rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
                    }
                    onClick={() => setEmailLanguage(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline" disabled={busy}>
                  {mailReady ? (de ? "Abbrechen" : "Отмена") : de ? "Schließen" : "Закрыть"}
                </Button>
              }
            />
            {mailReady ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void issueAndEmail()}
                data-testid="lead-portal-email-confirm"
              >
                {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : <Mail className="mr-2 size-4" />}
                {canReset
                  ? de
                    ? "Passwort ausgeben und senden"
                    : "Выдать пароль и отправить"
                  : de
                    ? "Zugang anlegen und senden"
                    : "Создать доступ и отправить"}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PortalCredentialsDialog
        credentials={
          issued?.one_time_password
            ? {
                email: issued.email,
                password: issued.one_time_password,
                firstName: lead.first_name,
                leadId: lead.id,
                userId: issued.user_id,
              }
            : null
        }
        created={issued?.created ?? false}
        lang={lang}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}

/** A freshly issued password; `leadId` and `userId` allow sending it by e-mail. */
export type PortalCredentials = {
  email: string;
  password: string;
  firstName: string;
  leadId?: string;
  userId?: string;
};

/**
 * Shows a one-time password exactly once, with copy actions, a ready text in
 * the patient's language and, where Mittaro is set up, "send by e-mail".
 * Closing it discards the password.
 */
export function PortalCredentialsDialog({
  credentials,
  created,
  lang,
  defaultLanguage,
  onClose,
}: {
  credentials: PortalCredentials | null;
  created: boolean;
  lang: Lang;
  defaultLanguage?: string | null;
  onClose: () => void;
}) {
  const de = lang === "de";
  return (
    <Dialog
      open={credentials !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {created
              ? de
                ? "Zugang für den Patienten angelegt"
                : "Доступ для пациента создан"
              : de
                ? "Neues Passwort"
                : "Новый пароль"}
          </DialogTitle>
          <DialogDescription>
            {de
              ? "Das Passwort wird nur jetzt angezeigt. Der Patient meldet sich damit an; geht es verloren, geben Sie hier ein neues aus."
              : "Пароль показывается только сейчас. Пациент входит с ним; если пароль потерян, выдайте здесь новый."}
          </DialogDescription>
        </DialogHeader>
        {credentials ? (
          // A new password starts with a fresh state (language, copy and e-mail status).
          <PortalCredentialsContent
            key={`${credentials.userId ?? credentials.email}:${credentials.password}`}
            credentials={credentials}
            lang={lang}
            defaultLanguage={defaultLanguage}
          />
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button">{de ? "Fertig" : "Готово"}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PortalCredentialsContent({
  credentials,
  lang,
  defaultLanguage,
}: {
  credentials: PortalCredentials;
  lang: Lang;
  defaultLanguage?: string | null;
}) {
  const de = lang === "de";
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const [messageLanguage, setMessageLanguage] = useState<PatientMessageLanguage>(
    patientMessageLanguage(defaultLanguage),
  );
  const [languageChosen, setLanguageChosen] = useState(Boolean(defaultLanguage));
  const [emailInfo, setEmailInfo] = useState<LeadLoginEmailInfo | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSent, setEmailSent] = useState<LeadLoginEmailSent | null>(null);
  const [emailError, setEmailError] = useState("");
  const { leadId, userId } = credentials;

  useEffect(() => {
    if (!leadId || !userId) return;
    let cancelled = false;
    fetchLeadLoginEmails(leadId)
      .then((info) => {
        if (!cancelled) setEmailInfo(info);
      })
      .catch(() => {
        if (!cancelled) setEmailInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId, userId]);

  // Without a language from the caller, the lead's own language applies.
  const language: PatientMessageLanguage =
    !languageChosen && emailInfo?.lead_language ? emailInfo.lead_language : messageLanguage;

  // On failure the text is selected so it can be copied with Ctrl+C.
  async function copy(key: string, text: string, event: { currentTarget: Element }) {
    const dialog = event.currentTarget.closest("[role='dialog']");
    if (await copyText(text, dialog)) {
      setCopied(key);
      setCopyFailed(null);
      return;
    }
    setCopied(null);
    setCopyFailed(key);
    selectElementText(dialog?.querySelector(`[data-copy-source='${key}']`));
  }

  async function sendByEmail() {
    if (!leadId || !userId) return;
    setEmailBusy(true);
    setEmailError("");
    try {
      setEmailSent(
        await sendLeadLoginEmail(leadId, { user_id: userId, password: credentials.password, language }),
      );
    } catch (error) {
      setEmailSent(null);
      setEmailError(
        loginEmailErrorMessage(error, lang)
          ?? leadErrorMessage(error, (ru, deText) => (de ? deText : ru)),
      );
    } finally {
      setEmailBusy(false);
    }
  }

  const loginUrl = typeof window === "undefined" ? "/login" : `${window.location.origin}/login`;
  const message = portalCredentialsMessage({ ...credentials, loginUrl, language });
  const canEmail = Boolean(leadId && userId && emailInfo?.can_send);

  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-[6rem_1fr_auto] items-center gap-x-3 gap-y-2">
        <dt className="text-muted-foreground">{de ? "Login" : "Логин"}</dt>
        <dd className="select-all truncate" data-copy-source="email" data-testid="portal-credentials-email">{credentials.email}</dd>
        <CopyButton copied={copied === "email"} label={de ? "Kopieren" : "Копировать"} onClick={(event) => void copy("email", credentials.email, event)} />
        <dt className="text-muted-foreground">{de ? "Passwort" : "Пароль"}</dt>
        <dd className="select-all font-mono" data-copy-source="password" data-testid="portal-credentials-password">{credentials.password}</dd>
        <CopyButton copied={copied === "password"} label={de ? "Kopieren" : "Копировать"} onClick={(event) => void copy("password", credentials.password, event)} />
      </dl>
      <div className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {de ? "Nachricht an den Patienten" : "Сообщение для пациента"}
          </span>
          <div className="flex gap-1" role="group" aria-label={de ? "Sprache" : "Язык"}>
            {MESSAGE_LANGUAGES.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={language === option.value}
                className={
                  language === option.value
                    ? "rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                    : "rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
                }
                onClick={() => {
                  setMessageLanguage(option.value);
                  setLanguageChosen(true);
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <pre className="select-all whitespace-pre-wrap break-words font-sans text-xs text-foreground" data-copy-source="message">{message}</pre>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 rounded-md text-xs"
            onClick={(event) => void copy("message", message, event)}
          >
            {copied === "message" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {de ? "Nachricht kopieren" : "Скопировать сообщение"}
          </Button>
          {canEmail && emailInfo?.available ? (
            <Button
              type="button"
              size="sm"
              className="h-7 gap-1.5 rounded-md text-xs"
              disabled={emailBusy}
              onClick={() => void sendByEmail()}
              data-testid="portal-credentials-send-email"
            >
              {emailBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />}
              {de ? `An ${credentials.email} senden` : `Отправить на ${credentials.email}`}
            </Button>
          ) : null}
        </div>
        {canEmail && emailInfo && !emailInfo.available ? (
          <p className="text-xs text-muted-foreground">
            {de
              ? "Der E-Mail-Versand (Mittaro) ist nicht eingerichtet – Zugang bitte per Nachricht weitergeben."
              : "Отправка e-mail (Mittaro) не настроена — передайте доступ сообщением."}
          </p>
        ) : null}
        <p className="text-xs empty:hidden" role="status" aria-live="polite" data-testid="portal-credentials-email-status">
          {emailSent ? (
            <span className="text-emerald-700">
              {emailSent.replayed
                ? de
                  ? `Diese E-Mail wurde bereits an ${emailSent.sent_to} gesendet – kein zweites Mal.`
                  : `Это письмо уже было отправлено на ${emailSent.sent_to} — повторно не отправляем.`
                : de
                  ? `Gesendet an ${emailSent.sent_to} · ${formatAppDateTime(emailSent.sent_at)}`
                  : `Отправлено на ${emailSent.sent_to} · ${formatAppDateTime(emailSent.sent_at)}`}
            </span>
          ) : emailError ? (
            <span className="text-rose-700">{emailError}</span>
          ) : null}
        </p>
      </div>
      <p className="min-h-4 text-xs" role="status" aria-live="polite">
        {copied ? (
          <span className="text-emerald-700">{de ? "Kopiert" : "Скопировано"}</span>
        ) : copyFailed ? (
          <span className="text-amber-700">
            {de
              ? "Kopieren hat der Browser blockiert – Text ist markiert, mit Strg+C kopieren"
              : "Браузер не дал скопировать — текст выделен, скопируйте его через Ctrl+C"}
          </span>
        ) : null}
      </p>
    </div>
  );
}

function CopyButton({
  copied,
  label,
  onClick,
}: {
  copied: boolean;
  label: string;
  onClick: (event: { currentTarget: Element }) => void;
}) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={label} onClick={onClick}>
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

/**
 * Parents' logins for a minor's request (owner decision 2026-10-03: a minor
 * has no own login). CEO and patient managers issue, renew or revoke them
 * for a trusted contact with relation parent / guardian and an e-mail.
 */
export function LeadGuardianAccess({
  lead,
  lang,
  canIssue,
  onChanged,
}: {
  lead: Lead;
  lang: Lang;
  canIssue: boolean;
  onChanged?: () => void;
}) {
  const de = lang === "de";
  const tx = (ru: string, deText: string) => (de ? deText : ru);
  const [intake, setIntake] = useState<LeadPortalIntake | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<{ email: string; password: string; created: boolean; userId: string } | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setIntake(await fetchLeadPortalIntake(lead.id));
    } catch {
      setIntake(null);
    }
  }, [lead.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<LeadGuardianAccessIssued | { login_deactivated: boolean }>) {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if ("one_time_password" in result) {
        if (result.one_time_password) {
          setIssued({
            email: result.email,
            password: result.one_time_password,
            created: result.created,
            userId: result.user_id,
          });
        } else if (result.reused) {
          setNotice(tx(
            "У родителя уже есть вход: он войдёт со своим паролем и увидит эту заявку.",
            "Der Elternteil hat bereits einen Zugang: Er meldet sich mit seinem Passwort an und sieht diese Anfrage.",
          ));
        }
      }
      await load();
      onChanged?.();
    } catch (nextError) {
      setError(leadErrorMessage(nextError, tx));
    } finally {
      setBusy(null);
    }
  }

  const links = intake?.guardians.links.filter((link) => !link.revoked_at) ?? [];
  const candidates = intake?.guardians.candidates.filter((candidate) => !candidate.access_id) ?? [];
  if (!intake || (!intake.minor && links.length === 0)) return null;

  return (
    <div className="w-full space-y-1.5 border-t border-border/60 pt-2" data-testid="lead-guardian-access">
      <p className="font-medium text-foreground">
        {tx("Доступ родителей (несовершеннолетний)", "Zugang der Eltern (minderjährig)")}
      </p>
      {links.map((link) => (
        <div key={link.access_id} className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            {link.name ?? "—"} <span className="text-muted-foreground">{link.email ?? ""}</span>
          </span>
          <span className="text-muted-foreground">
            {tx("Последний вход: ", "Letzte Anmeldung: ")}
            {link.last_login_at ? formatAppDateTime(link.last_login_at) : "—"}
          </span>
          {canIssue ? (
            <span className="ml-auto flex gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-md text-xs"
                disabled={busy !== null}
                onClick={() => void run(`reset-${link.access_id}`, () => resetLeadGuardianPassword(lead.id, link.access_id))}
              >
                <KeyRound className="size-3.5" />
                {tx("Новый пароль", "Neues Passwort")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 rounded-md text-xs text-rose-700"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(tx("Отозвать доступ родителя к этой заявке?", "Zugang des Elternteils zu dieser Anfrage widerrufen?"))) return;
                  void run(`revoke-${link.access_id}`, () => revokeLeadGuardianAccess(lead.id, link.access_id));
                }}
              >
                {tx("Отозвать", "Widerrufen")}
              </Button>
            </span>
          ) : null}
        </div>
      ))}
      {candidates.map((candidate) => {
        const contactId = candidate.trusted_contact_id;
        return (
          <div key={contactId ?? candidate.name ?? ""} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              {candidate.name ?? "—"}{" "}
              <span className="text-muted-foreground">
                {[candidate.relation, candidate.email ?? tx("нет e-mail", "keine E-Mail")].filter(Boolean).join(" · ")}
              </span>
            </span>
            {canIssue && contactId && candidate.email ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto h-7 gap-1.5 rounded-md text-xs"
                disabled={busy !== null}
                onClick={() => void run(`issue-${contactId}`, () => issueLeadGuardianAccess(lead.id, contactId))}
              >
                {busy === `issue-${contactId}` ? <LoaderCircle className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                {tx("Выдать доступ", "Zugang anlegen")}
              </Button>
            ) : null}
          </div>
        );
      })}
      {links.length === 0 && candidates.length === 0 ? (
        <p className="text-muted-foreground">
          {tx(
            "Добавьте в шаге «Данные клиента» мать, отца или законного представителя с e-mail.",
            "Unter „Personendaten“ Mutter, Vater oder gesetzlichen Vertreter mit E-Mail ergänzen.",
          )}
        </p>
      ) : null}
      {notice ? <p className="text-emerald-700">{notice}</p> : null}
      {error ? <p className="text-rose-700">{error}</p> : null}
      <PortalCredentialsDialog
        credentials={
          issued
            ? { email: issued.email, password: issued.password, firstName: "", leadId: lead.id, userId: issued.userId }
            : null
        }
        created={issued?.created ?? false}
        lang={lang}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}
