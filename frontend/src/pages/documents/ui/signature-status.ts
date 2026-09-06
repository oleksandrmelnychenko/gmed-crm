import { CircleAlert, Clock3, FileCheck2, FileSignature } from "lucide-react";
import { isSignaturePending } from "../data/document-signature-api";
import type { SignatureSummary } from "../data/use-signature-summary";

export function signaturePresentation(summary: SignatureSummary | undefined, lang: string) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  if (!summary) return { Icon: FileSignature, label: tx("Электронная подпись", "Elektronische Unterschrift"), className: "" };
  const prefix = summary.test_mode ? "TEST · " : "";
  if (summary.status === "completed") return { Icon: FileCheck2, label: prefix + tx("Подписано", "Unterzeichnet"), className: "text-emerald-700 dark:text-emerald-400" };
  if (isSignaturePending(summary.status)) return { Icon: Clock3, label: prefix + (summary.status === "pending" ? tx("Ожидание подписей", "Unterschriften ausstehend") : tx("Проверяем отправку", "Versand wird geprüft")), className: "text-amber-700 dark:text-amber-400" };
  const labels = {
    needs_review: tx("Требует проверки", "Prüfung erforderlich"),
    declined: tx("Подписание отклонено", "Unterschrift abgelehnt"),
    withdrawn: tx("Запрос отозван", "Anfrage zurückgezogen"),
    expired: tx("Срок запроса истёк", "Anfrage abgelaufen"),
    error: tx("Ошибка подписания", "Signatur fehlgeschlagen"),
  };
  return { Icon: CircleAlert, label: prefix + (labels[summary.status as keyof typeof labels] ?? tx("Требует проверки", "Prüfung erforderlich")), className: "text-rose-700 dark:text-rose-400" };
}
