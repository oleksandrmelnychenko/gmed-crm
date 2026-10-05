import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle, UserRound } from "lucide-react";

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

import { issueLeadPortalAccess, type LeadPortalAccountIssued } from "../data/leads-api";
import {
  leadPortalStatus,
  leadPortalStatusLabel,
  leadPortalStatusTone,
  patientMessageLanguage,
  portalCredentialsMessage,
  type PatientMessageLanguage,
} from "../model/lead-portal-access";
import { leadErrorMessage } from "../model/leads-model";
import { portalProgressText } from "../model/lead-portal-intake";
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
  const canCreate = status === "none" && Boolean(lead.email);
  const canReset = status !== "none" && status !== "disabled";

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 text-xs" data-testid="lead-portal-access">
      <div className="flex items-center gap-2">
        <UserRound className="size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">{de ? "Patientenportal" : "Портал пациента"}</span>
        <StatusBadge tone={leadPortalStatusTone(status)}>{leadPortalStatusLabel(status, lang)}</StatusBadge>
      </div>
      {status !== "none" ? (
        <>
          <span>
            <span className="text-muted-foreground">{de ? "Letzte Anmeldung: " : "Последний вход: "}</span>
            {lastLogin ? formatAppDateTime(lastLogin) : "—"}
          </span>
          <span>
            <span className="text-muted-foreground">{de ? "Login: " : "Логин: "}</span>
            {lead.email ?? "—"}
          </span>
          {lead.retention_deadline_at && status !== "disabled" ? (
            <span>
              <span className="text-muted-foreground">{de ? "Zugang bis: " : "Доступ до: "}</span>
              {formatAppDate(lead.retention_deadline_at)}
            </span>
          ) : null}
        </>
      ) : (
        <span className="text-muted-foreground">
          {lead.email
            ? de
              ? "Für diesen Lead wurde noch kein Zugang angelegt."
              : "Для этого лида доступ ещё не создан."
            : de
              ? "Ohne E-Mail-Adresse kann kein Zugang angelegt werden."
              : "Без электронной почты доступ создать нельзя."}
        </span>
      )}
      {canIssue && (canCreate || canReset) ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-7 gap-1.5 rounded-md text-xs"
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
      {error ? <p className="w-full text-rose-700">{error}</p> : null}
      {lead.portal_intake && (status !== "none" || lead.portal_intake.guardians > 0) ? (
        <p className="w-full text-muted-foreground" data-testid="lead-portal-progress">
          {portalProgressText(
            { ...lead.portal_intake, submitted_at: lead.portal_intake.submitted_at },
            (ru, deText) => (de ? deText : ru),
            formatAppDateTime,
          ).join(" · ")}
        </p>
      ) : null}
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

      <PortalCredentialsDialog
        credentials={
          issued?.one_time_password
            ? { email: issued.email, password: issued.one_time_password, firstName: lead.first_name }
            : null
        }
        created={issued?.created ?? false}
        lang={lang}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}

/**
 * Shows a one-time password exactly once, with copy actions and a ready text
 * in the patient's language. Closing it discards the password.
 */
export function PortalCredentialsDialog({
  credentials,
  created,
  lang,
  defaultLanguage,
  onClose,
}: {
  credentials: { email: string; password: string; firstName: string } | null;
  created: boolean;
  lang: Lang;
  defaultLanguage?: string | null;
  onClose: () => void;
}) {
  const de = lang === "de";
  const [copied, setCopied] = useState<string | null>(null);
  const [messageLanguage, setMessageLanguage] = useState<PatientMessageLanguage>(
    patientMessageLanguage(defaultLanguage),
  );

  const [copyFailed, setCopyFailed] = useState<string | null>(null);

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

  const loginUrl = typeof window === "undefined" ? "/login" : `${window.location.origin}/login`;
  const message = credentials
    ? portalCredentialsMessage({ ...credentials, loginUrl, language: messageLanguage })
    : "";

  return (
    <Dialog
      open={credentials !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(null);
          setCopyFailed(null);
          onClose();
        }
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
                      aria-pressed={messageLanguage === option.value}
                      className={
                        messageLanguage === option.value
                          ? "rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                          : "rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground"
                      }
                      onClick={() => setMessageLanguage(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <pre className="select-all whitespace-pre-wrap break-words font-sans text-xs text-foreground" data-copy-source="message">{message}</pre>
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
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button">{de ? "Fertig" : "Готово"}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [issued, setIssued] = useState<{ email: string; password: string; created: boolean } | null>(null);
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
          setIssued({ email: result.email, password: result.one_time_password, created: result.created });
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
        credentials={issued ? { email: issued.email, password: issued.password, firstName: "" } : null}
        created={issued?.created ?? false}
        lang={lang}
        onClose={() => setIssued(null)}
      />
    </div>
  );
}
