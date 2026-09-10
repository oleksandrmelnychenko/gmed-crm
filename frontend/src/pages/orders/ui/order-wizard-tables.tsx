import type { ReactNode } from "react";
import { ArrowRight, Check, Download, Plus, Trash2 } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import type { Lang } from "@/lib/i18n";
import { listAgencyServicePriceChoices, resolveAgencyServicePrice } from "@/pages/contracts/model/contracts-model";
import type { AgencyServiceItem } from "@/pages/contracts/model/types";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { formatIntakeDate, INTAKE_CHECK_LABELS, intakeTotal } from "../model/order-intake";
import type { IntakeCheck, IntakeLine } from "../model/order-intake";

export function OrderWizardSection({ title, accessory, children, flush = false }: {
  title: ReactNode; accessory?: ReactNode; children: ReactNode; flush?: boolean;
}) {
  return <section className="min-w-0 rounded-lg border border-border/70 bg-card shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5">
      <AdminSectionTitle>{title}</AdminSectionTitle>
      {accessory}
    </div>
    <div className={flush ? "min-w-0" : "space-y-3 p-3 sm:p-4"}>{children}</div>
  </section>;
}

const TABLE_CLASS = "rounded-none border-0 bg-transparent shadow-none sm:max-h-[420px]";
const INPUT_CLASS = "h-8 min-w-0 w-full text-xs";

