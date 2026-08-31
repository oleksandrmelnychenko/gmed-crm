import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MessageSquareText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { apiFetch, clearApiCache } from "@/lib/api";
import type { Lang } from "@/lib/i18n";

import {
  availableConciergeTaskStatuses,
  conciergeServiceDisplayTitle,
  type ConciergeAssignee,
  type ConciergeService,
  type ConciergeTask,
  type ConciergeTaskComment,
  type ConciergeTaskDetail,
} from "./model";
import {
  ConciergeDialogBody,
  ConciergeDialogFooter,
  ConciergeDialogHeader,
  ConciergeDialogSection,
  ConciergeField,
  conciergeDialogContentClassName,
} from "./dialog-layout";
import {
  ConciergeTaskAttachments,
  ConciergeTaskStagedAttachments,
  filesMissingFromTaskAttachments,
  listConciergeTaskAttachments,
  taskAttachmentFileKey,
  uploadConciergeTaskAttachment,
} from "./task-attachments";

const copy = {
  de: {
    createTitle: "Aufgabe oder Termin anlegen",
    createServiceTitle: "Serviceaufgabe anlegen",
    editTitle: "Aufgabe oder Termin bearbeiten",
    task: "Aufgabe",
    event: "Termin",
    title: "Titel",
    titlePlaceholder: "z. B. Fahrer bestätigen",
    note: "Operative Notiz",
    notePlaceholder: "Absprachen, Checkliste oder Übergabedetail",
    linkedService: "Zugewiesener Service",
    assignee: "Zuständig",
    chooseAssignee: "Zuständige Person auswählen",
    searchAssignee: "Zuständige Person suchen",
    noService: "Ohne Servicebezug",
    serviceRequired: "Wählen Sie den Service aus, damit Patient, Anfrage und Ausgabenbelege zusammenbleiben.",
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
    review: "Zur Prüfung",
    completed: "Erledigt",
    cancelled: "Storniert",
    cancel: "Abbrechen",
    create: "Anlegen",
    save: "Speichern",
    saving: "Wird gespeichert",
    detailsSection: "Details",
    planningSection: "Planung und Status",
    assignmentSection: "Zuordnung",
    audience: "Kategorie",
    internal: "Intern",
    external: "Extern",
    patient: "Patient / Kunde",
    noPatient: "Ohne Patientenzuordnung",
    searchPatient: "Patient suchen",
    provider: "Provider",
    noProvider: "Ohne Providerzuordnung",
    searchProvider: "Provider suchen",
    project: "Projekt",
    noProject: "Ohne Projektbezug",
    searchProject: "Projekt suchen",
    internalOwner: "Verantwortlich in GMED",
    externalType: "Externer Ausführender",
    searchExternalType: "Art des Ausführenden suchen",
    externalName: "Name / Unternehmen",
    externalNamePlaceholder: "z. B. Fahrer Müller oder Hotel Adlon",
    externalPhone: "Telefon",
    externalEmail: "E-Mail",
    driver: "Fahrer",
    hotel: "Hotel",
    clinic: "Klinik",
    partner: "Partner",
    other: "Andere",
    attachmentUploadFailed: "Die Aufgabe wurde angelegt, aber nicht alle Dateien konnten hochgeladen werden. Bitte erneut versuchen.",
    comments: "Kommentare",
    commentPlaceholder: "Kommentar oder Arbeitsergebnis hinzufügen",
    addComment: "Kommentar hinzufügen",
    noComments: "Noch keine Kommentare",
    commentsLoading: "Kommentare werden geladen",
    commentsLoadFailed: "Kommentare konnten nicht geladen werden.",
    commentAddFailed: "Der Kommentar konnte nicht hinzugefügt werden.",
  },
  ru: {
    createTitle: "Создать задачу или событие",
    createServiceTitle: "Создать сервисную задачу",
    editTitle: "Изменить задачу или событие",
    task: "Задача",
    event: "Событие",
    title: "Название",
    titlePlaceholder: "Например, подтвердить водителя",
    note: "Операционная заметка",
    notePlaceholder: "Договорённости, чек-лист или детали передачи",
    linkedService: "Назначенная услуга",
    assignee: "Исполнитель",
    chooseAssignee: "Выберите исполнителя",
    searchAssignee: "Найти исполнителя",
    noService: "Без привязки к услуге",
    serviceRequired: "Выберите сервис — тогда пациент, запрос и расходные документы останутся связаны.",
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
    review: "На проверке",
    completed: "Выполнена",
    cancelled: "Отменена",
    cancel: "Отмена",
    create: "Создать",
    save: "Сохранить",
    saving: "Сохранение",
    detailsSection: "Основные данные",
    planningSection: "Планирование и статус",
    assignmentSection: "Назначение",
    audience: "Категория",
    internal: "Внутренняя",
    external: "Внешняя",
    patient: "Пациент / клиент",
    noPatient: "Без привязки к пациенту",
    searchPatient: "Найти пациента",
    provider: "Провайдер",
    noProvider: "Без привязки к провайдеру",
    searchProvider: "Найти провайдера",
    project: "Проект",
    noProject: "Без привязки к проекту",
    searchProject: "Найти проект",
    internalOwner: "Ответственный в GMED",
    externalType: "Внешний исполнитель",
    searchExternalType: "Найти тип исполнителя",
    externalName: "Имя / компания",
    externalNamePlaceholder: "Например, водитель Мюллер или Hotel Adlon",
    externalPhone: "Телефон",
    externalEmail: "Электронная почта",
    driver: "Водитель",
    hotel: "Отель",
    clinic: "Клиника",
    partner: "Партнёр",
    other: "Другое",
    attachmentUploadFailed: "Задача создана, но не все файлы удалось загрузить. Повторите попытку.",
    comments: "Комментарии",
    commentPlaceholder: "Добавить комментарий или результат работы",
    addComment: "Добавить комментарий",
    noComments: "Комментариев пока нет",
    commentsLoading: "Загрузка комментариев",
    commentsLoadFailed: "Не удалось загрузить комментарии.",
    commentAddFailed: "Не удалось добавить комментарий.",
  },
} as const;

