import { FileKey2 } from "lucide-react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusChip } from "@/components/ui/status-chip";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useSignatureSummary } from "@/pages/documents/data/use-signature-summary";
import { SignatureProgressChips } from "@/pages/documents/ui/signature-progress-chips";
import { OutdatedSignatureDocuments, signatureStatusText } from "@/pages/documents/ui/signature-status";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

/** Opens the current unsigned source, or signed history. The composer loads
 * actual candidates from the server; this summary must not promise a fixed
 * package, because already signed companions can be excluded. */
export function LeadSigningPackagePanel({
  leadId,
  contractDocument,
  orderDocument,
  contractSigned,
  inheritedContract,
  onDone,
  demoChecks = [],
  outdatedDocumentIds = [],
}: {
  leadId: string;
  contractDocument: DocumentItem | null;
  orderDocument: DocumentItem | null;
  contractSigned: boolean;
  inheritedContract: boolean;
  onDone: () => void;
  demoChecks?: readonly string[];
  /** Every document of the lead with `terms_current: false`, for the dialog's list. */
  outdatedDocumentIds?: readonly string[];
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  // The entity may still say "signed" after a new, unsigned PDF version was
  // created. Choose by the current documents' proof, and keep signed documents
  // available for history once there is nothing left to sign.
  // A signature on an outdated version names what no longer holds: «подписан»
  // stood beside «Устарел» after a change of the paying parent (QA 2026-11-01, V4).
  const contractOutdated = contractDocument?.terms_current === false;
  const orderOutdated = orderDocument?.terms_current === false;
  const currentContractSigned = contractDocument ? Boolean(contractDocument.signed_at) && !contractOutdated : contractSigned;
  const source = (contractDocument && !contractDocument.signed_at ? contractDocument : null)
    ?? (orderDocument && !orderDocument.signed_at ? orderDocument : null)
    ?? contractDocument
    ?? orderDocument;
  const sourceIsContract = Boolean(source && source.id === contractDocument?.id);
  const { user } = useAuth();
  const summary = useSignatureSummary(user && ["ceo", "patient_manager"].includes(user.role) ? user.id : undefined, source?.id);
  const title = source?.original_filename
    || (sourceIsContract
      ? tx("Рамочный договор", "Rahmenvertrag")
      : source
        ? tx("Заказ", "Auftrag")
        : tx("Документы обращения", "Unterlagen der Anfrage"));

  const currentRequest = summary && source && summary.document_id === source.id && source.terms_current !== false
    ? summary
    : undefined;
  const contractApplies = currentContractSigned || (!contractDocument && inheritedContract);
  const description = source
    ? tx("Проверьте состав пакета в окне подписи.", "Prüfen Sie den Paketinhalt im Unterschriftsfenster.")
    : null;

  return (
    <section
      className="min-w-0 space-y-1.5 rounded-xl border border-border/50 bg-card p-3"
      data-testid="lead-signing-package"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <AdminSectionTitle icon={FileKey2}>
          {tx("Электронная подпись пакета", "Elektronische Unterschrift des Pakets")}
        </AdminSectionTitle>
        <OutdatedSignatureDocuments.Provider value={outdatedDocumentIds}>
          {source ? (
            <DocumentSignatureAction
              documentId={source.id}
              title={title}
              triggerLabel={currentRequest ? tx("Открыть запрос", "Anfrage öffnen") : undefined}
              signed={Boolean(source.signed_at)}
              onDone={onDone}
            />
          ) : (
            <DocumentSignatureAction scope={{ leadId }} title={title} onDone={onDone} />
          )}
        </OutdatedSignatureDocuments.Provider>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 empty:hidden [&>[data-signature-progress]]:contents" data-signing-document-statuses>
        {contractApplies ? (
          <StatusChip tone="success">{contractDocument?.ursprung === "paper_signature" && contractDocument.signed_at
            ? tx("Рамочный договор: подписан на бумаге", "Rahmenvertrag: auf Papier unterzeichnet")
            : tx("Рамочный договор: подписан", "Rahmenvertrag: unterzeichnet")}</StatusChip>
        ) : contractOutdated ? (
          <StatusChip tone="warning">{tx("Рамочный договор: устарел, нужна новая версия", "Rahmenvertrag: veraltet, neue Version nötig")}</StatusChip>
        ) : contractDocument ? (
          <StatusChip tone={demoChecks.includes("contract_signed") ? "info" : "warning"}>{demoChecks.includes("contract_signed")
            ? tx("Рамочный договор: DEMO-подпись", "Rahmenvertrag: DEMO-Unterschrift")
            : tx("Рамочный договор: не подписан", "Rahmenvertrag: nicht unterzeichnet")}</StatusChip>
        ) : null}
        {orderOutdated ? (
          <StatusChip tone="warning">{tx("Заказ: устарел, нужна новая версия", "Auftrag: veraltet, neue Version nötig")}</StatusChip>
        ) : orderDocument ? (
          <StatusChip tone={orderDocument.signed_at ? "success" : demoChecks.includes("order_signed_patient") ? "info" : "warning"}>{orderDocument.signed_at
            ? tx("Заказ: подписан", "Auftrag: unterzeichnet")
            : demoChecks.includes("order_signed_patient")
              ? tx("Заказ: DEMO-подпись", "Auftrag: DEMO-Unterschrift")
              : tx("Заказ: не подписан", "Auftrag: nicht unterzeichnet")}</StatusChip>
        ) : null}
        {currentRequest ? (
          <>
            <StatusChip data-current-package-status tone={currentRequest.status === "completed" ? "success" : ["declined", "error", "needs_review"].includes(currentRequest.status) ? "error" : "warning"}>
              {currentRequest.test_mode ? "DEMO · " : ""}{currentRequest.status === "pending"
                ? tx("Запрос принят Skribble", "Anfrage von Skribble angenommen")
                : signatureStatusText(currentRequest.status, lang)}
            </StatusChip>
            {currentRequest.status === "pending" && currentRequest.progress && currentRequest.progress.total > 0
              ? <SignatureProgressChips progress={currentRequest.progress} testMode={currentRequest.test_mode} lang={lang} /> : null}
          </>
        ) : null}
      </div>
      {description ? <p className="max-w-2xl text-xs leading-5 text-muted-foreground">{description}</p> : null}
    </section>
  );
}
