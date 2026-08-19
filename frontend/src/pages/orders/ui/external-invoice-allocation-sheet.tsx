import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, LoaderCircle, RotateCcw } from "lucide-react";

import { AdminSheetScaffold, SheetFormFooter } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Banner, EmptyCell, Field, InfoRow, StatusBadge, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { useStaffNavigate } from "@/lib/use-staff-navigate";
import { cn } from "@/lib/utils";

import {
  createExternalInvoiceAllocation,
  fetchExternalInvoiceAllocations,
  reverseExternalInvoiceAllocation,
} from "../data/order-api";
import type { ExternalInvoiceAllocationWorkspace } from "../model/types";

type ExternalInvoiceAllocationSheetProps = {
  open: boolean;
  orderId: string;
  externalInvoiceId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void | Promise<void>;
};

function suggestedAmount(workspace: ExternalInvoiceAllocationWorkspace, invoiceId: string) {
  const candidate = workspace.candidate_invoices.find((item) => item.id === invoiceId);
  const remaining = Number(workspace.remaining_receivable_gross);
  const capacity = Number(candidate?.allocatable_capacity ?? 0);
  if (!Number.isFinite(remaining) || !Number.isFinite(capacity)) return "";
  return Math.max(0, Math.min(remaining, capacity)).toFixed(2);
}

