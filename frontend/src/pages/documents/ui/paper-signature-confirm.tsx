import { useState } from "react";
import { FileCheck2, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
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
  /**
   * A way to what blocks the refusal (DEV 2026-10-27: «Укажите источник
   * средств» named the gap but not where to fill it); closes the dialog.
   */
  errorAction?: (error: unknown) => { label: string; onClick: () => void } | null;
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
  errorAction,
}: Props) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorJump, setErrorJump] = useState<{ label: string; onClick: () => void } | null>(null);

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
          setErrorJump(null);
          setOpen(true);
        }}
      >
        <FileCheck2 aria-hidden="true" className="size-3.5" />
        {label ?? tx("Подтвердить подпись", "Unterschrift bestätigen")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-3 sm:w-[calc(100vw-3rem)] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileCheck2 aria-hidden="true" className="size-5 shrink-0 text-[var(--brand)]" />{tx("Подтверждение подписи", "Unterschrift bestätigen")}</DialogTitle>
            <DialogDescription className="pt-1">
              <StatusChip className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/40 dark:text-violet-200">
                <FileText aria-hidden="true" />
                <span className="min-w-0 whitespace-normal [overflow-wrap:anywhere]">{title}</span>
              </StatusChip>
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
              <span className="min-w-0 flex-1">{error}</span>
              {errorJump ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  data-testid="paper-signature-error-jump"
                  onClick={() => {
                    const jump = errorJump;
                    setOpen(false);
                    jump.onClick();
                  }}
                >
                  {errorJump.label}
                </Button>
              ) : null}
            </div>
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
                setErrorJump(errorAction?.(reason) ?? null);
                return false;
              }
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
