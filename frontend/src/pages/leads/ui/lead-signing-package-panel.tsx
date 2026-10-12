import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { StatusChip } from "@/components/ui/status-chip";
import { useLang } from "@/lib/i18n";
import type { DocumentItem } from "@/pages/documents/model/types";
import { DocumentSignatureAction } from "@/pages/documents/ui/document-signature-action";

/**
 * Where the onboarding package of a lead is sent for e-signature; the client
 * signs first, GMED second. The package source decides what the composer
 * preselects (backend `signing_companions`):
 * - a new framework contract: contract, order, the patient form once the
 *   lead sent the request (`lead_self_disclosure`), Schweigepflichtsentbindung
 *   and DSGVO consents (the guardians' declaration for a minor);
 * - no new contract (a signed contract of the patient still applies, or none
 *   is generated yet): the order with the patient form, the
 *   Schweigepflichtsentbindung and the DSGVO consents;
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
        "Договор, заказ, анкета (если создана), освобождение от тайны и согласие DSGVO — одно приглашение. Сначала клиент, затем GMED.",
        "Vertrag, Auftrag, Patientenformular (falls erstellt), Schweigepflichtsentbindung und DSGVO-Einwilligung – eine Einladung. Zuerst der Kunde, danach GMED.",
      )
    : orderDocument
      ? inheritedContract
        ? tx(
            "Ранее подписанный договор действует. Заказ, анкета (если создана), освобождение от тайны и согласие DSGVO — одно приглашение.",
            "Der bereits unterzeichnete Vertrag gilt. Auftrag, Patientenformular (falls erstellt), Schweigepflichtsentbindung und DSGVO-Einwilligung – eine Einladung.",
          )
        : tx(
            "Заказ, анкета (если создана), освобождение от тайны и согласие DSGVO — один пакет. Создайте договор ниже, чтобы добавить его к ним.",
            "Auftrag, Patientenformular (falls erstellt), Schweigepflichtsentbindung und DSGVO-Einwilligung – ein Paket. Vertrag unten erstellen, um ihn hinzuzufügen.",
          )
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
          {contractSigned ? (
            <StatusChip tone="success">{tx("Договор подписан", "Vertrag unterzeichnet")}</StatusChip>
          ) : null}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
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
