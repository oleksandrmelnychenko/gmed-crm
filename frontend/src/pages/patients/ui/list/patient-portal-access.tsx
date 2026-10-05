import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, Mail, UserRound } from "lucide-react";

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
import {
  fetchPortalLoginEmails,
  sendPortalLoginEmail,
  type LeadLoginEmailInfo,
} from "@/pages/leads/data/leads-api";
import {
  leadPortalStatus,
  leadPortalStatusLabel,
  leadPortalStatusTone,
  loginEmailErrorMessage,
  type PatientMessageLanguage,
} from "@/pages/leads/model/lead-portal-access";
import { leadErrorMessage } from "@/pages/leads/model/leads-model";
import { PortalCredentialsDialog, PortalFact } from "@/pages/leads/ui/lead-portal-access";

import {
  issuePatientPortalAccess,
  type PatientPortalAccessIssued,
} from "../../data/patient-portal-access-api";
import {
  subscriptionKindLabel,
  type PatientSubscriptionSummary,
  type PatientSummary,
} from "../../model/list-model";

type Lang = string;

const MESSAGE_LANGUAGES: { value: PatientMessageLanguage; label: string }[] = [
  { value: "de", label: "DE" },
  { value: "en", label: "EN" },
  { value: "uk", label: "UA" },
  { value: "ru", label: "RU" },
];

function subscriptionPeriod(subscription: PatientSubscriptionSummary, de: boolean): string {
  const status =
    subscription.status === "paused"
      ? de ? "pausiert" : "приостановлен"
      : subscription.status === "draft"
        ? de ? "Entwurf" : "черновик"
        : de ? "aktiv" : "активен";
  if (subscription.ends_on) {
    return `${status} · ${de ? "bis" : "до"} ${formatAppDate(subscription.ends_on)}`;
  }
  if (subscription.starts_on) {
    return `${status} · ${de ? "seit" : "с"} ${formatAppDate(subscription.starts_on)}`;
  }
  return status;
}

/**
 * Expanded row of the patients table: the patient's portal login and account
 * type (owner request 2026-10-05: the login row of the leads table, without
 * the GwG sheet, plus the subscription chosen in an order).
 */
