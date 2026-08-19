import { useEffect, useMemo, useState } from "react";
import { Bell, CalendarClock, Link2, ListTodo, LoaderCircle, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";

import {
  conciergeServiceDisplayTitle,
  type ConciergeAssignee,
  type ConciergeService,
  type ConciergeTask,
} from "./model";
import {
  ConciergeDialogBody,
  ConciergeDialogFooter,
  ConciergeDialogHeader,
  ConciergeDialogSection,
  ConciergeField,
  conciergeDialogContentClassName,
} from "./dialog-layout";

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
    assignee: "Zuständig",
    chooseAssignee: "Concierge auswählen",
    noService: "Ohne Servicebezug",
    dueAt: "Fällig am",
    startsAt: "Beginn",
    endsAt: "Ende",
    location: "Ort oder Adresse",
    locationPlaceholder: "Treffpunkt oder Partneradresse",
    priority: "Priorität",
    reminderAt: "Erinnerung",
    noReminder: "Keine Erinnerung",
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
    detailsSection: "Details",
    planningSection: "Planung und Status",
    assignmentSection: "Zuordnung",
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
    assignee: "Исполнитель",
    chooseAssignee: "Выберите консьержа",
    noService: "Без привязки к услуге",
    dueAt: "Срок",
    startsAt: "Начало",
    endsAt: "Окончание",
    location: "Место или адрес",
    locationPlaceholder: "Точка встречи или адрес партнёра",
    priority: "Приоритет",
    reminderAt: "Напоминание",
    noReminder: "Без напоминания",
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
    detailsSection: "Основные данные",
    planningSection: "Планирование и статус",
    assignmentSection: "Назначение",
  },
} as const;

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-field px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";
const textAreaClass =
  "flex min-h-32 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

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
  assigned_to: string | null;
  reminder_at: string | null;
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
  assignees,
  currentUserId,
  canAssign,
  lang,
  open,
  submitting,
  error,
  onOpenChange,
  onSave,
}: {
  item: ConciergeTask | null;
  services: ConciergeService[];
  assignees: ConciergeAssignee[];
  currentUserId: string | null;
  canAssign: boolean;
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
  const [assigneeId, setAssigneeId] = useState("");
  const [reminderAt, setReminderAt] = useState("");

  const sortedServices = useMemo(
    () => services
      .filter((service) => !assigneeId || service.assigned_concierge_id === assigneeId)
      .sort((left, right) => conciergeServiceDisplayTitle(left, lang).localeCompare(conciergeServiceDisplayTitle(right, lang))),
    [assigneeId, lang, services],
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
    setAssigneeId(item?.assigned_to ?? currentUserId ?? assignees[0]?.id ?? "");
    setReminderAt(localDateTimeValue(item?.reminder_at ?? null));
  }, [assignees, currentUserId, item, open]);

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
        assigned_to: canAssign ? assigneeId || null : null,
        reminder_at: toIso(reminderAt),
      });
    } catch {
      // Preserve the form so the Concierge can correct or retry the request.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader icon={kind === "event" ? CalendarClock : ListTodo} tone="orange" title={item ? labels.editTitle : labels.createTitle} description={labels.description} />

        <form className="flex min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
          <ConciergeDialogBody>
            {error ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <div className="grid items-start gap-4 lg:grid-cols-2">
              <ConciergeDialogSection title={labels.detailsSection} icon={kind === "event" ? CalendarClock : ListTodo}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
                    {(["task", "event"] as const).map((value) => (
                      <Button key={value} type="button" size="sm" className="h-8 rounded-md text-xs" variant={kind === value ? "default" : "ghost"} aria-pressed={kind === value} onClick={() => setKind(value)}>
                        {value === "task" ? <ListTodo /> : <CalendarClock />}{labels[value]}
                      </Button>
                    ))}
                  </div>
                  <ConciergeField label={labels.title}>
                    <Input className="bg-field" value={title} maxLength={255} required placeholder={labels.titlePlaceholder} onChange={(event) => setTitle(event.target.value)} />
                  </ConciergeField>
                  <ConciergeField label={labels.note}>
                    <textarea className={textAreaClass} value={note} maxLength={4000} placeholder={labels.notePlaceholder} onChange={(event) => setNote(event.target.value)} />
                  </ConciergeField>
                </div>
              </ConciergeDialogSection>

              <div className="space-y-4">
                <ConciergeDialogSection title={labels.assignmentSection} icon={Link2}>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <ConciergeField label={labels.linkedService}>
                      <select className={selectClass} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                        <option value="">{labels.noService}</option>
                        {sortedServices.map((service) => <option key={service.id} value={service.id}>{conciergeServiceDisplayTitle(service, lang)}</option>)}
                      </select>
                    </ConciergeField>
                    {canAssign ? (
                      <ConciergeField label={labels.assignee}>
                        <select className={selectClass} value={assigneeId} required onChange={(event) => { setAssigneeId(event.target.value); setServiceId(""); }}>
                          <option value="" disabled>{labels.chooseAssignee}</option>
                          {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}
                        </select>
                      </ConciergeField>
                    ) : null}
                  </div>
                </ConciergeDialogSection>

                <ConciergeDialogSection title={labels.planningSection} icon={Bell}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {kind === "task" ? (
                      <ConciergeField label={labels.dueAt} className="sm:col-span-2">
                        <Input className="bg-field" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
                      </ConciergeField>
                    ) : (
                      <>
                        <ConciergeField label={labels.startsAt}><Input className="bg-field" type="datetime-local" value={startsAt} required onChange={(event) => setStartsAt(event.target.value)} /></ConciergeField>
                        <ConciergeField label={labels.endsAt}><Input className="bg-field" type="datetime-local" value={endsAt} min={startsAt || undefined} onChange={(event) => setEndsAt(event.target.value)} /></ConciergeField>
                      </>
                    )}
                    <ConciergeField label={<span className="flex items-center gap-1.5"><MapPin className="size-3.5" />{labels.location}</span>} className="sm:col-span-2">
                      <Input className="bg-field" value={location} maxLength={500} placeholder={labels.locationPlaceholder} onChange={(event) => setLocation(event.target.value)} />
                    </ConciergeField>
                    <ConciergeField label={labels.priority}>
                      <select className={selectClass} value={priority} onChange={(event) => setPriority(event.target.value)}>{(["low", "normal", "high", "urgent"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select>
                    </ConciergeField>
                    {item ? (
                      <ConciergeField label={labels.status}><select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>{(["open", "in_progress", "completed", "cancelled"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></ConciergeField>
                    ) : (
                      <div className="grid content-end gap-1.5 text-xs font-medium text-muted-foreground">{labels.status}<Badge variant="outline" className="h-9 justify-center rounded-md bg-field text-foreground">{labels.open}</Badge></div>
                    )}
                    <ConciergeField label={labels.reminderAt} className="sm:col-span-2"><Input className="bg-field" type="datetime-local" value={reminderAt} aria-label={labels.reminderAt} placeholder={labels.noReminder} onChange={(event) => setReminderAt(event.target.value)} /></ConciergeField>
                  </div>
                </ConciergeDialogSection>
              </div>
            </div>
          </ConciergeDialogBody>

          <ConciergeDialogFooter>
            <Button type="button" className="h-9 rounded-lg" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" className="h-9 rounded-lg px-4" disabled={submitting || !title.trim() || (kind === "event" && !startsAt) || (canAssign && !assigneeId)}>
              {submitting ? <LoaderCircle className="animate-spin" /> : null}{submitting ? labels.saving : item ? labels.save : labels.create}
            </Button>
          </ConciergeDialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
