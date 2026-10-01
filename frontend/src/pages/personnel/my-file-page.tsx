import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Lock } from "lucide-react";

import { Banner, PageHeader, TabLoader } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { ApiRequestError } from "@/lib/api";
import { useLang } from "@/lib/i18n";

import { personnelApi, type PersonnelCategory, type PersonnelDocument, type PersonnelOwnFile } from "./api";
import { PersonnelDocumentsList } from "./documents-list";
import { formatEmploymentPeriod } from "./model";
import { FilePreviewDialog, errorMessage } from "./personnel-ui";

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
    <div className="space-y-4">
      <PageHeader title={t.nav_my_personnel_file} />
      {loading ? <TabLoader /> : null}
      {error ? <Banner tone="error">{error}</Banner> : null}
      {missing ? <p className="text-sm text-muted-foreground">{t.personnel_my_file_missing}</p> : null}
      {employee ? (
        <>
          <section className="rounded-lg border border-border bg-card p-4 text-sm">
            <p className="font-medium text-foreground">{employee.display_name}</p>
            <p className="text-xs text-muted-foreground">
              {[
                employee.personnel_number ? `${t.personnel_number} ${employee.personnel_number}` : "",
                formatEmploymentPeriod(employee.employment_start, employee.employment_end, t.personnel_since),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </section>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3.5 shrink-0" />
            <span>{t.personnel_my_file_notice}</span>
          </div>
          <PersonnelDocumentsList
            documents={file?.documents ?? []}
            categoryOrder={categoryOrder}
            showInternal={false}
            emptyText={t.personnel_documents_empty}
            actions={(document) => (
              <>
                <Button type="button" size="xs" variant="outline" onClick={() => setPreviewing(document)}>
                  <Eye />
                  {t.personnel_preview}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void personnelApi
                      .downloadDocument(document)
                      .catch((reason: unknown) => toast.error(errorMessage(reason, t.common_failed_load)))
                  }
                >
                  <Download />
                  {t.personnel_download}
                </Button>
              </>
            )}
          />
        </>
      ) : null}
      <FilePreviewDialog
        open={Boolean(previewing)}
        title={t.personnel_preview}
        fileName={previewing?.archive_file_name ?? ""}
        mimeType={previewing?.mime_type ?? ""}
        load={() => personnelApi.documentFile(previewing?.id ?? "", true)}
        onClose={() => setPreviewing(null)}
      />
    </div>
  );
}
