import { OrderCatalogServicesTable } from "./order-catalog-services-table";
import type { ServiceLine } from "../model/order-service-line";
import { serviceDescriptionItems, serviceDescriptionText } from "@/lib/service-description";
import { money, formatMoneyValue, germanDateLabel, servicePriceOptionValue, parseServicePriceOptionValue, serviceBillingUnitLabel, resolveServiceDescriptionItems } from "../model/order-service-presentation";
import { useState, type ReactNode } from "react";
import { ArrowRight, Check, Download } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Field, Section } from "@/components/ui-shell";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import type { Lang } from "@/lib/i18n";
import { listAgencyServicePriceChoices } from "@/pages/contracts/model/contracts-model";
import type { AgencyServiceItem } from "@/pages/contracts/model/types";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import { formatIntakeDate, INTAKE_CHECK_LABELS } from "../model/order-intake";
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
export function OrderWizardLinesTable({ lines, catalog, effectiveOn, dateTo, specialties, lang, busy, onChange, children }: {
  lines: IntakeLine[]; catalog: AgencyServiceItem[]; effectiveOn: string | null; dateTo: string | null; specialties: string[];
  lang: Lang; busy: boolean; onChange: (lines: IntakeLine[]) => void; children?: ReactNode;
}) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const [deleteLine, setDeleteLine] = useState<ServiceLine | null>(null);
  const catalogById = new Map(catalog.map(service => [service.id, service]));
  const rows: ServiceLine[] = lines.map(line => {
    const service = catalogById.get(line.agency_service_id ?? "");
    return { id: line.id, agencyServiceId: line.agency_service_id, agencyServicePriceVersionId: line.agency_service_price_version_id,
      clientReference: null, description: line.description, catalogDescription: service?.description ?? "",
      catalogDescriptionItems: serviceDescriptionItems(service?.description_items, service?.description), catalogUnitLabel: service?.unit_label ?? "",
      currency: "EUR", quantity: line.quantity, price: line.unit_price, vat: line.vat_rate };
  });
  const totals = rows.reduce((result, line) => {
    const net = Math.round(money(line.quantity) * money(line.price) * 100) / 100;
    const vat = Math.round(net * money(line.vat)) / 100;
    return { net: result.net + net, vat: result.vat + vat, gross: result.gross + net + vat };
  }, { net: 0, vat: 0, gross: 0 });
  const updateLine = (id: string, patch: Partial<IntakeLine>) => onChange(lines.map(line => line.id === id ? { ...line, ...patch } : line));
  const describe = (line: ServiceLine) => serviceDescriptionText(resolveServiceDescriptionItems(line.catalogDescriptionItems ?? [], {
    dateFrom: effectiveOn ?? "", dateTo: dateTo ?? "", specialties,
  }));
  return <Section title={tx("Позиции заказа", "Auftragspositionen")} className="rounded-xl border border-border/70 bg-card p-4" accessory={<Badge variant="secondary">{lines.length}</Badge>}>
    {children}
    <Field label={tx("Добавить услугу из каталога", "Leistung aus dem Katalog hinzufügen")}>
      <NativeComboboxSelect aria-label={tx("Выбрать услугу из каталога", "Leistung aus dem Katalog auswählen")} className="w-full md:max-w-2xl" value="" disabled={busy} onChange={event => {
        const selection = parseServicePriceOptionValue(event.target.value);
        const service = catalogById.get(selection?.serviceId ?? "");
        const price = service && listAgencyServicePriceChoices(service, effectiveOn ?? undefined).find(item => item.id === selection?.priceVersionId);
        if (!service || !price || price.currency.toUpperCase() !== "EUR" || lines.some(line => line.agency_service_id === service.id)) return;
        onChange([...lines, { id: crypto.randomUUID(), description: service.service_name, quantity: "1", unit_price: String(price.unit_price), vat_rate: String(price.vat_rate), agency_service_id: service.id, agency_service_price_version_id: price.id || null }]);
      }}>
        <option value="">{tx("Выберите услугу и цену", "Leistung und Preis auswählen")}</option>
        {catalog.map(service => <optgroup key={service.id} label={service.service_name}>
          {listAgencyServicePriceChoices(service, effectiveOn ?? undefined).map(price => <option key={price.id || 'catalog'} value={servicePriceOptionValue(service.id, price.id)} disabled={lines.some(line => line.agency_service_id === service.id) || price.currency.toUpperCase() !== "EUR"}>
            {formatMoneyValue(money(price.unit_price), lang)} {price.currency} / {serviceBillingUnitLabel(service.unit_label, tx)} · {price.name || germanDateLabel(price.valid_from)}{price.is_effective ? ` · ${tx("Рекомендуемая", "Empfohlen")}` : ""}
          </option>)}
        </optgroup>)}
      </NativeComboboxSelect>
    </Field>
    {lines.length ? <OrderCatalogServicesTable lines={rows} catalogById={catalogById} effectiveOn={effectiveOn ?? undefined} lang={lang} tx={tx} disabled={busy} totals={totals} describe={describe}
      selectedPriceId={(line, service) => line.agencyServicePriceVersionId ?? listAgencyServicePriceChoices(service, effectiveOn ?? undefined).find(price => money(price.unit_price) === money(line.price) && money(price.vat_rate) === money(line.vat))?.id ?? ""}
      onQuantityChange={(line, quantity) => updateLine(line.id, { quantity })}
      onPriceChange={(line, service, priceId) => { const price = listAgencyServicePriceChoices(service, effectiveOn ?? undefined).find(item => item.id === priceId); if (price && price.currency.toUpperCase() === "EUR") updateLine(line.id, { agency_service_price_version_id: price.id || null, unit_price: String(price.unit_price), vat_rate: String(price.vat_rate) }); }}
      onDelete={setDeleteLine} /> : <p className="py-3 text-xs text-muted-foreground">{tx("Услуги из каталога не выбраны", "Keine Katalogleistungen ausgewählt")}</p>}
    <Dialog open={Boolean(deleteLine)} onOpenChange={open => { if (!open) setDeleteLine(null); }}>
      <DialogContent><DialogHeader><DialogTitle>{tx("Удалить услугу?", "Leistung entfernen?")}</DialogTitle><DialogDescription>{deleteLine?.description}</DialogDescription></DialogHeader>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setDeleteLine(null)}>{tx("Отмена", "Abbrechen")}</Button><Button type="button" variant="destructive" disabled={busy} onClick={() => { if (deleteLine) onChange(lines.filter(line => line.id !== deleteLine.id)); setDeleteLine(null); }}>{tx("Удалить", "Entfernen")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </Section>;
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
      render: doc => <Badge variant="outline" className={`h-auto min-h-5 max-w-full whitespace-normal! text-[11px] leading-4 ${currentIds.includes(doc.id) && doc.signed_at ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {!currentIds.includes(doc.id) ? tx("Нужна новая версия", "Neue Version erforderlich") : doc.signed_at ? tx("Подписано", "Unterschrieben") : tx("Ожидает подписи / ознакомления", "Unterschrift / Kenntnisnahme ausstehend")}
      </Badge> },
    { id: "signed", label: tx("Дата подписи", "Unterschrieben am"), accessor: doc => doc.signed_at, width: 145,
      render: doc => <span className="font-mono tabular-nums">{formatIntakeDate(doc.signed_at)}</span> },
  ];
  return <DataTable rows={documents} columns={columns} rowId={doc => doc.id} density="compact" rowHeightOverrides={{ compact: 48 }} mobilePrimaryColumnId="name" className={TABLE_CLASS}
    rowActionsWidth={340} rowActions={doc => <div className="flex flex-wrap items-center justify-end gap-1">
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