export function ExternalInvoiceAllocationSheet({
  open,
  orderId,
  externalInvoiceId,
  onOpenChange,
  onChanged,
}: ExternalInvoiceAllocationSheetProps) {
  const { lang } = useLang();
  const { staffGo } = useStaffNavigate();
  const [workspace, setWorkspace] = useState<ExternalInvoiceAllocationWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [patientInvoiceId, setPatientInvoiceId] = useState("");
  const [amountGross, setAmountGross] = useState("");
  const [reversalNote, setReversalNote] = useState("");

  const load = useCallback(async () => {
    if (!orderId || !externalInvoiceId) return;
    setLoading(true);
    setError("");
    try {
      const next = await fetchExternalInvoiceAllocations(orderId, externalInvoiceId);
      setWorkspace(next);
      const nextInvoiceId = next.candidate_invoices[0]?.id ?? "";
      setPatientInvoiceId(nextInvoiceId);
      setAmountGross(suggestedAmount(next, nextInvoiceId));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : lang === "de"
            ? "Die Zuordnungen konnten nicht geladen werden."
            : "Не удалось загрузить распределения.",
      );
    } finally {
      setLoading(false);
    }
  }, [externalInvoiceId, lang, orderId]);

  useEffect(() => {
    if (!open) {
      setWorkspace(null);
      setPatientInvoiceId("");
      setAmountGross("");
      setReversalNote("");
      setError("");
      return;
    }
    void load();
  }, [load, open]);

  const selectedCandidate = useMemo(
    () => workspace?.candidate_invoices.find((candidate) => candidate.id === patientInvoiceId),
    [patientInvoiceId, workspace?.candidate_invoices],
  );

  async function handleAllocate() {
    if (!externalInvoiceId || !patientInvoiceId || !amountGross.trim()) return;
    setBusy(true);
    setError("");
    try {
      await createExternalInvoiceAllocation(
        orderId,
        externalInvoiceId,
        patientInvoiceId,
        amountGross.trim(),
      );
      await load();
      await onChanged();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : lang === "de"
            ? "Die Zuordnung konnte nicht gespeichert werden."
            : "Не удалось сохранить распределение.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleReverse(allocationId: string) {
    if (!externalInvoiceId || !reversalNote.trim()) {
      setError(
        lang === "de"
          ? "Bitte geben Sie einen Grund für die Stornierung an."
          : "Укажите причину сторнирования.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      await reverseExternalInvoiceAllocation(
        orderId,
        externalInvoiceId,
        allocationId,
        reversalNote.trim(),
      );
      setReversalNote("");
      await load();
      await onChanged();
    } catch (reverseError) {
      setError(
        reverseError instanceof Error
          ? reverseError.message
          : lang === "de"
            ? "Die Zuordnung konnte nicht storniert werden."
            : "Не удалось сторнировать распределение.",
      );
    } finally {
      setBusy(false);
    }
  }

  const currency = workspace?.currency ?? "EUR";
  const activeAllocations = workspace?.allocations.filter((item) => item.is_effective) ?? [];

  return (
    <Sheet open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <SheetContent side="right" className="w-full border-l border-border p-0 sm:max-w-2xl">
        <AdminSheetScaffold
          title={lang === "de" ? "Patientenrechnung zuordnen" : "Связать со счётом пациента"}
          description={
            workspace
              ? `${workspace.external_invoice_number} · ${currency}`
              : lang === "de"
                ? "Eingangsrechnung und Patientenrechnung abstimmen."
                : "Сверка входящего счёта и счёта пациента."
          }
          footer={
            <SheetFormFooter
              cancelLabel={lang === "de" ? "Schließen" : "Закрыть"}
              submitLabel={lang === "de" ? "Zuordnung speichern" : "Сохранить распределение"}
              submittingLabel={lang === "de" ? "Wird gespeichert…" : "Сохранение…"}
              submitting={busy}
              submitDisabled={
                loading ||
                !workspace ||
                !patientInvoiceId ||
                !amountGross.trim() ||
                Number(workspace.remaining_receivable_gross) <= 0
              }
              onCancel={() => onOpenChange(false)}
              onSubmit={() => void handleAllocate()}
            />
          }
        >
          {loading && !workspace ? (
            <div className="flex min-h-56 items-center justify-center">
              <LoaderCircle className="size-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-5 p-5">
              {error ? <Banner tone="error">{error}</Banner> : null}

              {workspace ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <InfoRow
                      className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}
                      label={lang === "de" ? "Patientenforderung" : "Требование к пациенту"}
                      value={formatMoneyAmount(workspace.patient_receivable_gross, currency)}
                    />
                    <InfoRow
                      className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}
                      label={lang === "de" ? "Bereits zugeordnet" : "Уже распределено"}
                      value={formatMoneyAmount(workspace.allocated_receivable_gross, currency)}
                    />
                    <InfoRow
                      className={cn("rounded-xl px-3 py-3", tokens.surface.mutedCard)}
                      label={lang === "de" ? "Noch zuzuordnen" : "Осталось распределить"}
                      value={formatMoneyAmount(workspace.remaining_receivable_gross, currency)}
                    />
                  </div>

                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleAllocate();
                    }}
                  >
                    <Field label={lang === "de" ? "Patientenrechnung" : "Счёт пациента"}>
                      <select
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={patientInvoiceId}
                        onChange={(event) => {
                          const nextId = event.target.value;
                          setPatientInvoiceId(nextId);
                          setAmountGross(suggestedAmount(workspace, nextId));
                        }}
                        disabled={busy || workspace.candidate_invoices.length === 0}
                      >
                        {workspace.candidate_invoices.length === 0 ? (
                          <option value="">
                            {lang === "de" ? "Keine geeignete Rechnung" : "Нет подходящего счёта"}
                          </option>
                        ) : null}
                        {workspace.candidate_invoices.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.invoice_number} · {formatMoneyAmount(candidate.total_gross, currency)}
                            {` · ${lang === "de" ? "Kapazität" : "доступно"} ${formatMoneyAmount(candidate.allocatable_capacity, currency)}`}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {selectedCandidate ? (
                      <p className="text-xs text-muted-foreground">
                        {lang === "de" ? "Offener Rechnungsbetrag" : "Остаток по счёту"}: {formatMoneyAmount(selectedCandidate.balance_due, currency)} · {lang === "de" ? "bereits aus Quellen zugeordnet" : "уже распределено из источников"}: {formatMoneyAmount(selectedCandidate.allocated_source_receivable, currency)}
                      </p>
                    ) : null}
                    <Field label={lang === "de" ? "Quellforderung zuordnen" : "Сумма требования к распределению"}>
                      <Input
                        inputMode="decimal"
                        value={amountGross}
                        onChange={(event) => setAmountGross(event.target.value)}
                        disabled={busy || !patientInvoiceId}
                      />
                    </Field>
                    <Banner tone="warning">
                      {lang === "de"
                        ? "Zugeordnet wird die ursprüngliche Patientenforderung aus der Eingangsrechnung – nicht der Aufschlag oder die MwSt. der Patientenrechnung."
                        : "Распределяется исходное требование из входящего счёта, а не наценка или НДС счёта пациента."}
                    </Banner>
                  </form>

                  <section className="space-y-3 border-t border-border pt-5">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {lang === "de" ? "Zuordnungshistorie" : "История распределений"}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {lang === "de"
                          ? "Fehler werden storniert und bleiben nachvollziehbar."
                          : "Ошибки сторнируются и остаются в истории."}
                      </p>
                    </div>
                    {activeAllocations.length > 0 ? (
                      <Field label={lang === "de" ? "Stornogrund" : "Причина сторнирования"}>
                        <Input
                          value={reversalNote}
                          onChange={(event) => setReversalNote(event.target.value)}
                          placeholder={lang === "de" ? "Pflichtfeld vor Storno" : "Обязательно перед сторно"}
                          disabled={busy}
                        />
                      </Field>
                    ) : null}
                    {workspace.allocations.length === 0 ? (
                      <EmptyCell>
                        {lang === "de" ? "Noch keine Zuordnungen." : "Распределений пока нет."}
                      </EmptyCell>
                    ) : (
                      <div className="space-y-2">
                        {workspace.allocations.map((allocation) => (
                          <article key={allocation.id} className="rounded-xl border border-border p-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-700 hover:text-sky-800"
                                  onClick={() => staffGo(`/invoices?invoice=${encodeURIComponent(allocation.patient_invoice_id)}`)}
                                >
                                  <Link2 className="size-4" />
                                  {allocation.invoice_number}
                                </button>
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {allocation.created_by_name ?? "—"} · {new Date(allocation.created_at).toLocaleString(lang === "de" ? "de-DE" : "ru-RU")}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <StatusBadge tone={allocation.is_effective ? "success" : "neutral"}>
                                  {allocation.is_effective
                                    ? lang === "de" ? "Aktiv" : "Активно"
                                    : lang === "de" ? "Storniert" : "Сторнировано"}
                                </StatusBadge>
                                <span className="text-sm font-semibold">
                                  {formatMoneyAmount(allocation.amount_gross, currency)}
                                </span>
                              </div>
                            </div>
                            {allocation.reversal_note ? (
                              <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                                {allocation.reversal_note}
                              </p>
                            ) : null}
                            {allocation.is_effective ? (
                              <div className="mt-3 flex justify-end">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => void handleReverse(allocation.id)}
                                  disabled={busy}
                                >
                                  <RotateCcw className="size-4" />
                                  {lang === "de" ? "Stornieren" : "Сторнировать"}
                                </Button>
                              </div>
                            ) : null}
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : null}
            </div>
          )}
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}
