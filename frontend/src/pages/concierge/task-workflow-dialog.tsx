import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, CalendarDays, Check, CircleAlert, Clock3, FolderKanban, ListChecks, LoaderCircle, Play, Square, UserRound, Workflow } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import type { Lang } from "@/lib/i18n";
import { localizeTaskTitle } from "@/lib/task-labels";
import { cn } from "@/lib/utils";
import { conciergeTaskCode, conciergeTaskInterval, type ConciergeTask, type ConciergeTaskStatus } from "./model";
import { taskWorkflowRows } from "./task-workflow";
import { ConciergeDialogHeader } from "./dialog-layout";

const copy = {
  ru: {
    title: "Процесс задачи", description: "Запускайте и приостанавливайте задачи и события по отдельности.",
    main: "Основная задача", mainEvent: "Событие", task: "Подзадача", event: "Событие", tasks: "Подзадачи", events: "События", completedCount: "Выполнено", total: "Всего", board: "Показать на доске",
    start: "Запустить", stop: "Остановить", resume: "Продолжить", stopHint: "Поставить на паузу",
    open: "Открыта", in_progress: "В работе", on_hold: "На паузе", review: "На проверке", completed: "Выполнено", cancelled: "Отменено", archived: "В архиве",
    empty: "Подзадач и событий пока нет.", restricted: "Показаны только доступные вам подзадачи и события.", unavailable: "Задача больше недоступна.",
    details: "Открыть задачу", close: "Закрыть", noPermission: "Нет прав на изменение статуса", failed: "Не удалось изменить статус. Попробуйте ещё раз.",
    startDate: "Начало", endDate: "Окончание",
  },
  de: {
    title: "Aufgabenablauf", description: "Aufgaben und Termine einzeln starten oder pausieren.",
    main: "Hauptaufgabe", mainEvent: "Termin", task: "Unteraufgabe", event: "Termin", tasks: "Unteraufgaben", events: "Termine", completedCount: "Erledigt", total: "Gesamt", board: "Auf dem Board anzeigen",
    start: "Starten", stop: "Stoppen", resume: "Fortsetzen", stopHint: "Pausieren",
    open: "Offen", in_progress: "In Arbeit", on_hold: "Pausiert", review: "Zur Prüfung", completed: "Erledigt", cancelled: "Storniert", archived: "Archiviert",
    empty: "Noch keine Unteraufgaben oder Termine.", restricted: "Nur für Sie zugängliche Unteraufgaben und Termine werden angezeigt.", unavailable: "Die Aufgabe ist nicht mehr verfügbar.",
    details: "Aufgabe öffnen", close: "Schließen", noPermission: "Keine Berechtigung zur Statusänderung", failed: "Status konnte nicht geändert werden. Versuchen Sie es erneut.",
    startDate: "Beginn", endDate: "Ende",
  },
};

const statusTone: Record<ConciergeTaskStatus, string> = {
  open: "border-border bg-background text-muted-foreground",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300",
  on_hold: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
  review: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-300",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300",
  cancelled: "border-border bg-muted text-muted-foreground",
};

