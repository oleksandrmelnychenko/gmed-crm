import { useState } from "react";
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

      <Dialog open={confirmOpen} onOpenChange={(open) => !busy && setConfirmOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{de ? "Neues Einmalpasswort ausgeben?" : "Выдать новый одноразовый пароль?"}</DialogTitle>
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

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      setCopied(null);
    }
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
                ? "Neues Einmalpasswort"
                : "Новый одноразовый пароль"}
          </DialogTitle>
          <DialogDescription>
            {de
              ? "Das Passwort wird nur jetzt angezeigt. Bei der ersten Anmeldung legt der Patient ein eigenes fest."
              : "Пароль показывается только сейчас. При первом входе пациент задаст свой."}
          </DialogDescription>
        </DialogHeader>
        {credentials ? (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-[6rem_1fr_auto] items-center gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">{de ? "Login" : "Логин"}</dt>
              <dd className="truncate" data-testid="portal-credentials-email">{credentials.email}</dd>
              <CopyButton copied={copied === "email"} label={de ? "Kopieren" : "Копировать"} onClick={() => void copy("email", credentials.email)} />
              <dt className="text-muted-foreground">{de ? "Passwort" : "Пароль"}</dt>
              <dd className="font-mono" data-testid="portal-credentials-password">{credentials.password}</dd>
              <CopyButton copied={copied === "password"} label={de ? "Kopieren" : "Копировать"} onClick={() => void copy("password", credentials.password)} />
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
              <pre className="whitespace-pre-wrap break-words font-sans text-xs text-foreground">{message}</pre>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 rounded-md text-xs"
                onClick={() => void copy("message", message)}
              >
                {copied === "message" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {de ? "Nachricht kopieren" : "Скопировать сообщение"}
              </Button>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button type="button">{de ? "Fertig" : "Готово"}</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ copied, label, onClick }: { copied: boolean; label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={label} onClick={onClick}>
      {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />}
    </Button>
  );
}
