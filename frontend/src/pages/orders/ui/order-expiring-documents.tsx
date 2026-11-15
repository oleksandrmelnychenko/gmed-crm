import { Upload } from "lucide-react";

import { StaffLink } from "@/components/staff-link";
import { Banner } from "@/components/ui-shell";
import { needsValidityAttention } from "@/pages/documents/model/document-validity";
import { isOutdatedCurrentVersion } from "@/pages/documents/model/outdated-document-version";
import { DocumentValidityAction, DocumentValidityChip } from "@/pages/documents/ui/document-validity";
import {
  useCanRenewOutdatedDocuments,
  useOutdatedDocumentRenewal,
} from "@/pages/documents/ui/outdated-document-renewal";
import type { SupportingDocumentOption } from "../model/types";

/** DD.MM.YYYY for dates the stored name carries as "2026-10-10". */
function displayName(document: SupportingDocumentOption): string {
  return (document.auto_name || document.original_filename || "").replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3.$2.$1");
}

/**
 * The order's documents whose optional «Gültig bis» passed or is within 30
 * days (owner 2026-11-15). A document made from a template gets «Создать
 * новую версию» (fix-65), an uploaded scan a link to the patient's documents
 * where it is uploaded again. Documents without a date never show here.
 */
export function OrderExpiringDocuments({
  orderId,
  patientId,
  documents,
  lang,
  onChanged,
}: {
  orderId: string;
  patientId: string | null | undefined;
  documents: readonly SupportingDocumentOption[];
  lang: string;
  onChanged: () => void;
}) {
  const de = lang === "de";
  const canRenew = useCanRenewOutdatedDocuments();
  const renewal = useOutdatedDocumentRenewal({ onRenewed: onChanged });
  const expiring = documents.filter((document) => document.order_id === orderId
    && needsValidityAttention(document)
    // The outdated banner already offers the new version.
    && !isOutdatedCurrentVersion(document));
  if (expiring.length === 0) return renewal.dialog ? <>{renewal.dialog}</> : null;
  const anyExpired = expiring.some((document) => document.validity_status === "expired");
  return (
    <>
      <Banner tone={anyExpired ? "error" : "warning"} withIcon>
        <div className="space-y-2" data-testid="order-expiring-documents">
          <p>
            {de
              ? "Die Gültigkeit dieser Dokumente läuft ab oder ist abgelaufen."
              : "Срок действия этих документов истекает или истёк."}
          </p>
          <ul className="space-y-1.5">
            {expiring.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium" title={displayName(document)}>{displayName(document)}</span>
                <DocumentValidityChip document={document} />
                {document.generated_template_id ? (
                  canRenew && document.patient_id ? (
                    <DocumentValidityAction
                      document={document}
                      busyId={renewal.busyId}
                      onRenew={(id) => void renewal.renew(id, "expired")}
                      title={displayName(document)}
                    />
                  ) : null
                ) : patientId ? (
                  <StaffLink
                    to={`/patients/${patientId}?tab=documents`}
                    className="inline-flex items-center gap-1.5 text-sm font-medium underline"
                  >
                    <Upload aria-hidden="true" className="size-3.5" />
                    {de ? "Neues hochladen" : "Загрузить новый"}
                  </StaffLink>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </Banner>
      {canRenew ? renewal.dialog : null}
    </>
  );
}
