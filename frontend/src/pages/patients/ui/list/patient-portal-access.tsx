import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, Mail } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { EmailDomainWarning } from "@/components/email-domain-warning";
import { StatusChip } from "@/components/ui/status-chip";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { cn } from "@/lib/utils";
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
import { isMinor } from "@/pages/leads/model/lead-wizard.model";
import { LoginEmailFact, PortalCredentialsDialog, PortalFact } from "@/pages/leads/ui/lead-portal-access";

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
  const minor = isMinor(patient.birth_date ?? "", new Date());
  const canCreate = !minor && status === "none" && Boolean(patient.email);
  const canReset = !minor && status !== "none" && status !== "disabled";
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
      if (result.reused) setEmailNotice(de ? "Bestehender Elternzugang verknüpft. Passwort und Zugang zu den Kindern bleiben erhalten." : "Подключён существующий аккаунт родителя. Пароль и доступ к детям сохранены.");
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
      if (result.reused) {
        setEmailConfirmOpen(false);
        setEmailNotice(de ? "Bestehender Elternzugang verknüpft. Das bisherige Passwort gilt weiterhin; es wurde keine E-Mail versendet." : "Подключён существующий аккаунт родителя. Прежний пароль действует; письмо с новым паролем не отправлялось.");
        return;
      }
      if (!result.one_time_password) throw new Error("no password issued");
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

  const subscription = patient.subscription ?? null;

  return (
    <div className="@container space-y-4 border-y border-l-2 border-border border-l-primary bg-muted px-4 py-4 text-xs" data-testid="patient-portal-access">
      <div className="grid items-center gap-3 @[52rem]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <AdminSectionTitle>{de ? "Patientenportal" : "Портал пациента"}</AdminSectionTitle>
          <StatusChip tone={minor ? "neutral" : leadPortalStatusTone(status)}>{minor
            ? de ? "Über Eltern / gesetzliche Vertretung" : "Через родителя / представителя"
            : leadPortalStatusLabel(status, lang)}</StatusChip>
        </div>
        <div className="grid w-full grid-cols-1 items-stretch gap-2 @[26rem]:grid-cols-[9rem_minmax(0,14rem)] @[52rem]:w-auto" role="group" aria-label={de ? "Portalaktionen" : "Действия с порталом"}>
        {canOffer ? (
          <Button
            type="button"
            variant={canReset ? "outline" : "default"}
            size="sm"
            className={cn("h-auto min-h-8 max-w-full gap-1.5 whitespace-normal rounded-lg px-2.5 py-1.5 text-xs shadow-xs", canReset && "border-foreground/20 bg-card hover:bg-accent")}
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
            variant={canReset ? "default" : "outline"}
            size="sm"
            className={cn("h-auto min-h-8 max-w-full gap-1.5 whitespace-normal rounded-lg px-2.5 py-1.5 text-xs shadow-xs", !canReset && "border-foreground/20 bg-card hover:bg-accent")}
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
        </div>
      </div>
      {emailNotice ? (
          <span className="text-emerald-700" role="status" data-testid="patient-portal-email-notice">
            {emailNotice}
          </span>
        ) : null}
      <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] [&>div]:rounded-lg [&>div]:border [&>div]:border-border [&>div]:bg-card [&>div]:p-3">
        <PortalFact label={de ? "Kontotyp" : "Тип аккаунта"} testId="patient-account-type">
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
            <PortalFact label={de ? "Login" : "Логин"}>
              <span className="break-all">{loginEmail ?? "—"}</span>
              <EmailDomainWarning email={loginEmail} lang={lang} className="mt-1" />
            </PortalFact>
            <PortalFact label={de ? "Letzte Anmeldung" : "Последний вход"}>
              {account?.last_login_at ? formatAppDateTime(account.last_login_at) : de ? "noch nie" : "ещё не было"}
            </PortalFact>
            <LoginEmailFact emailedAt={account?.login_emailed_at} delivery={account?.login_email_delivery} lang={lang} />
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
      {status === "none" && !minor ? (
        <EmailDomainWarning email={patient.email} lang={lang} />
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
          issued?.one_time_password
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
