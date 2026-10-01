import { useCallback, useMemo, type ReactNode } from "react";
import { Lock, Scale } from "lucide-react";

import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { EmptyCell, StatusBadge } from "@/components/ui-shell";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";

import type { PersonnelDocument } from "./api";
import {
  documentSortKey,
  documentTableRows,
  formatDocumentPeriod,
  formatFileSize,
  type DocumentTableRow,
} from "./model";
import { TableTitle, categoryLabel, previewColumn, sourceLabel } from "./personnel-ui";

type Row = DocumentTableRow<PersonnelDocument>;

/**
 * Documents of one personnel file in the app's document table: one row per
 * document (its newest version) with the older versions indented under it.
 * Archived documents are never edited, so the only actions are the ones the
 * caller passes (download, correction, legal hold, delete).
 */
export function PersonnelDocumentsTable({
  documents,
  categoryOrder,
  title,
  rowActions,
  rowActionsWidth,
  onPreview,
  showInternal = true,
  emptyText,
  storageKey,
}: {
  documents: readonly PersonnelDocument[];
  categoryOrder: readonly string[];
  title: ReactNode;
  rowActions: (document: PersonnelDocument, isCurrent: boolean) => ReactNode;
  rowActionsWidth: number;
  onPreview: (document: PersonnelDocument) => void;
  /** Archive metadata for staff (archived by, retention, legal hold, hash, deletion). */
  showInternal?: boolean;
  emptyText: string;
  storageKey: string;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const { rows, history } = useMemo(() => documentTableRows(documents), [documents]);
  const expandRow = useCallback((row: Row) => (row.isChild ? null : history.get(row.document.id) ?? null), [history]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const rank = (code: string) => {
      const index = categoryOrder.indexOf(code);
      return index === -1 ? categoryOrder.length : index;
    };
    const label = (document: PersonnelDocument) =>
      categoryLabel(t, document.category, document.category_label);
    const categoryOptions = [...new Set(documents.map((document) => document.category))]
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
      .map((code) => {
        const name = label(documents.find((document) => document.category === code) as PersonnelDocument);
        return { value: name, label: name };
      });
    const marks = (row: Row) => {
      const document = row.document;
      return [
        document.version_number > 1
          ? { key: "version", tone: "info" as const, text: formatUiText(t.personnel_version_badge, { version: document.version_number }) }
          : null,
        !row.isCurrent ? { key: "superseded", tone: "neutral" as const, text: t.personnel_superseded } : null,
        document.archived_late ? { key: "late", tone: "warning" as const, text: t.personnel_archived_late } : null,
        showInternal && document.legal_hold ? { key: "hold", tone: "brand" as const, text: t.personnel_legal_hold } : null,
        document.deleted_at ? { key: "deleted", tone: "error" as const, text: t.personnel_deleted } : null,
        document.is_health ? { key: "health", tone: "warning" as const, text: t.personnel_health_badge } : null,
      ].filter((mark) => mark !== null);
    };
    const note = (document: PersonnelDocument) => {
      if (showInternal && document.deleted_at) {
        return [formatAppDateTime(document.deleted_at), document.deleted_by_name, document.delete_reason]
          .filter(Boolean)
          .join(" · ");
      }
      return document.correction_reason ?? "";
    };

    const all: (ColumnDef<Row> | null)[] = [
      previewColumn<Row>({
        label: t.personnel_preview,
        getTitle: (row) => row.document.archive_file_name,
        onPreview: (row) => onPreview(row.document),
      }),
      {
        id: "category",
        label: t.personnel_category,
        accessor: (row) => label(row.document),
        filterType: "enum",
        filterOptions: categoryOptions,
        sortable: true,
        width: 190,
        render: (row) =>
          row.isChild ? (
            <span aria-hidden className="pl-2 font-mono text-xs text-muted-foreground">└</span>
          ) : (
            <span className="truncate text-xs font-medium text-foreground" title={label(row.document)}>
              {label(row.document)}
            </span>
          ),
      },
      {
        id: "period",
        label: t.personnel_period,
        accessor: (row) => documentSortKey(row.document),
        filterType: "text",
        sortable: true,
        width: 110,
        render: (row) => (
          <span className="font-mono text-xs tabular-nums text-foreground">{formatDocumentPeriod(row.document)}</span>
        ),
      },
      {
        id: "archive_file_name",
        label: t.personnel_will_be_archived_as,
        accessor: (row) => row.document.archive_file_name,
        filterType: "text",
        sortable: true,
        required: true,
        width: 360,
        render: (row) => (
          <span
            className="flex min-w-0 items-center gap-1.5"
            style={{ paddingLeft: row.isChild ? 14 : 0 }}
            title={row.document.archive_file_name}
          >
            <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t.personnel_immutable} />
            <span className={row.document.deleted_at ? "truncate font-mono text-xs text-muted-foreground line-through" : "truncate font-mono text-xs text-foreground"}>
              {row.document.archive_file_name}
            </span>
          </span>
        ),
      },
      {
        id: "title",
        label: t.personnel_title_optional,
        accessor: (row) => row.document.title ?? "",
        filterType: "text",
        sortable: true,
        width: 180,
        render: (row) =>
          row.document.title ? (
            <span className="truncate text-xs text-foreground" title={row.document.title}>{row.document.title}</span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
      {
        id: "marks",
        label: t.personnel_document_marks,
        accessor: (row) => marks(row).map((mark) => mark.text).join(" "),
        filterType: "text",
        width: 220,
        cellClassName: "flex items-center gap-1 overflow-hidden",
        render: (row) =>
          marks(row).map((mark) => (
            <StatusBadge key={mark.key} tone={mark.tone} className="shrink-0">
              {mark.key === "hold" ? <Scale className="size-3" /> : null}
              {mark.text}
            </StatusBadge>
          )),
      },
      {
        id: "note",
        label: t.personnel_document_note,
        accessor: (row) => note(row.document),
        filterType: "text",
        width: 220,
        render: (row) => {
          const text = note(row.document);
          if (!text) return <span className="text-xs text-muted-foreground">—</span>;
          return (
            <span
              className={row.document.deleted_at && showInternal ? "truncate text-xs text-destructive" : "truncate text-xs text-foreground"}
              title={row.document.correction_reason ? `${t.personnel_correction_reason}: ${text}` : text}
            >
              {text}
            </span>
          );
        },
      },
      {
        id: "archived_at",
        label: t.personnel_archived_at,
        accessor: (row) => row.document.archived_at,
        filterType: "date",
        sortable: true,
        width: 150,
        render: (row) => (
          <span className="text-xs tabular-nums text-foreground">{formatAppDateTime(row.document.archived_at)}</span>
        ),
      },
      showInternal
        ? {
            id: "archived_by",
            label: t.personnel_archived_by,
            accessor: (row) => row.document.archived_by_name ?? "",
            filterType: "text",
            sortable: true,
            width: 160,
            render: (row) => <span className="truncate text-xs text-foreground">{row.document.archived_by_name || "—"}</span>,
          }
        : null,
      {
        id: "source",
        label: t.personnel_source,
        accessor: (row) => sourceLabel(t, row.document.source),
        filterType: "enum",
        filterOptions: ["upload", "scan", "import"].map((source) => ({
          value: sourceLabel(t, source),
          label: sourceLabel(t, source),
        })),
        sortable: true,
        width: 110,
        render: (row) => <span className="text-xs text-foreground">{sourceLabel(t, row.document.source)}</span>,
      },
      {
        id: "file_size",
        label: t.personnel_file_size,
        accessor: (row) => row.document.file_size,
        filterType: "number",
        sortable: true,
        align: "right",
        width: 90,
        render: (row) => formatFileSize(row.document.file_size),
      },
      showInternal
        ? {
            id: "retention_until",
            label: t.personnel_retention_until,
            accessor: (row) => row.document.retention_until ?? "",
            filterType: "date",
            sortable: true,
            width: 120,
            render: (row) => (
              <span className="text-xs tabular-nums text-foreground">
                {row.document.retention_until ? formatAppDate(row.document.retention_until) : "—"}
              </span>
            ),
          }
        : null,
      showInternal
        ? {
            id: "sha256",
            label: "SHA-256",
            accessor: (row) => row.document.sha256,
            filterType: "text",
            width: 240,
            render: (row) => (
              <span className="truncate font-mono text-[11px] text-muted-foreground" title={row.document.sha256}>
                {row.document.sha256}
              </span>
            ),
          }
        : null,
    ];
    return all.filter((column): column is ColumnDef<Row> => column !== null);
  }, [categoryOrder, documents, onPreview, showInternal, t]);

  return (
    <DataTableSurface
      rows={rows}
      columns={columns}
      rowId={(row) => row.document.id}
      expandRow={expandRow}
      defaultDensity="comfortable"
      defaultHiddenColumns={showInternal ? ["sha256"] : []}
      dictionary={tr}
      storageKey={storageKey}
      onRowClick={(row) => onPreview(row.document)}
      rowBackground={(row) => (row.isChild ? "color-mix(in oklch, var(--muted) 35%, transparent)" : null)}
      rowActions={(row) => (row.document.deleted_at ? null : rowActions(row.document, row.isCurrent))}
      rowActionsAlwaysVisible
      rowActionsWidth={rowActionsWidth}
      mobilePrimaryColumnId="archive_file_name"
      mobileDetailColumnIds={["category", "period", "marks", "archived_at", "file_size", "note"]}
      toolbarStart={<TableTitle count={rows.length}>{title}</TableTitle>}
      emptyState={<EmptyCell>{emptyText}</EmptyCell>}
    />
  );
}
