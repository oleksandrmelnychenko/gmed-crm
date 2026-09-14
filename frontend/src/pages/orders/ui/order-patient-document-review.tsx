import { useState } from "react";
import { Check, Eye, RefreshCw } from "lucide-react";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnDef } from "@/components/data-table/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import type { ContractItem } from "@/pages/contracts/model/types";
import type { DocumentItem } from "@/pages/documents/model/types";
import type { PatientOrderRecheck } from "../model/types";
import { contractCoversOrder, formatIntakeDate, INTAKE_CHECK_LABELS } from "../model/order-intake";
import { contractValidity, CONTRACT_VALIDITY_LABELS, passportReviewStatus, PASSPORT_REVIEW_LABELS } from "../model/order-document-review";
import { OrderWizardSection } from "./order-wizard-tables";

const tableClass = "rounded-none border-0 bg-transparent shadow-none sm:max-h-[400px]";
function ReviewBadge({ ready, children }: { ready: boolean; children: React.ReactNode }) {
  return <Badge variant="outline" className={`h-auto min-h-5 max-w-full whitespace-normal! text-[11px] leading-4 ${ready ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{children}</Badge>;
}

export function OrderExistingContractsTable({ contracts, dateFrom, dateTo, selectedId, lang, busy, onSelect }: {
  contracts: ContractItem[]; dateFrom: string | null; dateTo: string | null; selectedId: string | null;
  lang: Lang; busy: boolean; onSelect: (id: string) => void;
}) {
  const language = lang === "de" ? 1 : 0;
  const tx = (ru: string, de: string) => language ? de : ru;
  const columns: ColumnDef<ContractItem>[] = [
    { id: "number", label: tx("Договор", "Vertrag"), accessor: row => row.contract_number, minWidth: 145,
      render: row => <span className="font-mono font-medium">{row.contract_number}</span> },
    { id: "status", label: tx("Статус сейчас", "Aktueller Status"), accessor: contractValidity, minWidth: 160,
      render: row => { const status = contractValidity(row); return <ReviewBadge ready={status === "valid"}>{CONTRACT_VALIDITY_LABELS[status]?.[language] ?? tx("Проверьте статус", "Status prüfen")}</ReviewBadge>; } },
    { id: "signed", label: tx("Подписан", "Unterzeichnet am"), accessor: row => row.signed_at, width: 145,
      render: row => <span className="font-mono">{formatIntakeDate(row.signed_at)}</span> },
    { id: "period", label: tx("Срок действия", "Gültigkeitszeitraum"), accessor: row => row.valid_to, minWidth: 245,
      render: row => <span className="font-mono">{row.valid_from ? formatIntakeDate(row.valid_from) : tx("Без ограничения начала", "Ohne Beginnbegrenzung")} – {row.valid_to ? formatIntakeDate(row.valid_to) : tx("Бессрочно", "Unbefristet")}</span> },
    { id: "coverage", label: tx("Для этого заказа", "Für diesen Auftrag"), accessor: row => contractCoversOrder(row, dateFrom, dateTo), minWidth: 235,
      render: row => !dateFrom || !dateTo || dateFrom > dateTo ? <span className="text-muted-foreground">{tx("Укажите период заказа", "Auftragszeitraum angeben")}</span> : <ReviewBadge ready={contractCoversOrder(row, dateFrom, dateTo)}>{contractCoversOrder(row, dateFrom, dateTo) ? tx("Покрывает весь период", "Deckt den gesamten Zeitraum ab") : tx("Нужен другой / новый договор", "Anderer / neuer Vertrag erforderlich")}</ReviewBadge> },
  ];
  return <DataTable rows={contracts} columns={columns} rowId={row => row.id} density="compact" rowHeightOverrides={{ compact: 56 }} mobilePrimaryColumnId="number" className={tableClass}
    rowActionsWidth={160} rowActions={row => row.id === selectedId ? <ReviewBadge ready={contractCoversOrder(row, dateFrom, dateTo)}><Check className="size-3" />{tx("Выбран", "Ausgewählt")}</ReviewBadge> : contractCoversOrder(row, dateFrom, dateTo) ? <Button type="button" size="sm" variant="outline" disabled={busy} aria-label={`${tx("Использовать договор", "Vertrag verwenden")}: ${row.contract_number}`} onClick={() => onSelect(row.id)}>{tx("Использовать", "Verwenden")}</Button> : null}
    emptyState={<p className="p-4 text-xs text-muted-foreground">{tx("Сохранённых договоров нет. Создайте рамочный договор на этапе «Договор».", "Keine gespeicherten Verträge. Erstellen Sie im Schritt „Vertrag“ einen Rahmenvertrag.")}</p>} />;
}

type ReviewRow = { key: string; label: string; ready: boolean; status: string; detail: string };
export function OrderPatientDocumentReview({ readiness, documents, dateTo, lang, busy, onRefresh, onOpenDocuments, onSaveExpiry }: {
  readiness: PatientOrderRecheck; documents: DocumentItem[]; dateTo: string | null; lang: Lang; busy: boolean;
  onRefresh: () => void; onOpenDocuments: () => void; onSaveExpiry: (expiry: string) => Promise<boolean | undefined>;
}) {
  const language = lang === "de" ? 1 : 0;
  const tx = (ru: string, de: string) => language ? de : ru;
  const [editing, setEditing] = useState(false);
  const [expiry, setExpiry] = useState("");
  const passportStatus = passportReviewStatus(readiness.passport_expiry, dateTo);
  const signedOn = (kind: string) => documents.filter(doc => doc.is_latest_version && doc.status !== "archived" && !doc.file_deleted_at && doc.signed_at && (doc.compliance_kind === kind || doc.generated_template_id === kind))
    .map(doc => doc.signed_at!).sort().at(-1);
  const consentDate = signedOn("dsgvo") ?? signedOn("privacy_consents");
  const releaseDate = signedOn("confidentiality_release");
  const rows: ReviewRow[] = [
    { key: "passport", label: tx("Паспорт", "Reisepass"), ready: passportStatus === "valid", status: PASSPORT_REVIEW_LABELS[passportStatus][language],
      detail: readiness.passport_expiry ? `${tx("Действует до", "Gültig bis")}: ${formatIntakeDate(readiness.passport_expiry)}` : tx("Дата окончания действия отсутствует", "Ablaufdatum fehlt") },
    ...(["compliance_ready", "confidentiality_release_ready", "identity_ready", "document_pack_ready"] as const).map(key => ({
      key, label: INTAKE_CHECK_LABELS[key][language], ready: readiness.requires_recheck && readiness[key] && !(key === "document_pack_ready" && (readiness.document_alerts.missing_count > 0 || readiness.document_alerts.out_of_sync)),
      status: !readiness.requires_recheck ? tx("Проверка ещё не выполнена", "Noch nicht geprüft")
        : key === "document_pack_ready" && readiness[key] && (readiness.document_alerts.missing_count > 0 || readiness.document_alerts.out_of_sync) ? tx("Есть расхождения — проверьте документы", "Abweichungen — Dokumente prüfen")
        : readiness[key] ? tx("Подтверждено в карточке", "In der Akte bestätigt") : tx("Нужно проверить / дополнить", "Prüfen / ergänzen"),
      detail: key === "compliance_ready" && consentDate ? `${tx("Согласие подписано", "Einwilligung unterzeichnet")}: ${formatIntakeDate(consentDate)}`
        : key === "confidentiality_release_ready" && releaseDate ? `${tx("Подписано", "Unterzeichnet")}: ${formatIntakeDate(releaseDate)}`
        : key === "document_pack_ready" && readiness.document_alerts.missing_count > 0 ? `${tx("Не хватает документов", "Fehlende Dokumente")}: ${readiness.document_alerts.missing_count}` : "—",
    })),
  ];
  const columns: ColumnDef<ReviewRow>[] = [
    { id: "document", label: tx("Документ / проверка", "Dokument / Prüfung"), accessor: row => row.label, minWidth: 265, render: row => <span className="font-medium">{row.label}</span> },
    { id: "status", label: tx("Статус", "Status"), accessor: row => row.status, minWidth: 250, render: row => <ReviewBadge ready={row.ready}>{row.status}</ReviewBadge> },
    { id: "detail", label: tx("Срок / сведения", "Gültigkeit / Angaben"), accessor: row => row.detail, minWidth: 245 },
  ];
  return <OrderWizardSection flush title={tx("Проверка документов пациента", "Patientendokumente prüfen")}
    accessory={<Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onRefresh}><RefreshCw className="size-3.5" />{tx("Проверить снова", "Erneut prüfen")}</Button>}>
    <DataTable rows={rows} columns={columns} rowId={row => row.key} density="compact" rowHeightOverrides={{ compact: 44 }} mobilePrimaryColumnId="document" className={tableClass}
      rowActionsWidth={210} rowActions={row => row.key === "passport" ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setExpiry(readiness.passport_expiry ?? ""); setEditing(true); }}>{tx("Обновить срок", "Gültigkeit ändern")}</Button> : <Button type="button" size="sm" disabled={busy} onClick={onOpenDocuments}><Eye className="size-3.5" />{tx("Посмотреть документы", "Dokumente ansehen")}</Button>} />
    {editing ? <div role="group" aria-label={tx("Паспорт действителен до", "Reisepass gültig bis")} className="space-y-3 border-t p-3 sm:p-4">
      <Field label={tx("Паспорт действителен до", "Reisepass gültig bis")}><Input aria-label={tx("Паспорт действителен до", "Reisepass gültig bis")} type="date" value={expiry} onChange={event => setExpiry(event.target.value)} className="max-w-xs" /></Field>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" disabled={busy || !expiry || expiry === readiness.passport_expiry} onClick={() => { void onSaveExpiry(expiry).then(saved => { if (saved) setEditing(false); }); }}>{tx("Сохранить срок в карточке пациента", "Gültigkeit in Patientenakte speichern")}</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>{tx("Отмена", "Abbrechen")}</Button></div>
    </div> : null}
    {readiness.document_alerts.missing_documents.length ? <p className="border-t p-3 text-xs text-amber-800">{tx("Отсутствуют", "Fehlend")}: {readiness.document_alerts.missing_documents.map(doc => doc.label).join(", ")}</p> : null}
  </OrderWizardSection>;
}