export function PatientPortalAccessDetail({
  patient,
  lang,
  canIssue,
  onChanged,
}: {
  patient: PatientSummary;
  lang: Lang;
  canIssue: boolean;
  onChanged?: () => void;
}) {
  const de = lang === "de";
  const account = patient.portal_account ?? null;
  const status = leadPortalStatus(account);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [issued, setIssued] = useState<PatientPortalAccessIssued | null>(null);
  const [emailInfo, setEmailInfo] = useState<LeadLoginEmailInfo | null | undefined>(undefined);
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);
  const [emailLanguage, setEmailLanguage] = useState<PatientMessageLanguage | null>(null);
  const [emailNotice, setEmailNotice] = useState("");

  const loginEmail = account?.email ?? patient.email ?? null;
  const canCreate = status === "none" && Boolean(patient.email);
  const canReset = status !== "none" && status !== "disabled";
  const canOffer = canIssue && (canCreate || canReset);
  const errorText = (nextError: unknown) =>
    loginEmailErrorMessage(nextError, lang)
    ?? leadErrorMessage(nextError, (ru, deText) => (de ? deText : ru));

  useEffect(() => {
    if (!canOffer) return;
    let cancelled = false;
    fetchPortalLoginEmails({ kind: "patient", id: patient.id })
      .then((info) => {
        if (!cancelled) setEmailInfo(info);
      })
      .catch(() => {
        if (!cancelled) setEmailInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canOffer, patient.id]);

  const mailReady = emailInfo?.available === true && emailInfo.can_send === true;
  const language: PatientMessageLanguage =
    emailLanguage ?? emailInfo?.default_language ?? emailInfo?.lead_language ?? "de";

  async function issue() {
    setBusy(true);
    setError("");
    try {
      const result = await issuePatientPortalAccess(patient.id);
      setConfirmOpen(false);
      setIssued(result);
      onChanged?.();
    } catch (nextError) {
      setError(errorText(nextError));
    } finally {
      setBusy(false);
    }
  }

  /** New password and e-mail in one step: the stored hash cannot be sent. */
  async function issueAndEmail() {
    setBusy(true);
    setError("");
    setEmailNotice("");
    let result: PatientPortalAccessIssued | null = null;
    try {
      result = await issuePatientPortalAccess(patient.id);
      const sent = await sendPortalLoginEmail(
        { kind: "patient", id: patient.id },
        { user_id: result.user_id, password: result.one_time_password, language },
      );
      setEmailConfirmOpen(false);
      setEmailNotice(
        de
          ? `Zugang gesendet an ${sent.sent_to} · ${formatAppDateTime(sent.sent_at)}`
          : `Доступ отправлен на ${sent.sent_to} · ${formatAppDateTime(sent.sent_at)}`,
      );
    } catch (nextError) {
      setEmailConfirmOpen(false);
      const reason = errorText(nextError);
      if (result) {
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

  const subscription = patient.subscription ?? null;

  return (
    <div className="space-y-3 px-4 py-3 text-xs" data-testid="patient-portal-access">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <UserRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-foreground">{de ? "Patientenportal" : "Портал пациента"}</span>
          <StatusBadge tone={leadPortalStatusTone(status)}>{leadPortalStatusLabel(status, lang)}</StatusBadge>
        </div>
        {canOffer ? (
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1.5 rounded-md px-2.5 text-xs"
            disabled={busy}
            onClick={() => (canReset ? setConfirmOpen(true) : void issue())}
            data-testid="patient-portal-issue"
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
            {canReset ? (de ? "Neues Passwort" : "Новый пароль") : de ? "Zugang anlegen" : "Создать доступ"}
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
            data-testid="patient-portal-send-email"
          >
            <Mail className="size-3.5" />
            {de ? "Zugang per E-Mail senden" : "Отправить доступ на e-mail"}
          </Button>
        ) : null}
        {emailNotice ? (
          <span className="text-emerald-700" role="status" data-testid="patient-portal-email-notice">
            {emailNotice}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 xl:grid-cols-6">
        <PortalFact label={de ? "Kontotyp" : "Тип аккаунта"} className="col-span-2 sm:col-span-1 xl:col-span-2" testId="patient-account-type">
          {subscription ? (
            <>
              <span className="block">{subscriptionKindLabel(subscription, lang)}</span>
              <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                {[subscription.name, subscriptionPeriod(subscription, de)].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">{de ? "Ohne Abonnement" : "Без подписки"}</span>
          )}
        </PortalFact>
        {status !== "none" ? (
          <>
            <PortalFact label={de ? "Login" : "Логин"} className="col-span-2 sm:col-span-1 xl:col-span-2">
              <span className="break-all">{loginEmail ?? "—"}</span>
            </PortalFact>
            <PortalFact label={de ? "Letzte Anmeldung" : "Последний вход"}>
              {account?.last_login_at ? formatAppDateTime(account.last_login_at) : de ? "noch nie" : "ещё не было"}
            </PortalFact>
            {account?.login_emailed_at ? (
              <PortalFact label={de ? "Zugang per E-Mail" : "Доступ по e-mail"}>
                {formatAppDateTime(account.login_emailed_at)}
              </PortalFact>
            ) : null}
          </>
        ) : null}
      </dl>
      {status === "none" ? (
        <p className="text-muted-foreground">
          {patient.email
            ? de
              ? "Für diesen Patienten wurde noch kein Zugang angelegt."
              : "Для этого пациента доступ ещё не создан."
            : de
              ? "Ohne E-Mail-Adresse kann kein Zugang angelegt werden."
              : "Без электронной почты доступ создать нельзя."}
        </p>
      ) : null}
      {error ? <p className="text-rose-700">{error}</p> : null}

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
        <DialogContent className="max-w-md" data-testid="patient-portal-email-dialog">
          <DialogHeader>
            <DialogTitle>{de ? "Zugang per E-Mail senden?" : "Отправить доступ на e-mail?"}</DialogTitle>
            <DialogDescription>
              {!mailReady
                ? de
                  ? "Der E-Mail-Versand ist nicht eingerichtet. Mittaro wird unter „API-Verbindungen“ → „E-Mail“ verbunden; bis dahin den Zugang per Nachricht weitergeben."
                  : "Отправка e-mail не настроена. Mittaro подключается в разделе «API-подключения» → «E-Mail»; пока передайте доступ сообщением."
                : canReset
                  ? de
                    ? `Der Patient erhält ein neues Passwort: Das bisherige funktioniert danach nicht mehr, offene Sitzungen des Patienten werden beendet. Die E-Mail mit Anmeldeadresse, Login und Passwort geht an ${loginEmail}.`
                    : `Пациент получит новый пароль: старый перестанет работать, открытые сессии пациента будут завершены. Письмо с адресом входа, логином и паролем уйдёт на ${loginEmail}.`
                  : de
                    ? `Der Zugang wird angelegt. Die E-Mail mit Anmeldeadresse, Login und Passwort geht an ${loginEmail}.`
                    : `Доступ будет создан. Письмо с адресом входа, логином и паролем уйдёт на ${loginEmail}.`}
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
                data-testid="patient-portal-email-confirm"
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
          issued
            ? {
                email: issued.email ?? loginEmail ?? "",
                password: issued.one_time_password,
                firstName: patient.first_name ?? "",
                patientId: patient.id,
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
