import { memo, useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { DocumentsGrid } from "@/components/documents-grid";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { Banner, EmptyCell } from "@/components/ui-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";
import { localizeDocumentCode } from "@/lib/required-document-labels";
import { appointmentText } from "@/pages/appointments/model/labels";
import type { LinkedDocumentItem } from "@/pages/appointments/model/types";
import {
  linkedDocumentSensitivityBadge,
  linkedDocumentStatusBadge,
  linkedDocumentVisibilityBadge,
} from "@/pages/appointments/appearance/linked-document-badges";
import { AppointmentPreviewSheet } from "@/pages/appointments/ui/shared/workspace-primitives";
import {
  createDocumentPreviewObjectUrl,
  revokeDocumentPreviewObjectUrl,
} from "@/pages/documents/data/document-api";

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
  const [preview, setPreview] = useState<{
    contentType: string;
    id: string;
    title: string;
    url: string;
  } | null>(null);
  const [previewBusyId, setPreviewBusyId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState("");
  const previewUrlRef = useRef<string | null>(null);

  function closePreview() {
    if (previewUrlRef.current) {
      revokeDocumentPreviewObjectUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreview(null);
  }

  useEffect(
    () => () => {
      if (previewUrlRef.current) {
        revokeDocumentPreviewObjectUrl(previewUrlRef.current);
      }
    },
    [],
  );

  async function openPreview(id: string, title: string) {
    if (previewBusyId) return;
    setPreviewBusyId(id);
    setPreviewError("");
    try {
      const nextPreview = await createDocumentPreviewObjectUrl(id);
      closePreview();
      previewUrlRef.current = nextPreview.url;
      setPreview({ ...nextPreview, id, title });
    } catch (nextError) {
      setPreviewError(
        nextError instanceof Error
          ? nextError.message
          : t.documents_failed_open_preview,
      );
    } finally {
      setPreviewBusyId(null);
    }
  }

  return (
    <>
      <AppointmentPreviewSheet
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closePreview();
          onOpenChange(nextOpen);
        }}
        title={appointmentText("appointments_documents")}
        description={appointmentText("appointments_documents_from_the_current_appointment_context")}
        maxWidthClassName="sm:max-w-[760px]"
        bodyClassName="space-y-4 px-5 py-4"
      >
        {previewError ? <Banner tone="error" withIcon>{previewError}</Banner> : null}
        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
            <LoaderCircle className="mr-2 size-4 animate-spin" />
            {appointmentText("appointments_loading_documents")}
          </div>
        ) : error ? (
          <Banner tone="error" withIcon>{error}</Banner>
        ) : items.length === 0 ? (
          <EmptyCell>
            {appointmentText("appointments_no_documents_in_this_context")}
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
              preview: t.documents_preview,
              filename: t.documents_filename,
              patient: t.orders_patient,
              category: t.documents_category,
              status: t.users_status,
              visibility: appointmentText("appointments_visibility"),
              uploadedBy: t.documents_uploaded_by,
              unclassified: t.documents_unclassified,
              current: appointmentText("appointments_current"),
              pidFallback: "PID",
              notSet: t.common_not_set,
              unknownUploader: t.documents_unknown_uploader,
              needsCategorization: appointmentText("appointments_needs_categorization"),
            }}
            localizeCode={(value) => localizeDocumentCode(value, appointmentText)}
            onSelectionChange={() => undefined}
            onToggleSelection={() => undefined}
            onOpenDocument={() => undefined}
            onPreviewDocument={(id, title) => void openPreview(id, title)}
            statusBadge={linkedDocumentStatusBadge}
            visibilityBadge={linkedDocumentVisibilityBadge}
            sensitivityBadge={linkedDocumentSensitivityBadge}
            formatStatusLabel={(value) => value}
            formatVisibilityLabel={(value) => value}
            formatSensitivityLabel={() =>
              appointmentText("appointments_standard")
            }
            formatDateTime={formatDateTime}
          />
        )}
      </AppointmentPreviewSheet>

      <Dialog open={Boolean(preview)} onOpenChange={(nextOpen) => !nextOpen && closePreview()}>
        <DialogContent className="flex h-[86vh] w-[94vw] max-w-none flex-col overflow-hidden rounded-xl p-0 duration-0 data-closed:animate-none data-open:animate-none sm:w-[78vw] sm:max-w-[1500px]">
          <DialogHeader className="border-b border-border/70 px-5 py-4">
            <DialogTitle className="truncate text-base">
              {preview?.title ?? t.documents_preview}
            </DialogTitle>
            <DialogDescription className="truncate">
              {preview?.contentType ?? ""}
            </DialogDescription>
            {preview ? <div className="pt-2"><DocumentSignatureAction documentId={preview.id} title={preview.title} /></div> : null}
          </DialogHeader>
          <div className="min-h-0 flex-1 bg-slate-50 p-3">
            {preview ? (
              <iframe
                title={preview.title || t.documents_preview}
                src={preview.url}
                className="h-full min-h-[560px] w-full rounded-lg border border-border bg-white"
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const MemoizedLinkedDocumentsSheet = memo(LinkedDocumentsSheet);
