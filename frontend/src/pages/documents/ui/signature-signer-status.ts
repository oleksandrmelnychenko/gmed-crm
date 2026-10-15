import type { StatusChipTone } from "@/components/ui/status-chip";
import type { SignatureRequest, Signer } from "../data/document-signature-api";

type SignerState = "ready" | "waiting" | "signed" | "declined" | "error" | "withdrawn" | "expired" | "unconfirmed";
type SignerPresentation = { state: SignerState; label: string; tone: StatusChipTone; detail?: string };

const normalEmail = (email: string) => email.trim().toLowerCase();

function providerStatus(request: SignatureRequest, signer: Signer) {
  const matches = request.evidence.signatures?.filter(item => normalEmail(item.email) === normalEmail(signer.email));
  // Missing or ambiguous evidence must not imply readiness or a signature.
  return matches?.length === 1 ? matches[0].status : undefined;
}

/** A request being open does not mean every person can already sign it. */
export function signatureSignerPresentation(request: SignatureRequest, signer: Signer, lang: string): SignerPresentation {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const status = providerStatus(request, signer);
  if (status === "SIGNED") return { state: "signed", tone: "success", label: tx("Подписано", "Unterzeichnet") };
  if (status === "DECLINED") return { state: "declined", tone: "error", label: tx("Подпись отклонена", "Unterschrift abgelehnt") };
  if (status === "ERROR") return { state: "error", tone: "error", label: tx("Ошибка подписания", "Signatur fehlgeschlagen") };
  if (status === "WITHDRAWN" || request.status === "withdrawn") return { state: "withdrawn", tone: "neutral", label: tx("Запрос отозван", "Anfrage zurückgezogen") };
  if (status === "EXPIRED" || request.status === "expired") return { state: "expired", tone: "neutral", label: tx("Срок запроса истёк", "Anfrage abgelaufen") };
  if (request.status === "pending") {
    if (status === "OPEN") return { state: "ready", tone: "info", label: tx("Готов к подписи", "Zur Unterschrift bereit") };
    if (status === "WAITING") {
      // Only name people whose provider evidence says OPEN; array order and
      // client/agency roles alone do not prove the configured signing sequence.
      const preceding = request.signers.filter(other => normalEmail(other.email) !== normalEmail(signer.email)
        && providerStatus(request, other) === "OPEN").map(other => `${other.first_name} ${other.last_name}`.trim() || other.email);
      return {
        state: "waiting", tone: "warning", label: tx("Ждёт предыдущей подписи", "Wartet auf vorherige Unterschrift"),
        detail: preceding.length
          ? tx(`Сначала ожидаются подписи: ${preceding.join(", ")}.`, `Zuerst ausstehende Unterschriften: ${preceding.join(", ")}.`)
          : tx("Предыдущие подписи ещё не подтверждены.", "Die vorherigen Unterschriften sind noch nicht bestätigt."),
      };
    }
  }
  return { state: "unconfirmed", tone: "warning", label: tx("Статус требует проверки", "Status muss geprüft werden") };
}
