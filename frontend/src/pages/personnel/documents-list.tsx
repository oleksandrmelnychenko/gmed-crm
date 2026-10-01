import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, FileText, Lock, Scale, Trash2 } from "lucide-react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { formatAppDate, formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";

import type { PersonnelDocument } from "./api";
import {
  formatDocumentPeriod,
  formatFileSize,
  groupByCategory,
  groupDocumentVersions,
  type DocumentVersionGroup,
} from "./model";
import { ArchiveName, categoryLabel, sourceLabel } from "./personnel-ui";

type DocumentActions = (document: PersonnelDocument, isCurrent: boolean) => ReactNode;

/**
 * Documents of one personnel file grouped by category; each document shows
 * its newest version with the older versions (and their correction reasons)
 * on demand. Archived documents are never edited, so the only actions are
 * the ones the caller passes (preview, download, correction, legal hold).
 */
export function PersonnelDocumentsList({
  documents,
  categoryOrder,
  actions,
  showInternal = true,
  emptyText,
}: {
  documents: readonly PersonnelDocument[];
  categoryOrder: readonly string[];
  actions: DocumentActions;
  /** Archive metadata for staff (archived by, retention, legal hold, hash). */
  showInternal?: boolean;
  emptyText: string;
}) {
  const { t } = useLang();
  const sections = useMemo(
    () => groupByCategory(groupDocumentVersions(documents), categoryOrder),
    [categoryOrder, documents],
  );

  if (sections.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-muted-foreground">
        <FileText className="size-5" />
        <span className="text-sm">{emptyText}</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map((section) => {
        const label = categoryLabel(
          t,
          section.category,
          section.groups[0]?.current.category_label,
        );
        return (
          <section key={section.category} className="space-y-2">
            <div className="flex items-center gap-2">
              <AdminSectionTitle>{label}</AdminSectionTitle>
              <span className="text-xs text-muted-foreground">{section.groups.length}</span>
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {section.groups.map((group) => (
                <DocumentGroupRow
                  key={group.rootId}
                  group={group}
                  actions={actions}
                  showInternal={showInternal}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DocumentGroupRow({
  group,
  actions,
  showInternal,
}: {
  group: DocumentVersionGroup<PersonnelDocument>;
  actions: DocumentActions;
  showInternal: boolean;
}) {
  const { t } = useLang();
  const [expanded, setExpanded] = useState(false);
  const { current, history } = group;

  return (
    <li className="px-3 py-2.5">
      <DocumentLine document={current} actions={actions} isCurrent showInternal={showInternal} />
      {history.length > 0 ? (
        <div className="mt-1.5">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
            {formatUiText(t.personnel_versions_history, { count: history.length })}
          </Button>
          {expanded ? (
            <ul className="mt-1 space-y-2 border-l-2 border-border pl-3">
              {history.map((version) => (
                <li key={version.id}>
                  <DocumentLine
                    document={version}
                    actions={actions}
                    isCurrent={false}
                    showInternal={showInternal}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DocumentLine({
  document,
  actions,
  isCurrent,
  showInternal,
}: {
  document: PersonnelDocument;
  actions: DocumentActions;
  isCurrent: boolean;
  showInternal: boolean;
}) {
  const { t } = useLang();
  const deleted = Boolean(document.deleted_at);
  const archivedBy = document.archived_by_name
    ? ` · ${document.archived_by_name}`
    : "";

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-foreground">
            {formatDocumentPeriod(document)}
          </span>
          {document.title ? (
            <span className="text-sm text-muted-foreground">{document.title}</span>
          ) : null}
          {document.version_number > 1 ? (
            <StatusBadge tone="info">
              {formatUiText(t.personnel_version_badge, { version: document.version_number })}
            </StatusBadge>
          ) : null}
          {!isCurrent ? <StatusBadge tone="neutral">{t.personnel_superseded}</StatusBadge> : null}
          {document.archived_late ? (
            <StatusBadge tone="warning">{t.personnel_archived_late}</StatusBadge>
          ) : null}
          {showInternal && document.legal_hold ? (
            <StatusBadge tone="brand">
              <Scale className="size-3" />
              {t.personnel_legal_hold}
            </StatusBadge>
          ) : null}
          {deleted ? <StatusBadge tone="error">{t.personnel_deleted}</StatusBadge> : null}
          {document.is_health ? (
            <StatusBadge tone="warning">{t.personnel_health_badge}</StatusBadge>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <Lock className="size-3 shrink-0 text-muted-foreground" aria-label={t.personnel_immutable} />
          <ArchiveName name={document.archive_file_name} />
        </div>
        {document.correction_reason ? (
          <p className="text-xs text-foreground">
            <span className="font-medium">{t.personnel_correction_reason}:</span>{" "}
            {document.correction_reason}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {t.personnel_archived_at} {formatAppDateTime(document.archived_at)}
          {showInternal ? archivedBy : ""} · {sourceLabel(t, document.source)} ·{" "}
          {formatFileSize(document.file_size)}
          {showInternal && document.retention_until
            ? ` · ${t.personnel_retention_until} ${formatAppDate(document.retention_until)}`
            : ""}
        </p>
        {showInternal && deleted ? (
          <p className="flex items-center gap-1 text-xs text-rose-700">
            <Trash2 className="size-3" />
            {formatAppDateTime(document.deleted_at)}
            {document.deleted_by_name ? ` · ${document.deleted_by_name}` : ""}
            {document.delete_reason ? ` · ${document.delete_reason}` : ""}
          </p>
        ) : null}
        {showInternal ? (
          <p className="truncate font-mono text-[10px] text-muted-foreground/70" title={document.sha256}>
            SHA-256 {document.sha256}
          </p>
        ) : null}
      </div>
      {deleted ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">{actions(document, isCurrent)}</div>
      )}
    </div>
  );
}
