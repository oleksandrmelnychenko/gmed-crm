import { useMemo } from "react";

import { CountBadge } from "@/components/ui-shell";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import { DEFAULT_DATA_TABLE_PAGE_SIZE } from "@/components/data-table/data-table-pager";
import type { ColumnDef } from "@/components/data-table/types";
import { formatEnumLabelFromKeys, useLang } from "@/lib/i18n";
import { CASE_HISTORY_SECTION_LABEL_KEYS } from "@/lib/i18n/catalogs/cases-clinical";
import { cn } from "@/lib/utils";

import { type CaseHistoryEntry, useCaseWorkspace } from "./context";

function localeCode(lang: string) {
  if (lang === "de") return "de-DE";
  if (lang === "ru") return "ru-RU";
  return "en-GB";
}

const HISTORY_DATE_TIME_FORMATTERS: Record<string, Intl.DateTimeFormat> = {
  "de-DE": new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }),
  "ru-RU": new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }),
  "en-GB": new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }),
};

function formatDateTime(lang: string, value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (HISTORY_DATE_TIME_FORMATTERS[localeCode(lang)] ?? HISTORY_DATE_TIME_FORMATTERS["en-GB"]).format(date);
}

const HISTORY_SECTION_CHIP_TONES = [
  "border-sky-200 bg-sky-50 text-sky-700",
  "border-emerald-200 bg-emerald-50 text-emerald-700",
  "border-amber-200 bg-amber-50 text-amber-700",
  "border-violet-200 bg-violet-50 text-violet-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-teal-200 bg-teal-50 text-teal-700",
  "border-indigo-200 bg-indigo-50 text-indigo-700",
  "border-orange-200 bg-orange-50 text-orange-700",
] as const;

function historySectionChipTone(section: string) {
  let hash = 0;
  for (let index = 0; index < section.length; index += 1) {
    hash = (hash * 31 + section.charCodeAt(index)) | 0;
  }
  return HISTORY_SECTION_CHIP_TONES[Math.abs(hash) % HISTORY_SECTION_CHIP_TONES.length];
}

export function HistorySection() {
  const { lang, t } = useLang();
  const { detail } = useCaseWorkspace();

  const history = useMemo(() => detail?.history ?? [], [detail?.history]);

  const sectionLabel = useMemo(
    () => (entry: CaseHistoryEntry) =>
      entry.section
        ? formatEnumLabelFromKeys(entry.section, CASE_HISTORY_SECTION_LABEL_KEYS, t)
        : t.common_unknown,
    [t],
  );

  const columns = useMemo<ColumnDef<CaseHistoryEntry>[]>(
    () => [
      {
        id: "section",
        label: t.cases_workspace_history_title,
        accessor: (entry) => sectionLabel(entry),
        filterType: "enum",
        filterOptions: () =>
          [...new Set(history.map((entry) => sectionLabel(entry)))].map((label) => ({
            value: label,
            label,
          })),
        sortable: true,
        required: true,
        width: 240,
        render: (entry) => (
          <span
            className={cn(
              "inline-flex rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium",
              historySectionChipTone(entry.section ?? ""),
            )}
          >
            {sectionLabel(entry)}
          </span>
        ),
      },
      {
        id: "created_at",
        label: t.users_created,
        accessor: (entry) => entry.created_at ?? "",
        filterType: "date",
        sortable: true,
        width: 190,
        render: (entry) => (
          <span className="whitespace-nowrap font-mono text-xs text-foreground">
            {formatDateTime(lang, entry.created_at)}
          </span>
        ),
      },
      {
        id: "changed_by",
        label: t.cases_workspace_history_changed_by,
        accessor: (entry) => entry.changed_by_name || entry.changed_by || "",
        filterType: "text",
        searchable: true,
        sortable: true,
        width: 260,
        render: (entry) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs font-medium text-foreground">
              {entry.changed_by_name || entry.changed_by}
            </span>
            {entry.changed_by_role ? (
              <span className="inline-flex shrink-0 rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
                {entry.changed_by_role}
              </span>
            ) : null}
          </span>
        ),
      },
    ],
    [history, lang, sectionLabel, t],
  );

  return (
    <DataTableSurface
      rows={history}
      columns={columns}
      rowId={(entry) => String(entry.id)}
      dictionary={t as unknown as Record<string, string>}
      pagination={{
        pageSize: DEFAULT_DATA_TABLE_PAGE_SIZE,
        resetKey: String(history.length),
      }}
      emptyState={
        <div className="px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            {t.cases_workspace_history_empty_title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t.cases_workspace_history_empty_description}
          </p>
        </div>
      }
      toolbarStart={
        <>
          <span className="flex shrink-0 items-center gap-2 self-center text-[13px] font-semibold tracking-tight text-foreground">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            {t.cases_workspace_history_title}
          </span>
          <span className="shrink-0 self-center">
            <CountBadge>
              {detail?.version_count ?? history.length} {t.cases_workspace_history_revisions}
            </CountBadge>
          </span>
          <span aria-hidden className="mx-1 h-4 w-px shrink-0 self-center bg-border" />
        </>
      }
    />
  );
}
