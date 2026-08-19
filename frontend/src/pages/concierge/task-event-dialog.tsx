import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ListTodo, LoaderCircle, MapPin } from "lucide-react";

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

import {
  conciergeServiceDisplayTitle,
  type ConciergeService,
  type ConciergeTask,
} from "./model";

const copy = {
  de: {
    createTitle: "Aufgabe oder Termin anlegen",
    editTitle: "Aufgabe oder Termin bearbeiten",
    description: "Nur operative Informationen erfassen. Medizinische Daten gehören nicht in diesen Bereich.",
    task: "Aufgabe",
    event: "Termin",
    title: "Titel",
    titlePlaceholder: "z. B. Fahrer bestätigen",
    note: "Operative Notiz",
    notePlaceholder: "Absprachen, Checkliste oder Übergabedetail",
    linkedService: "Zugewiesener Service",
    noService: "Ohne Servicebezug",
    dueAt: "Fällig am",
    startsAt: "Beginn",
    endsAt: "Ende",
    location: "Ort oder Adresse",
    locationPlaceholder: "Treffpunkt oder Partneradresse",
    priority: "Priorität",
    low: "Niedrig",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
    status: "Status",
    open: "Offen",
    in_progress: "In Arbeit",
    completed: "Erledigt",
    cancelled: "Storniert",
    cancel: "Abbrechen",
    create: "Anlegen",
    save: "Speichern",
    saving: "Wird gespeichert",
  },
  ru: {
    createTitle: "Создать задачу или событие",
    editTitle: "Изменить задачу или событие",
    description: "Добавляйте только операционные данные. Медицинской информации здесь быть не должно.",
    task: "Задача",
    event: "Событие",
    title: "Название",
    titlePlaceholder: "Например, подтвердить водителя",
    note: "Операционная заметка",
    notePlaceholder: "Договорённости, чек-лист или детали передачи",
    linkedService: "Назначенная услуга",
    noService: "Без привязки к услуге",
    dueAt: "Срок",
    startsAt: "Начало",
    endsAt: "Окончание",
    location: "Место или адрес",
    locationPlaceholder: "Точка встречи или адрес партнёра",
    priority: "Приоритет",
    low: "Низкий",
    normal: "Обычный",
    high: "Высокий",
    urgent: "Срочный",
    status: "Статус",
    open: "Открыта",
    in_progress: "В работе",
    completed: "Выполнена",
    cancelled: "Отменена",
    cancel: "Отмена",
    create: "Создать",
    save: "Сохранить",
    saving: "Сохранение",
  },
} as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";
const textAreaClass =
  "flex min-h-24 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

export type SaveConciergeOperationalItemInput = {
  kind: "task" | "event";
  title: string;
  note: string | null;
  concierge_service_id: string | null;
  due_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  priority: string;
  status: string;
};

function localDateTimeValue(value: Date | string | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export function ConciergeTaskEventDialog({
  item,
  services,
  lang,
  open,
  submitting,
  error,
  onOpenChange,
  onSave,
}: {
  item: ConciergeTask | null;
  services: ConciergeService[];
  lang: Lang;
  open: boolean;
  submitting: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSave: (input: SaveConciergeOperationalItemInput) => Promise<void>;
}) {
  const labels = copy[lang];
  const [kind, setKind] = useState<"task" | "event">("task");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [priority, setPriority] = useState("normal");
  const [status, setStatus] = useState("open");

  const sortedServices = useMemo(
    () => [...services].sort((left, right) => conciergeServiceDisplayTitle(left, lang).localeCompare(conciergeServiceDisplayTitle(right, lang))),
    [lang, services],
  );

  useEffect(() => {
    if (!open) return;
    const start = new Date(Date.now() + 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    setKind(item?.kind ?? "task");
    setTitle(item?.title ?? "");
    setNote(item?.note ?? "");
    setServiceId(item?.concierge_service_id ?? "");
    setDueAt(localDateTimeValue(item?.due_at ?? start));
    setStartsAt(localDateTimeValue(item?.starts_at ?? start));
    setEndsAt(localDateTimeValue(item?.ends_at ?? end));
    setLocation(item?.location ?? "");
    setPriority(item?.priority ?? "normal");
    setStatus(item?.status ?? "open");
  }, [item, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await onSave({
        kind,
        title: title.trim(),
        note: note.trim() || null,
        concierge_service_id: serviceId || null,
        due_at: kind === "task" ? toIso(dueAt) : null,
        starts_at: kind === "event" ? toIso(startsAt) : null,
        ends_at: kind === "event" ? toIso(endsAt) : null,
        location: location.trim() || null,
        priority,
        status,
      });
    } catch {
      // Preserve the form so the Concierge can correct or retry the request.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:max-h-[88vh] sm:w-full sm:p-5">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {kind === "event" ? <CalendarClock className="size-5 text-primary" /> : <ListTodo className="size-5 text-primary" />}
            {item ? labels.editTitle : labels.createTitle}
          </DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
            {(["task", "event"] as const).map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={kind === value ? "secondary" : "ghost"}
                aria-pressed={kind === value}
                onClick={() => setKind(value)}
              >
                {value === "task" ? <ListTodo /> : <CalendarClock />}
                {labels[value]}
              </Button>
            ))}
          </div>

          <label className="grid gap-1.5 text-sm font-medium">
            {labels.title}
            <Input value={title} maxLength={255} required placeholder={labels.titlePlaceholder} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="grid gap-1.5 text-sm font-medium">
            {labels.note}
            <textarea className={textAreaClass} value={note} maxLength={4000} placeholder={labels.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
          </label>

          <label className="grid gap-1.5 text-sm font-medium">
            {labels.linkedService}
            <select className={selectClass} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
              <option value="">{labels.noService}</option>
              {sortedServices.map((service) => (
                <option key={service.id} value={service.id}>{conciergeServiceDisplayTitle(service, lang)}</option>
              ))}
            </select>
          </label>

          {kind === "task" ? (
            <label className="grid gap-1.5 text-sm font-medium">
              {labels.dueAt}
              <Input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
            </label>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-medium">
                {labels.startsAt}
                <Input type="datetime-local" value={startsAt} required onChange={(event) => setStartsAt(event.target.value)} />
              </label>
              <label className="grid gap-1.5 text-sm font-medium">
                {labels.endsAt}
                <Input type="datetime-local" value={endsAt} min={startsAt || undefined} onChange={(event) => setEndsAt(event.target.value)} />
              </label>
            </div>
          )}

          <label className="grid gap-1.5 text-sm font-medium">
            <span className="flex items-center gap-1.5"><MapPin className="size-4" />{labels.location}</span>
            <Input value={location} maxLength={500} placeholder={labels.locationPlaceholder} onChange={(event) => setLocation(event.target.value)} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">
              {labels.priority}
              <select className={selectClass} value={priority} onChange={(event) => setPriority(event.target.value)}>
                {(["low", "normal", "high", "urgent"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}
              </select>
            </label>
            {item ? (
              <label className="grid gap-1.5 text-sm font-medium">
                {labels.status}
                <select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>
                  {(["open", "in_progress", "completed", "cancelled"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}
                </select>
              </label>
            ) : (
              <div className="grid content-end gap-1.5 text-sm font-medium">
                {labels.status}
                <Badge variant="outline" className="h-9 justify-center">{labels.open}</Badge>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" disabled={submitting || !title.trim() || (kind === "event" && !startsAt)}>
              {submitting ? <LoaderCircle className="animate-spin" /> : null}
              {submitting ? labels.saving : item ? labels.save : labels.create}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