function assigneeRoleLabel(role: string, lang: Lang) {
  const labels: Record<string, [string, string]> = {
    concierge: ["Concierge", "Консьерж"],
    ceo: ["CEO", "CEO"],
    ceo_assistant: ["CEO-Assistenz", "Ассистент CEO"],
    billing: ["Buchhaltung", "Бухгалтерия"],
    patient_manager: ["Patientenmanagement", "Менеджер пациентов"],
    sales: ["Vertrieb", "Отдел продаж"],
    teamlead_interpreter: ["Teamlead Dolmetscher", "Тимлид переводчиков"],
    interpreter: ["Dolmetscher", "Переводчик"],
  };
  const label = labels[role];
  return label ? (lang === "de" ? label[0] : label[1]) : role;
}

export function isConciergeServiceSelectableForTask(
  service: ConciergeService,
  assigneeId: string | null,
  existingServiceId: string | null = null,
) {
  if (service.task_eligible === false) return false;
  if (service.linked_task_id && service.id !== existingServiceId) return false;
  return service.id === existingServiceId
    || !assigneeId
    || !service.assigned_concierge_id
    || service.assigned_concierge_id === assigneeId;
}

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-field px-3 py-1 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";
const textAreaClass =
  "flex min-h-32 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm text-foreground shadow-xs outline-none placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

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
  task_audience: "internal" | "external";
  patient_id: string | null;
  provider_id: string | null;
  project_id: string | null;
  external_assignee_type: string | null;
  external_assignee_name: string | null;
  external_assignee_phone: string | null;
  external_assignee_email: string | null;
};

export type ConciergeTaskPatientOption = {
  id: string;
  name: string;
};

export type ConciergeTaskProviderOption = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
};

