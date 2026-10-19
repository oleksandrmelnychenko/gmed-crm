import { createContext, useContext, type ReactNode } from "react";

/** A refused signature action ("Подтвердить подпись") of one document row. */
export type WizardDocumentRowErrorState = { documentId: string; text: string } | null;

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
    <p
      role="alert"
      data-document-row-error={documentId}
      className="mt-1.5 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive"
    >
      {error.text}
    </p>
  );
}
