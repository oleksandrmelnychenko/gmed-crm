import type { ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { inputClass, selectClass, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { formatMoneyAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

import {
  creditableVatRates,
  normalizeVatRate,
  type CreditNoteMode,
  type CreditNotePreview,
  type CreditNoteSelectionError,
} from "../model/credit-note";
import type { InvoiceCreditNoteDraft } from "../model/invoice-detail-drafts";
import type { InvoiceCreditableLine, InvoiceCreditNoteTransaction } from "../model/types";

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

type CreditNoteFormProps = {
  lines: InvoiceCreditableLine[] | undefined;
  draft: InvoiceCreditNoteDraft;
  onChange: (update: (current: InvoiceCreditNoteDraft) => InvoiceCreditNoteDraft) => void;
  preview: CreditNotePreview;
  currency: string;
  /** Invoice date: a correction cannot precede it. */
  minDate: string;
  busy: boolean;
  onSubmit: () => void;
};

const ERROR_KEYS = {
  nothing_selected: "finance_credit_note_error_nothing_selected",
  invalid_amount: "finance_credit_note_error_invalid_amount",
  line_exceeded: "finance_credit_note_error_line_exceeded",
  vat_rate_missing: "finance_credit_note_error_vat_rate_missing",
  vat_rate_exceeded: "finance_credit_note_error_vat_rate_exceeded",
} as const satisfies Record<CreditNoteSelectionError, string>;

/** Credit-note form: credited invoice lines or an amount within one VAT rate. */
export function CreditNoteForm({
  lines,
  draft,
  onChange,
  preview,
  currency,
  minDate,
  busy,
  onSubmit,
}: CreditNoteFormProps) {
  const { t } = useLang();
  const money = (value: unknown) => formatMoneyAmount(value, currency);
  const rates = creditableVatRates(lines);
  const openLines = (lines ?? []).filter((line) => Number(line.remaining_gross) > 0);
  const setMode = (mode: CreditNoteMode) =>
    onChange((current) => ({
      ...current,
      selection: {
        ...current.selection,
        mode,
        vatRate: current.selection.vatRate || (rates[0]?.rate ?? ""),
      },
    }));
  const showError = preview.error && preview.error !== "nothing_selected";

  if (openLines.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
        {t.finance_credit_note_no_open_lines}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
      <div className="flex flex-wrap gap-2" role="radiogroup">
        {(["lines", "vat_rate"] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            size="sm"
            variant={draft.selection.mode === mode ? "default" : "outline"}
            role="radio"
            aria-checked={draft.selection.mode === mode}
            onClick={() => setMode(mode)}
          >
            {mode === "lines" ? t.finance_credit_note_mode_lines : t.finance_credit_note_mode_vat_rate}
          </Button>
        ))}
      </div>

      {draft.selection.mode === "lines" ? (
        <div className="space-y-2">
          {(lines ?? []).map((line) => {
            const lineDraft = draft.selection.lines[line.line_index] ?? { selected: false, amount: "" };
            const open = Number(line.remaining_gross) > 0;
            return (
              <div
                key={line.line_index}
                className={cn(
                  "grid gap-2 rounded-md border border-border/60 bg-background/70 p-2 sm:grid-cols-[1fr_11rem]",
                  !open && "opacity-60",
                )}
              >
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!open}
                    checked={lineDraft.selected}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        selection: {
                          ...current.selection,
                          lines: {
                            ...current.selection.lines,
                            [line.line_index]: { ...lineDraft, selected: event.target.checked },
                          },
                        },
                      }))
                    }
                  />
                  <span className="min-w-0">
                    <span className="block font-medium text-foreground">{line.description || "—"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {normalizeVatRate(line.vat_rate)} % · {money(line.line_gross)}
                      {line.is_cost_passthrough ? ` · ${t.finance_credit_note_passthrough}` : ""}
                      {" · "}
                      {open
                        ? t.finance_credit_note_line_remaining.replace("{amount}", money(line.remaining_gross))
                        : t.finance_credit_note_line_fully_credited}
                    </span>
                  </span>
                </label>
                {lineDraft.selected ? (
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    max={line.remaining_gross}
                    aria-label={t.finance_credit_note_line_amount}
                    placeholder={Number(line.remaining_gross).toFixed(2)}
                    title={t.finance_credit_note_line_amount_hint}
                    value={lineDraft.amount}
                    onChange={(event) =>
                      onChange((current) => ({
                        ...current,
                        selection: {
                          ...current.selection,
                          lines: {
                            ...current.selection.lines,
                            [line.line_index]: { ...lineDraft, amount: event.target.value },
                          },
                        },
                      }))
                    }
                    className={inputClass}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.finance_credit_note_vat_rate}>
            <NativeComboboxSelect
              value={draft.selection.vatRate}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  selection: { ...current.selection, vatRate: event.target.value },
                }))
              }
              className={selectClass}
            >
              {rates.map((rate) => (
                <option key={rate.rate} value={rate.rate}>
                  {t.finance_credit_note_vat_rate_option
                    .replace("{rate}", rate.rate)
                    .replace("{amount}", money(rate.remainingGross))}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field label={t.finance_credit_note_amount}>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={draft.selection.amountGross}
              onChange={(event) =>
                onChange((current) => ({
                  ...current,
                  selection: { ...current.selection, amountGross: event.target.value },
                }))
              }
              className={inputClass}
            />
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t.finance_credit_note_date}>
          <Input
            type="date"
            min={minDate}
            max={new Date().toISOString().slice(0, 10)}
            value={draft.issuedOn}
            onChange={(event) => onChange((current) => ({ ...current, issuedOn: event.target.value }))}
            className={inputClass}
          />
        </Field>
        <Field label={t.finance_credit_note_reason} className="sm:col-span-1 lg:col-span-2">
          <Input
            value={draft.reason}
            onChange={(event) => onChange((current) => ({ ...current, reason: event.target.value }))}
            className={inputClass}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={draft.portalVisible}
          onChange={(event) => onChange((current) => ({ ...current, portalVisible: event.target.checked }))}
        />
        {t.finance_credit_note_portal_visible}
      </label>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
          {showError ? (
            <span className="text-rose-700">{t[ERROR_KEYS[preview.error!]]}</span>
          ) : preview.gross > 0 ? (
            t.finance_credit_note_preview
              .replace("{net}", money(preview.net))
              .replace("{vat}", money(preview.vat))
              .replace("{gross}", money(preview.gross))
          ) : null}
        </div>
        <Button
          type="button"
          disabled={busy || Boolean(preview.error) || !draft.reason.trim() || !draft.issuedOn}
          onClick={onSubmit}
        >
          {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
          {t.finance_credit_note_create}
        </Button>
      </div>
    </div>
  );
}

/** Credited lines and VAT per rate of a recorded credit note. */
export function CreditNoteLinesSummary({
  credit,
  currency,
}: {
  credit: InvoiceCreditNoteTransaction;
  currency: string;
}) {
  const { t } = useLang();
  const money = (value: unknown) => formatMoneyAmount(value, currency);
  if (credit.credit_mode === "legacy_pro_rata") {
    return <div className="mt-1 text-xs text-muted-foreground">{t.finance_credit_note_legacy}</div>;
  }
  if (!credit.line_items?.length) return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
      {credit.line_items.map((line) => (
        <div key={`${line.invoice_line_index}-${line.line_gross}`} className="flex justify-between gap-3">
          <span className="min-w-0 truncate">
            {line.description}
            {line.quantity === null ? ` · ${t.finance_credit_note_partial}` : ""}
            {line.is_cost_passthrough ? ` · ${t.finance_credit_note_passthrough}` : ""}
          </span>
          <span className="shrink-0 tabular-nums">
            {normalizeVatRate(line.vat_rate)} % · {money(line.line_gross)}
          </span>
        </div>
      ))}
      {(credit.vat_breakdown ?? []).map((rate) => (
        <div key={rate.vat_rate} className="tabular-nums">
          {t.finance_credit_note_vat_line
            .replace("{rate}", normalizeVatRate(rate.vat_rate))
            .replace("{net}", money(rate.net))
            .replace("{vat}", money(rate.vat))}
        </div>
      ))}
    </div>
  );
}
