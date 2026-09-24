import { useEffect, useId, useState } from "react";
import { LoaderCircle, OctagonAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { Field, textareaClass } from "@/components/ui-shell";
import type { Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  fetchTerminationPreview,
  type TerminationPreviewOrder,
  type TerminationResultSettlement,
} from "@/pages/invoices/termination-settlement/api";
import { countDueInFull } from "@/pages/invoices/termination-settlement/model";
import { SettlementFigures, SettlementLines } from "@/pages/invoices/termination-settlement/ui";

import { terminateContract } from "../data/contracts-api";
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

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; orders: TerminationPreviewOrder[] }
  | { status: "failed" };

/**
 * Confirms a framework contract termination ("Kündigung"). The contract is
 * open-ended; after termination a new contract must be created and signed.
 * Open orders under the contract are stopped by the termination: the dialog
 * previews the final settlement per order and summarises the result.
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
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const [result, setResult] = useState<{
    contract: ContractItem;
    settlements: TerminationResultSettlement[];
  } | null>(null);
  const contractId = contract?.id ?? null;

  useEffect(() => {
    setReason("");
    setError("");
    setBusy(false);
    setResult(null);
    setPreview({ status: "loading" });
    if (!contractId) return;
    let active = true;
    fetchTerminationPreview(contractId)
      .then((data) => {
        if (active) setPreview({ status: "ready", orders: data.open_orders ?? [] });
      })
      .catch(() => {
        if (active) setPreview({ status: "failed" });
      });
    return () => {
      active = false;
    };
  }, [contractId]);

  const reasonValid = isValidTerminationReason(reason);
  const openOrders = preview.status === "ready" ? preview.orders : [];
  const currencyFor = (orderId: string) =>
    openOrders.find((order) => order.id === orderId)?.currency || "EUR";

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
    try {
      const { settlements = [], ...updated } = await terminateContract(contract.id, reason.trim());
      toast.success(tx("Договор расторгнут.", "Vertrag gekündigt."));
      if (settlements.length > 0) {
        // Keep the summary on screen; the parent refreshes when it is dismissed.
        setResult({ contract: updated, settlements });
      } else {
        await onTerminated(updated);
        onClose();
      }
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message.trim()
          ? cause.message
          : tx("Не удалось расторгнуть договор.", "Vertrag konnte nicht gekündigt werden."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (!result) return;
    const updated = result.contract;
    setResult(null);
    onClose();
    await onTerminated(updated);
  }

  return (
    <Dialog
      dirty={reason.trim().length > 0 && !busy && result === null}
      open={contract !== null}
      onOpenChange={(open) => {
        if (open || busy) return;
        if (result) void finish();
        else onClose();
      }}
    >
      {contract && result ? (
        <DialogContent className="sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>
              {tx("Договор расторгнут", "Vertrag gekündigt")} {contract.contract_number}
            </DialogTitle>
            <DialogDescription>
              {tx(
                "Заказы остановлены, по каждому создан расчёт при расторжении. Бухгалтерия выставит финальный счёт или оформит возврат.",
                "Die Aufträge wurden gestoppt, für jeden wurde eine Abrechnung bei Kündigung angelegt. Die Buchhaltung erstellt die Schlussrechnung oder die Erstattung.",
              )}
            </DialogDescription>
          </DialogHeader>
          <ul className="grid max-h-[55vh] gap-3 overflow-y-auto" data-testid="termination-result">
            {result.settlements.map((settlement) => (
              <li key={settlement.order_id} className="grid gap-2 rounded-lg border border-border/70 p-3">
                <p className="font-mono text-sm font-semibold">{settlement.order_number}</p>
                <SettlementFigures figures={settlement} currency={currencyFor(settlement.order_id)} lang={lang} />
                <p className="text-xs text-muted-foreground">
                  {tx("Отменено услуг", "Stornierte Leistungen")}: {settlement.cancelled_services}
                  {" · "}
                  {tx("Паушалы к оплате полностью", "Voll fällige Pauschalen")}: {settlement.flat_fees_due}
                </p>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" onClick={() => void finish()}>
              {tx("Готово", "Fertig")}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : contract ? (
        <DialogContent className={openOrders.length > 0 ? "sm:max-w-[560px]" : "sm:max-w-[460px]"}>
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
            {preview.status === "loading" ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                {tx("Проверяем открытые заказы…", "Offene Aufträge werden geprüft…")}
              </p>
            ) : preview.status === "failed" ? (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                {tx(
                  "Не удалось загрузить расчёт по открытым заказам. Открытые заказы по договору всё равно будут остановлены.",
                  "Die Abrechnung der offenen Aufträge konnte nicht geladen werden. Offene Aufträge unter dem Vertrag werden trotzdem gestoppt.",
                )}
              </p>
            ) : openOrders.length > 0 ? (
              <div
                role="status"
                className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm"
                data-testid="termination-preview"
              >
                <p className="flex items-start gap-2 font-medium text-amber-900">
                  <OctagonAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {tx(
                    "Эти заказы будут остановлены: запланированные услуги отменяются, паушалы «при расторжении полностью» начисляются целиком.",
                    "Diese Aufträge werden gestoppt: geplante Leistungen werden storniert, Pauschalen „bei Kündigung voll fällig“ werden vollständig berechnet.",
                  )}
                </p>
                <ul className="grid max-h-[40vh] gap-2 overflow-y-auto">
                  {openOrders.map((order) => (
                    <li key={order.id} className="grid gap-2 rounded-md border border-border/60 bg-card p-3">
                      <p className="font-mono text-sm font-semibold">{order.order_number}</p>
                      <SettlementFigures figures={order} currency={order.currency} lang={lang} />
                      <p className="text-xs text-muted-foreground">
                        {tx("Будет отменено услуг", "Zu stornierende Leistungen")}: {order.cancelled_lines.length}
                        {" · "}
                        {tx("Паушалы к оплате полностью", "Voll fällige Pauschalen")}: {countDueInFull(order.lines)}
                      </p>
                      {order.warnings.length > 0 ? (
                        <ul className="list-disc pl-4 text-xs text-amber-800">
                          {order.warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                          ))}
                        </ul>
                      ) : null}
                      <SettlementLines lines={order.lines} currency={order.currency} lang={lang} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                {tx("Отмена", "Abbrechen")}
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={busy || !reasonValid || preview.status === "loading"}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {openOrders.length > 0
                  ? tx("Расторгнуть и остановить заказы", "Kündigen und Aufträge stoppen")
                  : tx("Расторгнуть договор", "Vertrag kündigen")}
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
