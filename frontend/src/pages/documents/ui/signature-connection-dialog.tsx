import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, KeyRound, LoaderCircle } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { checkSignatureConnection, disconnectSignatureConnection, fetchSignatureConnection, saveSignatureConnection, type SignatureConnection } from "../data/document-signature-api";

function ConnectionSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <AdminSectionTitle>{title}</AdminSectionTitle>
        {action}
      </div>
      {children}
    </section>
  );
}

export function SignatureConnectionDialog({ canConfigure, onChanged }: { canConfigure: boolean; onChanged: () => void }) {
  const { lang } = useLang();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><KeyRound aria-hidden="true" className="size-4" />{lang === "de" ? "Skribble anmelden / verbinden" : "Вход / подключение Skribble"}</Button>
    <Dialog open={open} onOpenChange={value => { setOpen(value); if (!value) setDirty(false); }} dirty={dirty}>
      <DialogContent className="grid max-h-[calc(100dvh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-xl p-0 sm:max-h-[90dvh] sm:max-w-2xl">
        <DialogHeader className="border-b border-border/70 px-4 py-3.5 pr-12 sm:px-5 sm:pr-14">
          <DialogTitle className="flex items-center gap-2 text-base"><span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />{lang === "de" ? "Skribble verbinden" : "Подключить Skribble"}</DialogTitle>
          <DialogDescription className="text-xs">{lang === "de" ? "Deutschland · Elektronische Unterschriften für GMED" : "Германия · Электронные подписи для GMED"}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
          {open ? <SignatureConnectionForm canConfigure={canConfigure} onChanged={onChanged} onDirtyChange={setDirty} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  </>;
}

export function SignatureConnectionForm({ canConfigure, onChanged, onDirtyChange }: { canConfigure: boolean; onChanged?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [connection, setConnection] = useState<SignatureConnection | null>(null);
  const [username, setUsername] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(canConfigure);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const dirty = canConfigure && !loading && (username !== (connection?.username ?? "") || mode !== (connection?.mode ?? "demo") || apiKey.length > 0);
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!canConfigure) return;
    let cancelled = false;
    void fetchSignatureConnection().then(value => {
      if (cancelled) return;
      setConnection(value); setUsername(value.username ?? ""); setMode(value.mode);
    }).catch(() => {
      // Initial discovery is best-effort; show errors only for explicit user actions.
    })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [canConfigure]);

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(""); setNotice("");
    try { await action(); }
    catch (reason) {
      const code = reason instanceof ApiRequestError ? reason.body?.error : null;
      setError(code === "signature_account_has_pending_requests"
        ? tx("Сначала завершите или отзовите текущие запросы подписей.", "Bitte zuerst offene Signaturanfragen abschließen oder zurückziehen.")
        : code === "signature_credentials_invalid"
          ? tx("Проверьте API-имя, ключ и выбранный режим.", "Bitte API-Benutzer, Schlüssel und Betriebsart prüfen.")
          : tx("Не удалось подтвердить подключение. Проверьте немецкий аккаунт и API-доступ.", "Verbindung nicht bestätigt. Bitte deutsches Konto und API-Zugang prüfen."));
    } finally { busyRef.current = false; setBusy(false); }
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const next = await saveSignatureConnection(username, apiKey, mode);
      setConnection(next); setUsername(next.username ?? ""); setMode(next.mode); setApiKey("");
      setNotice(tx("Подключение проверено и сохранено.", "Verbindung geprüft und gespeichert.")); onChanged?.();
    });
  }
  return (
    <div className="grid min-w-0 gap-3">
      <ConnectionSection title={tx("Вход в кабинет Skribble", "Bei Skribble anmelden")}>
        <div className="flex flex-col items-start gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-muted-foreground">{tx("Откройте немецкий кабинет сервиса в отдельном окне.", "Öffnen Sie das deutsche Skribble-Konto in einem separaten Fenster.")}</p>
          <a href="https://my.skribble.de/" target="_blank" rel="noopener noreferrer" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 shrink-0 rounded-md")}>
            {tx("Войти в Skribble", "Skribble-Login öffnen")}<ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </ConnectionSection>
      {canConfigure ? (
        <form onSubmit={save}>
          <ConnectionSection
            title={tx("Подключение GMED", "GMED anbinden")}
            action={loading ? (
              <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{tx("Загрузка…", "Wird geladen…")}</span>
            ) : connection?.configured ? (
              <Badge variant="outline" className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{tx("Подключение настроено", "Verbindung eingerichtet")} · {connection.mode === "demo" ? "DEMO" : "QES / eIDAS"}</Badge>
            ) : undefined}
          >
            <div className="space-y-3 p-3.5">
              <p className="text-xs leading-5 text-muted-foreground">{tx("Создайте API-доступ в административном разделе Skribble и введите данные здесь.", "Erstellen Sie im Skribble-Adminbereich einen API-Zugang und tragen Sie die Zugangsdaten hier ein.")}{" "}<a href="https://docs.skribble.com/business-admin/api/apicreate.html" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-4">{tx("Инструкция", "Anleitung")}</a></p>
              <fieldset disabled={busy || loading} className="grid min-w-0 gap-3 sm:grid-cols-2">
                <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
                  <span>{tx("Режим", "Betriebsart")}</span>
                  <NativeComboboxSelect className="h-9 bg-field text-sm font-normal text-foreground" value={mode} onChange={e => setMode(e.target.value as "demo" | "live")}>
                    <option value="demo">{tx("Тестовый — DEMO", "Testbetrieb – DEMO")}</option>
                    <option value="live">{tx("Рабочий — QES / eIDAS", "Echtbetrieb – QES / eIDAS")}</option>
                  </NativeComboboxSelect>
                </label>
                <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
                  <span>{tx("Имя API-пользователя", "API-Benutzername")}</span>
                  <Input className="h-9 bg-field font-normal" autoComplete="off" maxLength={200} value={username} required placeholder={mode === "demo" ? "api_demo_…" : "api_production_…"} onChange={e => setUsername(e.target.value)} />
                </label>
                <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
                  <span>{tx("API-ключ", "API-Schlüssel")}</span>
                  <Input className="h-9 bg-field font-normal" type="password" autoComplete="new-password" maxLength={8192} value={apiKey} required onChange={e => setApiKey(e.target.value)} />
                </label>
                <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">{tx("Ключ будет зашифрован на сервере. После сохранения поле очистится.", "Der Schlüssel wird verschlüsselt auf dem Server gespeichert. Nach dem Speichern wird das Feld geleert.")}</p>
              </fieldset>
              {notice ? <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{notice}</p> : null}
              {error ? <p role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">{error}</p> : null}
            </div>
            <div className="flex flex-col gap-2 border-t border-border/60 bg-muted/20 px-3.5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              {connection?.configured ? (
                <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
                  <Button type="button" variant="ghost" size="sm" className="h-8 rounded-md text-destructive hover:text-destructive" disabled={busy || loading} onClick={() => void run(async () => { await disconnectSignatureConnection(); setConnection(null); setUsername(""); setApiKey(""); setMode("demo"); setNotice(tx("Подключение отключено.", "Verbindung getrennt.")); onChanged?.(); })}>{tx("Отключить", "Verbindung trennen")}</Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 rounded-md" disabled={busy || loading} onClick={() => void run(async () => { await checkSignatureConnection(); setNotice(tx("Соединение работает.", "Verbindung erfolgreich geprüft.")); })}>{tx("Проверить соединение", "Verbindung prüfen")}</Button>
                </div>
              ) : null}
              <Button type="submit" size="sm" className="h-9 rounded-md sm:h-8" disabled={!username.trim() || !apiKey || busy || loading}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{tx("Проверить и подключить", "Prüfen und verbinden")}</Button>
            </div>
          </ConnectionSection>
        </form>
      ) : (
        <p className="rounded-lg border border-border/70 bg-muted/20 px-3.5 py-3 text-xs leading-5 text-muted-foreground">{tx("API-подключение GMED настраивает администратор.", "Die API-Anbindung von GMED richtet die Administration ein.")}</p>
      )}
    </div>
  );
}