export type ConciergeTaskProjectOption = {
  id: string;
  name: string;
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

function commentDateTime(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function selectTaskAssigneeId(
  itemAssignedTo: string | null | undefined,
  currentUserId: string | null,
  assignees: ConciergeAssignee[],
) {
  const itemAssignee = assignees.find((assignee) => assignee.id === itemAssignedTo);
  if (itemAssignee) return itemAssignee.id;
  const currentUserAssignee = assignees.find((assignee) => assignee.id === currentUserId);
  if (currentUserAssignee?.role === "concierge") return currentUserAssignee.id;
  const firstConcierge = assignees.find((assignee) => assignee.role === "concierge");
  return firstConcierge?.id ?? currentUserAssignee?.id ?? assignees[0]?.id ?? "";
}

export function ConciergeTaskEventDialog({
  item,
  services,
  assignees,
  currentUserId,
  canAssign,
  canModifyAttachments = false,
  showServiceLink = true,
  serviceLinkRequired = false,
  patients = [],
  providers = [],
  projects = [],
  initialTitle = "",
  initialServiceId = null,
  initialAssigneeId = null,
  initialPatientId = null,
  initialProviderId = null,
  initialProjectId = null,
  initialDate = null,
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
  canModifyAttachments?: boolean;
  showServiceLink?: boolean;
  serviceLinkRequired?: boolean;
  patients?: ConciergeTaskPatientOption[];
  providers?: ConciergeTaskProviderOption[];
  projects?: ConciergeTaskProjectOption[];
  initialTitle?: string;
  initialServiceId?: string | null;
  initialAssigneeId?: string | null;
  initialPatientId?: string | null;
  initialProviderId?: string | null;
  initialProjectId?: string | null;
  initialDate?: Date | null;
  lang: Lang;
  open: boolean;
  submitting: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSave: (input: SaveConciergeOperationalItemInput) => Promise<ConciergeTask>;
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
  const [audience, setAudience] = useState<"internal" | "external">("internal");
  const [patientId, setPatientId] = useState("");
  const [providerId, setProviderId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [externalType, setExternalType] = useState("driver");
  const [externalName, setExternalName] = useState("");
  const [externalPhone, setExternalPhone] = useState("");
  const [externalEmail, setExternalEmail] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [pendingAttachmentError, setPendingAttachmentError] = useState("");
  const [uploadingPending, setUploadingPending] = useState(false);
  const [comments, setComments] = useState<ConciergeTaskComment[]>([]);
  const currentUserRole = assignees.find((assignee) => assignee.id === currentUserId)?.role ?? null;
  const editableStatuses = item
    ? availableConciergeTaskStatuses(item, currentUserId, currentUserRole)
    : (["open"] as const);
  const [comment, setComment] = useState("");
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState("");
  const createdTaskRef = useRef<ConciergeTask | null>(null);
  const commentRequestRef = useRef<{ body: string; requestId: string } | null>(null);

  const sortedServices = useMemo(
    () => services
      .filter((service) => isConciergeServiceSelectableForTask(
        service,
        assigneeId || null,
        item?.concierge_service_id ?? null,
      ))
      .sort((left, right) => conciergeServiceDisplayTitle(left, lang).localeCompare(conciergeServiceDisplayTitle(right, lang))),
    [assigneeId, item?.concierge_service_id, lang, services],
  );

  useEffect(() => {
    if (!open || !serviceId) return;
    const selectedService = services.find((service) => service.id === serviceId);
    if (
      !selectedService
      || !isConciergeServiceSelectableForTask(
        selectedService,
        assigneeId || null,
        item?.concierge_service_id ?? null,
      )
    ) {
      setServiceId("");
    }
  }, [assigneeId, item?.concierge_service_id, open, serviceId, services]);

  useEffect(() => {
    if (!open) return;
    const start = initialDate ? new Date(initialDate) : new Date(Date.now() + 60 * 60_000);
    if (initialDate) start.setHours(9, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60_000);
    setKind(item?.kind ?? "task");
    setTitle(item?.title ?? initialTitle);
    setNote(item?.note ?? "");
    setServiceId(item?.concierge_service_id ?? initialServiceId ?? "");
    setDueAt(localDateTimeValue(item?.due_at ?? start));
    setStartsAt(localDateTimeValue(item?.starts_at ?? start));
    setEndsAt(localDateTimeValue(item?.ends_at ?? end));
    setLocation(item?.location ?? "");
    setPriority(item?.priority ?? "normal");
    setStatus(item?.status ?? "open");
    setAssigneeId(selectTaskAssigneeId(item?.assigned_to ?? initialAssigneeId, currentUserId, assignees));
    setReminderAt(localDateTimeValue(item?.reminder_at ?? null));
    setAudience(item?.task_audience ?? "internal");
    setPatientId(item?.patient_id ?? initialPatientId ?? "");
    setProviderId(item?.provider_id ?? initialProviderId ?? "");
    setProjectId(item?.project_id ?? initialProjectId ?? "");
    setExternalType(item?.external_assignee_type ?? "driver");
    setExternalName(item?.external_assignee_name ?? "");
    setExternalPhone(item?.external_assignee_phone ?? "");
    setExternalEmail(item?.external_assignee_email ?? "");
  }, [assignees, currentUserId, initialAssigneeId, initialDate, initialPatientId, initialProjectId, initialProviderId, initialServiceId, initialTitle, item, open]);

  useEffect(() => {
    if (!open) return;
    setPendingFiles([]);
    setPendingAttachmentError("");
    setUploadingPending(false);
    createdTaskRef.current = null;
  }, [item?.id, open]);

  useEffect(() => {
    if (!open) return;
    setComments([]);
    setComment("");
    setCommentError("");
    setCommentBusy(false);
    commentRequestRef.current = null;
    if (!item) {
      setCommentsLoading(false);
      return;
    }

    let cancelled = false;
    setCommentsLoading(true);
    void apiFetch<ConciergeTaskDetail>(`/concierge-operational-items/${item.id}`, { forceFresh: true })
      .then((detail) => {
        if (!cancelled) setComments(detail.comments);
      })
      .catch(() => {
        if (!cancelled) setCommentError(labels.commentsLoadFailed);
      })
      .finally(() => {
        if (!cancelled) setCommentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [item, labels.commentsLoadFailed, open]);

  async function addComment() {
    if (!item || !comment.trim() || commentBusy) return;
    const body = comment.trim();
    const requestId = commentRequestRef.current?.body === body
      ? commentRequestRef.current.requestId
      : crypto.randomUUID();
    commentRequestRef.current = { body, requestId };
    setCommentBusy(true);
    setCommentError("");
    try {
      const row = await apiFetch<ConciergeTaskComment>(`/concierge-operational-items/${item.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ request_id: requestId, body }),
      });
      setComments((current) => current.some((entry) => entry.id === row.id) ? current : [...current, row]);
      setComment("");
      commentRequestRef.current = null;
      clearApiCache("/concierge-operational-items");
    } catch {
      setCommentError(labels.commentAddFailed);
    } finally {
      setCommentBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploadingPending) return;
    setUploadingPending(true);
    setPendingAttachmentError("");
    try {
      let saved = createdTaskRef.current;
      const retryingAttachmentUpload = Boolean(saved);
      if (!saved) {
        const selectedService = services.find((service) => service.id === serviceId);
        const selectedServiceId = showServiceLink
          && selectedService
          && isConciergeServiceSelectableForTask(
            selectedService,
            assigneeId || null,
            item?.concierge_service_id ?? null,
          )
          ? selectedService.id
          : null;
        saved = await onSave({
          kind,
          title: title.trim(),
          note: note.trim() || null,
          concierge_service_id: showServiceLink
            ? selectedServiceId
            : item?.concierge_service_id ?? null,
          due_at: kind === "task" ? toIso(dueAt) : null,
          starts_at: kind === "event" ? toIso(startsAt) : null,
          ends_at: kind === "event" ? toIso(endsAt) : null,
          location: location.trim() || null,
          priority,
          status,
          assigned_to: canAssign ? assigneeId || null : null,
          reminder_at: toIso(reminderAt),
          task_audience: audience,
          patient_id: patientId || null,
          provider_id: providerId || null,
          project_id: projectId || null,
          external_assignee_type: audience === "external" ? externalType : null,
          external_assignee_name: audience === "external" ? externalName.trim() || null : null,
          external_assignee_phone: audience === "external" ? externalPhone.trim() || null : null,
          external_assignee_email: audience === "external" ? externalEmail.trim() || null : null,
        });
        createdTaskRef.current = saved;
      }
      let filesToUpload = pendingFiles;
      if (retryingAttachmentUpload) {
        const existing = await listConciergeTaskAttachments(saved.id);
        filesToUpload = filesMissingFromTaskAttachments(pendingFiles, existing);
        setPendingFiles(filesToUpload);
      }
      for (const file of filesToUpload) {
        await uploadConciergeTaskAttachment(saved.id, file);
        const uploadedKey = taskAttachmentFileKey(file);
        setPendingFiles((current) => current.filter((entry) => taskAttachmentFileKey(entry) !== uploadedKey));
      }
      onOpenChange(false);
    } catch {
      if (createdTaskRef.current) setPendingAttachmentError(labels.attachmentUploadFailed);
      // Preserve both the form and remaining staged files for a safe retry.
    } finally {
      setUploadingPending(false);
    }
  }

  const dialogBusy = submitting || uploadingPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={conciergeDialogContentClassName}>
        <ConciergeDialogHeader tone="dot" title={item ? labels.editTitle : serviceLinkRequired ? labels.createServiceTitle : labels.createTitle} />

        <form className="flex min-h-0 flex-col" onSubmit={(event) => void submit(event)}>
          <ConciergeDialogBody>
            {error ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}
            <div className="space-y-4">
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(18rem,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-4">
                  <ConciergeDialogSection title={labels.detailsSection} dot>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
                        {(["task", "event"] as const).map((value) => (
                          <Button key={value} type="button" size="sm" className="h-8 rounded-md text-xs" variant={kind === value ? "default" : "ghost"} aria-pressed={kind === value} onClick={() => setKind(value)}>
                            {labels[value]}
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

                  {showServiceLink || canAssign ? (
                    <ConciergeDialogSection title={labels.assignmentSection} dot>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                        {showServiceLink ? (
                          <ConciergeField label={labels.linkedService}>
                            <select className={selectClass} value={serviceId} required={serviceLinkRequired} onChange={(event) => setServiceId(event.target.value)}>
                              <option value="" disabled={serviceLinkRequired}>{labels.noService}</option>
                              {sortedServices.map((service) => <option key={service.id} value={service.id}>{conciergeServiceDisplayTitle(service, lang)}</option>)}
                            </select>
                            {serviceLinkRequired ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{labels.serviceRequired}</p> : null}
                          </ConciergeField>
                        ) : null}
                        {canAssign ? (
                          <ConciergeField label={audience === "external" ? labels.internalOwner : labels.assignee}>
                            <NativeComboboxSelect className={selectClass} value={assigneeId} required searchPlaceholder={labels.searchAssignee} onChange={(event) => setAssigneeId(event.target.value)}>
                              <option value="" disabled>{labels.chooseAssignee}</option>
                              {assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name} · {assigneeRoleLabel(assignee.role, lang)}</option>)}
                            </NativeComboboxSelect>
                          </ConciergeField>
                        ) : null}
                      </div>
                    </ConciergeDialogSection>
                  ) : null}
                </div>

                <div className="space-y-4">
                <ConciergeDialogSection title={labels.audience} dot>
                  <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/70 bg-muted/40 p-1">
                    {(["internal", "external"] as const).map((value) => (
                      <Button key={value} type="button" size="sm" className="h-8 rounded-md text-xs" variant={audience === value ? "default" : "ghost"} onClick={() => setAudience(value)}>
                        {labels[value]}
                      </Button>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <ConciergeField label={labels.patient}>
                      <NativeComboboxSelect className={selectClass} value={patientId} searchPlaceholder={labels.searchPatient} onChange={(event) => setPatientId(event.target.value)}>
                        <option value="">{labels.noPatient}</option>
                        {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name}</option>)}
                      </NativeComboboxSelect>
                    </ConciergeField>
                    <ConciergeField label={labels.provider}>
                      <NativeComboboxSelect className={selectClass} value={providerId} searchPlaceholder={labels.searchProvider} onChange={(event) => setProviderId(event.target.value)}>
                        <option value="">{labels.noProvider}</option>
                        {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
                      </NativeComboboxSelect>
                    </ConciergeField>
                    <ConciergeField label={labels.project} className="sm:col-span-2">
                      <NativeComboboxSelect className={selectClass} value={projectId} searchPlaceholder={labels.searchProject} onChange={(event) => setProjectId(event.target.value)}>
                        <option value="">{labels.noProject}</option>
                        {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                      </NativeComboboxSelect>
                    </ConciergeField>
                    {audience === "external" ? (
                      <>
                        <ConciergeField label={labels.externalType}>
                          <NativeComboboxSelect className={selectClass} value={externalType} searchPlaceholder={labels.searchExternalType} onChange={(event) => setExternalType(event.target.value)}>
                            {(["driver", "hotel", "clinic", "partner", "other"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}
                          </NativeComboboxSelect>
                        </ConciergeField>
                        <ConciergeField label={labels.externalName}>
                          <Input value={externalName} required maxLength={255} placeholder={labels.externalNamePlaceholder} onChange={(event) => setExternalName(event.target.value)} />
                        </ConciergeField>
                        <ConciergeField label={labels.externalPhone}><Input value={externalPhone} maxLength={100} onChange={(event) => setExternalPhone(event.target.value)} /></ConciergeField>
                        <ConciergeField label={labels.externalEmail}><Input type="email" value={externalEmail} maxLength={255} onChange={(event) => setExternalEmail(event.target.value)} /></ConciergeField>
                      </>
                    ) : null}
                  </div>
                </ConciergeDialogSection>
                <ConciergeDialogSection title={labels.planningSection} dot>
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
                    <ConciergeField label={labels.location} className="sm:col-span-2">
                      <Input className="bg-field" value={location} maxLength={500} placeholder={labels.locationPlaceholder} onChange={(event) => setLocation(event.target.value)} />
                    </ConciergeField>
                    <ConciergeField label={labels.priority}>
                      <select className={selectClass} value={priority} onChange={(event) => setPriority(event.target.value)}>{(["low", "normal", "high", "urgent"] as const).map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select>
                    </ConciergeField>
                    {item ? (
                      <ConciergeField label={labels.status}><select className={selectClass} value={status} onChange={(event) => setStatus(event.target.value)}>{editableStatuses.map((value) => <option key={value} value={value}>{labels[value]}</option>)}</select></ConciergeField>
                    ) : (
                      <div className="grid content-end gap-1.5 text-xs font-medium text-muted-foreground">{labels.status}<Badge variant="outline" className="h-9 w-full justify-center rounded-md bg-field text-foreground">{labels.open}</Badge></div>
                    )}
                    <ConciergeField label={labels.reminderAt} className="sm:col-span-2"><Input className="bg-field" type="datetime-local" value={reminderAt} aria-label={labels.reminderAt} placeholder={labels.noReminder} onChange={(event) => setReminderAt(event.target.value)} /></ConciergeField>
                  </div>
                </ConciergeDialogSection>
                </div>
              </div>

              {item ? (
                <div>
                  <ConciergeTaskAttachments taskId={item.id} lang={lang} canModify={canModifyAttachments} />
                </div>
              ) : (
                <div>
                  <ConciergeTaskStagedAttachments
                    files={pendingFiles}
                    lang={lang}
                    disabled={dialogBusy}
                    externalError={pendingAttachmentError}
                    onChange={(files) => {
                      setPendingFiles(files);
                      setPendingAttachmentError("");
                    }}
                  />
                </div>
              )}
              {item ? (
                <div>
                  <ConciergeDialogSection title={labels.comments} dot>
                    {commentError ? <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{commentError}</p> : null}
                    <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
                      {commentsLoading ? (
                        <div className="flex items-center justify-center px-3 py-6 text-xs text-muted-foreground"><LoaderCircle className="mr-2 size-4 animate-spin" />{labels.commentsLoading}</div>
                      ) : comments.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-muted-foreground">{labels.noComments}</p>
                      ) : (
                        <div className="divide-y divide-border/60">
                          {comments.map((entry) => (
                            <article key={entry.id} className="px-3 py-2.5">
                              <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                                <strong className="truncate text-foreground">{entry.created_by_name}</strong>
                                <time className="shrink-0">{commentDateTime(entry.created_at, lang)}</time>
                              </div>
                              <p className="mt-1.5 whitespace-pre-wrap text-sm text-foreground">{entry.body}</p>
                            </article>
                          ))}
                        </div>
                      )}
                      <div className="space-y-2 border-t border-border/70 p-3">
                        <textarea
                          className="min-h-20 w-full resize-y rounded-md border border-input bg-field px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/45 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                          value={comment}
                          maxLength={4000}
                          placeholder={labels.commentPlaceholder}
                          onChange={(event) => setComment(event.target.value)}
                        />
                        <Button type="button" size="sm" className="w-full" disabled={commentBusy || !comment.trim()} onClick={() => void addComment()}>
                          {commentBusy ? <LoaderCircle className="animate-spin" /> : <MessageSquareText />}{labels.addComment}
                        </Button>
                      </div>
                    </div>
                  </ConciergeDialogSection>
                </div>
              ) : null}
            </div>
          </ConciergeDialogBody>

          <ConciergeDialogFooter>
            <Button type="button" className="h-9 rounded-lg" variant="outline" disabled={dialogBusy} onClick={() => onOpenChange(false)}>{labels.cancel}</Button>
            <Button type="submit" className="h-9 rounded-lg px-4" disabled={dialogBusy || !title.trim() || (kind === "event" && !startsAt) || (canAssign && !assigneeId) || (audience === "external" && !externalName.trim())}>
              {dialogBusy ? <LoaderCircle className="animate-spin" /> : null}{dialogBusy ? labels.saving : item ? labels.save : labels.create}
            </Button>
          </ConciergeDialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
