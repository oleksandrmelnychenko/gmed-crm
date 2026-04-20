import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type DocumentsGridItem = {
  id: string;
  auto_name: string;
  original_filename: string | null;
  version_number: number;
  is_latest_version: boolean;
  patient_name: string | null;
  patient_pid: string | null;
  art: string;
  category: string | null;
  status: string;
  visibility: string;
  data_sensitivity: string;
  file_size: number | null;
  uploaded_by_name: string | null;
  updated_at: string;
  needs_categorization: boolean;
};

type DocumentsGridLabels = {
  selectBulkShare: string;
  filename: string;
  patient: string;
  category: string;
  status: string;
  visibility: string;
  size: string;
  uploadedBy: string;
  unclassified: string;
  current: string;
  pidFallback: string;
  notSet: string;
  unknownUploader: string;
  needsCategorization: string;
};

type DocumentsGridProps = {
  documents: DocumentsGridItem[];
  selectedDocumentIds: string[];
  selectedId: string | null;
  showSelection?: boolean;
  labels: DocumentsGridLabels;
  localizeCode: (value: string) => string;
  onSelectionChange: (ids: string[]) => void;
  onToggleSelection: (id: string, checked: boolean) => void;
  onOpenDocument: (id: string) => void;
  statusBadge: (value: string) => string;
  visibilityBadge: (value: string) => string;
  sensitivityBadge: (value: string) => string;
  formatStatusLabel: (value: string) => string;
  formatVisibilityLabel: (value: string) => string;
  formatSensitivityLabel: (value: string) => string;
  formatFileSize: (value: number | null) => string;
  formatDateTime: (value?: string | null) => string;
};

export function DocumentsGrid({
  documents,
  selectedDocumentIds,
  selectedId,
  showSelection = true,
  labels,
  localizeCode,
  onSelectionChange,
  onToggleSelection,
  onOpenDocument,
  statusBadge,
  visibilityBadge,
  sensitivityBadge,
  formatStatusLabel,
  formatVisibilityLabel,
  formatSensitivityLabel,
  formatFileSize,
  formatDateTime,
}: DocumentsGridProps) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40">
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              {showSelection ? (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={labels.selectBulkShare}
                    checked={
                      documents.length > 0 &&
                      documents.every((d) => selectedDocumentIds.includes(d.id))
                    }
                    onChange={(event) =>
                      onSelectionChange(
                        event.target.checked ? documents.map((d) => d.id) : [],
                      )
                    }
                    className="size-4 rounded border-input"
                  />
                </th>
              ) : null}
              <th className="px-3 py-2.5 font-medium">{labels.filename}</th>
              <th className="px-3 py-2.5 font-medium">{labels.patient}</th>
              <th className="px-3 py-2.5 font-medium">{labels.category}</th>
              <th className="px-3 py-2.5 font-medium">{labels.status}</th>
              <th className="px-3 py-2.5 font-medium">{labels.visibility}</th>
              <th className="px-3 py-2.5 font-medium text-right">{labels.size}</th>
              <th className="px-3 py-2.5 font-medium">{labels.uploadedBy}</th>
            </tr>
          </thead>
          <tbody>
            {documents.map((item) => (
              <tr
                key={item.id}
                className={cn(
                  "group/row border-t border-border transition-colors hover:bg-muted/40 cursor-pointer",
                  selectedId === item.id && "bg-sky-50/60",
                )}
                onClick={() => onOpenDocument(item.id)}
              >
                {showSelection ? (
                  <td
                    className="w-10 px-3 py-2.5"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={labels.selectBulkShare}
                      checked={selectedDocumentIds.includes(item.id)}
                      onChange={(event) =>
                        onToggleSelection(item.id, event.target.checked)
                      }
                      className="size-4 rounded border-input"
                    />
                  </td>
                ) : null}
                <td className="px-3 py-2.5 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate font-medium text-foreground">
                      {localizeCode(item.auto_name)}
                    </span>
                    {item.needs_categorization ? (
                      <Badge
                        variant="outline"
                        className="rounded-full text-[10px] border-amber-200 bg-amber-50 text-amber-700 shrink-0"
                      >
                        {labels.needsCategorization}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                    <span className="truncate">
                      {item.original_filename ?? labels.unclassified}
                    </span>
                    <span className="text-muted-foreground/60">·</span>
                    <span>v{item.version_number}</span>
                    {item.is_latest_version ? (
                      <>
                        <span className="text-muted-foreground/60">·</span>
                        <span>{labels.current}</span>
                      </>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {item.patient_name ? (
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.patient_pid ?? labels.pidFallback}
                      </span>
                      <div className="truncate text-foreground">{item.patient_name}</div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{labels.notSet}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {item.art || item.category ? (
                    <div className="min-w-0">
                      {item.art ? (
                        <div className="truncate text-foreground">
                          {localizeCode(item.art)}
                        </div>
                      ) : null}
                      {item.category ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {localizeCode(item.category)}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{labels.unclassified}</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusBadge(item.status))}
                  >
                    {formatStatusLabel(item.status)}
                  </Badge>
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-col items-start gap-1">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full text-[10px]",
                        visibilityBadge(item.visibility),
                      )}
                    >
                      {formatVisibilityLabel(item.visibility)}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full text-[10px]",
                        sensitivityBadge(item.data_sensitivity),
                      )}
                    >
                      {formatSensitivityLabel(item.data_sensitivity)}
                    </Badge>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {formatFileSize(item.file_size)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="text-foreground truncate">
                    {item.uploaded_by_name || labels.unknownUploader}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(item.updated_at)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
