import { Suspense, createContext, lazy, useCallback, useContext, useRef, useState } from "react";
import { LoaderCircle, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { StepId } from "@/pages/patient-lead/lead-request-steps";

import { clientFormStepOf, type ClientFormSection } from "../model/lead-client-form-steps";
import type { Tx } from "../model/lead-gwg-statements";

// The cabinet form is a chunk of its own: the wizard loads it when the dialog opens.
const LeadRequestPage = lazy(() =>
  import("@/pages/patient-lead/lead-request-page").then((module) => ({ default: module.LeadRequestPage })),
);

type ClientFormEdit = { open: (step: StepId) => void; tx: Tx };

/**
 * Opens the client's form at a step (owner decision 2026-10-29). Provided by
 * the wizard only while the lead is not converted and the user may edit
 * leads; without it the «Изменить» buttons stay away.
 */
export const ClientFormEditContext = createContext<ClientFormEdit | null>(null);

/** «Изменить» next to a read-only block of the client's answers: the client's form at the step that holds them. */
export function ClientFormEditButton({ section, className }: { section: ClientFormSection; className?: string }) {
  const edit = useContext(ClientFormEditContext);
  if (!edit) return null;
  const step = clientFormStepOf(section);
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className={cn("shrink-0 text-muted-foreground hover:text-foreground", className)}
      data-testid={`lead-client-form-edit-${section}`}
      data-step={step}
      onClick={() => edit.open(step)}
    >
      <Pencil aria-hidden="true" />
      {edit.tx("Изменить", "Bearbeiten")}
    </Button>
  );
}

/**
 * The client's cabinet form inside the wizard (owner decision 2026-10-29: no
 * separate browser tab): the same form as `/leads/{id}/client-form`, opened at
 * `step`. Closing saves every open entry first; an entry that could not be
 * saved keeps the dialog open with the form's own notice.
 */
export function LeadClientFormDialog({
  leadId,
  open,
  step,
  version,
  tx,
  onClose,
}: {
  leadId: string;
  open: boolean;
  step: StepId;
  /** A new value for every opening: the form is read afresh each time. */
  version: number;
  tx: Tx;
  /** After the dialog closed with everything saved: the wizard reads the client's answers again. */
  onClose: () => void;
}) {
  const saveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = useCallback(async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    try {
      const saved = await (saveRef.current?.() ?? Promise.resolve(true));
      if (saved) onClose();
    } finally {
      closingRef.current = false;
      setClosing(false);
    }
  }, [onClose]);

  return (
    <Dialog
      open={open}
      // The form saves itself: closing asks nothing, it saves first (`close`).
      allowImplicitDismissal
      onOpenChange={(next) => { if (!next) void close(); }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[92vh] sm:max-w-6xl"
        data-testid="lead-client-form-dialog"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
          <div className="min-w-0 space-y-0.5">
            <DialogTitle>{tx("Анкета клиента", "Formular des Kunden")}</DialogTitle>
            <DialogDescription className="text-xs">
              {tx("Изменения сохраняются автоматически.", "Änderungen werden automatisch gespeichert.")}
            </DialogDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={closing}
            onClick={() => void close()}
            data-testid="lead-client-form-close"
          >
            {closing ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {tx("Закрыть", "Schließen")}
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/20 p-3 sm:p-5">
          <Suspense
            fallback={(
              <div role="status" className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                {tx("Загрузка…", "Wird geladen…")}
              </div>
            )}
          >
            <LeadRequestPage key={`${leadId}:${version}`} staffLeadId={leadId} initialStep={step} embedded saveRef={saveRef} />
          </Suspense>
        </div>
      </DialogContent>
    </Dialog>
  );
}
