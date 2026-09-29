import { useState, type FormEvent } from "react";
import { Ban, LoaderCircle, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banner as ShellBanner } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";

import { cancelUnassignedProviderInvoice, updateUnassignedProviderInvoice } from "./data";
import type { CompanyProviderLiability } from "./types";

const copy = {
  ru: {
    title: "Исправить или отменить счёт",
    hint: "Счёт без заказа можно исправить или отменить, пока по нему нет оплаты. Изменения и отмена записываются в журнал аудита.",
    number: "Номер счёта",
    invoiceDate: "Дата счёта",
    dueDate: "Оплатить до",
    net: "Нетто",
    vat: "НДС",
    gross: "Брутто",
    amountsHint: "Чтобы изменить сумму, укажите нетто, НДС и брутто (брутто = нетто + НДС).",
    save: "Сохранить исправление",
    saveFailed: "Не удалось сохранить исправление.",
    cancelReason: "Причина отмены (от 3 символов)",
    cancel: "Отменить счёт",
    cancelFailed: "Не удалось отменить счёт.",
    allocationsFirst: "Сначала сторнируйте распределения этого счёта на счета пациентов.",
    paymentsFirst: "Сначала отмените выплаты по этому счёту.",
  },
  de: {
    title: "Rechnung korrigieren oder stornieren",
    hint: "Eine Rechnung ohne Auftrag kann korrigiert oder storniert werden, solange keine Zahlung erfasst ist. Änderungen und Storno werden im Audit-Protokoll erfasst.",
    number: "Rechnungsnummer",
    invoiceDate: "Rechnungsdatum",
    dueDate: "Fällig am",
    net: "Netto",
    vat: "USt.",
    gross: "Brutto",
    amountsHint: "Zum Ändern des Betrags Netto, USt. und Brutto angeben (Brutto = Netto + USt.).",
    save: "Korrektur speichern",
    saveFailed: "Die Korrektur konnte nicht gespeichert werden.",
    cancelReason: "Stornogrund (mindestens 3 Zeichen)",
    cancel: "Rechnung stornieren",
    cancelFailed: "Die Rechnung konnte nicht storniert werden.",
    allocationsFirst: "Stornieren Sie zuerst die Zuordnungen dieser Rechnung zu Patientenrechnungen.",
    paymentsFirst: "Stornieren Sie zuerst die Zahlungen dieser Rechnung.",
  },
} as const;

function parseAmount(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

type Props = {
  liability: CompanyProviderLiability;
  onChanged: () => void;
  onDirtyChange: (dirty: boolean) => void;
};

export function UnassignedInvoiceCorrection({ liability, onChanged, onDirtyChange }: Props) {
  const { lang } = useLang();
  const text = copy[lang];
  const [form, setForm] = useState({
    number: liability.external_invoice_number,
    invoiceDate: liability.invoice_date ?? "",
    dueDate: liability.due_date ?? "",
    net: "",
    vat: "",
    gross: "",
  });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"save" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function localize(message: string, fallback: string) {
    if (message.includes("patient-invoice allocations")) return text.allocationsFirst;
    if (message.includes("company payments")) return text.paymentsFirst;
    return message || fallback;
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    const amounts = [form.net, form.vat, form.gross].map(parseAmount);
    const amountsGiven = amounts.every((value) => value !== null);
    const payload: Record<string, unknown> = {
      external_invoice_number: form.number.trim(),
      invoice_date: form.invoiceDate || null,
      due_date: form.dueDate || null,
    };
    if (amountsGiven) {
      payload.amount_net = amounts[0];
      payload.amount_vat = amounts[1];
      payload.amount_gross = amounts[2];
    }
    setBusy("save");
    setError(null);
    try {
      await updateUnassignedProviderInvoice(liability.id, payload);
      onDirtyChange(false);
      onChanged();
    } catch (saveError) {
      setError(localize(saveError instanceof Error ? saveError.message : "", text.saveFailed));
    } finally {
      setBusy(null);
    }
  }

  async function handleCancel() {
    if (reason.trim().length < 3) return;
    setBusy("cancel");
    setError(null);
    try {
      await cancelUnassignedProviderInvoice(liability.id, reason.trim());
      onDirtyChange(false);
      onChanged();
    } catch (cancelError) {
      setError(localize(cancelError instanceof Error ? cancelError.message : "", text.cancelFailed));
    } finally {
      setBusy(null);
    }
  }

  const amountsPartial =
    [form.net, form.vat, form.gross].some((value) => value.trim()) &&
    ![form.net, form.vat, form.gross].every((value) => value.trim());
  const fieldClassName = "grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground";
  const inputClassName = "h-9 min-w-0 bg-field font-normal text-foreground";

  return (
    <form
      className="space-y-3 p-3.5"
      onSubmit={handleSave}
      onChangeCapture={() => onDirtyChange(true)}
      aria-label={text.title}
    >
      <p className="text-xs leading-5 text-muted-foreground">{text.hint}</p>
      {error ? <ShellBanner tone="error">{error}</ShellBanner> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={fieldClassName}>
          <span>{text.number}</span>
          <Input className={inputClassName} required maxLength={250} value={form.number} onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))} />
        </label>
        <label className={fieldClassName}>
          <span>{text.invoiceDate}</span>
          <Input className={inputClassName} type="date" value={form.invoiceDate} onChange={(event) => setForm((current) => ({ ...current, invoiceDate: event.target.value }))} />
        </label>
        <label className={fieldClassName}>
          <span>{text.dueDate}</span>
          <Input className={inputClassName} type="date" value={form.dueDate} onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))} />
        </label>
        <label className={fieldClassName}>
          <span>{text.net}</span>
          <Input className={inputClassName} inputMode="decimal" value={form.net} onChange={(event) => setForm((current) => ({ ...current, net: event.target.value }))} />
        </label>
        <label className={fieldClassName}>
          <span>{text.vat}</span>
          <Input className={inputClassName} inputMode="decimal" value={form.vat} onChange={(event) => setForm((current) => ({ ...current, vat: event.target.value }))} />
        </label>
        <label className={fieldClassName}>
          <span>{text.gross}</span>
          <Input className={inputClassName} inputMode="decimal" placeholder={liability.amount_gross} value={form.gross} onChange={(event) => setForm((current) => ({ ...current, gross: event.target.value }))} />
        </label>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">{text.amountsHint}</p>
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="h-8 rounded-md" disabled={busy !== null || amountsPartial || !form.number.trim()}>
          {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {text.save}
        </Button>
      </div>
      <div className="grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className={fieldClassName}>
          <span>{text.cancelReason}</span>
          <Input className={inputClassName} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <Button type="button" variant="destructive" size="sm" className="h-9 rounded-md" disabled={busy !== null || reason.trim().length < 3} onClick={() => void handleCancel()}>
          {busy === "cancel" ? <LoaderCircle className="size-4 animate-spin" /> : <Ban className="size-4" />}
          {text.cancel}
        </Button>
      </div>
    </form>
  );
}
