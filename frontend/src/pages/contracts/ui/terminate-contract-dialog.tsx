import { useEffect, useId, useState } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, textareaClass } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import {
  terminateContract,
  terminationOpenOrders,
  type ContractOpenOrder,
} from "../data/contracts-api";
import {
  isValidTerminationReason,
  TERMINATION_REASON_MAX,
  TERMINATION_REASON_MIN,
} from "../model/contracts-model";
import type { ContractItem } from "../model/types";

type TerminateContractDialogProps = {
  /** The contract to terminate; `null` closes the dialog. */
  contract: Pick<ContractItem, "id" | "contract_number"> | null;
  lang: Lang;
  onClose: () => void;
  onTerminated: (contract: ContractItem) => void | Promise<void>;
};

/**
 * Confirms a framework contract termination ("Kündigung"). The contract is
 * open-ended; after termination a new contract must be created and signed.
 * The server refuses while the contract still has open orders (409).
 */
export function TerminateContractDialog({
  contract,
  lang,
  onClose,
  onTerminated,
}: TerminateContractDialogProps) {
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [openOrders, setOpenOrders] = useState<ContractOpenOrder[]>([]);
  const contractId = contract?.id ?? null;

  useEffect(() => {
    setReason("");
    setError("");
    setOpenOrders([]);
    setBusy(false);
  }, [contractId]);

  const reasonValid = isValidTerminationReason(reason);

  async function submit() {
    if (!contract || busy) return;
    if (!reasonValid) {
      setError(
        tx(
          `Укажите причину (${TERMINATION_REASON_MIN}–${TERMINATION_REASON_MAX} символов).`,
          `Bitte einen Grund angeben (${TERMINATION_REASON_MIN}–${TERMINATION_REASON_MAX} Zeichen).`,
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    setOpenOrders([]);
    try {
      const updated = await terminateContract(contract.id, reason.trim());
      await onTerminated(updated);
      onClose();
    } catch (cause) {
      const blocking = terminationOpenOrders(cause);
      if (blocking.length > 0) {
        setOpenOrders(blocking);
        setError(
          tx(
            "Сначала завершите или отмените заказы:",
            "Schließen Sie zuerst diese Aufträge ab oder stornieren Sie sie:",
          ),
        );
      } else {
        setError(
          cause instanceof Error && cause.message.trim()
            ? cause.message
            : tx("Не удалось расторгнуть договор.", "Vertrag konnte nicht gekündigt werden."),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      dirty={reason.trim().length > 0 && !busy}
      open={contract !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      {contract ? (
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              {tx("Расторгнуть договор", "Vertrag kündigen")} {contract.contract_number}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "Договор перестанет действовать для новых заказов. Для следующих заказов нужно будет оформить и подписать новый рамочный договор.",
                "Der Vertrag gilt danach nicht mehr für neue Aufträge. Für weitere Aufträge muss ein neuer Rahmenvertrag erstellt und unterzeichnet werden.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label={tx("Причина расторжения", "Kündigungsgrund")} htmlFor={reasonId} required>
              <textarea
                id={reasonId}
                className={cn(textareaClass, "min-h-24")}
                value={reason}
                maxLength={TERMINATION_REASON_MAX}
                disabled={busy}
                aria-invalid={Boolean(error) && !reasonValid}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {error ? (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <p>{error}</p>
                {openOrders.length > 0 ? (
                  <p className="mt-1 font-mono">
                    {openOrders.map((order) => order.order_number).join(", ")}
                  </p>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button type="submit" variant="destructive" disabled={busy || !reasonValid}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {tx("Расторгнуть договор", "Vertrag kündigen")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

/** Terminated-contract facts for a detail view: date, who, and why. */
export function contractTerminationSummary(
  contract: Pick<ContractItem, "terminated_at" | "terminated_by_name" | "termination_reason">,
  lang: Lang,
) {
  if (!contract.terminated_at) return null;
  const date = new Date(contract.terminated_at);
  const dateLabel = Number.isNaN(date.getTime())
    ? contract.terminated_at
    : date.toLocaleDateString(lang === "de" ? "de-DE" : "ru-RU");
  return {
    date: dateLabel,
    by: contract.terminated_by_name?.trim() || null,
    reason: contract.termination_reason?.trim() || null,
  };
}

export function ContractTerminationNote({
  contract,
  lang,
  className,
}: {
  contract: Pick<ContractItem, "terminated_at" | "terminated_by_name" | "termination_reason">;
  lang: Lang;
  className?: string;
}) {
  const summary = contractTerminationSummary(contract, lang);
  if (!summary) return null;
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);
  return (
    <div className={cn("rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm", className)}>
      <p className="font-medium text-destructive">
        {tx("Расторгнут", "Gekündigt")} {summary.date}
        {summary.by ? ` · ${summary.by}` : ""}
      </p>
      {summary.reason ? (
        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{summary.reason}</p>
      ) : null}
    </div>
  );
}