export function OrderWizardLinesTable({ lines, catalog, effectiveOn, lang, busy, onChange }: {
  lines: IntakeLine[]; catalog: AgencyServiceItem[]; effectiveOn: string | null;
  lang: Lang; busy: boolean; onChange: (lines: IntakeLine[]) => void;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const money = (value: number) => new Intl.NumberFormat(lang === "de" ? "de-DE" : "ru-RU", { style: "currency", currency: "EUR" }).format(value);
  const patchLine = (line: IntakeLine, changes: Partial<IntakeLine>) => onChange(lines.map(item => item.id === line.id ? { ...item, ...changes } : item));
  const columns: ColumnDef<IntakeLine>[] = [
    { id: "description", label: tx("Услуга", "Leistung"), accessor: line => line.description, minWidth: 260,
      render: line => <Input aria-label={tx("Услуга", "Leistung")} className={INPUT_CLASS} value={line.description} onChange={event => patchLine(line, { description: event.target.value })} /> },
    { id: "version", label: tx("Версия цены", "Preisversion"), accessor: line => line.agency_service_price_version_id, minWidth: 210,
      render: line => {
        const service = catalog.find(item => item.id === line.agency_service_id);
        if (!service) return <span className="text-muted-foreground">{tx("Индивидуальная цена", "Individueller Preis")}</span>;
        const versions = listAgencyServicePriceChoices(service, effectiveOn ?? undefined).filter(version => version.id);
        return <NativeComboboxSelect aria-label={tx("Версия цены", "Preisversion")} className={INPUT_CLASS} disabled={busy} value={line.agency_service_price_version_id ?? ""} onChange={event => {
          const version = versions.find(item => item.id === event.target.value);
          patchLine(line, version ? { agency_service_price_version_id: version.id, unit_price: String(version.unit_price), vat_rate: String(version.vat_rate) } : { agency_service_price_version_id: null });
        }}>
          <option value="">{tx("Индивидуальная / каталожная цена", "Individueller / Katalogpreis")}</option>
          {versions.map(version => <option key={version.id} value={version.id}>{version.name || formatIntakeDate(version.valid_from)} · {money(Number(version.unit_price))}{version.is_effective ? ` · ${tx("на дату заказа", "zum Auftragsdatum")}` : ""}</option>)}
        </NativeComboboxSelect>;
      } },
    { id: "quantity", label: tx("Кол-во", "Menge"), accessor: line => line.quantity, width: 95, align: "right",
      render: line => <Input aria-label={tx("Количество", "Menge")} className={`${INPUT_CLASS} text-right font-mono tabular-nums`} type="number" min="0.001" step="0.001" value={line.quantity} onChange={event => patchLine(line, { quantity: event.target.value })} /> },
    { id: "price", label: tx("Цена, EUR", "Preis, EUR"), accessor: line => line.unit_price, width: 125, align: "right",
      render: line => <Input aria-label={tx("Цена, EUR", "Preis, EUR")} className={`${INPUT_CLASS} text-right font-mono tabular-nums`} type="number" min="0" step="0.01" value={line.unit_price} onChange={event => patchLine(line, { unit_price: event.target.value, agency_service_price_version_id: null })} /> },
    { id: "vat", label: tx("НДС, %", "MwSt., %"), accessor: line => line.vat_rate, width: 95, align: "right",
      render: line => <Input aria-label={tx("НДС, %", "MwSt., %")} className={`${INPUT_CLASS} text-right font-mono tabular-nums`} type="number" min="0" max="100" value={line.vat_rate} onChange={event => patchLine(line, { vat_rate: event.target.value, agency_service_price_version_id: null })} /> },
    { id: "total", label: tx("Сумма с НДС", "Summe inkl. MwSt."), accessor: line => intakeTotal([line]), width: 145, align: "right",
      render: line => <span className="whitespace-nowrap font-mono font-medium tabular-nums">{money(intakeTotal([line]))}</span> },
  ];
  return <OrderWizardSection flush title={tx("Услуги нового заказа", "Leistungen des neuen Auftrags")} accessory={<Badge variant="secondary">{lines.length}</Badge>}>
    <div className="flex flex-wrap items-center gap-2 border-b border-border/60 p-2.5">
      <div className="w-full min-w-0 sm:w-80">
        <NativeComboboxSelect aria-label={tx("Добавить из каталога", "Aus Katalog hinzufügen")} className="h-9 w-full text-xs" value="" disabled={busy} onChange={event => {
          const service = catalog.find(item => item.id === event.target.value);
          if (!service) return;
          const price = resolveAgencyServicePrice(service, effectiveOn ?? undefined);
          onChange([...lines, { id: crypto.randomUUID(), description: service.service_name, quantity: "1", unit_price: String(price?.unit_price ?? service.unit_price ?? ""), vat_rate: String(price?.vat_rate ?? service.vat_rate ?? "19"), agency_service_id: service.id, agency_service_price_version_id: price?.id || null }]);
        }}>
          <option value="">{tx("Добавить из каталога", "Aus Katalog hinzufügen")}</option>
          {catalog.filter(service => service.currency.toUpperCase() === "EUR").map(service => <option key={service.id} value={service.id}>{service.service_name}</option>)}
        </NativeComboboxSelect>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onChange([...lines, { id: crypto.randomUUID(), description: "", quantity: "1", unit_price: "0", vat_rate: "19", agency_service_id: null, agency_service_price_version_id: null }])}><Plus className="size-3.5" />{tx("Добавить услугу", "Leistung hinzufügen")}</Button>
    </div>
    <DataTable rows={lines} columns={columns} rowId={line => line.id} density="compact" rowHeightOverrides={{ compact: 48 }} mobilePrimaryColumnId="description" className={TABLE_CLASS}
      rowActions={line => <Button type="button" variant="ghost" size="icon-sm" disabled={busy} title={tx("Удалить услугу", "Leistung löschen")} aria-label={`${tx("Удалить услугу", "Leistung löschen")}: ${line.description || "—"}`} className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onChange(lines.filter(item => item.id !== line.id))}><Trash2 className="size-3.5" /></Button>}
      emptyState={<p className="px-4 py-8 text-center text-xs text-muted-foreground">{tx("Добавьте услуги из каталога или создайте свою строку.", "Fügen Sie Leistungen aus dem Katalog oder eine eigene Position hinzu.")}</p>}
    />
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 rounded-b-lg border-t border-border/60 bg-muted/20 px-3 py-3">
      <span className="text-xs text-muted-foreground">{tx("Итого с НДС", "Gesamt inkl. MwSt.")}</span>
      <span data-testid="order-wizard-total" className="font-mono text-base font-semibold tabular-nums">{money(intakeTotal(lines))}</span>
    </div>
  </OrderWizardSection>;
}

