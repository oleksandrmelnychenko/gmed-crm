import { createContext, useContext, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * A refused signature action ("Подтвердить подпись") of one document row and,
 * when the refusal names a place to fix it (the risk assessment, a person's
 * identity document data), the way there.
 */
export type WizardDocumentRowErrorState = {
  documentId: string;
  text: string;
  action?: { label: string; onClick: () => void } | null;
} | null;

const WizardDocumentRowErrorContext = createContext<WizardDocumentRowErrorState>(null);

/**
 * Carries the refusal of the last signature action to the document row whose
 * button was pressed (DEV 2026-10-19: the refusal of one parent's GwG sheet
 * appeared at the bottom of the documents step, under "Оценка риска").
 */
export function WizardDocumentRowErrorProvider({
  value,
  children,
}: {
  value: WizardDocumentRowErrorState;
  children: ReactNode;
}) {
  return <WizardDocumentRowErrorContext.Provider value={value}>{children}</WizardDocumentRowErrorContext.Provider>;
}

/** The refusal of this document's signature action, right under its row; nothing otherwise. */
export function WizardDocumentRowError({ documentId }: { documentId: string }) {
  const error = useContext(WizardDocumentRowErrorContext);
  if (!error || error.documentId !== documentId) return null;
  return (
    <div
      role="alert"
      data-document-row-error={documentId}
      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"
    >
      <span className="min-w-0 flex-1" data-document-row-error-text>{error.text}</span>
      {error.action ? (
        <Button type="button" variant="outline" size="xs" data-document-row-error-action onClick={error.action.onClick}>
          {error.action.label}
        </Button>
      ) : null}
    </div>
  );
}
