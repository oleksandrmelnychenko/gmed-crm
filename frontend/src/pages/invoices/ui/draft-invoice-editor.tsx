import { useEffect, useState } from "react";
import { LoaderCircle, PencilLine, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { SectionHeading } from "@/components/ui/section-heading";
import { Banner as ShellBanner, inputClass, textareaClass } from "@/components/ui-shell";
import { appDateKey } from "@/lib/app-time-zone";
import { formatMoneyAmount } from "@/lib/money";

import { fetchInvoiceDraftEditor, updateInvoiceDraft } from "../data/invoice-api";
import {
  advanceSplitPreview,
  advanceSplitProblem,
  defaultSplitForm,
  draftFormDirty,
  draftFormFrom,
  draftLinesProblem,
  draftUpdatePayload,
  type DraftEditorPayload,
  type DraftForm,
} from "../model/draft-editor";
import { localizeInvoiceError } from "../model/invoice-errors";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  currency: string;
  lang: string;
  /** The recipient is changed in its own dialog (`/invoices/{id}/payer`). */
  canEditRecipient: boolean;
  onEditRecipient: () => void;
  onSaved: () => void;
};

type Copy = Record<string, string>;

const COPY: Record<"ru" | "de", Copy> = {
  ru: {
    title: "Редактировать черновик",
    description:
      "Черновик ещё не выставлен: менять можно срок оплаты, примечание, получателя и позиции. Дата счёта — день выставления.",
    dueDate: "Срок оплаты",
    dueDateHint: "Пусто — дата счёта + срок оплаты из настроек.",
    notes: "Примечание в счёте",
    recipient: "Получатель счёта…",
    lines: "Позиции из сметы",
    linesHint: "Количество — не больше открытого остатка позиции (с учётом этого черновика).",
    open: "открыто",
    quantity: "Кол-во",
    comment: "Примечание к позиции",
    split: "Распределение аванса",
    splitHint:
      "По умолчанию аванс сначала полностью покрывает услуги GMED с НДС, остаток — ожидаемые расходы третьих лиц. Можно распределить вручную в пределах открытых остатков; сумма должна равняться сумме аванса.",
    splitDefault: "Сначала услуги GMED",
    ownGroup: "Услуги GMED, НДС {rate} %",
    passthroughGroup: "Расходы третьих лиц (без НДС)",
    net: "Нетто",
    vat: "НДС",
    gross: "Брутто",
    total: "Итого",
    advanceAmount: "Сумма аванса",
    difference: "Разница",
    save: "Сохранить черновик",
    locked_no_quote: "Позиции этого черновика не из сметы и здесь не меняются: удалите черновик и создайте новый.",
    locked_other_sources:
      "Черновик содержит позиции не из сметы (счета поставщиков, консьерж-услуги): удалите черновик и создайте новый.",
    locked_termination_settlement: "Позиции итогового счёта при расторжении меняются только через расчёт расторжения.",
    locked_quote_closed: "Смета закрыта или заменена: позиции не меняются, удалите черновик.",
    locked_nothing_open: "В смете больше нечего распределять.",
    no_line: "Выберите хотя бы одну позицию.",
    quantity_invalid: "Введите количество больше нуля.",
    quantity_over_open: "Количество больше открытого остатка позиции.",
    unreadable: "Введите сумму числом, например 119,00.",
    negative: "Доля не может быть отрицательной.",
    over_open: "Доля больше открытого остатка группы.",
    sum_mismatch: "Сумма долей должна равняться сумме аванса.",
    due_past: "Срок оплаты не может быть раньше даты счёта (сегодня).",
    loadError: "Не удалось загрузить черновик.",
  },
  de: {
    title: "Entwurf bearbeiten",
    description:
      "Der Entwurf ist noch nicht ausgestellt: Fälligkeit, Anmerkung, Empfänger und Positionen lassen sich ändern. Rechnungsdatum ist der Tag der Ausstellung.",
    dueDate: "Fällig am",
    dueDateHint: "Leer: Rechnungsdatum + Zahlungsziel aus den Einstellungen.",
    notes: "Anmerkung auf der Rechnung",
    recipient: "Rechnungsempfänger…",
    lines: "Positionen aus dem Angebot",
    linesHint: "Menge höchstens der offene Rest der Position (dieser Entwurf eingerechnet).",
    open: "offen",
    quantity: "Menge",
    comment: "Anmerkung zur Position",
    split: "Aufteilung der Anzahlung",
    splitHint:
      "Standard: Die Anzahlung deckt zuerst die Leistungen der GMED samt USt., der Rest geht auf die erwarteten Fremdkosten. Manuell innerhalb der offenen Beträge möglich; die Summe muss den Betrag der Anzahlung ergeben.",
    splitDefault: "Zuerst GMED-Leistungen",
    ownGroup: "GMED-Leistungen, {rate} % USt.",
    passthroughGroup: "Fremdkosten (ohne USt.)",
    net: "Netto",
    vat: "USt.",
    gross: "Brutto",
    total: "Summe",
    advanceAmount: "Betrag der Anzahlung",
    difference: "Differenz",
    save: "Entwurf speichern",
    locked_no_quote:
      "Die Positionen dieses Entwurfs stammen nicht aus einem Angebot: Entwurf löschen und neu erstellen.",
    locked_other_sources:
      "Der Entwurf enthält Positionen außerhalb des Angebots (Lieferantenrechnungen, Concierge-Leistungen): Entwurf löschen und neu erstellen.",
    locked_termination_settlement: "Die Positionen der Schlussrechnung einer Kündigung ändert nur die Kündigungsabrechnung.",
    locked_quote_closed: "Das Angebot ist geschlossen oder ersetzt: Positionen bleiben, Entwurf löschen.",
    locked_nothing_open: "Im Angebot ist nichts mehr offen.",
    no_line: "Bitte mindestens eine Position wählen.",
    quantity_invalid: "Bitte eine Menge größer als null eingeben.",
    quantity_over_open: "Die Menge ist größer als der offene Rest der Position.",
    unreadable: "Bitte den Betrag als Zahl eingeben, z. B. 119,00.",
    negative: "Ein Anteil darf nicht negativ sein.",
    over_open: "Ein Anteil ist größer als der offene Betrag seiner Gruppe.",
    sum_mismatch: "Die Anteile müssen zusammen den Betrag der Anzahlung ergeben.",
    due_past: "Die Fälligkeit darf nicht vor dem Rechnungsdatum (heute) liegen.",
    loadError: "Der Entwurf konnte nicht geladen werden.",
  },
};

