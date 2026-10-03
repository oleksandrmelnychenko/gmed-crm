import { StatusBadge } from "@/components/record-workspace/recipes/status-badge";
import { useLang } from "@/lib/i18n";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

/**
 * Where the onboarding package of a lead is sent for e-signature; the client
 * signs first, GMED second. The package source decides what the composer
 * preselects (backend `signing_companions`):
 * - a new framework contract: contract, order, Schweigepflichtsentbindung and
 *   DSGVO consents (the guardians' declaration for a minor);
 * - no new contract (a signed contract of the patient still applies, or none
 *   is generated yet): the order with the Schweigepflichtsentbindung and the
 *   DSGVO consents;
 * - neither: the lead's package composer with a free choice.
 * The action renders only for roles that may send invitations (CEO, patient
 * manager).
 */
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
  const source = contractDocument ?? orderDocument;
  const title = source?.original_filename
    || (contractDocument
      ? tx("Рамочный договор", "Rahmenvertrag")
      : orderDocument
        ? tx("Заказ", "Auftrag")
        : tx("Документы обращения", "Unterlagen der Anfrage"));

  const description = contractDocument
    ? tx(
        "Клиент получает одно приглашение: рамочный договор, заказ, освобождение от врачебной тайны и согласие DSGVO. Сначала подписывает клиент, затем GMED.",
        "Der Kunde erhält eine Einladung: Rahmenvertrag, Auftrag, Schweigepflichtsentbindung und DSGVO-Einwilligung. Zuerst unterschreibt der Kunde, danach GMED.",
      )
    : orderDocument
      ? inheritedContract
        ? tx(
            "Действует ранее подписанный рамочный договор. Клиент получает одно приглашение: заказ, освобождение от врачебной тайны и согласие DSGVO.",
            "Es gilt ein bereits unterzeichneter Rahmenvertrag. Der Kunde erhält eine Einladung: Auftrag, Schweigepflichtsentbindung und DSGVO-Einwilligung.",
          )
        : tx(
            "Рамочного договора ещё нет — пакет уйдёт с заказом, освобождением от врачебной тайны и согласием DSGVO. Лучше сначала создать договор ниже, тогда он войдёт в тот же пакет.",
            "Noch kein Rahmenvertrag – das Paket geht mit Auftrag, Schweigepflichtsentbindung und DSGVO-Einwilligung. Besser zuerst unten den Vertrag erstellen, dann ist er im selben Paket.",
          )
      : tx(
          "Создайте рамочный договор и заказ ниже — они уходят на подпись одним пакетом вместе с освобождением от врачебной тайны и согласием DSGVO. Отдельные документы можно выбрать в окне подписи.",
          "Rahmenvertrag und Auftrag unten erstellen – sie gehen zusammen mit Schweigepflichtsentbindung und DSGVO-Einwilligung als ein Paket zur Unterschrift. Einzelne Dokumente lassen sich im Unterschriftsfenster wählen.",
        );

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
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="shrink-0">
        {source ? (
          <DocumentSignatureAction
            documentId={source.id}
            title={title}
            signed={contractDocument ? contractSigned : false}
            onDone={onDone}
          />
        ) : (
          <DocumentSignatureAction scope={{ leadId }} title={title} onDone={onDone} />
        )}
      </div>
    </section>
  );
}
