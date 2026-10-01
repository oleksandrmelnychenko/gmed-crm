import { useEffect, useMemo, useState } from "react";
import { Download, Lock } from "lucide-react";

import { Banner, EmptyCell, InfoRow, PageHeader, Section, TabLoader, TabShell } from "@/components/ui-shell";
import { toast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";

import { personnelApi, type PersonnelCategory, type PersonnelDocument, type PersonnelOwnFile } from "./api";
import { PersonnelDocumentsTable } from "./documents-list";
import { formatEmploymentPeriod } from "./model";
import { FilePreviewDialog, MutedNote, RowIconAction, errorMessage } from "./personnel-ui";

/**
 * The signed-in employee's own personnel file (§ 83 BetrVG, Art. 15 DSGVO):
 * read and download only. Every view and download is written to the journal
 * of the file by the server.
 */
export function MyPersonnelFilePage() {
  const { t } = useLang();
  const [file, setFile] = useState<PersonnelOwnFile | null>(null);
  const [categories, setCategories] = useState<PersonnelCategory[]>([]);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [previewing, setPreviewing] = useState<PersonnelDocument | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([personnelApi.ownFile(), personnelApi.categories().catch(() => [])])
      .then(([own, list]) => {
        if (cancelled) return;
        setFile(own);
        setCategories(list);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof ApiRequestError && reason.status === 404) setMissing(true);
        else setError(errorMessage(reason, t.common_failed_load));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t.common_failed_load]);

  const categoryOrder = useMemo(() => categories.map((category) => category.code), [categories]);
  const employee = file?.employee;

  return (
    <TabShell className="mt-0">
      <PageHeader title={t.nav_my_personnel_file} />
      {loading ? <TabLoader /> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {missing ? <EmptyCell>{t.personnel_my_file_missing}</EmptyCell> : null}
      {employee ? (
        <>
          <Section title={employee.display_name}>
            <div className="grid gap-4 sm:grid-cols-2">
              <InfoRow label={t.personnel_number} value={<span className="font-mono">{employee.personnel_number || "—"}</span>} />
              <InfoRow
                label={t.personnel_employment_period}
                value={formatEmploymentPeriod(employee.employment_start, employee.employment_end, t.personnel_since) || "—"}
              />
            </div>
          </Section>
          <MutedNote icon={Lock}>{t.personnel_my_file_notice}</MutedNote>
          <PersonnelDocumentsTable
            title={t.personnel_tab_documents}
            documents={file?.documents ?? []}
            categoryOrder={categoryOrder}
            showInternal={false}
            onPreview={setPreviewing}
            emptyText={t.personnel_documents_empty}
            storageKey="personnel-own-documents"
            rowActionsWidth={40}
            rowActions={(document) => (
              <RowIconAction
                icon={Download}
                label={t.personnel_download}
                onClick={() =>
                  void personnelApi
                    .downloadDocument(document)
                    .catch((reason: unknown) => toast.error(errorMessage(reason, t.common_failed_load)))
                }
              />
            )}
          />
        </>
      ) : null}
      <FilePreviewDialog
        open={Boolean(previewing)}
        fileName={previewing?.archive_file_name ?? ""}
        mimeType={previewing?.mime_type ?? ""}
        load={() => personnelApi.documentFile(previewing?.id ?? "", true)}
        onClose={() => setPreviewing(null)}
        note={t.personnel_access_logged}
      />
    </TabShell>
  );
}
