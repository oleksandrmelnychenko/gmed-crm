import { Info } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { Banner, StatusBadge } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { useLang } from "@/lib/i18n";
import { CONSENT_CHOICE_REASONS, signatureErrorText, type OnboardingManifest } from "../data/document-signature-api";

const names: Record<string, [string, string]> = {
  framework_contract: ["Рамочный договор", "Rahmenvertrag"],
  single_order: ["Заказ", "Einzelauftrag"],
  order_cost_estimate: ["Смета к заказу", "Kostenvoranschlag zum Auftrag"],
  lead_self_disclosure: ["Формуляр пациента", "Patientenformular"],
  confidentiality_release: ["Освобождение от врачебной тайны", "Schweigepflichtsentbindung"],
  privacy_consents: ["Согласия на передачу данных", "Einwilligungen zur Datenübermittlung"],
  consent_data_release_child: ["Согласие законных представителей ребёнка", "Einwilligung der gesetzlichen Vertretung des Kindes"],
  consent_data_release_single: ["Согласие единственного представителя ребёнка", "Einwilligung der alleinigen Vertretung des Kindes"],
};

/** Full initial composition, including existing evidence and missing forms.
 * A paper scan is selected only by an explicit checkbox or the select-all action. */
export function OnboardingSignatureManifest({ manifest, documentId, selectedIds = [], paperIds = [], availableIds = [], onSelect, disabled }: {
  manifest: OnboardingManifest; documentId?: string; selectedIds?: string[]; paperIds?: string[];
  availableIds?: string[]; onSelect?: (ids: string[], paperIds: string[]) => void; disabled?: boolean;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const incomplete = manifest.items.some(item => item.state !== "signed" &&
    (item.state !== "ready" || item.pending_elsewhere || !item.document_id || !selectedIds.includes(item.document_id)));
  const selectable = manifest.items.filter(item => item.document_id && availableIds.includes(item.document_id)
    && !item.pending_elsewhere && (item.state === "ready" || (item.state === "signed" && item.paper_signed)));
  return <section data-onboarding-manifest className="space-y-3 rounded-xl border border-border/70 bg-muted/20 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <AdminSectionTitle>{tx("Полный комплект первичного оформления", "Vollständige Erstaufnahme")}</AdminSectionTitle>
      <StatusBadge tone="neutral">{manifest.expected_count} {tx("документов", "Dokumente")}</StatusBadge>
    </div>
    {onSelect && selectable.length ? <Button type="button" size="sm" variant="outline" className="h-auto max-w-full whitespace-normal text-left" disabled={disabled} onClick={() => {
      const ids = selectable.flatMap(item => item.document_id ? [item.document_id] : []);
      const paper = selectable.flatMap(item => item.paper_signed && item.document_id ? [item.document_id] : []);
      onSelect([...new Set([...selectedIds, ...ids])], [...new Set([...paperIds, ...paper])]);
    }}>{tx("Выбрать доступные, включая бумажные копии", "Verfügbare auswählen, einschließlich Papierkopien")}</Button> : null}
    <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-card">
      {manifest.items.map(item => {
        const id = item.document_id;
        const checked = Boolean(id && (item.paper_signed ? paperIds.includes(id) : selectedIds.includes(id)));
        const canSelect = Boolean(onSelect && id && selectable.includes(item));
        return <li key={item.template} className="min-w-0 space-y-1.5 px-3 py-2">
          <div className="flex min-w-0 items-start gap-2">
          {onSelect ? <input type="checkbox" className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
            aria-label={`${tx("Включить в электронный пакет", "In das elektronische Paket aufnehmen")}: ${tx(...(names[item.template] ?? [item.template, item.template]))}`}
            checked={checked} disabled={disabled || !canSelect || (id === documentId && !item.paper_signed)}
            onChange={event => {
              if (!id) return;
              const ids = event.target.checked ? [...new Set([...selectedIds, id])]
                : id === documentId ? selectedIds : selectedIds.filter(other => other !== id);
              const paper = event.target.checked && item.paper_signed ? [...new Set([...paperIds, id])] : paperIds.filter(other => other !== id);
              onSelect?.(ids, paper);
            }} /> : null}
            <p className="min-w-0 flex-1 break-words text-sm font-semibold">{tx(...(names[item.template] ?? [item.template, item.template]))}</p>
          <StatusBadge tone={item.pending_elsewhere ? "warning" : item.state === "signed" ? "success" : item.state === "ready" ? "neutral" : "warning"}>
            {item.pending_elsewhere ? tx("На подписи", "In Unterzeichnung") : item.state === "signed" ? item.paper_signed ? tx("Подписан на бумаге", "Auf Papier unterschrieben") : tx("Подписан", "Unterschrieben") : item.state === "missing" ? tx("Не создан", "Fehlt") : item.state === "blocked" ? tx("Нужна проверка", "Prüfung nötig") : checked ? tx("В пакете", "Im Paket") : tx("Не выбран", "Nicht ausgewählt")}
          </StatusBadge>
          </div>
          <div className="min-w-0 space-y-1.5">
            {item.title ? <p className="break-words text-xs leading-5 text-foreground">{item.title}{item.version ? ` · v${item.version}` : ""}</p> : null}
            {item.state === "missing" ? <p className="text-xs text-amber-700 dark:text-amber-300">{tx("Сначала создайте этот документ.", "Erstellen Sie zuerst dieses Dokument.")}</p> : null}
            {item.reason && CONSENT_CHOICE_REASONS.has(item.reason) ? <div className="flex w-full items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-5 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"><Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" /><span>{signatureErrorText(item.reason, tx)}</span></div> : null}
            {item.state === "blocked" && !CONSENT_CHOICE_REASONS.has(item.reason ?? "") ? <p className="text-xs text-destructive">{tx("Проверьте доступ и текущую PDF-версию документа.", "Prüfen Sie den Zugriff und die aktuelle PDF-Version.")}</p> : null}
          </div>
        </li>;
      })}
    </ul>
    {incomplete && onSelect ? <Banner tone="warning">{tx("Для первичного оформления нужен полный комплект: создайте недостающие документы и включите неподписанные PDF. Выбор согласий заполняет сам пациент или представитель.", "Die Erstaufnahme benötigt das vollständige Paket: Erstellen Sie fehlende Dokumente und nehmen Sie die unsignierten PDFs auf. Einwilligungen wählt die Patientenseite bzw. ihre Vertretung selbst aus.")}</Banner> : null}
  </section>;
}
