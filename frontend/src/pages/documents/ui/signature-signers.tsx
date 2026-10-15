import { StatusChip } from "@/components/ui/status-chip";
import type { SignatureRequest } from "../data/document-signature-api";
import { signatureSignerPresentation } from "./signature-signer-status";

export function SignatureSigners({ request, lang }: { request: SignatureRequest; lang: string }) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  return <>
    {request.signers.map(signer => {
      const presentation = signatureSignerPresentation(request, signer, lang);
      return <div key={signer.email} data-signature-signer={presentation.state}
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 bg-muted/15 px-3 py-2.5 text-xs sm:flex-row sm:items-start sm:justify-between">
        <span className="min-w-0">
          <span className="block break-words font-semibold text-foreground">{signer.first_name} {signer.last_name}</span>
          <span className="block break-all text-muted-foreground">{signer.email}</span>
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1 sm:max-w-[60%] sm:items-end">
          <StatusChip tone={presentation.tone} className="whitespace-normal">
            {request.test_mode ? "DEMO · " : ""}{presentation.label}
          </StatusChip>
          {presentation.detail ? <span className="break-words leading-5 text-muted-foreground sm:text-right">{presentation.detail}</span> : null}
        </span>
      </div>;
    })}
    {request.status === "pending" ? <p data-signature-provider-receipt className="text-xs leading-5 text-muted-foreground">
      {request.test_mode
        ? tx("DEMO: тестовый запрос передан Skribble. Доставка E-Mail не подтверждена.", "DEMO: Die Testanfrage wurde an Skribble übergeben. Die E-Mail-Zustellung ist nicht bestätigt.")
        : tx("Запрос передан Skribble. Доставка E-Mail не подтверждена. После подписания PDF появится здесь автоматически.", "Die Anfrage wurde an Skribble übergeben. Die E-Mail-Zustellung ist nicht bestätigt. Nach der Unterschrift erscheint die PDF hier automatisch.")}
    </p> : null}
  </>;
}
