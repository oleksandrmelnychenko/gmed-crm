import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  TabLoader,
  inputClass as formInputClassName,
  tokens,
} from "@/components/ui-shell";
import { downloadApiFile } from "@/lib/api";
import {
  localizeDocumentCode,
  localizeRequiredDocumentLabel,
} from "@/lib/required-document-labels";
import { cn } from "@/lib/utils";
import type { PatientOption as DocumentPatientOption } from "@/pages/documents/model/types";

import type { DocumentAlerts, DocumentItem } from "../../model/detail-tab-types";
import { FormSection } from "../shared/patient-form-primitives";
import { PatientDocumentGenerateDialog } from "../sheets/patient-document-generate-dialog";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (key: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type PatientDocumentContext = {
  id: string;
  patient_id: string;
  first_name?: string | null;
  last_name?: string | null;
  languages?: string[];
};

type PatientDocumentsTabProps = {
  l: LocalizeFn;
  patientId: string | undefined;
  patient?: PatientDocumentContext;
  commonNotSet: string;
  commonUnknown: string;
  documentsFilenameLabel: string;
  appointmentsTypeLabel: string;
  usersStatusLabel: string;
  patientsAssignedByLabel: string;
  usersCreatedLabel: string;
  tabLoading: boolean;
  documents: DocumentItem[];
  filteredDocuments: DocumentItem[];
  documentAlerts: DocumentAlerts | null;
  requiredDocumentFulfilledCount: number;
  documentCategoryOptions: string[];
  documentStatusOptions: string[];
  hasDocumentFilters: boolean;
  documentStatusFilter: string;
  documentCategoryFilter: string;
  onDocumentStatusFilterChange: (value: string) => void;
  onDocumentCategoryFilterChange: (value: string) => void;
  onDocumentGenerated: () => void;
  onResetDocumentFilters: () => void;
  canManageDocuments: boolean;
  onOpenUpload: () => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
};

type DocumentsOverviewSectionProps = {
  l: LocalizeFn;
  documents: DocumentItem[];
  documentAlerts: DocumentAlerts | null;
  requiredDocumentFulfilledCount: number;
  documentCategoryOptions: string[];
};

function DocumentOverviewTile({
  label,
  value,
  description,
  groupedLast,
}: {
  label: string;
  value: string | number;
  description: string;
  groupedLast?: boolean;
}) {
  return (
    <article className="relative min-h-[68px] min-w-[190px] px-3 py-1">
      {!groupedLast ? (
        <span className="absolute right-0 top-1/2 hidden -translate-y-1/2 space-y-1 md:block">
          <span className="block h-1.5 w-px bg-border" />
          <span className="block h-1.5 w-px bg-border" />
          <span className="block h-1.5 w-px bg-border" />
        </span>
      ) : null}
      <p className="text-2xl font-semibold leading-[0.85] text-foreground">
        {value}
      </p>
      <p className="mt-[5px] text-[11px] leading-tight text-muted-foreground/75 break-words">
        {description}
      </p>
      <p className={cn("mt-0.5 text-xs font-medium leading-tight break-words", tokens.text.muted)}>
        {label}
      </p>
    </article>
  );
}

function DocumentsOverviewSection({
  l,
  documents,
  documentAlerts,
  requiredDocumentFulfilledCount,
  documentCategoryOptions,
}: DocumentsOverviewSectionProps) {
  return (
    <FormSection
      title={l("appointments_overview")}
      accessory={<CountBadge>{documents.length} {l("patients_files")}</CountBadge>}
    >
      <div className="grid overflow-hidden rounded-xl border border-border px-3 pb-3 pt-4 md:grid-cols-3">
        <DocumentOverviewTile
          label={l("patients_total_documents")}
          value={documents.length}
          description={l("patients_files_linked_to_this_patient")}
        />
        <DocumentOverviewTile
          label={l("patients_required_docs_fulfilled")}
          value={
            documentAlerts?.configured_rule_count
              ? `${requiredDocumentFulfilledCount}/${documentAlerts.configured_rule_count}`
              : requiredDocumentFulfilledCount
          }
          description={l("patients_minimum_pack_readiness")}
        />
        <DocumentOverviewTile
          label={l("patients_document_types")}
          value={documentCategoryOptions.length}
          description={l("patients_categories_in_profile")}
          groupedLast
        />
      </div>
    </FormSection>
  );
}

export function PatientDocumentsTab({
  l,
  patientId,
  patient,
  commonNotSet,
  commonUnknown,
  documentsFilenameLabel,
  appointmentsTypeLabel,
  usersStatusLabel,
  patientsAssignedByLabel,
  usersCreatedLabel,
  tabLoading,
  documents,
  filteredDocuments,
  documentAlerts,
  requiredDocumentFulfilledCount,
  documentCategoryOptions,
  documentStatusOptions,
  hasDocumentFilters,
  documentStatusFilter,
  documentCategoryFilter,
  onDocumentStatusFilterChange,
  onDocumentCategoryFilterChange,
  onDocumentGenerated,
  onResetDocumentFilters,
  canManageDocuments,
  onOpenUpload,
  statusColors,
  statusLabel,
  formatDate,
}: PatientDocumentsTabProps) {
  const [generateOpen, setGenerateOpen] = useState(false);
  const generatePatient = useMemo<DocumentPatientOption | undefined>(
    () =>
      patient
        ? {
            id: patient.id,
            patient_id: patient.patient_id,
            first_name: patient.first_name ?? undefined,
            last_name: patient.last_name ?? undefined,
            languages: patient.languages,
          }
        : undefined,
    [patient],
  );
  const documentStatusCounts = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of documents) {
      const status = item.status ?? "";
      counts.set(status, (counts.get(status) ?? 0) + 1);
    }

    return counts;
  }, [documents]);

  return (
    <TabsContent value="documents" className="space-y-4 mt-4 min-h-[400px]">
      <WorkspaceSectionIntro
        title={l("patients_documents_cockpit")}
        description={l("patients_required_documents_uploads_and_visibility_for_this_patie")}
        accessory={<CountBadge>{filteredDocuments.length}</CountBadge>}
      />

      <DocumentsOverviewSection
        l={l}
        documents={documents}
        documentAlerts={documentAlerts}
        requiredDocumentFulfilledCount={requiredDocumentFulfilledCount}
        documentCategoryOptions={documentCategoryOptions}
      />

      {!tabLoading && documentAlerts && documentAlerts.configured_rule_count > 0 ? (
        <div
          className={cn(
            "rounded-xl border px-4 py-3",
            documentAlerts.document_pack_complete
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-amber-200 bg-amber-50/70",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                {documentAlerts.document_pack_complete
                  ? l("patients_minimum_document_pack_is_complete")
                  : l("patients_required_documents_missing_count").replace(
                      "{count}",
                      String(documentAlerts.missing_count),
                    )}
              </h4>
            </div>
            <Badge
              variant="outline"
              className={cn(
                "rounded-full text-[10px]",
                documentAlerts.document_pack_complete
                  ? "border-emerald-200 bg-emerald-100 text-emerald-800"
                  : "border-amber-200 bg-amber-100 text-amber-800",
              )}
            >
              {documentAlerts.required_documents.filter((item) => item.fulfilled).length}/
              {documentAlerts.configured_rule_count} {l("patients_fulfilled")}
            </Badge>
          </div>
          {documentAlerts.missing_count > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {documentAlerts.missing_documents.map((item) => (
                <Badge
                  key={item.key}
                  variant="outline"
                  className="rounded-full border-amber-300 bg-card text-amber-800"
                >
                  {localizeRequiredDocumentLabel(item.key, item.label, l)}
                </Badge>
              ))}
            </div>
          ) : null}
          {documentAlerts.out_of_sync ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {l("patients_the_stored_compliance_flag_for_document_pack_complete_is")}
            </p>
          ) : null}
        </div>
      ) : null}

      <FormSection
        title={l("patients_documents_linked_to_this_patient")}
        accessory={
          <div className="flex flex-wrap items-center gap-2">
            <CountBadge>{documents.length}</CountBadge>
            {canManageDocuments ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={() => setGenerateOpen(true)}
                >
                  {l("documents_generate_from_template")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 rounded-lg gap-1.5"
                  onClick={onOpenUpload}
                >
                  {l("patients_upload_document")}
                </Button>
              </>
            ) : null}
          </div>
        }
      >
        {documents.length > 0 ? (
          <FormSection
            title={l("patients_filters")}
            accessory={
              hasDocumentFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={onResetDocumentFilters}
                >
                  {l("patients_reset_filters")}
                </Button>
              ) : null
            }
          >
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={documentStatusFilter === "all" ? "default" : "outline"}
                className="h-8 rounded-full"
                onClick={() => onDocumentStatusFilterChange("all")}
              >
                {l("patients_all_statuses")} · {documents.length}
              </Button>
              {documentStatusOptions.map((status) => (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant={documentStatusFilter === status ? "default" : "outline"}
                  className="h-8 rounded-full"
                  onClick={() => onDocumentStatusFilterChange(status)}
                >
                  {statusLabel(status)} · {documentStatusCounts.get(status) ?? 0}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-[minmax(0,260px)_auto]">
              <NativeComboboxSelect
                value={documentCategoryFilter}


                onChange={(event) => onDocumentCategoryFilterChange(event.target.value ?? "all")} className={cn("w-full", formInputClassName)}>
                  <option value="all">{l("patients_all_document_types")}</option>
                  {documentCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {localizeDocumentCode(category, l)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              <div className="flex items-center text-xs text-muted-foreground">
                {l("patients_showing")} {filteredDocuments.length} {l("documents_of")} {documents.length}
              </div>
            </div>
          </FormSection>
        ) : null}

        {tabLoading ? (
          <TabLoader />
        ) : documents.length === 0 ? (
          <EmptyCell>
            {l("patients_no_documents_have_been_uploaded_for_this_patient_yet")}
          </EmptyCell>
        ) : filteredDocuments.length === 0 ? (
          <EmptyCell>
            {l("patients_no_document_matches_the_current_filters")}
          </EmptyCell>
        ) : (
          <>
            <div className="space-y-1.5 md:hidden">
              {filteredDocuments.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() =>
                    void downloadApiFile(
                      `/documents/${doc.id}/download`,
                      doc.filename || "document",
                    )
                  }
                  className="block w-full rounded-xl border border-border/50 bg-card px-4 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-foreground">{doc.filename}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {doc.category ? localizeDocumentCode(doc.category, l) : commonNotSet}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 rounded-full text-[10px]",
                        statusColors[doc.status ?? ""] ?? "border-border/60 bg-muted/25 text-muted-foreground",
                      )}
                    >
                      {doc.status ? statusLabel(doc.status) : commonNotSet}
                    </Badge>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{doc.uploaded_by_name ?? commonUnknown}</span>
                    <span>· {formatDate(doc.created_at)}</span>
                  </div>
                </button>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-xl border border-border/50 bg-card md:block">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-card px-4 py-2.5 font-mono">
                {[documentsFilenameLabel, appointmentsTypeLabel, usersStatusLabel, patientsAssignedByLabel, usersCreatedLabel].map((label) => (
                  <span key={label} className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground/80">
                    {label}
                  </span>
                ))}
              </div>
              {filteredDocuments.map((doc, idx) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() =>
                    void downloadApiFile(
                      `/documents/${doc.id}/download`,
                      doc.filename || "document",
                    )
                  }
                  className={cn(
                    "grid w-full grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none",
                    idx < filteredDocuments.length - 1 && "border-b border-border/45",
                  )}
                >
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{doc.filename}</span>
                  <span className="text-xs text-muted-foreground">
                    {doc.category ? localizeDocumentCode(doc.category, l) : commonNotSet}
                  </span>
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px] w-fit",
                      statusColors[doc.status ?? ""] ?? "border-border/60 bg-muted/25 text-muted-foreground",
                    )}
                  >
                    {doc.status ? statusLabel(doc.status) : commonNotSet}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{doc.uploaded_by_name ?? commonUnknown}</span>
                  <span className="text-xs text-muted-foreground/80">{formatDate(doc.created_at)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </FormSection>
      {canManageDocuments ? (
        <PatientDocumentGenerateDialog
          open={generateOpen}
          patientId={patientId}
          patient={generatePatient}
          onOpenChange={setGenerateOpen}
          onGenerated={onDocumentGenerated}
        />
      ) : null}
    </TabsContent>
  );
}
