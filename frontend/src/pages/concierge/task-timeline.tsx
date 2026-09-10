import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { localizeTaskTitle } from "@/lib/task-labels";
import { conciergeTaskInterval, type ConciergeTask, type ConciergeTaskStatus } from "./model";
import { addTaskCalendarDays, orderedTaskHierarchy, taskCalendarDays, taskOccursOnDay } from "./task-calendar";

const copy = {
  ru: { today: "Сегодня", previous: "Предыдущая неделя", next: "Следующая неделя", start: "Начало", end: "Окончание", unplanned: "Без дат", open: "Открыто", in_progress: "В работе", on_hold: "На паузе", review: "На проверке", completed: "Выполнено", cancelled: "Отменено", pause: "На паузу", resume: "Продолжить", launch: "Начать", outside: "Вне этой недели", task: "Задача" },
  de: { today: "Heute", previous: "Vorherige Woche", next: "Nächste Woche", start: "Beginn", end: "Ende", unplanned: "Ohne Datum", open: "Offen", in_progress: "In Arbeit", on_hold: "Pausiert", review: "Zur Prüfung", completed: "Erledigt", cancelled: "Storniert", pause: "Pausieren", resume: "Fortsetzen", launch: "Starten", outside: "Außerhalb dieser Woche", task: "Aufgabe" },
};

export function TaskTimeline({ tasks, lang, now, onOpen, onStatusChange, availableStatusesForTask, updatingTaskId }: {
  tasks: ConciergeTask[];
  lang: Lang;
  now: Date;
  onOpen: (task: ConciergeTask) => void;
  onStatusChange: (task: ConciergeTask, status: string) => void;
  availableStatusesForTask: (task: ConciergeTask) => ConciergeTaskStatus[];
  updatingTaskId: string | null;
}) {
  const [focus, setFocus] = useState(now);
  const days = useMemo(() => taskCalendarDays("week", focus), [focus]);
  const rows = useMemo(() => orderedTaskHierarchy(tasks), [tasks]);
  const labels = copy[lang];
  const locale = lang === "ru" ? "ru-RU" : "de-DE";
  const format = (date: Date | null) => date ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date) : "—";
  return (
    <section className="min-w-0 rounded-xl border bg-card shadow-sm" aria-label={lang === "ru" ? "Таймлайн задач" : "Aufgabenzeitplan"}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" aria-label={labels.previous} onClick={() => setFocus(addTaskCalendarDays(focus, -7))}><ChevronLeft /></Button>
          <Button size="sm" variant="outline" onClick={() => setFocus(now)}>{labels.today}</Button>
          <Button size="icon-sm" variant="ghost" aria-label={labels.next} onClick={() => setFocus(addTaskCalendarDays(focus, 7))}><ChevronRight /></Button>
        </div>
        <span className="text-sm font-medium">{new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).formatRange(days[0], days[6])}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[230px_minmax(0,1fr)] border-b bg-muted/30 text-xs sm:grid-cols-[360px_minmax(0,1fr)]">
            <div className="p-3 font-medium">{labels.task} · {labels.start} — {labels.end}</div>
            <div className="grid grid-cols-7">{days.map((day) => <div key={day.toISOString()} className={cn("border-l p-3 text-center", day.toDateString() === now.toDateString() && "bg-orange-50 font-semibold text-orange-700")}>
              {new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit" }).format(day)}
            </div>)}</div>
          </div>
          {rows.map(({ task, depth }) => {
            const { start, end } = conciergeTaskInterval(task);
            const statusLabel = task.archived_at ? (lang === "ru" ? "В архиве" : "Archiviert") : labels[task.status];
            const occupied = days.flatMap((day, index) => taskOccursOnDay(task, day) ? [index] : []);
            const target = task.status === "in_progress" ? "on_hold" : "in_progress";
            const actionable = !task.archived_at && ["open", "in_progress", "on_hold"].includes(task.status) && availableStatusesForTask(task).includes(target);
            return <div key={task.id} data-testid={`timeline-row-${task.id}`} className="grid grid-cols-[230px_minmax(0,1fr)] border-b last:border-0 sm:grid-cols-[360px_minmax(0,1fr)]">
              <div className="flex items-start gap-2 p-3" style={{ paddingLeft: 12 + Math.min(depth, 5) * 16 }}>
                <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(task)}>
                  <span className="block break-words text-sm font-medium">{depth ? "↳ " : ""}{task.kind === "event" ? <CalendarDays className="mr-1 inline size-3.5" /> : null}{localizeTaskTitle(task.title, lang)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{labels.start}: {format(start)}<br />{labels.end}: {format(end)}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{task.assigned_to_name}</span>
                  <Badge variant="outline" className={cn("mt-1 text-[10px]", task.status === "on_hold" && "border-amber-300 text-amber-700")}>{statusLabel}</Badge>
                </button>
                {actionable ? <Button size="icon-sm" variant={task.status === "in_progress" ? "outline" : "default"} disabled={updatingTaskId === task.id} aria-label={task.status === "in_progress" ? labels.pause : task.status === "on_hold" ? labels.resume : labels.launch} onClick={() => onStatusChange(task, target)}>{task.status === "in_progress" ? <Pause /> : <Play />}</Button> : null}
              </div>
              <div className="relative grid grid-cols-7 items-center">
                <div className="pointer-events-none absolute inset-0 grid grid-cols-7">{days.map((day) => <div key={day.toISOString()} className={cn("border-l", day.toDateString() === now.toDateString() && "bg-orange-50/40")} />)}</div>
                {occupied.length ? <button onClick={() => onOpen(task)} title={`${task.title}: ${format(start)} — ${format(end)}`} className={cn("relative mx-1 rounded-md border px-2 py-2 text-left text-xs font-medium", task.archived_at ? "border-border bg-muted text-muted-foreground" : task.status === "on_hold" ? "border-dashed border-amber-400 bg-amber-50 text-amber-800" : task.status === "completed" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : task.status === "cancelled" ? "border-border bg-muted text-muted-foreground line-through" : "border-orange-200 bg-orange-100 text-orange-900")} style={{ gridColumn: `${occupied[0] + 1} / ${occupied[occupied.length - 1] + 2}` }}><span className="block truncate">{statusLabel}</span></button> : <span className="relative col-span-7 px-3 text-center text-xs text-muted-foreground">{start || end ? labels.outside : labels.unplanned}</span>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </section>
  );
}
