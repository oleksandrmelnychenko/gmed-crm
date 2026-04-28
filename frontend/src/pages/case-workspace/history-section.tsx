import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { CountBadge } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";

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
        <CountBadge>
          {detail?.version_count ?? history.length}{" "}
          {tri(lang, "Revisionen", "ревизий", "revisions")}
        </CountBadge>
      }
    >
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {tri(
              lang,
              "Noch keine Revisionen.",
              "Ревизий пока нет.",
              "No revisions yet.",
            )}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
    <li className="rounded-xl border border-border/50 bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
        <p className="text-sm font-medium text-foreground">
          {entry.section || tri(lang, "Unbekannt", "Неизвестно", "Unknown")}
        </p>
        <Badge
          variant="outline"
          className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
        >
          {formatDateTime(lang, entry.created_at)}
        </Badge>
      </div>
      <p className="mt-2 text-[13px] text-muted-foreground">
        <span className="text-[11.5px] font-medium text-muted-foreground">
          {tri(lang, "Geändert von", "Изменено", "Changed by")}
        </span>
        {" · "}
        <span className="text-foreground">
          {entry.changed_by_name || entry.changed_by}
        </span>
        {entry.changed_by_role ? (
          <span className="ml-1 text-muted-foreground">
            ({entry.changed_by_role})
          </span>
        ) : null}
      </p>
    </li>
  );
}
