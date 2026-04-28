import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { TabsContent } from "@/components/ui/tabs";
import {
  CountBadge,
  EmptyCell,
  Section as FormSection,
  StatCard,
  TabLoader,
  inputClass as formInputClassName,
} from "@/components/ui-shell";
import { buildApiUrl } from "@/lib/api";
import {
  localizeDocumentCode,
  localizeRequiredDocumentLabel,
} from "@/lib/required-document-labels";
import { cn } from "@/lib/utils";

import type { DocumentAlerts, DocumentItem } from "../../model/detail-tab-types";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (de: string, ru: string, en: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;

type PatientDocumentsTabProps = {
  l: LocalizeFn;
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
  onResetDocumentFilters: () => void;
  canManageDocuments: boolean;
  onOpenUpload: () => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
};

export function PatientDocumentsTab({
  l,
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
  onResetDocumentFilters,
  canManageDocuments,
  onOpenUpload,
  statusColors,
  statusLabel,
  formatDate,
}: PatientDocumentsTabProps) {
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
        title={l("Dokumenten-Cockpit", "Панель документов", "Documents cockpit")}
        description={l(
          "Pflichtdokumente, Uploads und Sichtbarkeit für diesen Patienten in einer eigenen Dokumentenzone.",
          "Обязательные документы, загрузки и видимость по этому пациенту в отдельной зоне документов.",
          "Required documents, uploads and visibility for this patient in a dedicated document zone.",
        )}
        accessory={<CountBadge>{filteredDocuments.length}</CountBadge>}
      />

      <FormSection
        title={l("Überblick", "Обзор", "Overview")}
        accessory={<CountBadge>{documents.length} {l("Dateien", "файлов", "files")}</CountBadge>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={l("Dokumente gesamt", "Всего документов", "Total documents")}
            value={documents.length}
            description={l(
              "Alle Dateien, die direkt mit diesem Patienten verknüpft sind.",
              "Все файлы, напрямую связанные с этим пациентом.",
              "All files linked directly to this patient.",
            )}
          />
          <StatCard
            label={l("Pflichtdokumente erfüllt", "Обязательные документы выполнены", "Required docs fulfilled")}
            value={
              documentAlerts?.configured_rule_count
                ? `${requiredDocumentFulfilledCount}/${documentAlerts.configured_rule_count}`
                : requiredDocumentFulfilledCount
            }
            description={l(
              "Abdeckung des minimalen Dokumentenpakets für Aufnahme und Compliance.",
              "Покрытие минимального пакета документов для intake и compliance.",
              "Coverage of the minimum document pack for intake and compliance.",
            )}
          />
          <StatCard
            label={l("Dokumentarten", "Типы документов", "Document types")}
            value={documentCategoryOptions.length}
            description={l(
              "Wie viele Kategorien aktuell im Profil dieses Patienten vorkommen.",
              "Сколько категорий документов сейчас присутствует в профиле пациента.",
              "How many document categories currently appear in this patient profile.",
            )}
          />
        </div>
      </FormSection>

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
                  ? l("Das minimale Dokumentenpaket ist vollständig", "Минимальный пакет документов собран", "Minimum document pack is complete")
                  : l(
                      `${documentAlerts.missing_count} erforderliche Dokument${documentAlerts.missing_count === 1 ? "" : "e"} fehlen`,
                      `Не хватает обязательных документов: ${documentAlerts.missing_count}`,
                      `${documentAlerts.missing_count} required document${documentAlerts.missing_count === 1 ? "" : "s"} missing`,
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
              {documentAlerts.configured_rule_count} {l("erfüllt", "выполнено", "fulfilled")}
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
              {l(
                "Das gespeicherte Compliance-Flag für „Dokumentenpaket vollständig“ stimmt nicht mit dem aktuellen Dokumentbestand überein.",
                "Сохранённый флаг compliance для «пакет документов собран» не совпадает с текущим составом документов.",
                "The stored compliance flag for “Document pack complete” is not aligned with the current document inventory.",
              )}
            </p>
          ) : null}
        </div>
      ) : null}

      <FormSection
        title={l("Dokumente zu diesem Patienten", "Документы этого пациента", "Documents linked to this patient")}
        accessory={
          <div className="flex flex-wrap items-center gap-2">
            <CountBadge>{documents.length}</CountBadge>
            {canManageDocuments ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={onOpenUpload}
              >
                {l("Dokument hochladen", "Загрузить документ", "Upload document")}
              </Button>
            ) : null}
          </div>
        }
      >
        {documents.length > 0 ? (
          <FormSection
            title={l("Filter", "Фильтры", "Filters")}
            accessory={
              hasDocumentFilters ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  onClick={onResetDocumentFilters}
                >
                  {l("Filter zurücksetzen", "Сбросить фильтры", "Reset filters")}
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
                {l("Alle Status", "Все статусы", "All statuses")} · {documents.length}
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
                  <option value="all">{l("Alle Dokumentarten", "Все типы документов", "All document types")}</option>
                  {documentCategoryOptions.map((category) => (
                    <option key={category} value={category}>
                      {localizeDocumentCode(category, l)}
                    </option>
                  ))}
                </NativeComboboxSelect>
              <div className="flex items-center text-xs text-muted-foreground">
                {l("Angezeigt", "Показано", "Showing")} {filteredDocuments.length} {l("von", "из", "of")} {documents.length}
              </div>
            </div>
          </FormSection>
        ) : null}

        {tabLoading ? (
          <TabLoader />
        ) : documents.length === 0 ? (
          <EmptyCell>
            {l("Zu diesem Patienten wurden noch keine Dokumente hochgeladen.", "Для этого пациента пока не загружены документы.", "No documents have been uploaded for this patient yet.")}
          </EmptyCell>
        ) : filteredDocuments.length === 0 ? (
          <EmptyCell>
            {l("Kein Dokument entspricht den aktuellen Filtern.", "Текущим фильтрам не соответствует ни один документ.", "No document matches the current filters.")}
          </EmptyCell>
        ) : (
          <>
            <div className="space-y-2 md:hidden">
              {filteredDocuments.map((doc) => (
                <a
                  key={doc.id}
                  href={buildApiUrl(`/documents/${doc.id}/download`)}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-border/50 bg-card px-4 py-3 transition-colors hover:border-border hover:bg-muted/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{doc.filename}</p>
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
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{doc.uploaded_by_name ?? commonUnknown}</span>
                    <span>· {formatDate(doc.created_at)}</span>
                  </div>
                </a>
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
                <a
                  key={doc.id}
                  href={buildApiUrl(`/documents/${doc.id}/download`)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/45 focus-visible:bg-muted/45 focus-visible:outline-none",
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
                </a>
              ))}
            </div>
          </>
        )}
      </FormSection>
    </TabsContent>
  );
}