export function TaskWorkflowDialog({ rootId, tasks, lang, busy, availableStatusesForTask, onStatusChange, onOpen, onShowOnBoard, onClose }: {
  rootId: string;
  tasks: ConciergeTask[];
  lang: Lang;
  busy: boolean;
  availableStatusesForTask: (task: ConciergeTask) => ConciergeTaskStatus[];
  onStatusChange: (task: ConciergeTask, status: string) => Promise<string | null>;
  onOpen: (task: ConciergeTask) => void;
  onShowOnBoard: (task: ConciergeTask) => void;
  onClose: () => void;
}) {
  const labels = copy[lang];
  const rows = useMemo(() => taskWorkflowRows(tasks, rootId), [tasks, rootId]);
  const root = rows[0]?.task;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const saving = useRef(false);
  const locked = busy || Boolean(pendingId);
  const children = rows.slice(1);
  const completed = children.filter(({ task }) => task.status === "completed").length;
  const incompleteVisibility = rows.some(({ task }) => (task.child_count ?? 0) > rows.filter(row => row.task.parent_task_id === task.id).length);
  const formatDate = (date: Date) => new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "de-DE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);

  async function changeStatus(task: ConciergeTask, status: ConciergeTaskStatus) {
    if (locked || saving.current || !availableStatusesForTask(task).includes(status)) return;
    saving.current = true;
    setPendingId(task.id);
    setError("");
    try {
      setError(await onStatusChange(task, status) ?? "");
    } catch {
      setError(labels.failed);
    } finally {
      saving.current = false;
      setPendingId(null);
    }
  }

  return <Dialog open allowImplicitDismissal onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent data-testid="task-workflow-dialog" className="flex max-h-[min(42rem,calc(100dvh-1rem))] flex-col gap-0 overflow-hidden rounded-xl p-0 pb-0 sm:max-w-[34rem] sm:pb-0" finalFocus={() => document.querySelector<HTMLButtonElement>(`[data-workflow-task-id="${CSS.escape(rootId)}"]`)}>
      <div className="shrink-0">
        <ConciergeDialogHeader icon={Workflow} tone="orange" title={labels.title} description={labels.description} />
      </div>
      {children.length ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/70 bg-muted/20 px-4 py-3 sm:px-5" aria-label={`${labels.total}: ${children.length}`}>
          <Badge variant="outline" className="h-6 gap-1.5 border-primary/20 bg-primary/5 text-[10px] text-primary"><ListChecks />{labels.tasks}<span className="font-semibold tabular-nums">{children.filter(({ task }) => task.kind === "task").length}</span></Badge>
          <Badge variant="outline" className={cn("h-6 gap-1.5 text-[10px]", statusTone.review)}><CalendarDays />{labels.events}<span className="font-semibold tabular-nums">{children.filter(({ task }) => task.kind === "event").length}</span></Badge>
          <Badge variant="outline" className={cn("ml-auto h-6 gap-1.5 text-[10px]", completed > 0 ? statusTone.completed : "bg-background text-muted-foreground")}><Check />{labels.completedCount}: <span className="font-semibold tabular-nums">{completed}/{children.length}</span></Badge>
        </div>
      ) : null}
      <div className="min-h-0 overflow-y-auto overscroll-contain bg-muted/10 p-4 sm:p-5">
        <div role="list" aria-label={labels.title} className="space-y-3">
          {rows.map(({ task, depth }) => {
            const interval = conciergeTaskInterval(task);
            const active = task.status === "in_progress";
            const target = active ? "on_hold" : "in_progress";
            const controllable = !task.archived_at && ["open", "in_progress", "on_hold"].includes(task.status);
            const allowed = controllable && availableStatusesForTask(task).includes(target);
            const action = active ? labels.stop : task.status === "on_hold" ? labels.resume : labels.start;
            const title = localizeTaskTitle(task.title, lang);
            const Icon = task.status === "completed" ? Check : task.kind === "event" ? CalendarDays : ListChecks;
            return <div key={task.id} role="listitem" data-testid={`workflow-item-${task.id}`} className={cn("relative min-w-0", depth > 0 && "border-l-2 border-primary/15 pl-3")} style={depth ? { marginLeft: Math.min(depth, 3) * 8 } : undefined}>
              {depth > 0 ? <span aria-hidden className="absolute left-0 top-6 w-3 border-t-2 border-primary/15" /> : null}
              <div className={cn("min-w-0 overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm", depth === 0 && "border-l-[3px] border-l-primary")}>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border/60 bg-muted/20 px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                    <Icon className={cn("size-3.5 shrink-0", task.status === "completed" ? "text-emerald-600" : "text-primary")} />
                    {depth === 0 ? task.kind === "event" ? labels.mainEvent : labels.main : task.kind === "event" ? labels.event : labels.task}
                  </span>
                  <Badge variant="outline" className="bg-background text-[10px] text-muted-foreground">{conciergeTaskCode(task)}</Badge>
                  <Badge variant="outline" className={cn("ml-auto text-[10px]", task.archived_at ? "bg-muted text-muted-foreground" : statusTone[task.status])}>{task.archived_at ? labels.archived : labels[task.status]}</Badge>
                </div>
                <div className="space-y-3 p-3">
                  <button type="button" className="block w-full min-w-0 break-words text-left text-sm font-semibold leading-snug hover:text-primary focus-visible:outline-2 focus-visible:outline-primary [overflow-wrap:anywhere]" title={labels.details} onClick={() => { onClose(); onOpen(task); }}>{title}</button>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {task.assigned_to_name ? (
                      <Badge variant="outline" className="h-6 min-w-0 max-w-full gap-1.5 bg-muted/20 text-[10px] font-normal text-muted-foreground" title={task.assigned_to_name}><UserRound /><span className="truncate">{task.assigned_to_name}</span></Badge>
                    ) : null}
                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                      <Button type="button" size="icon-sm" variant="outline" title={labels.board} aria-label={`${labels.board}: ${title}`} disabled={locked} onClick={() => onShowOnBoard(task)}><FolderKanban /></Button>
                      {controllable ? (
                        <Button type="button" size="icon-sm" variant="default" aria-label={`${action}: ${title}`} title={allowed ? active ? labels.stopHint : action : labels.noPermission} disabled={locked || !allowed} onClick={() => void changeStatus(task, target)}>
                          {pendingId === task.id ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : active ? <Square /> : <Play />}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {interval.start || interval.end ? (
                    <div className="space-y-1.5 rounded-lg border border-border/50 bg-muted/20 px-2.5 py-2 text-[10px] text-muted-foreground">
                      {([[labels.startDate, interval.start], [labels.endDate, interval.end]] as const).map(([label, date]) => date ? (
                        <div key={label} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <span className="flex items-center gap-1.5"><Clock3 className="size-3 shrink-0" />{label}</span>
                          <Badge variant="outline" className="ml-auto bg-background text-[10px] font-normal text-foreground"><time dateTime={date.toISOString()}>{formatDate(date)}</time></Badge>
                        </div>
                      ) : null)}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>;
          })}
        </div>
        {!root ? <p role="status" className="rounded-xl border border-dashed border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">{labels.unavailable}</p> : !children.length && !incompleteVisibility ? <p className="mt-3 rounded-xl border border-dashed border-border bg-card px-4 py-5 text-center text-xs text-muted-foreground">{labels.empty}</p> : null}
        {incompleteVisibility ? <p className="pt-3 text-xs text-muted-foreground">{labels.restricted}</p> : null}
      </div>
      <footer className="shrink-0 space-y-3 border-t border-border/70 bg-muted/25 px-4 py-3 sm:px-5">
        {error ? <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2.5 text-xs text-destructive"><CircleAlert className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></div> : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {root ? <Button type="button" size="sm" onClick={() => { onClose(); onOpen(root); }}><ArrowUpRight />{labels.details}</Button> : <span />}
          <DialogClose render={<Button size="sm" variant="outline" />}>{labels.close}</DialogClose>
        </div>
      </footer>
    </DialogContent>
  </Dialog>;
}
