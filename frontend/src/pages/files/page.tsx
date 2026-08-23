import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Download,
  ExternalLink,
  FileImage,
  Files,
  FileText,
  LoaderCircle,
  RefreshCw,
  Search,
  UserRound,
} from "lucide-react";

import { PageHeader } from "@/components/ui-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { apiFetch, downloadApiFile } from "@/lib/api";
import { useLang, type Lang } from "@/lib/i18n";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";
import { formatTaskAttachmentSize } from "@/pages/concierge/task-attachments";

export type OperationalAttachmentFile = {
  id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string;
  uploaded_by_name: string;
  created_at: string;
  task_id: string;
  task_title: string;
  task_kind: "task" | "event";
  task_status: string;
  patient_id: string | null;
  patient_name: string | null;
  provider_id: string | null;
  provider_name: string | null;
};

export type OperationalAttachmentFilters = {
  query: string;
  kind: "all" | "task" | "event";
};

const copy = {
  de: {
    title: "Dateien",
    subtitle: "Alle Dateien aus Aufgaben und Terminen an einem Ort",
    search: "Datei, Aufgabe, Patient, Anbieter oder Uploader suchen",
    allKinds: "Aufgaben und Termine",
    task: "Aufgaben",
    event: "Termine",
    taskKind: "Aufgabe",
    eventKind: "Termin",
    file: "Datei",
    related: "Aufgabe / Termin",
    profile: "Patient / Anbieter",
    uploaded: "Hochgeladen von / am",
    actions: "Aktionen",
    noProfile: "Kein Profil verknüpft",
    openTask: "Aufgabe öffnen",
    openPatient: "Patientenprofil öffnen",
    openProvider: "Anbieterprofil öffnen",
    download: "Herunterladen",
    loading: "Dateien werden geladen",
    empty: "Noch keine Dateien an Aufgaben oder Termine angehängt.",
    noResults: "Keine Dateien entsprechen der Suche oder dem Filter.",
    loadFailed: "Die Dateien konnten nicht geladen werden.",
    downloadFailed: "Die Datei konnte nicht heruntergeladen werden.",
    retry: "Erneut laden",
    refresh: "Aktualisieren",
    open_status: "Offen",
    in_progress: "In Arbeit",
    completed: "Erledigt",
    cancelled: "Storniert",
  },
  ru: {
    title: "Файлы",
    subtitle: "Все файлы из задач и событий в одном месте",
    search: "Поиск по файлу, задаче, пациенту, провайдеру или автору",
    allKinds: "Задачи и события",
    task: "Задачи",
    event: "События",
    taskKind: "Задача",
    eventKind: "Событие",
    file: "Файл",
    related: "Задача / событие",
    profile: "Пациент / провайдер",
    uploaded: "Кто и когда загрузил",
    actions: "Действия",
    noProfile: "Профиль не привязан",
    openTask: "Открыть задачу",
    openPatient: "Открыть профиль пациента",
    openProvider: "Открыть профиль провайдера",
    download: "Скачать",
    loading: "Загрузка файлов",
    empty: "К задачам и событиям пока не прикреплено ни одного файла.",
    noResults: "Поиск и фильтр не нашли подходящих файлов.",
    loadFailed: "Не удалось загрузить файлы.",
    downloadFailed: "Не удалось скачать файл.",
    retry: "Повторить",
    refresh: "Обновить",
    open_status: "Открыта",
    in_progress: "В работе",
    completed: "Выполнена",
    cancelled: "Отменена",
  },
} as const satisfies Record<Lang, Record<string, string>>;

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

export function filterOperationalAttachmentFiles(
  rows: OperationalAttachmentFile[],
  filters: OperationalAttachmentFilters,
) {
  const query = normalizeSearch(filters.query);
  return rows.filter((row) => {
    if (filters.kind !== "all" && row.task_kind !== filters.kind) return false;
    if (!query) return true;
    return [
      row.file_name,
      row.task_title,
      row.patient_name,
      row.provider_name,
      row.uploaded_by_name,
    ].some((value) => normalizeSearch(value ?? "").includes(query));
  });
}

