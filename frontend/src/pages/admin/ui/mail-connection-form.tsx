import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ExternalLink, KeyRound, LoaderCircle, Mail, Pencil, Send } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  disconnectMailConnection,
  fetchMailConnection,
  saveMailConnection,
  sendMailConnectionTest,
  type MailConnection,
} from "../data/mail-connection-api";

const MITTARO_APP = "https://app.mittaro.de/";
const MITTARO_DOCS = "https://mittaro.de/dokumentation";

const ERRORS: Record<string, [ru: string, de: string]> = {
  mail_api_key_required: ["Введите API-ключ Mittaro.", "Bitte den Mittaro-API-Schlüssel eingeben."],
  mail_api_key_invalid: [
    "Ключ Mittaro начинается с tx_live_ или tx_test_.",
    "Ein Mittaro-Schlüssel beginnt mit tx_live_ oder tx_test_.",
  ],
  mail_sender_invalid: ["Укажите адрес отправителя.", "Bitte eine Absenderadresse angeben."],
  mail_reply_to_invalid: ["Адрес для ответов указан неверно.", "Die Antwortadresse ist ungültig."],
  mail_test_recipient_invalid: ["Укажите адрес получателя.", "Bitte eine Empfängeradresse angeben."],
  mail_not_configured: ["Отправка e-mail не настроена.", "Der E-Mail-Versand ist nicht eingerichtet."],
  mail_rejected: [
    "Mittaro отклонил ключ или домен отправителя. Проверьте ключ и подтверждение домена в Mittaro.",
    "Mittaro hat den Schlüssel oder die Absenderdomain abgelehnt. Bitte Schlüssel und Domainbestätigung bei Mittaro prüfen.",
  ],
  mail_invalid_message: [
    "Mittaro не принял письмо. Проверьте адрес отправителя.",
    "Mittaro hat die E-Mail nicht angenommen. Bitte die Absenderadresse prüfen.",
  ],
  mail_quota_reached: [
    "Лимит писем Mittaro исчерпан. Повторите позже.",
    "Das E-Mail-Kontingent bei Mittaro ist ausgeschöpft. Bitte später erneut versuchen.",
  ],
  mail_unavailable: [
    "Mittaro временно недоступен. Повторите попытку.",
    "Mittaro ist vorübergehend nicht erreichbar. Bitte erneut versuchen.",
  ],
};

