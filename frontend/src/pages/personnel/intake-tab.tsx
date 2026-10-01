import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, FileInput, Inbox, LoaderCircle, Trash2, Upload } from "lucide-react";

import { Banner, TabLoader } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
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
import { ArchiveName, FilePreviewDialog, ReasonDialog, errorMessage, sourceLabel } from "./personnel-ui";

/**
 * Scan intake of personnel documents: scans (`gmed-scan --personnel`) and
 * manual uploads (several files at once when a paper archive is digitised) wait here until they are filed into a
 * personnel file under a generated name, or discarded with a reason.
 */
export function IntakeTab({ categories }: { categories: readonly PersonnelCategory[] }) {
  const { t } = useLang();
  const [items, setItems] = useState<PersonnelIntakeItem[]>([]);
  const [employees, setEmployees] = useState<PersonnelEmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<PersonnelIntakeItem | null>(null);
  const [assignItem, setAssignItem] = useState<PersonnelIntakeItem | null>(null);
  const [discardItem, setDiscardItem] = useState<PersonnelIntakeItem | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => load(), [load]);

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
      load();
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
  };

  const assignMode = assignItem
    ? {
        kind: "intake" as const,
        item: assignItem,
        employees: [...employees].sort((a, b) => Number(b.is_active) - Number(a.is_active)),
      }
    : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">{t.personnel_intake_intro}</p>
        <Button type="button" size="sm" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
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
      </div>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading && items.length === 0 ? <TabLoader /> : null}
      {!loading && items.length === 0 && !error ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-muted-foreground">
          <Inbox className="size-5" />
          <span className="text-sm">{t.personnel_intake_empty}</span>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0 space-y-0.5">
                <ArchiveName name={item.original_file_name} />
                <p className="text-xs text-muted-foreground">
                  {formatAppDateTime(item.received_at)} · {sourceLabel(t, item.source)} ·{" "}
                  {formatFileSize(item.file_size)}
                  {item.uploaded_by_name ? ` · ${item.uploaded_by_name}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={() => setPreviewItem(item)}>
                  <Eye />
                  {t.personnel_preview}
                </Button>
                <Button type="button" size="sm" onClick={() => setAssignItem(item)}>
                  <FileInput />
                  {t.personnel_intake_assign}
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={() => setDiscardItem(item)}>
                  <Trash2 />
                  {t.personnel_intake_discard}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <FilePreviewDialog
        open={Boolean(previewItem)}
        title={t.personnel_preview}
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
