import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { type CaseHistoryEntry, useCaseWorkspace } from "./context";
import { Panel } from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function localeCode(lang: string) {
  if (lang === "de") return "de-DE";
  if (lang === "ru") return "ru-RU";
  return "en-GB";
}

function formatDateTime(lang: string, value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(localeCode(lang), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function HistorySection() {
  const { lang } = useLang();
  const { detail } = useCaseWorkspace();

  const history = useMemo(() => detail?.history ?? [], [detail?.history]);

  return (
    <Panel
      title={tri(lang, "Verlauf", "История", "History")}
      description={tri(
        lang,
        "Append-only Historie der Änderungen in diesem Fall.",
        "Неизменяемая история изменений в кейсе.",
        "Append-only history of changes in this case.",
      )}
      action={
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
            history.length > 0
              ? "border-orange-200 bg-orange-50 text-orange-700"
              : "border-slate-200 bg-slate-50 text-slate-500",
          )}
        >
          {history.length > 0 ? (
            <span aria-hidden className="size-1.5 rounded-full bg-orange-500" />
          ) : null}
          {detail?.version_count ?? history.length}{" "}
          {tri(lang, "Revisionen", "ревизий", "revisions")}
        </span>
      }
    >
      {history.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-slate-700">
            {tri(
              lang,
              "Noch keine Revisionen.",
              "Ревизий пока нет.",
              "No revisions yet.",
            )}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
            {tri(
              lang,
              "Jede Speicherung erzeugt einen Eintrag in der Historie.",
              "Каждое сохранение добавляет запись в историю.",
              "Every save creates an entry in the history.",
            )}
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {history.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} lang={lang} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function HistoryRow({
  entry,
  lang,
}: {
  entry: CaseHistoryEntry;
  lang: string;
}) {
  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-orange-500" />
        <p className="text-sm font-semibold text-slate-950">
          {entry.section || tri(lang, "Unbekannt", "Неизвестно", "Unknown")}
        </p>
        <Badge
          variant="outline"
          className="rounded-full border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600"
        >
          {formatDateTime(lang, entry.created_at)}
        </Badge>
      </div>
      <p className="mt-2 text-[13px] text-slate-600">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {tri(lang, "Geändert von", "Изменено", "Changed by")}
        </span>
        {" · "}
        <span className="text-slate-800">
          {entry.changed_by_name || entry.changed_by}
        </span>
        {entry.changed_by_role ? (
          <span className="ml-1 text-slate-500">({entry.changed_by_role})</span>
        ) : null}
      </p>
    </li>
  );
}
