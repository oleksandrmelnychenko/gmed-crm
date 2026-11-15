import { Banner } from "@/components/ui-shell";
import { OutdatedSignatureDocuments } from "@/pages/documents/ui/signature-status";
import { isOutdatedCurrentVersion } from "@/pages/documents/model/outdated-document-version";
import {
  OutdatedDocumentChip,
  RenewOutdatedDocumentButton,
  useCanRenewOutdatedDocuments,
  useOutdatedDocumentRenewal,
} from "@/pages/documents/ui/outdated-document-renewal";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";
import type { SupportingDocumentOption } from "../model/types";

/** DD.MM.YYYY for dates the stored name carries as "2026-10-10". */
function displayName(document: SupportingDocumentOption): string {
  return (document.auto_name || document.original_filename || "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3.$2.$1");
}

/**
 * The order's documents that were made before its terms changed and need a
 * new version before they are signed (`terms_current: false`). For an existing
 * patient the lead wizard is frozen, so the order workspace offers the new
 * version here: one click, then the signature dialog with the previous
 * recipients (owner request 2026-11-15). Sending stays a click of staff.
 */
export function OrderOutdatedDocuments({
  orderId,
  documents,
  lang,
  onChanged,
}: {
  orderId: string;
  documents: readonly SupportingDocumentOption[];
  lang: string;
  onChanged: () => void;
}) {
  const de = lang === "de";
  const canRenew = useCanRenewOutdatedDocuments();
  const renewal = useOutdatedDocumentRenewal({ onRenewed: onChanged });
  const outdated = documents.filter((document) => document.order_id === orderId && isOutdatedCurrentVersion(document));
  if (outdated.length === 0) return renewal.dialog ? <>{renewal.dialog}</> : null;
  return (
    <OutdatedSignatureDocuments.Provider value={outdated.map((document) => document.id)}>
      <Banner tone="warning" withIcon>
        <div className="space-y-2" data-testid="order-outdated-documents">
          <p>
            {de
              ? "Der Auftrag wurde nach der Erstellung dieser Dokumente geändert. Erstellen Sie eine neue Version und senden Sie sie zur Unterschrift."
              : "Заказ изменился после создания этих документов. Создайте новую версию и отправьте её на подпись."}
          </p>
          <ul className="space-y-1.5">
            {outdated.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium" title={displayName(document)}>{displayName(document)}</span>
                <OutdatedDocumentChip />
                <DocumentSignatureAction documentId={document.id} title={displayName(document)} iconOnly />
                {canRenew && document.patient_id ? (
                  <RenewOutdatedDocumentButton
                    documentId={document.id}
                    busyId={renewal.busyId}
                    onRenew={(id) => void renewal.renew(id)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Banner>
      {canRenew ? renewal.dialog : null}
    </OutdatedSignatureDocuments.Provider>
  );
}
