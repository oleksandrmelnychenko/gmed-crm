import { Info, Users } from "lucide-react";
import { SectionHeading } from "@/components/ui/section-heading";
import { StatusChip } from "@/components/ui/status-chip";
import type { SignatureRequest } from "../data/document-signature-api";
import { signatureSignerPresentation } from "./signature-signer-status";

export function SignatureSigners({ request, lang }: { request: SignatureRequest; lang: string }) {
  const tx = (ru: string, de: string) => lang === "de" ? de : ru;
  return <>
    {request.signers.length > 0 && (
      <section className="@container min-w-0 space-y-1.5">
        <h4><SectionHeading icon={Users}>{tx("Подписанты", "Unterzeichnende")}</SectionHeading></h4>
        <ul className="divide-y divide-border/60 text-xs leading-5">
          {request.signers.map(signer => {
            const presentation = signatureSignerPresentation(request, signer, lang);
            return (
              <li key={signer.email} data-signature-signer={presentation.state}
                className="grid min-w-0 gap-x-4 gap-y-1 py-2 @sm:grid-cols-2">
                <div className="min-w-0 wrap-anywhere">
                  <span className="block font-semibold text-foreground">{signer.first_name} {signer.last_name}</span>
                  <span className="block text-muted-foreground">{signer.email}</span>
                </div>
                <div className="min-w-0 space-y-1">
                  <StatusChip tone={presentation.tone} className="whitespace-normal">
                    {request.test_mode ? "DEMO · " : ""}{presentation.label}
                  </StatusChip>
                  {presentation.detail && <p className="wrap-anywhere text-muted-foreground">{presentation.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    )}
    {request.status === "pending" && !request.test_mode ? <p data-signature-provider-receipt className="flex items-start gap-2 border-t border-border/60 pt-2 text-xs leading-5 text-muted-foreground">
      <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>{tx("Запрос передан Skribble. Доставка E-Mail не подтверждена. После подписания PDF появится здесь автоматически.", "Die Anfrage wurde an Skribble übergeben. Die E-Mail-Zustellung ist nicht bestätigt. Nach der Unterschrift erscheint die PDF hier automatisch.")}</span>
    </p> : null}
  </>;
}
