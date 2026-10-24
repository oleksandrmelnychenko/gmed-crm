import { Button } from "@/components/ui/button";

import type { Tx } from "../model/lead-payer";

/**
 * A panel of the documents step whose data did not load: one line that says
 * so and a retry, instead of a section that silently vanishes (DEV
 * 2026-10-24: a failed load of the portal state, the risk assessment or the
 * identification status left nothing on the screen).
 */
export function WizardLoadError({
  message,
  detail,
  onRetry,
  tx,
  disabled = false,
  testId,
}: {
  message: string;
  /** The server's or network's words, after the message. */
  detail?: string;
  onRetry: () => void;
  tx: Tx;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-destructive" data-testid={testId}>
      <span className="[overflow-wrap:anywhere]">{detail ? `${message}: ${detail}` : message}</span>
      <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg text-xs" disabled={disabled} onClick={onRetry}>
        {tx("Повторить", "Erneut versuchen")}
      </Button>
    </div>
  );
}
