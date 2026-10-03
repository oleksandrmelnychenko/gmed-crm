import { StatusBadge } from "@/components/record-workspace/recipes/status-badge";
import { useLang } from "@/lib/i18n";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

/**
 * Where the onboarding package of a lead is sent for e-signature. The
 * framework contract carries the package (contract, order,
 * Schweigepflichtsentbindung, DSGVO consents; the client signs first, GMED
 * second). Without a new contract document — a signed contract of the patient
 * still applies, or it is not generated yet — the documents are picked in the
 * package composer of the lead. The action renders only for roles that may
 * send invitations (CEO, patient manager).
 */
export function LeadSigningPackagePanel({
  leadId,
  contractDocument,
  contractSigned,
  inheritedContract,
  onDone,
}: {
  leadId: string;
  contractDocument: DocumentItem | null;
  contractSigned: boolean;
  inheritedContract: boolean;
  onDone: () => void;
}) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const title = contractDocument
    ? contractDocument.original_filename || tx("Рамочный договор", "Rahmenvertrag")
    : tx("Документы обращения", "Unterlagen der Anfrage");

  return (
    <section
      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3"
      data-testid="lead-signing-package"
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {tx("Электронная подпись пакета", "Elektronische Unterschrift des Pakets")}
          </h3>
          {contractSigned ? (
            <StatusBadge tone="success">{tx("Договор подписан", "Vertrag unterzeichnet")}</StatusBadge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {contractDocument
            ? tx(
                "Клиент получает одно приглашение: рамочный договор, заказ, освобождение от врачебной тайны и согласия DSGVO. Сначала подписывает клиент, затем GMED.",
                "Der Kunde erhält eine Einladung: Rahmenvertrag, Auftrag, Schweigepflichtsentbindung und DSGVO-Einwilligungen. Zuerst unterschreibt der Kunde, danach GMED.",
              )
            : inheritedContract
              ? tx(
                  "Действует ранее подписанный рамочный договор. Отправьте на подпись заказ и согласия — документы выбираются в окне подписи.",
                  "Es gilt ein bereits unterzeichneter Rahmenvertrag. Auftrag und Einwilligungen zur Unterschrift senden – die Dokumente werden im Unterschriftsfenster ausgewählt.",
                )
              : tx(
                  "Создайте рамочный договор ниже — он уходит на подпись одним пакетом вместе с заказом и согласиями. Отдельные документы можно выбрать в окне подписи.",
                  "Rahmenvertrag unten erstellen – er geht zusammen mit Auftrag und Einwilligungen als ein Paket zur Unterschrift. Einzelne Dokumente lassen sich im Unterschriftsfenster wählen.",
                )}
        </p>
      </div>
      <div className="shrink-0">
        {contractDocument ? (
          <DocumentSignatureAction
            documentId={contractDocument.id}
            title={title}
            signed={contractSigned}
            onDone={onDone}
          />
        ) : (
          <DocumentSignatureAction scope={{ leadId }} title={title} onDone={onDone} />
        )}
      </div>
    </section>
  );
}
