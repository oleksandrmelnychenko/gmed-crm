import { Banner } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import type { InvoiceImportFields, InvoiceImportPreview } from "../model/import-model";

export function StructuredInvoiceDetails({ preview, labels }: { preview: InvoiceImportPreview; labels: Record<keyof InvoiceImportFields, string> }) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const warnings = preview.warnings;
  return <>
    {preview.structured ? <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-xs">
      <p className="font-medium">{tx("Реквизиты прочитаны из XML", "Angaben aus XML gelesen")} · {preview.structured.syntax.toUpperCase()}{preview.source_format === "embedded_xml" ? tx(" · вложение PDF", " · PDF-Anhang") : ""}</p>
      <p>{tx("Сверьте реквизиты и получателя с оригиналом перед сохранением.", "Angaben und Empfänger vor dem Speichern mit dem Original abgleichen.")}</p>
      {preview.recipient?.name ? <p>{tx("Получатель счёта", "Rechnungsempfänger")}: {preview.recipient.name}</p> : null}
    </div> : null}
    {preview.structured?.import_allowed === false ? <Banner tone="warning" withIcon>{tx("Этот тип документа пока доступен только для просмотра. Кредит-ноту или другой тип нельзя сохранить как обычный входящий счёт.", "Dieser Dokumenttyp kann derzeit nur angesehen werden. Gutschriften und andere Typen können nicht als normale Eingangsrechnung gespeichert werden.")}</Banner> : null}
    {preview.source_differences?.length ? <Banner tone="warning" withIcon><div className="space-y-2">
      <p>{tx("XML и видимый PDF содержат разные реквизиты. В поля подставлены данные XML. Сверьте обе версии и исправьте поля перед подтверждением.", "XML und sichtbares PDF enthalten unterschiedliche Angaben. Die Felder zeigen XML-Werte. Beide Fassungen vergleichen und Felder vor der Bestätigung korrigieren.")}</p>
      <ul className="space-y-1">{preview.source_differences.map((difference) => <li key={difference.field}>{labels[difference.field]}: XML {difference.structured} · PDF {difference.visible}</li>)}</ul>
    </div></Banner> : null}
    {warnings.includes("structured_pdf_comparison_unavailable") ? <Banner tone="warning" withIcon>{tx("Не все реквизиты видимого PDF удалось сравнить с XML. Сверьте их с оригиналом вручную.", "Nicht alle Angaben im sichtbaren PDF konnten mit XML verglichen werden. Manuell mit dem Original abgleichen.")}</Banner> : null}
    {warnings.includes("multiple_embedded_invoices") || warnings.includes("embedded_xml_unreadable") || warnings.includes("embedded_xml_limit") ? <Banner tone="warning" withIcon>{tx("XML-вложения PDF не удалось однозначно прочитать. Поля заполнены по видимому документу; XML не использован.", "Die XML-Anhänge des PDFs konnten nicht eindeutig gelesen werden. Die Felder stammen aus dem sichtbaren Dokument; XML wurde nicht übernommen.")}</Banner> : null}
    {warnings.includes("structured_vat_mismatch") || warnings.includes("structured_payable_mismatch") || warnings.includes("structured_currency_mismatch") || warnings.some((warning) => warning.startsWith("invalid_or_ambiguous_")) ? <Banner tone="warning" withIcon>{tx("В XML есть неоднозначные реквизиты или несогласованные суммы, НДС либо валюта. Проверьте реквизиты и условия оплаты по оригиналу.", "Das XML enthält mehrdeutige Angaben oder widersprüchliche Beträge, Steuer- oder Währungsangaben. Angaben und Zahlungsbedingungen im Original prüfen.")}</Banner> : null}
    {preview.tax_breakdown?.length ? <div className="space-y-1 text-xs"><p className="font-medium">{tx("НДС по XML", "Umsatzsteuer laut XML")}</p>{preview.tax_breakdown.map((tax, index) => <p key={index}>{tax.category ?? "—"} · {tax.rate ?? "—"} % · {tx("База", "Basis")}: {tax.base ?? "—"} · {tx("НДС", "USt.")}: {tax.amount ?? "—"} {preview.fields.currency}</p>)}</div> : null}
  </>;
}