export function sortOperationalAttachmentFiles(rows: OperationalAttachmentFile[]) {
  return [...rows].sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function statusLabel(status: string, lang: Lang) {
  const labels = copy[lang];
  if (status === "open") return labels.open_status;
  if (status === "in_progress") return labels.in_progress;
  if (status === "completed") return labels.completed;
  if (status === "cancelled") return labels.cancelled;
  return status;
}

function statusTone(status: string) {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "cancelled") return "border-slate-200 bg-slate-50 text-slate-600";
  if (status === "in_progress") return "border-sky-200 bg-sky-50 text-sky-700";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function formatUploadedAt(value: string, lang: Lang) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function FileIcon({ mimeType }: { mimeType: string }) {
  return mimeType.startsWith("image/")
    ? <FileImage className="size-5 shrink-0 text-violet-600" />
    : <FileText className="size-5 shrink-0 text-sky-600" />;
}

export function FilesPage() {
  const { lang } = useLang();
  const labels = copy[lang];
  const { staffGo, canStaffPath } = useStaffNavigate();
  const [rows, setRows] = useState<OperationalAttachmentFile[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<OperationalAttachmentFilters["kind"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void apiFetch<OperationalAttachmentFile[]>("/concierge-operational-attachments", {
      cacheTtlMs: 10_000,
      forceFresh: version > 0,
    })
      .then((items) => {
        if (!cancelled) setRows(sortOperationalAttachmentFiles(items));
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : labels.loadFailed);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [labels.loadFailed, version]);

  const filteredRows = useMemo(
    () => filterOperationalAttachmentFiles(rows, { query, kind }),
    [kind, query, rows],
  );

  async function download(row: OperationalAttachmentFile) {
    if (downloadingId) return;
    setDownloadingId(row.id);
    setError("");
    try {
      await downloadApiFile(
        `/concierge-operational-items/${row.task_id}/attachments/${row.id}/download`,
        row.file_name,
      );
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : labels.downloadFailed);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="space-y-4" data-testid="operational-files-page">
      <PageHeader title={labels.title} description={labels.subtitle} />

      <section className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-muted/20 p-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-9"
              placeholder={labels.search}
              aria-label={labels.search}
            />
          </div>
          <NativeComboboxSelect
            value={kind}
            onChange={(event) => setKind(event.target.value as OperationalAttachmentFilters["kind"])}
            className="h-9 w-full sm:w-56"
            aria-label={labels.allKinds}
          >
            <option value="all">{labels.allKinds}</option>
            <option value="task">{labels.task}</option>
            <option value="event">{labels.event}</option>
          </NativeComboboxSelect>
          <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setVersion((value) => value + 1)}>
            <RefreshCw className="size-3.5" />
            {labels.refresh}
          </Button>
        </div>

        {error ? (
          <div role="alert" className="border-b border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex min-h-52 items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {labels.loading}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
            <Files className="mb-3 size-8 opacity-50" />
            {labels.empty}
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center px-5 text-center text-sm text-muted-foreground">
            <Search className="mb-3 size-8 opacity-50" />
            {labels.noResults}
          </div>
        ) : (
          <div role="table" aria-label={labels.title}>
            <div role="row" className="hidden grid-cols-[minmax(12rem,1.1fr)_minmax(12rem,1fr)_minmax(11rem,0.9fr)_minmax(10rem,0.75fr)_5rem] gap-3 border-b border-border/60 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
              <span role="columnheader">{labels.file}</span>
              <span role="columnheader">{labels.related}</span>
              <span role="columnheader">{labels.profile}</span>
              <span role="columnheader">{labels.uploaded}</span>
              <span role="columnheader" className="text-right">{labels.actions}</span>
            </div>
            {filteredRows.map((row) => (
              <div
                key={row.id}
                role="row"
                className="grid min-w-0 gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(12rem,1.1fr)_minmax(12rem,1fr)_minmax(11rem,0.9fr)_minmax(10rem,0.75fr)_5rem] lg:items-center"
              >
                <div role="cell" className="flex min-w-0 items-center gap-2.5">
                  <FileIcon mimeType={row.mime_type} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground" title={row.file_name}>{row.file_name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{formatTaskAttachmentSize(row.file_size)}</p>
                  </div>
                </div>

                <div role="cell" className="min-w-0">
                  <button
                    type="button"
                    className="group flex max-w-full items-start gap-1.5 text-left text-sm font-medium text-foreground hover:text-orange-700"
                    onClick={() => staffGo(`/task-manager?task=${encodeURIComponent(row.task_id)}`)}
                  >
                    <span className="truncate">{row.task_title}</span>
                    <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="rounded-full text-[10px]">
                      {row.task_kind === "event" ? labels.eventKind : labels.taskKind}
                    </Badge>
                    <Badge variant="outline" className={cn("rounded-full text-[10px]", statusTone(row.task_status))}>
                      {statusLabel(row.task_status, lang)}
                    </Badge>
                  </div>
                </div>

                <div role="cell" className="min-w-0 space-y-1">
                  {row.patient_id && row.patient_name ? (
                    canStaffPath("/patients") ? (
                      <button type="button" className="flex max-w-full items-center gap-1.5 text-left text-xs font-medium text-foreground hover:text-orange-700" onClick={() => staffGo(`/patients/${encodeURIComponent(row.patient_id ?? "")}`)} title={labels.openPatient}>
                        <UserRound className="size-3.5 shrink-0" /><span className="truncate">{row.patient_name}</span>
                      </button>
                    ) : <p className="truncate text-xs text-foreground">{row.patient_name}</p>
                  ) : null}
                  {row.provider_id && row.provider_name ? (
                    canStaffPath("/providers") ? (
                      <button type="button" className="flex max-w-full items-center gap-1.5 text-left text-xs font-medium text-foreground hover:text-orange-700" onClick={() => staffGo(`/providers/${encodeURIComponent(row.provider_id ?? "")}`)} title={labels.openProvider}>
                        <UserRound className="size-3.5 shrink-0" /><span className="truncate">{row.provider_name}</span>
                      </button>
                    ) : <p className="truncate text-xs text-foreground">{row.provider_name}</p>
                  ) : null}
                  {!row.patient_name && !row.provider_name ? <p className="text-xs text-muted-foreground">{labels.noProfile}</p> : null}
                </div>

                <div role="cell" className="min-w-0 text-xs text-muted-foreground">
                  <p className="truncate font-medium text-foreground">{row.uploaded_by_name || "—"}</p>
                  <p className="mt-1 inline-flex items-center gap-1.5">
                    <CalendarClock className="size-3.5" />
                    {formatUploadedAt(row.created_at, lang)}
                  </p>
                </div>

                <div role="cell" className="flex justify-start lg:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    title={labels.download}
                    aria-label={`${labels.download}: ${row.file_name}`}
                    disabled={Boolean(downloadingId)}
                    onClick={() => void download(row)}
                  >
                    {downloadingId === row.id ? <LoaderCircle className="animate-spin" /> : <Download />}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
