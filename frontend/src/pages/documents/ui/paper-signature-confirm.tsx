import { useState } from "react";
import { FileCheck2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiRequestError, isLocalizedApiError } from "@/lib/api";
import { recordPaperSignature, signatureErrorText } from "../data/document-signature-api";
import { PaperSignatureSection } from "./paper-signature-section";

type Props = {
  documentId: string;
  /** File name or title of the document, shown in the dialog. */
  title: string;
  lang: "de" | "ru";
  disabled?: boolean;
  /** Button text; defaults to "Подтвердить подпись" / "Unterschrift bestätigen". */
  label?: string;
  size?: "xs" | "sm";
  /** A screen-specific text for a refusal (e.g. the payer gate of a lead); `null` falls back. */
  errorText?: (error: unknown) => string | null;
  /** Runs after the scan was stored as the signed version (a new document version). */
  onDone?: (result: { documentId: string; replacedDocumentId: string; signedAt: string }) => void;
};

/**
 * Confirms a signature given on paper: staff upload the scan of the signed
 * copy and attest that they compared it ("Подписано на бумаге"). Owner
 * decisions 2026-10-11: a generated consent, confidentiality release,
 * framework contract, enhanced due diligence form, cost coverage declaration
 * or patient form becomes "signed" only with this proof or a QES, never by
 * one click (`model/signature-proof.ts`).
 */
export function PaperSignatureConfirmButton({
  documentId,
  title,
  lang,
  disabled = false,
  label,
  size = "xs",
  errorText,
  onDone,
}: Props) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = (reason: unknown) => {
    const specific = errorText?.(reason);
    if (specific) return specific;
    if (isLocalizedApiError(reason)) return reason.message;
    const code = reason instanceof ApiRequestError
      ? (reason.body?.error as string | undefined) ?? reason.code
      : undefined;
    return signatureErrorText(code, tx);
  };

  return (
    <>
      <Button
        type="button"
        variant="default"
        size={size}
        disabled={disabled}
        data-paper-signature-confirm={documentId}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <FileCheck2 aria-hidden="true" className="size-3.5" />
        {label ?? tx("Подтвердить подпись", "Unterschrift bestätigen")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{tx("Подтверждение подписи", "Unterschrift bestätigen")}</DialogTitle>
            <DialogDescription className="break-words">
              {tx(
                "Подписанным документ становится только с подтверждением: загрузите скан подписанного экземпляра или подпишите документ электронно.",
                "Als unterschrieben gilt das Dokument nur mit Nachweis: Laden Sie den Scan des unterschriebenen Exemplars hoch oder lassen Sie das Dokument elektronisch unterschreiben.",
              )}
              {" "}
              <span className="font-medium text-foreground">{title}</span>
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
              {error}
            </p>
          ) : null}
          <PaperSignatureSection
            lang={lang}
            onSubmit={async (scan, signedOn) => {
              setError(null);
              try {
                const stored = await recordPaperSignature(documentId, scan, signedOn);
                setOpen(false);
                onDone?.({
                  documentId: stored.document_id,
                  replacedDocumentId: stored.replaced_document_id,
                  signedAt: stored.signed_at,
                });
                return true;
              } catch (reason) {
                setError(describe(reason));
                return false;
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
