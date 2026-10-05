import { CircleAlert, Clock3, FileCheck2, FileSignature } from "lucide-react";
import { isSignaturePending } from "../data/document-signature-api";
import type { SignatureSummary } from "../data/use-signature-summary";

// Short names of every signature request status (DB CHECK in
// migrations/20260905180000_document_signature_requests.sql). The document
// signature panel shows longer explanations of the same states.
const SIGNATURE_STATUS_TEXT: Record<string, [string, string]> = {
  submitting: ["Отправка приглашений", "Einladungen werden versendet"],
  submission_unknown: ["Проверяем отправку", "Versand wird geprüft"],
  pending: ["Ожидание подписей", "Unterschriften ausstehend"],
  completed: ["Подписано", "Unterzeichnet"],
  needs_review: ["Требует проверки", "Prüfung erforderlich"],
  declined: ["Подписание отклонено", "Unterschrift abgelehnt"],
  withdrawn: ["Запрос отозван", "Anfrage zurückgezogen"],
  expired: ["Срок запроса истёк", "Anfrage abgelaufen"],
  error: ["Ошибка подписания", "Signatur fehlgeschlagen"],
};

const INFORMATIONAL_TEMPLATES = ["privacy_information", "cost_estimate"];

/**
 * Informational documents (privacy information, cost estimate) travel as
 * attachments for acknowledgement and are never the subject of a signature
 * request; the server refuses them (`informational_document_not_signable`).
 * Like the server, this goes by the template the document was generated from
 * and nothing else: an uploaded file of the same kind stays signable.
 */
export function isInformationalDocument(document: { generated_template_id?: string | null }): boolean {
  return INFORMATIONAL_TEMPLATES.includes(document.generated_template_id ?? "");
}

/** Label of a signature request status; unknown values read as "needs review". */
export function signatureStatusText(status: string, lang: string) {
  const [ru, de] = SIGNATURE_STATUS_TEXT[status] ?? SIGNATURE_STATUS_TEXT.needs_review;
  return lang === "de" ? de : ru;
}

export function signaturePresentation(summary: SignatureSummary | undefined, lang: string, documentSigned = false) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  if (documentSigned) return { Icon: FileCheck2, label: signatureStatusText("completed", lang), className: "text-emerald-700 dark:text-emerald-400" };
  if (!summary) return { Icon: FileSignature, label: tx("Электронная подпись", "Elektronische Unterschrift"), className: "" };
  const prefix = summary.test_mode ? "TEST · " : "";
  if (summary.status === "completed") return { Icon: FileCheck2, label: prefix + signatureStatusText("completed", lang), className: "text-emerald-700 dark:text-emerald-400" };
  if (isSignaturePending(summary.status)) return { Icon: Clock3, label: prefix + signatureStatusText(summary.status, lang), className: "text-amber-700 dark:text-amber-400" };
  return { Icon: CircleAlert, label: prefix + signatureStatusText(summary.status, lang), className: "text-rose-700 dark:text-rose-400" };
}
