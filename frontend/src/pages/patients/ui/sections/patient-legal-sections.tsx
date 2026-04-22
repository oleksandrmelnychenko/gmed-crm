import { useMemo } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

import type {
  ContractItem,
  DocumentAlerts,
  DocumentItem,
  InvoiceItem,
} from "../../model/detail-tab-types";
import { WorkspaceSectionIntro } from "../shared/workspace-primitives";

type LocalizeFn = (de: string, ru: string, en: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type MoneyFormatter = (value?: string | null, currency?: string) => string;

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

type PatientContractsTabProps = {
  l: LocalizeFn;
  commonNotSet: string;
  tabLoading: boolean;
  contracts: ContractItem[];
  contractSignedCount: number;
  contractPendingCount: number;
  contractExpiringSoonCount: number;
  canManageContracts: boolean;
  onCreateContract: () => void;
  onEditContractStatus: (contract: ContractItem) => void;
  onOpenContract: (contractId: string) => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  isContractExpiringSoon: (contract: ContractItem) => boolean;
};

type PatientInvoicesTabProps = {
  l: LocalizeFn;
  commonNotSet: string;
  tabLoading: boolean;
  invoices: InvoiceItem[];
  invoiceOpenCount: number;
  invoiceOverdueCount: number;
  invoiceOutstandingAmount: number;
  invoicePaidAmountTotal: number;
  canManageInvoices: boolean;
  onOpenInvoice: (invoiceId: string) => void;
  onManageInvoice: (invoice: InvoiceItem) => void;
  statusColors: Record<string, string>;
  statusLabel: StatusLabelFn;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  formatMoney: MoneyFormatter;
  moneyValueNumber: (value?: string | null) => number;
  invoiceTypeLabel: (value: string) => string;
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
              <ShadSelect
                value={documentCategoryFilter}
                onValueChange={(value) => onDocumentCategoryFilterChange(value ?? "all")}
              >
                <SelectTrigger className={cn("w-full", formInputClassName)}>
                  <SelectValue>
                    {documentCategoryFilter === "all"
                      ? l("Alle Dokumentarten", "Все типы документов", "All document types")
                      : localizeDocumentCode(documentCategoryFilter, l)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{l("Alle Dokumentarten", "Все типы документов", "All document types")}</SelectItem>
                  {documentCategoryOptions.map((category) => (
                    <SelectItem key={category} value={category}>
                      {localizeDocumentCode(category, l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
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
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 border-b border-border/60 bg-muted/40 px-4 py-2.5">
                {[documentsFilenameLabel, appointmentsTypeLabel, usersStatusLabel, patientsAssignedByLabel, usersCreatedLabel].map((label) => (
                  <span key={label} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
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
                    "grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 items-center px-4 py-2.5 transition-colors hover:bg-muted/40",
                    idx < filteredDocuments.length - 1 && "border-b border-border/40",
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

export function PatientContractsTab({
  l,
  commonNotSet,
  tabLoading,
  contracts,
  contractSignedCount,
  contractPendingCount,
  contractExpiringSoonCount,
  canManageContracts,
  onCreateContract,
  onEditContractStatus,
  onOpenContract,
  statusColors,
  statusLabel,
  formatDate,
  formatDateTime,
  isContractExpiringSoon,
}: PatientContractsTabProps) {
  return (
    <TabsContent value="contracts" className="space-y-4 mt-4 min-h-[400px]">
      <WorkspaceSectionIntro
        title={l("Vertrags-Cockpit", "Панель договоров", "Contracts cockpit")}
        description={l(
          "Lifecycle, Gültigkeit und unmittelbare Pflege von Verträgen, ohne das Patientenprofil zu verlassen.",
          "Жизненный цикл, сроки действия и быстрое управление договорами без выхода из профиля пациента.",
          "Lifecycle, validity and direct contract management without leaving the patient profile.",
        )}
        accessory={<CountBadge>{contracts.length}</CountBadge>}
      />

      <FormSection
        title={l("Portfolio-Überblick", "Обзор портфеля", "Portfolio overview")}
        accessory={<CountBadge>{contracts.length} {l("Verträge", "договоров", "contracts")}</CountBadge>}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <StatCard
            label={l("Aktiv oder unterzeichnet", "Активные или подписанные", "Active or signed")}
            value={contractSignedCount}
            description={l(
              "Verträge, die bereits wirksam sind oder unterzeichnet wurden.",
              "Договоры, которые уже вступили в силу или были подписаны.",
              "Contracts that are already effective or have been signed.",
            )}
          />
          <StatCard
            label={l("In Vorbereitung", "В подготовке", "In preparation")}
            value={contractPendingCount}
            description={l(
              "Entwürfe oder versandte Verträge, die noch nicht finalisiert wurden.",
              "Черновики или отправленные договоры, которые ещё не финализированы.",
              "Draft or sent contracts that still need to be finalized.",
            )}
          />
          <StatCard
            label={l("Laufen bald ab", "Скоро истекают", "Expiring soon")}
            value={contractExpiringSoonCount}
            description={l(
              "Verträge mit Enddatum innerhalb der nächsten 30 Tage.",
              "Договоры, у которых срок действия заканчивается в ближайшие 30 дней.",
              "Contracts with an end date in the next 30 days.",
            )}
          />
        </div>
      </FormSection>

      <FormSection
        title={l("Verträge dieses Patienten", "Договоры этого пациента", "Contracts for this patient")}
        accessory={
          <div className="flex flex-wrap items-center gap-2">
            <CountBadge>{contracts.length}</CountBadge>
            {canManageContracts ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={onCreateContract}
              >
                {l("Neuer Vertrag", "Новый договор", "New contract")}
              </Button>
            ) : null}
          </div>
        }
      >
        {tabLoading ? (
          <TabLoader />
        ) : contracts.length === 0 ? (
          <EmptyCell>
            {l("Für diesen Patienten wurde noch kein Vertrag angelegt.", "Для этого пациента пока не создано ни одного договора.", "No contract has been created for this patient yet.")}
          </EmptyCell>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {contracts.map((contract) => (
              <div
                key={contract.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{contract.contract_number}</span>
                  <Badge
                    variant="outline"
                    className={cn("rounded-full text-[10px]", statusColors[contract.status] ?? "")}
                  >
                    {statusLabel(contract.status)}
                  </Badge>
                </div>
                <div className="grid gap-1 text-sm text-muted-foreground">
                  <p>{l("Unterzeichnet", "Подписано", "Signed")}: {formatDateTime(contract.signed_at, commonNotSet)}</p>
                  <p>{l("Gültig ab", "Действует с", "Valid from")}: {formatDate(contract.valid_from, commonNotSet)}</p>
                  <p>{l("Gültig bis", "Действует до", "Valid to")}: {formatDate(contract.valid_to, commonNotSet)}</p>
                </div>
                {contract.valid_to ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px] w-fit",
                      isContractExpiringSoon(contract)
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-border/60 bg-muted/25 text-muted-foreground",
                    )}
                  >
                    {isContractExpiringSoon(contract)
                      ? l("Läuft bald ab", "Скоро истекает", "Expiring soon")
                      : l("Gültigkeitsfenster gesetzt", "Срок действия задан", "Validity window set")}
                  </Badge>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => onOpenContract(contract.id)}
                  >
                    {l("Öffnen", "Открыть", "Open")}
                  </Button>
                  {canManageContracts ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => onEditContractStatus(contract)}
                    >
                      {l("Status aktualisieren", "Обновить статус", "Update status")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}

export function PatientInvoicesTab({
  l,
  commonNotSet,
  tabLoading,
  invoices,
  invoiceOpenCount,
  invoiceOverdueCount,
  invoiceOutstandingAmount,
  invoicePaidAmountTotal,
  canManageInvoices,
  onOpenInvoice,
  onManageInvoice,
  statusColors,
  statusLabel,
  formatDate,
  formatDateTime,
  formatMoney,
  moneyValueNumber,
  invoiceTypeLabel,
}: PatientInvoicesTabProps) {
  return (
    <TabsContent value="invoices" className="space-y-4 mt-4 min-h-[400px]">
      <WorkspaceSectionIntro
        title={l("Billing-Cockpit", "Панель биллинга", "Billing cockpit")}
        description={l(
          "Zahlungsstatus, offene Beträge und Eskalation direkt im Kontext des Patienten.",
          "Статусы оплат, открытые суммы и эскалация прямо в контексте пациента.",
          "Payment status, outstanding balances and escalation directly in patient context.",
        )}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      />

      <FormSection
        title={l("Finanzüberblick", "Финансовый обзор", "Financial overview")}
        accessory={<CountBadge>{invoices.length} {l("Rechnungen", "счетов", "invoices")}</CountBadge>}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={l("Offene Rechnungen", "Открытые счета", "Open invoices")}
            value={invoiceOpenCount}
            description={l(
              "Rechnungen mit verbleibendem Saldo.",
              "Счета, по которым ещё остаётся остаток.",
              "Invoices with a remaining balance.",
            )}
          />
          <StatCard
            label={l("Überfällig", "Просрочено", "Overdue")}
            value={invoiceOverdueCount}
            description={l(
              "Rechnungen, die sofortige Nachverfolgung erfordern.",
              "Счета, требующие немедленного follow-up.",
              "Invoices that require immediate follow-up.",
            )}
          />
          <StatCard
            label={l("Offener Betrag", "Открытая сумма", "Outstanding amount")}
            value={formatMoney(String(invoiceOutstandingAmount))}
            description={l(
              "Noch nicht bezahlte Gesamtsumme in diesem Patientenprofil.",
              "Общая сумма, которая ещё не оплачена по этому профилю пациента.",
              "Total amount still unpaid in this patient profile.",
            )}
          />
          <StatCard
            label={l("Bezahlt", "Оплачено", "Paid")}
            value={formatMoney(String(invoicePaidAmountTotal))}
            description={l(
              "Bereits vereinnahmter Betrag über alle Rechnungen.",
              "Сумма, уже оплаченная по всем счетам.",
              "Amount already collected across all invoices.",
            )}
          />
        </div>
      </FormSection>

      <FormSection
        title={l("Rechnungen und Zahlungsnachverfolgung", "Счета и контроль оплат", "Invoices and payment follow-up")}
        accessory={<CountBadge>{invoices.length}</CountBadge>}
      >
        {tabLoading ? (
          <TabLoader />
        ) : invoices.length === 0 ? (
          <EmptyCell>
            {l("Für diesen Patienten wurden noch keine Rechnungen erstellt.", "Для этого пациента пока не создано ни одного счёта.", "No invoices have been issued for this patient yet.")}
          </EmptyCell>
        ) : (
          <div className="space-y-2">
            {invoices.map((invoice) => (
              <div
                key={invoice.id}
                className="rounded-xl border border-border/50 bg-card px-4 py-3 space-y-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{invoice.invoice_number}</span>
                    <Badge
                      variant="outline"
                      className={cn("rounded-full text-[10px]", statusColors[invoice.status] ?? "")}
                    >
                      {statusLabel(invoice.status)}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground/80">{formatDateTime(invoice.issued_at)}</p>
                </div>
                <div className="grid gap-1 md:grid-cols-2 xl:grid-cols-4 text-sm text-muted-foreground">
                  <p>{l("Typ", "Тип", "Type")}: {invoiceTypeLabel(invoice.invoice_type)}</p>
                  <p>{l("Gesamt", "Итого", "Total")}: {formatMoney(invoice.total_gross)}</p>
                  <p>{l("Bezahlt", "Оплачено", "Paid")}: {formatMoney(invoice.paid_amount)}</p>
                  <p>{l("Offen", "Остаток", "Open")}: {formatMoney(invoice.balance_due)}</p>
                  <p>{l("Fällig", "Срок", "Due")}: {formatDate(invoice.due_date, commonNotSet)}</p>
                  <p>{l("Auftrag", "Заказ", "Order")}: {invoice.order_number ?? commonNotSet}</p>
                  <p>{l("Angebot", "Смета", "Quote")}: {invoice.quote_number ?? commonNotSet}</p>
                </div>
                {moneyValueNumber(invoice.balance_due) > 0 ? (
                  <Badge
                    variant="outline"
                    className={cn(
                      "rounded-full text-[10px] w-fit",
                      invoice.status === "overdue"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : "border-amber-200 bg-amber-50 text-amber-700",
                    )}
                  >
                    {invoice.status === "overdue"
                      ? l("Sofort nachverfolgen", "Требует срочного follow-up", "Needs urgent follow-up")
                      : l("Saldo offen", "Есть остаток", "Balance outstanding")}
                  </Badge>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 rounded-lg"
                    onClick={() => onOpenInvoice(invoice.id)}
                  >
                    {l("Öffnen", "Открыть", "Open")}
                  </Button>
                  {canManageInvoices ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-lg"
                      onClick={() => onManageInvoice(invoice)}
                    >
                      {l("Billing verwalten", "Управлять биллингом", "Manage billing")}
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </FormSection>
    </TabsContent>
  );
}
