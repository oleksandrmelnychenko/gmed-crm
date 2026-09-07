import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";

type ReviewEvent = { id: string; at: string; by: string; test_mode: boolean; automatic: boolean };
export type DocumentReviewState = { sent: ReviewEvent | null; acknowledged: ReviewEvent | null; can_record?: boolean };

export function DocumentReviewStatus({ documentId, disabled }: { documentId: string; disabled?: boolean }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [state, setState] = useState<DocumentReviewState | null>(null);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirming, setConfirming] = useState<{ kind: "sent" | "acknowledged"; sent_event_id: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await apiFetch<DocumentReviewState>(`/documents/${documentId}/review-status`, { forceFresh: true });
        if (!cancelled) { setState(next); setError(false); }
      } catch { if (!cancelled) setError(true); }
    }
    void load();
    // This row stays mounted while a signature workspace sends its package.
    const timer = setInterval(() => void load(), 10_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [documentId, revision]);
  async function record() {
    if (inFlight.current || !state || !confirming || confirming.sent_event_id !== (state.sent?.id ?? null)) return;
    inFlight.current = true; setBusy(true); setActionError(false);
    try {
      await apiFetch(`/documents/${documentId}/review-status`, { method: "POST", body: JSON.stringify(confirming) });
      setConfirming(null);
    } catch { setActionError(true); }
    finally { inFlight.current = false; setBusy(false); setRevision(value => value + 1); }
  }
  if (error) return <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">{tx("Не удалось проверить статус ознакомления", "Kenntnisnahmestatus konnte nicht geprüft werden")}<Button size="xs" variant="outline" onClick={() => setRevision(value => value + 1)}>{tx("Повторить", "Erneut versuchen")}</Button></div>;
  if (!state) return <span className="mt-2 block text-xs text-muted-foreground">{tx("Проверка статуса ознакомления…", "Kenntnisnahmestatus wird geprüft…")}</span>;
  const event = state.acknowledged ?? state.sent;
  const at = event ? new Date(event.at).toLocaleString(lang === "de" ? "de-DE" : "ru-RU", { dateStyle: "short", timeStyle: "short" }) : "";
  const confirmationStale = !!confirming && confirming.sent_event_id !== (state.sent?.id ?? null);
  return <div className="mt-2 space-y-2 text-xs">
    {actionError ? <p role="alert" className="text-destructive">{tx("Отметка не сохранена. Проверьте актуальный статус и повторите.", "Vermerk nicht gespeichert. Prüfen Sie den aktuellen Status und versuchen Sie es erneut.")}</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline">{state.acknowledged ? tx("Ознакомлен", "Kenntnisnahme bestätigt") : state.sent ? tx("Отправлен для ознакомления", "Zur Kenntnisnahme versendet") : tx("Не отправлен", "Nicht versendet")}</Badge>
      {event?.test_mode ? <Badge variant="outline">DEMO</Badge> : null}
      {event ? <span className="text-muted-foreground">{at} · {event.automatic ? "Skribble" : event.by}</span> : null}
      {!state.acknowledged && state.can_record ? <Button type="button" size="xs" variant="outline" disabled={disabled || busy} onClick={() => setConfirming(value => value ? null : { kind: state.sent ? "acknowledged" : "sent", sent_event_id: state.sent?.id ?? null })}>{state.sent ? <Check className="size-3.5" /> : <Send className="size-3.5" />}{state.sent ? tx("Подтвердить ознакомление", "Kenntnisnahme bestätigen") : tx("Отметить отправку", "Versand vermerken")}</Button> : null}
    </div>
    {confirming ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <span>{confirmationStale ? tx("Статус отправки изменился. Проверьте его и откройте подтверждение заново.", "Der Versandstatus hat sich geändert. Prüfen und öffnen Sie die Bestätigung erneut.") : confirming.kind === "acknowledged" ? tx("Получено подтверждение клиента об ознакомлении с этой версией?", "Hat der Kunde die Kenntnisnahme dieser Version bestätigt?") : tx("Эта версия уже отправлена клиенту? Это только отметка, письмо не отправляется.", "Wurde diese Version bereits an den Kunden versendet? Dies vermerkt nur den Versand und versendet keine E-Mail.")}</span>
      <Button type="button" size="xs" disabled={disabled || busy || confirmationStale} onClick={() => void record()}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}{tx("Подтверждаю", "Bestätigen")}</Button>
      <Button type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setConfirming(null)}>{tx("Отмена", "Abbrechen")}</Button>
    </div> : null}
  </div>;
}