export function OrderWizardDocumentsTable({ documents, currentIds, lang, busy, documentTitle, onDownload, onSigned, onReview }: {
  documents: DocumentItem[]; currentIds: string[]; lang: Lang; busy: boolean;
  documentTitle: (doc: DocumentItem) => string;
  onDownload: (doc: DocumentItem) => void; onSigned: (doc: DocumentItem) => void; onReview: () => void;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const columns: ColumnDef<DocumentItem>[] = [
    { id: "name", label: tx("Документ", "Dokument"), accessor: documentTitle, minWidth: 250,
      render: doc => <span className="block min-w-0 truncate font-medium" title={documentTitle(doc)}>{documentTitle(doc)}</span> },
    { id: "status", label: tx("Статус", "Status"), accessor: doc => doc.signed_at, minWidth: 270,
      render: doc => <Badge variant="outline" className={currentIds.includes(doc.id) && doc.signed_at ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}>
        {!currentIds.includes(doc.id) ? tx("Нужна новая версия", "Neue Version erforderlich") : doc.signed_at ? tx("Подписано", "Unterschrieben") : tx("Ожидает подписи / ознакомления", "Unterschrift / Kenntnisnahme ausstehend")}
      </Badge> },
    { id: "signed", label: tx("Дата подписи", "Unterschrieben am"), accessor: doc => doc.signed_at, width: 145,
      render: doc => <span className="font-mono tabular-nums">{formatIntakeDate(doc.signed_at)}</span> },
  ];
  return <DataTable rows={documents} columns={columns} rowId={doc => doc.id} density="compact" rowHeightOverrides={{ compact: 48 }} mobilePrimaryColumnId="name" className={TABLE_CLASS}
    rowActionsWidth={275} rowActions={doc => <div className="flex flex-wrap items-center justify-end gap-1">
      <Button type="button" variant="outline" size="sm" disabled={busy} aria-label={`${tx("Скачать PDF", "PDF herunterladen")}: ${documentTitle(doc)}`} onClick={() => onDownload(doc)}><Download className="size-3.5" />PDF</Button>
      <DocumentSignatureAction iconOnly documentId={doc.id} title={doc.auto_name} disabled={busy || !currentIds.includes(doc.id)} onDone={onReview} />
      {!doc.signed_at && currentIds.includes(doc.id) ? <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onSigned(doc)}>{tx("Подписано на бумаге", "Auf Papier unterschrieben")}</Button> : null}
    </div>}
    emptyState={<p className="px-4 py-8 text-center text-xs text-muted-foreground">{tx("Документы ещё не созданы. Выберите документ для подготовки.", "Noch keine Dokumente erstellt. Wählen Sie ein Dokument zur Erstellung aus.")}</p>}
  />;
}

export function OrderWizardChecksTable({ checks, lang, busy, onStepChange }: {
  checks: IntakeCheck[]; lang: Lang; busy: boolean; onStepChange: (step: number) => void;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const label = (check: IntakeCheck) => INTAKE_CHECK_LABELS[check.key]?.[lang === "de" ? 1 : 0] ?? check.key;
  const columns: ColumnDef<IntakeCheck>[] = [
    { id: "check", label: tx("Проверка", "Prüfung"), accessor: label, minWidth: 360, render: check => <span className="truncate" title={label(check)}>{label(check)}</span> },
    { id: "status", label: tx("Статус", "Status"), accessor: check => check.status, width: 185, render: check => <Badge variant="outline" className={check.status === "passed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}>
      {check.status === "passed" ? <><Check />{tx("Готово", "Erledigt")}</> : check.status === "warning" ? tx("Внимание", "Hinweis") : tx("Нужно завершить", "Offen")}
    </Badge> },
  ];
  return <DataTable rows={checks} columns={columns} rowId={check => check.key} density="compact" rowHeightOverrides={{ compact: 44 }} mobilePrimaryColumnId="check" className="sm:max-h-[420px]"
    onRowClick={busy ? undefined : check => onStepChange(check.step)}
    rowActions={check => <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={`${tx("Открыть этап", "Schritt öffnen")}: ${label(check)}`} onClick={() => onStepChange(check.step)}><ArrowRight className="size-3.5" /></Button>}
  />;
}
