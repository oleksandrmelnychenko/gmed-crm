import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { CountBadge } from "@/components/ui-shell";
import { formatEnumLabelFromKeys, useLang, type Translations } from "@/lib/i18n";
import { CASE_HISTORY_SECTION_LABEL_KEYS } from "@/lib/i18n/catalogs/cases-clinical";

import { type CaseHistoryEntry, useCaseWorkspace } from "./context";
import { Panel } from "./primitives";

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
  const { lang, t } = useLang();
  const { detail } = useCaseWorkspace();

  const history = useMemo(() => detail?.history ?? [], [detail?.history]);

  return (
    <Panel
      title={t.cases_workspace_history_title}
      description={t.cases_workspace_history_description}
      action={
        <CountBadge>
          {detail?.version_count ?? history.length}{" "}
          {t.cases_workspace_history_revisions}
        </CountBadge>
      }
    >
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {t.cases_workspace_history_empty_title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t.cases_workspace_history_empty_description}
          </p>
        </div>
      ) : (
        <ol className="space-y-3">
          {history.map((entry) => (
            <HistoryRow key={entry.id} entry={entry} lang={lang} t={t} />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function HistoryRow({
  entry,
  lang,
  t,
}: {
  entry: CaseHistoryEntry;
  lang: string;
  t: Translations;
}) {
  const sectionLabel = entry.section
    ? formatEnumLabelFromKeys(entry.section, CASE_HISTORY_SECTION_LABEL_KEYS, t)
    : t.common_unknown;

  return (
    <li className="rounded-xl border border-border/50 bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
        <p className="text-sm font-medium text-foreground">
          {sectionLabel}
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
          {t.cases_workspace_history_changed_by}
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
