import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, Trash2, Upload } from "lucide-react";

import { AdminTableCard } from "@/components/admin-page-patterns";
import { DataTableSurface } from "@/components/data-table/data-table-surface";
import type { ColumnDef } from "@/components/data-table/types";
import { Banner, EmptyCell, TabLoader } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { formatAppDateTime } from "@/lib/app-time-zone";
import { formatUiText, useLang } from "@/lib/i18n";

import {
  personnelApi,
  type PersonnelCategory,
  type PersonnelEmployeeRow,
  type PersonnelIntakeItem,
} from "./api";
import { ArchiveDialog } from "./archive-dialog";
import { PERSONNEL_FILE_ACCEPT, formatFileSize, validatePersonnelFile } from "./model";
import {
  FilePreviewDialog,
  ReasonDialog,
  RowIconAction,
  errorMessage,
  previewColumn,
  sourceLabel,
} from "./personnel-ui";

/**
 * Header action of the intake tab: uploads one or more files into the scan
 * intake (several at once when a paper archive is digitised).
 */
export function IntakeUploadButton({ onUploaded }: { onUploaded: () => void }) {
  const { t } = useLang();
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const upload = async (files: readonly File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    let added = 0;
    // One request per file, so a refused file does not stop the rest.
    for (const file of files) {
      const problem = validatePersonnelFile(file);
      if (problem) {
        toast.error(
          `${file.name}: ${problem === "unsupported" ? t.personnel_file_unsupported : t.personnel_file_too_large}`,
        );
        continue;
      }
      try {
        await personnelApi.uploadIntake(file);
        added += 1;
      } catch (reason) {
        toast.error(`${file.name}: ${errorMessage(reason, t.common_failed_create)}`);
      }
    }
    if (added > 0) {
      toast.success(
        files.length === 1 ? t.personnel_intake_uploaded : formatUiText(t.personnel_intake_uploaded_many, { count: added }),
      );
      onUploaded();
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <>
      <Button
        type="button"
        className="h-9 gap-1.5 rounded-lg px-3.5"
        disabled={uploading}
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {t.personnel_intake_add}
      </Button>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        multiple
        accept={PERSONNEL_FILE_ACCEPT}
        aria-label={t.personnel_intake_add}
        onChange={(event) => void upload(Array.from(event.target.files ?? []))}
      />
    </>
  );
}

/**
 * Scan intake of personnel documents: scans (`gmed-scan --personnel`) and
 * manual uploads wait here until they are filed into a personnel file under
 * a generated name, or discarded with a reason.
 */
export function IntakeTab({
  categories,
  reloadKey,
}: {
  categories: readonly PersonnelCategory[];
  /** Changes after an upload from the page header. */
  reloadKey: number;
}) {
  const { t } = useLang();
  const tr = t as unknown as Record<string, string>;
  const [items, setItems] = useState<PersonnelIntakeItem[]>([]);
  const [employees, setEmployees] = useState<PersonnelEmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [previewItem, setPreviewItem] = useState<PersonnelIntakeItem | null>(null);
  const [assignItem, setAssignItem] = useState<PersonnelIntakeItem | null>(null);
  const [discardItem, setDiscardItem] = useState<PersonnelIntakeItem | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    Promise.all([personnelApi.intake(), personnelApi.employees()])
      .then(([queue, list]) => {
        setItems(queue);
        setEmployees(list.employees);
      })
      .catch((reason: unknown) => setError(errorMessage(reason, t.common_failed_load)))
      .finally(() => setLoading(false));
  }, [t.common_failed_load]);

  useEffect(() => load(), [load, reloadKey]);

  const assignMode = assignItem
    ? {
        kind: "intake" as const,
        item: assignItem,
        employees: [...employees].sort((a, b) => Number(b.is_active) - Number(a.is_active)),
      }
    : null;

  const columns = useMemo<ColumnDef<PersonnelIntakeItem>[]>(
    () => [
      previewColumn<PersonnelIntakeItem>({
        label: t.personnel_preview,
        getTitle: (item) => item.original_file_name,
        onPreview: setPreviewItem,
      }),
      {
        id: "file",
        label: t.personnel_intake_original_name,
        accessor: (item) => item.original_file_name,
        filterType: "text",
        sortable: true,
        required: true,
        width: 320,
        render: (item) => (
          <span className="truncate font-mono text-xs text-foreground" title={item.original_file_name}>
            {item.original_file_name}
          </span>
        ),
      },
      {
        id: "received_at",
        label: t.personnel_received_at,
        accessor: (item) => item.received_at,
        filterType: "date",
        sortable: true,
        width: 160,
        render: (item) => <span className="text-xs tabular-nums">{formatAppDateTime(item.received_at)}</span>,
      },
      {
        id: "source",
        label: t.personnel_source,
        accessor: (item) => sourceLabel(t, item.source),
        filterType: "enum",
        filterOptions: ["upload", "scan"].map((source) => ({
          value: sourceLabel(t, source),
          label: sourceLabel(t, source),
        })),
        sortable: true,
        width: 110,
      },
      {
        id: "file_size",
        label: t.personnel_file_size,
        accessor: (item) => item.file_size,
        filterType: "number",
        sortable: true,
        align: "right",
        width: 90,
        render: (item) => formatFileSize(item.file_size),
      },
      {
        id: "uploaded_by",
        label: t.personnel_uploaded_by,
        accessor: (item) => item.uploaded_by_name ?? "",
        filterType: "text",
        sortable: true,
        width: 180,
        render: (item) => <span className="truncate text-xs">{item.uploaded_by_name || "—"}</span>,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-3">
      {error ? <Banner tone="error">{error}</Banner> : null}
      <AdminTableCard title={t.personnel_tab_intake} count={loading && items.length === 0 ? undefined : items.length}>
        <p className="px-1 text-xs text-muted-foreground">{t.personnel_intake_intro}</p>
        {loading && items.length === 0 ? (
          <TabLoader />
        ) : (
          <DataTableSurface
            rows={items}
            columns={columns}
            rowId={(item) => item.id}
            defaultDensity="comfortable"
            defaultSort={[{ field: "received_at", dir: "desc" }]}
            dictionary={tr}
            storageKey="personnel-intake"
            onRowClick={setPreviewItem}
            rowAccent={() => "bg-amber-500"}
            rowActions={(item) => (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md px-2 text-xs"
                  onClick={(event) => {
                    event.stopPropagation();
                    setAssignItem(item);
                  }}
                >
                  {t.personnel_intake_assign}
                </Button>
                <RowIconAction
                  icon={Trash2}
                  label={t.personnel_intake_discard}
                  destructive
                  onClick={() => setDiscardItem(item)}
                />
              </>
            )}
            rowActionsAlwaysVisible
            rowActionsWidth={156}
            mobilePrimaryColumnId="file"
            mobileDetailColumnIds={["received_at", "source", "file_size", "uploaded_by"]}
            emptyState={<EmptyCell>{t.personnel_intake_empty}</EmptyCell>}
          />
        )}
      </AdminTableCard>

      <FilePreviewDialog
        open={Boolean(previewItem)}
        fileName={previewItem?.original_file_name ?? ""}
        mimeType={previewItem?.mime_type ?? ""}
        load={() => personnelApi.intakeFile(previewItem?.id ?? "")}
        onClose={() => setPreviewItem(null)}
      />
      <ArchiveDialog
        open={Boolean(assignItem)}
        mode={assignMode}
        categories={categories}
        onClose={() => setAssignItem(null)}
        onArchived={(document) => {
          toast.success(formatUiText(t.personnel_archived_toast, { name: document.archive_file_name }));
          load();
        }}
      />
      <ReasonDialog
        open={Boolean(discardItem)}
        title={t.personnel_intake_discard_title}
        description={discardItem?.original_file_name}
        confirmLabel={t.personnel_intake_discard}
        destructive
        onConfirm={async (reason) => {
          if (!discardItem) return;
          await personnelApi.discardIntake(discardItem.id, reason);
          load();
        }}
        onClose={() => setDiscardItem(null)}
      />
    </div>
  );
}
