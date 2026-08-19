import { useEffect, useMemo, useState } from "react";
import { Clock3, History, KeyRound, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  nextConciergeKeyActions,
  type ConciergeKeyAction,
  type ConciergeKeyEvent,
  type ConciergeService,
} from "./model";

const copy = {
  de: {
    title: "Schlüsselservice",
    description: "Übergaben nachvollziehbar dokumentieren. Die verantwortliche Person wird automatisch erfasst.",
    current: "Aktueller Status",
    notStarted: "Noch nicht gestartet",
    responsible: "Verantwortlich",
    time: "Zeitpunkt",
    note: "Optionale Notiz",
    notePlaceholder: "Zum Beispiel Aufbewahrungsort oder Übergabedetail",
    nextAction: "Nächster Schritt",
    history: "Übergabeverlauf",
    noHistory: "Noch keine Schlüsselübergabe dokumentiert.",
    recordedBy: "Erfasst von {name}",
    received: "Schlüssel erhalten",
    stored: "Schlüssel verwahrt",
    handed_over: "Schlüssel übergeben",
    returned: "Schlüssel zurückgegeben",
    saving: "Wird gespeichert",
  },
  ru: {
    title: "Передача ключа",
    description: "Фиксируйте движение ключа. Ответственный сотрудник сохраняется автоматически.",
    current: "Текущий статус",
    notStarted: "Учёт ещё не начат",
    responsible: "Ответственный",
    time: "Время действия",
    note: "Необязательная заметка",
    notePlaceholder: "Например, место хранения или детали передачи",
    nextAction: "Следующее действие",
    history: "История передачи",
    noHistory: "Действия с ключом ещё не зафиксированы.",
    recordedBy: "Зафиксировал(а): {name}",
    received: "Ключ получен",
    stored: "Ключ на хранении",
    handed_over: "Ключ передан",
    returned: "Ключ возвращён",
    saving: "Сохранение",
  },
} as const;

function localDateTimeValue(value: Date) {
  const shifted = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function formatDateTime(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function conciergeKeyActionLabel(action: ConciergeKeyAction, lang: Lang) {
  return copy[lang][action];
}

function actionTone(action: ConciergeKeyAction) {
  if (action === "returned") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (action === "handed_over") return "border-violet-200 bg-violet-50 text-violet-700";
  if (action === "stored") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

export function ConciergeKeyHandoverDialog({
  service,
  lang,
  open,
  events,
  error,
  loading,
  submittingAction,
  onOpenChange,
  onRecord,
}: {
  service: ConciergeService | null;
  lang: Lang;
  open: boolean;
  events: ConciergeKeyEvent[];
  error: string;
  loading: boolean;
  submittingAction: ConciergeKeyAction | null;
  onOpenChange: (open: boolean) => void;
  onRecord: (action: ConciergeKeyAction, occurredAt: string, note: string) => Promise<void>;
}) {
  const labels = copy[lang];
  const [occurredAt, setOccurredAt] = useState(() => localDateTimeValue(new Date()));
  const [note, setNote] = useState("");
  const nextActions = useMemo(
    () => nextConciergeKeyActions(service?.key_status ?? null),
    [service?.key_status],
  );

  useEffect(() => {
    if (!open) return;
    setOccurredAt(localDateTimeValue(new Date()));
    setNote("");
  }, [open, service?.id]);

  if (!service) return null;

  async function record(action: ConciergeKeyAction) {
    try {
      await onRecord(action, occurredAt, note);
      setOccurredAt(localDateTimeValue(new Date()));
      setNote("");
    } catch {
      // The parent keeps the form values and exposes the API error in this dialog.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl overflow-y-auto rounded-2xl p-4 sm:max-h-[85vh] sm:w-full sm:p-5">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <KeyRound className="size-4" />
            </span>
            <DialogTitle>{labels.title}</DialogTitle>
          </div>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <section className="rounded-xl border border-border/70 bg-muted/30 p-3" aria-label={labels.current}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{labels.current}</p>
            {service.key_status ? (
              <Badge variant="outline" className={actionTone(service.key_status)}>
                {conciergeKeyActionLabel(service.key_status, lang)}
              </Badge>
            ) : (
              <Badge variant="outline">{labels.notStarted}</Badge>
            )}
          </div>
          {service.key_responsible_user_name ? (
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex items-center gap-2">
                <UserRound className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">{labels.responsible}:</span>
                <span className="font-medium">{service.key_responsible_user_name}</span>
              </div>
              {service.key_status_at ? (
                <div className="flex items-center gap-2">
                  <Clock3 className="size-3.5 text-muted-foreground" />
                  <span>{formatDateTime(service.key_status_at, lang)}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {error ? (
          <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="space-y-3" aria-label={labels.nextAction}>
          <h3 className="text-sm font-semibold">{labels.nextAction}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">
              {labels.time}
              <Input
                type="datetime-local"
                value={occurredAt}
                max={localDateTimeValue(new Date(Date.now() + 5 * 60_000))}
                onChange={(event) => setOccurredAt(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground sm:row-span-2">
              {labels.note}
              <textarea
                value={note}
                maxLength={1000}
                rows={3}
                placeholder={labels.notePlaceholder}
                onChange={(event) => setNote(event.target.value)}
                className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
              />
            </label>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {nextActions.map((action) => (
              <Button
                key={action}
                type="button"
                variant={action === "returned" ? "outline" : "default"}
                disabled={Boolean(submittingAction) || !occurredAt}
                onClick={() => void record(action)}
                className="min-h-11 justify-start"
              >
                {submittingAction === action ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <ShieldCheck />
                )}
                {submittingAction === action ? labels.saving : conciergeKeyActionLabel(action, lang)}
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3 border-t border-border/70 pt-4" aria-label={labels.history}>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <History className="size-4 text-muted-foreground" />
            {labels.history}
          </h3>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground">
              {labels.noHistory}
            </p>
          ) : (
            <ol className="space-y-2">
              {[...events].reverse().map((event) => (
                <li key={event.id} className="rounded-xl border border-border/70 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline" className={actionTone(event.action)}>
                      {conciergeKeyActionLabel(event.action, lang)}
                    </Badge>
                    <time className="text-[11px] text-muted-foreground" dateTime={event.occurred_at}>
                      {formatDateTime(event.occurred_at, lang)}
                    </time>
                  </div>
                  <p className="mt-2 text-xs font-medium">{event.responsible_user_name}</p>
                  {event.note ? <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{event.note}</p> : null}
                  <p className={cn("mt-2 text-[10px] text-muted-foreground", event.note ? "" : "mt-1")}>
                    {labels.recordedBy.replace("{name}", event.recorded_by_name)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
