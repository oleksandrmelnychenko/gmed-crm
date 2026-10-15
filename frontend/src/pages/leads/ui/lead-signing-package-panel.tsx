import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusChip } from "@/components/ui/status-chip";
import { useLang } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { useSignatureSummary } from "@/pages/documents/data/use-signature-summary";
import { SignatureProgressChips } from "@/pages/documents/ui/signature-progress-chips";
import { signatureStatusText } from "@/pages/documents/ui/signature-status";
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
}: {
  leadId: string;
  contractDocument: DocumentItem | null;
  orderDocument: DocumentItem | null;
  contractSigned: boolean;
  inheritedContract: boolean;
  onDone: () => void;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  // The entity may still say "signed" after a new, unsigned PDF version was
  // created. Choose by the current documents' proof, and keep signed documents
  // available for history once there is nothing left to sign.
  const currentContractSigned = contractDocument ? Boolean(contractDocument.signed_at) : contractSigned;
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

  const contractApplies = currentContractSigned || (!contractDocument && inheritedContract);
  const description = source
    ? tx("Проверьте состав пакета в окне подписи.", "Prüfen Sie den Paketinhalt im Unterschriftsfenster.")
    : tx(
        "Создайте договор и заказ ниже. Документы для общего приглашения выбираются в окне подписи.",
        "Vertrag und Auftrag unten erstellen. Die Dokumente für die gemeinsame Einladung wählen Sie im Unterschriftsfenster.",
      );

  return (
    <section
      className="flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-xl border border-border/50 bg-card p-3.5"
      data-testid="lead-signing-package"
    >
      <div className="w-full min-w-0 space-y-1 sm:w-auto sm:flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <AdminSectionTitle>
            {tx("Электронная подпись пакета", "Elektronische Unterschrift des Pakets")}
          </AdminSectionTitle>
        </div>
        <div className="flex flex-wrap gap-2" data-signing-document-statuses>
          {contractApplies ? (
            <StatusChip tone="success">{contractDocument?.ursprung === "paper_signature" && contractDocument.signed_at
              ? tx("Рамочный договор: подписан на бумаге", "Rahmenvertrag: auf Papier unterzeichnet")
              : tx("Рамочный договор: подписан", "Rahmenvertrag: unterzeichnet")}</StatusChip>
          ) : contractDocument ? (
            <StatusChip tone="warning">{tx("Рамочный договор: не подписан", "Rahmenvertrag: nicht unterzeichnet")}</StatusChip>
          ) : null}
          {orderDocument ? (
            <StatusChip tone={orderDocument.signed_at ? "success" : "warning"}>{orderDocument.signed_at
              ? tx("Заказ: подписан", "Auftrag: unterzeichnet")
              : tx("Заказ: не подписан", "Auftrag: nicht unterzeichnet")}</StatusChip>
          ) : null}
        </div>
        {summary && summary.document_id === source?.id ? <div className="space-y-1.5" data-current-package-status>
          <StatusChip tone={summary.status === "completed" ? "success" : ["declined", "error", "needs_review"].includes(summary.status) ? "error" : "warning"}>
            {summary.test_mode ? "DEMO · " : ""}{summary.status === "pending"
              ? tx("Запрос принят Skribble", "Anfrage von Skribble angenommen")
              : signatureStatusText(summary.status, lang)}
          </StatusChip>
          {summary.status === "pending" && summary.progress && summary.progress.total > 0
            ? <SignatureProgressChips progress={summary.progress} testMode={summary.test_mode} lang={lang} /> : null}
        </div> : null}
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">
        {source ? (
          <DocumentSignatureAction
            documentId={source.id}
            title={title}
            signed={Boolean(source.signed_at)}
            onDone={onDone}
          />
        ) : (
          <DocumentSignatureAction scope={{ leadId }} title={title} onDone={onDone} />
        )}
      </div>
    </section>
  );
}
