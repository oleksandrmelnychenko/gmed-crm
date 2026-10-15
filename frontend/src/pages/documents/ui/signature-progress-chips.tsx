import { StatusChip } from "@/components/ui/status-chip";
import type { SignatureProgress } from "../data/use-signature-summary";

export function SignatureProgressChips({ progress, testMode, lang }: { progress: SignatureProgress; testMode: boolean; lang: string }) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  const waitingAgency = progress.client_total > 0 && progress.client_signed === progress.client_total
    && progress.agency_signed < progress.agency_total
    && progress.total - progress.signed === progress.agency_total - progress.agency_signed;
  return <div className="flex flex-wrap items-center gap-1.5" data-signature-progress data-test-mode={testMode}>
    <StatusChip tone="info">{testMode ? "DEMO · " : "Skribble · "}{tx("Подписи", "Unterschriften")}: {progress.signed}/{progress.total}</StatusChip>
    <StatusChip tone="warning">{progress.signed >= progress.total
      ? tx("Проверяем результат", "Ergebnis wird geprüft")
      : waitingAgency ? tx("Клиент подписал · ожидается GMED", "Kunde hat unterschrieben · GMED steht aus")
        : tx("Ожидаются подписи", "Unterschriften ausstehend")}</StatusChip>
  </div>;
}