function errorCode(reason: unknown): string | null {
  if (!(reason instanceof ApiRequestError)) return null;
  const body = reason.body as Record<string, unknown> | null | undefined;
  return typeof body?.code === "string" ? body.code : null;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card" data-testid="mail-connection">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <AdminSectionTitle>{title}</AdminSectionTitle>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The Mittaro e-mail connection on the API connections page: key, sender and
 * reply-to (the key is stored encrypted and never shown again) and a test
 * letter. A connection saved here takes precedence over the server
 * configuration.
 */
export function MailConnectionForm({ canConfigure }: { canConfigure: boolean }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [connection, setConnection] = useState<MailConnection | null>(null);
  const [loading, setLoading] = useState(canConfigure);
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [sender, setSender] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);

  useEffect(() => {
    if (!canConfigure) return;
    let cancelled = false;
    void fetchMailConnection()
      .then((value) => {
        if (cancelled) return;
        setConnection(value);
        setSender(value.sender ?? "");
        setReplyTo(value.reply_to ?? "");
      })
      .catch(() => {
        // Discovery is best-effort; errors are shown for explicit actions.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canConfigure]);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (reason) {
      const message = ERRORS[errorCode(reason) ?? ""];
      setError(message
        ? tx(message[0], message[1])
        : tx("Не удалось выполнить действие. Повторите попытку.", "Aktion fehlgeschlagen. Bitte erneut versuchen."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function apply(next: MailConnection) {
    setConnection(next);
    setSender(next.sender ?? "");
    setReplyTo(next.reply_to ?? "");
    setApiKey("");
  }

  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      apply(await saveMailConnection({ api_key: apiKey, sender, reply_to: replyTo }));
      setEditing(false);
      setNotice(tx(
        "Подключение сохранено. Отправьте тестовое письмо, чтобы проверить ключ и домен.",
        "Verbindung gespeichert. Senden Sie eine Test-E-Mail, um Schlüssel und Domain zu prüfen.",
      ));
    });
  }

  function sendTest() {
    void run(async () => {
      const sent = await sendMailConnectionTest({ to: testTo, language: lang === "de" ? "de" : "ru" });
      setNotice(tx(`Тестовое письмо отправлено на ${sent.sent_to}.`, `Test-E-Mail an ${sent.sent_to} gesendet.`));
    });
  }

  function disconnect() {
    void run(async () => {
      apply(await disconnectMailConnection());
      setEditing(false);
      setNotice(tx("Отправка e-mail отключена.", "E-Mail-Versand getrennt."));
    });
  }

  const feedback = (
    <>
      {notice ? (
        <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
  const mittaroLink = (
    <a href={MITTARO_APP} target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 shrink-0 rounded-md")}>
      {tx("Кабинет Mittaro", "Mittaro-Konto öffnen")}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
  const title = tx("Подключение Mittaro", "Mittaro-Verbindung");
  const savedKey = connection?.source === "database";

  if (!canConfigure) {
    return (
      <p className="rounded-lg border border-border/70 bg-muted/20 px-3.5 py-3 text-xs leading-5 text-muted-foreground">
        {tx("Отправку e-mail настраивает администратор.", "Den E-Mail-Versand richtet die Administration ein.")}
      </p>
    );
  }
  if (loading) {
    return (
      <Section title={title}>
        <p role="status" className="flex items-center gap-2 p-3.5 text-xs text-muted-foreground">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {tx("Загрузка подключения…", "Verbindung wird geladen…")}
        </p>
      </Section>
    );
  }

  if (connection?.configured && !editing) {
    return (
      <Section
        title={title}
        action={
          <Badge variant="outline" className="gap-1 rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <Check aria-hidden="true" className="size-3" />
            {tx("Подключено", "Verbunden")}
          </Badge>
        }
      >
        <div className="space-y-4 p-3.5">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <Mail aria-hidden="true" className="size-5" />
            </span>
            <p className="min-w-0 text-sm font-medium">
              {tx("Письма отправляются через Mittaro", "E-Mails werden über Mittaro versendet")}
            </p>
          </div>
          <dl className="grid min-w-0 gap-x-5 gap-y-3 rounded-md border border-border/60 bg-muted/20 p-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">{tx("Отправитель", "Absender")}</dt>
              <dd className="break-all text-sm font-medium" data-testid="mail-connection-sender">{connection.sender ?? "—"}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">{tx("Ответы на адрес", "Antworten an")}</dt>
              <dd className="break-all text-sm font-medium">{connection.reply_to ?? tx("как отправитель", "wie Absender")}</dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">{tx("API-ключ", "API-Schlüssel")}</dt>
              <dd className="flex items-center gap-1.5 text-xs">
                <KeyRound aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="font-mono">{connection.key_hint ?? ""}</span>
                <span className="text-muted-foreground">
                  · {tx("сохранён, повторный ввод не нужен", "gespeichert, keine erneute Eingabe nötig")}
                </span>
              </dd>
            </div>
            <div className="min-w-0 space-y-1">
              <dt className="text-xs text-muted-foreground">{tx("Ссылки в письмах", "Links in E-Mails")}</dt>
              <dd className="break-all font-mono text-xs leading-5">{connection.console_url ?? "—"}</dd>
            </div>
          </dl>
          <div className="grid min-w-0 gap-2 rounded-md border border-border/60 p-3">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              <span>{tx("Тестовое письмо на адрес", "Test-E-Mail an")}</span>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                <Input
                  className="h-9 min-w-0 flex-1 bg-field font-normal"
                  type="email"
                  autoComplete="email"
                  value={testTo}
                  placeholder={tx("Пусто — на ваш адрес", "Leer – an Ihre Adresse")}
                  onChange={(event) => setTestTo(event.target.value)}
                />
                <Button type="button" size="sm" className="h-9 shrink-0 rounded-md" disabled={busy} onClick={sendTest} data-testid="mail-connection-test">
                  {busy ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <Send aria-hidden="true" className="size-3.5" />}
                  {tx("Отправить тестовое письмо", "Test-E-Mail senden")}
                </Button>
              </div>
            </label>
          </div>
          {feedback}
        </div>
        <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-3 sm:flex-row sm:flex-wrap sm:items-center">
          {mittaroLink}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-md sm:ml-auto"
            disabled={busy}
            onClick={() => {
              setNotice("");
              setError("");
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            {tx("Изменить подключение", "Verbindung ändern")}
          </Button>
        </div>
      </Section>
    );
  }

  return (
    <form onSubmit={save}>
      <Section title={connection?.configured ? tx("Изменить подключение", "Verbindung ändern") : title}>
        <div className="space-y-3 p-3.5">
          <p className="text-xs leading-5 text-muted-foreground">
            {connection?.source === "disconnected"
              ? tx("Отправка e-mail отключена. Введите ключ, чтобы подключить снова.", "Der E-Mail-Versand ist getrennt. Geben Sie einen Schlüssel ein, um ihn wieder zu verbinden.")
              : tx(
                  "Письма из системы (например, вход для лида) отправляются через Mittaro — сервис с серверами в Германии, без трекинга. Создайте API-ключ в кабинете Mittaro и подтвердите там домен отправителя.",
                  "E-Mails aus dem System (z. B. der Zugang für einen Lead) werden über Mittaro versendet – Server in Deutschland, ohne Tracking. Erstellen Sie im Mittaro-Konto einen API-Schlüssel und bestätigen Sie dort die Absenderdomain.",
                )}{" "}
            <a href={MITTARO_DOCS} target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">
              {tx("Документация", "Dokumentation")}
            </a>
          </p>
          <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
              <span>{tx("API-ключ", "API-Schlüssel")}</span>
              <Input
                className="h-9 bg-field font-normal"
                type="password"
                autoComplete="new-password"
                maxLength={512}
                value={apiKey}
                required={!savedKey}
                placeholder={savedKey ? tx(`Сохранён (${connection?.key_hint ?? ""}) — пусто, чтобы оставить`, `Gespeichert (${connection?.key_hint ?? ""}) – leer lassen, um ihn zu behalten`) : "tx_live_…"}
                onChange={(event) => setApiKey(event.target.value)}
                data-testid="mail-connection-key"
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              <span>{tx("Отправитель", "Absender")}</span>
              <Input
                className="h-9 bg-field font-normal"
                type="email"
                autoComplete="off"
                maxLength={320}
                value={sender}
                required
                placeholder="zugang@gmed-health.com"
                onChange={(event) => setSender(event.target.value)}
                data-testid="mail-connection-sender-input"
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              <span>{tx("Ответы на адрес (необязательно)", "Antworten an (optional)")}</span>
              <Input
                className="h-9 bg-field font-normal"
                type="email"
                autoComplete="off"
                maxLength={320}
                value={replyTo}
                placeholder="info@gmed-health.com"
                onChange={(event) => setReplyTo(event.target.value)}
              />
            </label>
            <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
              {tx(
                "Ключ сохраняется в зашифрованном виде и больше не показывается.",
                "Der Schlüssel wird verschlüsselt gespeichert und nicht mehr angezeigt.",
              )}
            </p>
          </fieldset>
          {feedback}
        </div>
        <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
          {connection?.configured ? (
            <>
              <Button type="button" variant="ghost" size="sm" className="h-8 rounded-md text-destructive hover:text-destructive sm:mr-auto" disabled={busy} onClick={disconnect}>
                {tx("Отключить", "Verbindung trennen")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-md"
                disabled={busy}
                onClick={() => {
                  setApiKey("");
                  setSender(connection.sender ?? "");
                  setReplyTo(connection.reply_to ?? "");
                  setError("");
                  setEditing(false);
                }}
              >
                {tx("Отменить изменения", "Änderungen verwerfen")}
              </Button>
            </>
          ) : (
            <span className="sm:mr-auto">{mittaroLink}</span>
          )}
          <Button type="submit" size="sm" className="h-9 rounded-md sm:h-8" disabled={busy || !sender.trim() || (!savedKey && !apiKey.trim())} data-testid="mail-connection-save">
            {busy ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : null}
            {tx("Сохранить", "Speichern")}
          </Button>
        </div>
      </Section>
    </form>
  );
}
