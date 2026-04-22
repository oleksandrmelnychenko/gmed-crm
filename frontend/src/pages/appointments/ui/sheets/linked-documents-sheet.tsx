import { memo } from "react";
import { LoaderCircle } from "lucide-react";

import { DocumentsGrid } from "@/components/documents-grid";
import { Banner, EmptyCell } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { localizeDocumentCode } from "@/lib/required-document-labels";
import { appointmentText } from "@/pages/appointments/model/labels";
import { formatDocumentFileSize } from "@/pages/appointments/model/query-builders";
import type { LinkedDocumentItem } from "@/pages/appointments/model/types";
import {
  linkedDocumentSensitivityBadge,
  linkedDocumentStatusBadge,
  linkedDocumentVisibilityBadge,
} from "@/pages/appointments/appearance/linked-document-badges";
import { AppointmentPreviewSheet } from "@/pages/appointments/ui/shared/workspace-primitives";

export type LinkedDocumentsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string;
  items: LinkedDocumentItem[];
  formatDateTime: (value?: string | null) => string;
};

function LinkedDocumentsSheet({
  open,
  onOpenChange,
  loading,
  error,
  items,
  formatDateTime,
}: LinkedDocumentsSheetProps) {
  const { t } = useLang();

  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={appointmentText("Dokumente", "Документы", "Documents")}
      description={appointmentText(
        "Dokumente aus dem aktuellen Termin-Kontext.",
        "Документы из контекста текущего приёма.",
        "Documents from the current appointment context.",
      )}
      maxWidthClassName="sm:max-w-[760px]"
      bodyClassName="px-4 pb-6 pt-4"
    >
      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
          <LoaderCircle className="mr-2 size-4 animate-spin" />
          {appointmentText(
            "Dokumente werden geladen",
            "Загрузка документов",
            "Loading documents",
          )}
        </div>
      ) : error ? (
        <Banner tone="error" withIcon>{error}</Banner>
      ) : items.length === 0 ? (
        <EmptyCell>
          {appointmentText(
            "Keine Dokumente im aktuellen Kontext.",
            "В текущем контексте нет документов.",
            "No documents in this context.",
          )}
        </EmptyCell>
      ) : (
        <DocumentsGrid
          documents={items.map((item) => ({
            ...item,
            is_latest_version: item.version_number >= item.version_count,
            needs_categorization: false,
            data_sensitivity: "standard",
          }))}
          showSelection={false}
          selectedDocumentIds={[]}
          selectedId={null}
          labels={{
            selectBulkShare: t.documents_select_bulk_share,
            filename: t.documents_filename,
            patient: t.orders_patient,
            category: t.documents_category,
            status: t.users_status,
            visibility: appointmentText("Sichtbarkeit", "Видимость", "Visibility"),
            size: t.documents_size,
            uploadedBy: t.documents_uploaded_by,
            unclassified: t.documents_unclassified,
            current: appointmentText("aktuell", "текущая", "current"),
            pidFallback: "PID",
            notSet: t.common_not_set,
            unknownUploader: t.documents_unknown_uploader,
            needsCategorization: appointmentText(
              "Kategorisierung erforderlich",
              "Требуется категоризация",
              "Needs categorization",
            ),
          }}
          localizeCode={(value) => localizeDocumentCode(value, appointmentText)}
          onSelectionChange={() => undefined}
          onToggleSelection={() => undefined}
          onOpenDocument={() => undefined}
          statusBadge={linkedDocumentStatusBadge}
          visibilityBadge={linkedDocumentVisibilityBadge}
          sensitivityBadge={linkedDocumentSensitivityBadge}
          formatStatusLabel={(value) => value}
          formatVisibilityLabel={(value) => value}
          formatSensitivityLabel={() =>
            appointmentText("Standard", "Стандарт", "Standard")
          }
          formatFileSize={formatDocumentFileSize}
          formatDateTime={formatDateTime}
        />
      )}
    </AppointmentPreviewSheet>
  );
}

export const MemoizedLinkedDocumentsSheet = memo(LinkedDocumentsSheet);