/** The editor of a draft invoice: header, quote lines or advance split. */
export function DraftInvoiceEditorDialog({
  open,
  onOpenChange,
  invoiceId,
  currency,
  lang,
  canEditRecipient,
  onEditRecipient,
  onSaved,
}: Props) {
  const copy = COPY[lang === "de" ? "de" : "ru"];
  const [payload, setPayload] = useState<DraftEditorPayload | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPayload(null);
    setForm(null);
    setLoadError(null);
    setSaveError(null);
    fetchInvoiceDraftEditor(invoiceId)
      .then((value) => {
        if (cancelled) return;
        setPayload(value);
        setForm(draftFormFrom(value));
      })
      .catch((error) => {
        if (!cancelled) setLoadError(localizeInvoiceError(error, lang, copy.loadError));
      });
    return () => {
      cancelled = true;
    };
  }, [open, invoiceId, lang, copy.loadError]);

  const money = (value: unknown) => formatMoneyAmount(value, currency || "EUR");
  const today = appDateKey();
  const dirty = Boolean(payload && form && draftFormDirty(payload, form));
  const dueProblem = form?.dueDate && form.dueDate < today ? copy.due_past : null;
  const linesProblem = payload && form ? draftLinesProblem(payload, form) : null;
  const splitProblem = payload && form ? advanceSplitProblem(payload, form.split) : null;
  const problem = dueProblem ?? (linesProblem ? copy[linesProblem] : null) ?? (splitProblem ? copy[splitProblem] : null);
  const preview = payload && form && payload.advance ? advanceSplitPreview(payload, form.split) : null;

  async function save() {
    if (!payload || !form || busy || problem || !dirty) return;
    setBusy(true);
    setSaveError(null);
    try {
      await updateInvoiceDraft(invoiceId, draftUpdatePayload(payload, form));
      onOpenChange(false);
      onSaved();
    } catch (error) {
      setSaveError(localizeInvoiceError(error, lang, copy.loadError));
    } finally {
      setBusy(false);
    }
  }

  const setLine = (index: number, patch: Partial<DraftForm["lines"][number]>) =>
    setForm((current) =>
      current ? { ...current, lines: { ...current.lines, [index]: { ...current.lines[index], ...patch } } } : current,
    );

  return (
    <Dialog dirty={dirty} open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <div className="space-y-5" data-testid="invoice-draft-editor">
          <DialogHeader>
            <DialogTitle>
              <SectionHeading icon={PencilLine}>{copy.title}</SectionHeading>
            </DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          {loadError ? <ShellBanner tone="error">{loadError}</ShellBanner> : null}
          {saveError ? <ShellBanner tone="error">{saveError}</ShellBanner> : null}
          {!payload || !form ? (
            loadError ? null : <LoaderCircle className="mx-auto size-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm">
                  <span className="font-medium text-foreground">{copy.dueDate}</span>
                  <Input
                    type="date"
                    className={inputClass}
                    min={today}
                    value={form.dueDate}
                    onChange={(event) => setForm({ ...form, dueDate: event.target.value })}
                    data-testid="invoice-draft-due-date"
                  />
                  <span className="block text-xs text-muted-foreground">{copy.dueDateHint}</span>
                </label>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    disabled={!canEditRecipient}
                    onClick={() => {
                      onOpenChange(false);
                      onEditRecipient();
                    }}
                  >
                    <UserRound className="size-4" />
                    {copy.recipient}
                  </Button>
                </div>
                <label className="space-y-1.5 text-sm sm:col-span-2">
                  <span className="font-medium text-foreground">{copy.notes}</span>
                  <textarea
                    className={textareaClass}
                    value={form.notes}
                    onChange={(event) => setForm({ ...form, notes: event.target.value })}
                    data-testid="invoice-draft-notes"
                  />
                </label>
              </div>

              {payload.lines_mode === "locked" ? (
                <ShellBanner tone="warning">
                  {copy[`locked_${payload.lines_locked_reason ?? "other_sources"}`] ?? copy.locked_other_sources}
                </ShellBanner>
              ) : null}

              {payload.lines_mode === "quote_positions" ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-foreground">{copy.lines}</h3>
                  <p className="text-xs text-muted-foreground">{copy.linesHint}</p>
                  <div className="divide-y divide-border rounded-lg border border-border">
                    {payload.quote_lines.map((line) => {
                      const entry = form.lines[line.line_index];
                      return (
                        <div
                          key={line.line_index}
                          className="grid gap-2 p-3 sm:grid-cols-[1fr_7rem]"
                          data-testid={`invoice-draft-line-${line.line_index}`}
                        >
                          <label className="flex min-w-0 items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              className="mt-1"
                              checked={entry?.selected ?? false}
                              onChange={(event) => setLine(line.line_index, { selected: event.target.checked })}
                            />
                            <span className="min-w-0">
                              <span className="block break-words text-foreground">{line.description}</span>
                              <span className="block text-xs text-muted-foreground">
                                {money(line.unit_price)} · {line.is_cost_passthrough ? copy.passthroughGroup : `${line.vat_rate ?? "0"} %`}
                                {" · "}
                                {copy.open}: {line.open_quantity.replace(".", ",")} / {line.quoted_quantity.replace(".", ",")}
                              </span>
                            </span>
                          </label>
                          <Input
                            className={inputClass}
                            inputMode="decimal"
                            aria-label={`${copy.quantity}: ${line.description}`}
                            disabled={!entry?.selected}
                            value={entry?.quantity ?? ""}
                            onChange={(event) => setLine(line.line_index, { quantity: event.target.value })}
                          />
                          {entry?.selected ? (
                            <Input
                              className={`${inputClass} sm:col-span-2`}
                              maxLength={300}
                              placeholder={copy.comment}
                              aria-label={`${copy.comment}: ${line.description}`}
                              value={entry.comment}
                              onChange={(event) => setLine(line.line_index, { comment: event.target.value })}
                            />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ) : null}

              {payload.lines_mode === "advance_split" && payload.advance && preview ? (
                <section className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-medium text-foreground">{copy.split}</h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setForm({ ...form, split: defaultSplitForm(payload) })}
                    >
                      {copy.splitDefault}
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">{copy.splitHint}</p>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full min-w-[34rem] text-sm">
                      <thead className="bg-muted/40 text-xs text-muted-foreground">
                        <tr>
                          <th className="p-2 text-left font-medium" />
                          <th className="p-2 text-right font-medium">{copy.open}</th>
                          <th className="p-2 text-right font-medium">{copy.gross}</th>
                          <th className="p-2 text-right font-medium">{copy.net}</th>
                          <th className="p-2 text-right font-medium">{copy.vat}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payload.advance.groups.map((group, index) => {
                          const label = group.is_cost_passthrough
                            ? copy.passthroughGroup
                            : copy.ownGroup.replace("{rate}", group.vat_rate.replace(".", ","));
                          return (
                            <tr key={`${group.is_cost_passthrough}-${group.vat_rate}`} className="border-t border-border">
                              <td className="p-2">{label}</td>
                              <td className="p-2 text-right text-muted-foreground">{money(group.open_gross)}</td>
                              <td className="p-2 text-right">
                                <MoneyInput
                                  className={`${inputClass} ml-auto w-32 text-right`}
                                  aria-label={`${copy.gross}: ${label}`}
                                  value={form.split[index] ?? ""}
                                  onChange={(event) => {
                                    const split = [...form.split];
                                    split[index] = event.target.value;
                                    setForm({ ...form, split });
                                  }}
                                />
                              </td>
                              <td className="p-2 text-right">{money(preview.rows[index]?.net ?? 0)}</td>
                              <td className="p-2 text-right">{money(preview.rows[index]?.vat ?? 0)}</td>
                            </tr>
                          );
                        })}
                        <tr className="border-t border-border font-medium">
                          <td className="p-2">{copy.total}</td>
                          <td className="p-2 text-right text-muted-foreground">
                            {copy.advanceAmount}: {money(payload.advance.amount_gross)}
                          </td>
                          <td className="p-2 text-right" data-testid="invoice-draft-split-gross">
                            {money(preview.total.gross)}
                          </td>
                          <td className="p-2 text-right">{money(preview.total.net)}</td>
                          <td className="p-2 text-right">{money(preview.total.vat)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {preview.difference !== 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {copy.difference}: {money(preview.difference)}
                    </p>
                  ) : null}
                </section>
              ) : null}

              {problem ? (
                <p role="alert" className="text-xs text-destructive">
                  {problem}
                </p>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  disabled={busy || !dirty || Boolean(problem)}
                  onClick={() => void save()}
                  data-testid="invoice-draft-save"
                >
                  {busy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {copy.save}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
