import { useEffect } from "react";
import { LoaderCircle } from "lucide-react";

import type { Lang } from "@/lib/i18n";
import { useRepeatPatientReview } from "@/pages/leads/model/use-repeat-patient-review";
import { defaultOrderContractId } from "../model/order-document-review";
import { isContractUsable } from "../model/order-intake";
import { OrderExistingContractsTable, OrderPatientDocumentReview } from "./order-patient-document-review";
import { OrderWizardSection } from "./order-wizard-tables";

/**
 * What the patient already has on file when a new order is created: the
 * signed consents, the confidentiality release, the identity document with
 * the passport validity, and the framework contracts. Nothing here has to be
 * created again; the order is attached to the selected signed contract.
 */
export function OrderExistingPatientDocuments({ patientId, lang, selectedContractId, onSelectContract, onOpenPatient }: {
  patientId: string;
  lang: Lang;
  /** The contract chosen for the order; `null` until the default is known. */
  selectedContractId: string | null;
  onSelectContract: (id: string | null) => void;
  onOpenPatient: () => void;
}) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const review = useRepeatPatientReview(patientId);
  const fallbackId = defaultOrderContractId(review.contracts);
  const chosen = review.contracts.some(contract => contract.id === selectedContractId && isContractUsable(contract))
    ? selectedContractId
    : fallbackId;
  // The order is created with what the table shows as selected.
  useEffect(() => {
    if (chosen !== selectedContractId) onSelectContract(chosen);
  }, [chosen, selectedContractId, onSelectContract]);

  if (!review.readiness) {
    return review.error
      ? <p role="alert" className="text-sm text-destructive">{tx("Не удалось загрузить документы пациента.", "Die Dokumente des Patienten konnten nicht geladen werden.")}</p>
      : <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{tx("Загрузка документов пациента…", "Patientendokumente werden geladen…")}</p>;
  }
  return <div data-order-existing-patient-documents className="space-y-4">
    <OrderPatientDocumentReview readiness={review.readiness} documents={review.documents} dateTo={null} lang={lang} busy={review.loading} compact
      onRefresh={() => { void review.refresh().catch(() => undefined); }} onOpenDocuments={onOpenPatient} onSaveExpiry={review.saveExpiry} />
    <OrderWizardSection flush title={tx("Сохранённые договоры пациента", "Gespeicherte Patientenverträge")}>
      <OrderExistingContractsTable contracts={review.contracts} selectedId={chosen} lang={lang} busy={review.loading} onSelect={onSelectContract} />
      <p className="border-t border-border/60 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
        {chosen
          ? tx("Заказ будет привязан к выбранному подписанному договору — новый договор не нужен.", "Der Auftrag wird dem ausgewählten unterzeichneten Vertrag zugeordnet – ein neuer Vertrag ist nicht nötig.")
          : tx("Подписанного рамочного договора нет: сначала оформите и подпишите договор.", "Es gibt keinen unterzeichneten Rahmenvertrag: Erstellen und unterzeichnen Sie zuerst einen Vertrag.")}
      </p>
    </OrderWizardSection>
  </div>;
}
