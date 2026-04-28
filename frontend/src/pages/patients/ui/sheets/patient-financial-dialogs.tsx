import type { FormEvent } from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { inputClass, selectClass } from "@/components/ui-shell";

import type { DunningEvent } from "../../model/detail-tab-types";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

type LocalizeFn = (de: string, ru: string, en: string) => string;
type StatusLabelFn = (status: string) => string;
type DateTimeFormatter = (value?: string | null, fallback?: string) => string;
type MoneyFormatter = (value?: string | null, currency?: string) => string;

type ContractFormState = {
  status: string;
  validFrom: string;
  validTo: string;
  signedAt: string;
};

type InvoiceStatusFormState = {
  status: string;
  dueDate: string;
  paidAmount: string;
  notes: string;
};

type PatientFinancialDialogsProps = {
  canManageInvoices: boolean;
  cancelLabel: string;
  contractBusy: boolean;
  contractCreateForm: ContractFormState;
  contractCreateOpen: boolean;
  contractStatusForm: ContractFormState;
  contractStatusId: string;
  contractStatusOptions: readonly string[];
  dunningBusy: boolean;
  dunningEvents: DunningEvent[];
  dunningNote: string;
  formatDateTime: DateTimeFormatter;
  formatMoney: MoneyFormatter;
  invoiceBusy: boolean;
  invoiceManageId: string;
  invoiceStatusForm: InvoiceStatusFormState;
  invoiceStatusOptions: readonly string[];
  l: LocalizeFn;
  nextDunningLevel: (events: DunningEvent[]) => string | null;
  onCloseContractStatus: () => void;
  onCloseInvoiceManager: () => void;
  onContractCreateOpenChange: (open: boolean) => void;
  onContractCreateSignedAtChange: (value: string) => void;
  onContractCreateStatusChange: (value: string) => void;
  onContractCreateSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onContractCreateValidFromChange: (value: string) => void;
  onContractCreateValidToChange: (value: string) => void;
  onContractStatusSignedAtChange: (value: string) => void;
  onContractStatusSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onContractStatusValueChange: (value: string) => void;
  onContractStatusValidFromChange: (value: string) => void;
  onContractStatusValidToChange: (value: string) => void;
  onCreateDunning: () => void | Promise<void>;
  onDunningNoteChange: (value: string) => void;
  onInvoiceDueDateChange: (value: string) => void;
  onInvoiceManageOpenChange: (open: boolean) => void;
  onInvoiceNotesChange: (value: string) => void;
  onInvoicePaidAmountChange: (value: string) => void;
  onInvoiceStatusSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onInvoiceStatusValueChange: (value: string) => void;
  patientDetailStatusLabel: StatusLabelFn;
  textareaClassName: string;
};

export function PatientFinancialDialogs({
  canManageInvoices,
  cancelLabel,
  contractBusy,
  contractCreateForm,
  contractCreateOpen,
  contractStatusForm,
  contractStatusId,
  contractStatusOptions,
  dunningBusy,
  dunningEvents,
  dunningNote,
  formatDateTime,
  formatMoney,
  invoiceBusy,
  invoiceManageId,
  invoiceStatusForm,
  invoiceStatusOptions,
  l,
  nextDunningLevel,
  onCloseContractStatus,
  onCloseInvoiceManager,
  onContractCreateOpenChange,
  onContractCreateSignedAtChange,
  onContractCreateStatusChange,
  onContractCreateSubmit,
  onContractCreateValidFromChange,
  onContractCreateValidToChange,
  onContractStatusSignedAtChange,
  onContractStatusSubmit,
  onContractStatusValueChange,
  onContractStatusValidFromChange,
  onContractStatusValidToChange,
  onCreateDunning,
  onDunningNoteChange,
  onInvoiceDueDateChange,
  onInvoiceManageOpenChange,
  onInvoiceNotesChange,
  onInvoicePaidAmountChange,
  onInvoiceStatusSubmit,
  onInvoiceStatusValueChange,
  patientDetailStatusLabel,
  textareaClassName,
}: PatientFinancialDialogsProps) {
  return (
    <>
      <PatientSheetScaffold open={contractCreateOpen} onOpenChange={onContractCreateOpenChange} width="narrow" onSubmit={onContractCreateSubmit}
        title={l("Rahmenvertrag erstellen", "Sozdat ramochnyy dogovor", "Create framework contract")}
        bodyClassName="px-4 py-4 space-y-4"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={() => onContractCreateOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={contractBusy}>
              {contractBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {l("Vertrag erstellen", "Sozdat dogovor", "Create contract")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="contract-status">
              {l("Status", "Status", "Status")}
            </Label>
            <NativeComboboxSelect
              value={contractCreateForm.status}
              onChange={(event) => onContractCreateStatusChange(event.target.value ?? contractCreateForm.status)} id="contract-status" className={selectClass}>
                {contractStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {patientDetailStatusLabel(status)}
                  </option>
                ))}
              </NativeComboboxSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="contract-signed-at">
              {l("Unterzeichnet am", "Podpisano", "Signed at")}
            </Label>
            <Input
              id="contract-signed-at"
              type="datetime-local"
              value={contractCreateForm.signedAt}
              onChange={(event) => onContractCreateSignedAtChange(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="contract-valid-from">
              {l("Gueltig ab", "Deystvuet s", "Valid from")}
            </Label>
            <Input
              id="contract-valid-from"
              type="date"
              value={contractCreateForm.validFrom}
              onChange={(event) => onContractCreateValidFromChange(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[11.5px] font-medium text-muted-foreground leading-tight" htmlFor="contract-valid-to">
              {l("Gueltig bis", "Deystvuet do", "Valid to")}
            </Label>
            <Input
              id="contract-valid-to"
              type="date"
              value={contractCreateForm.validTo}
              onChange={(event) => onContractCreateValidToChange(event.target.value)}
              className={inputClass}
            />
          </div>
        </div>
      </PatientSheetScaffold>

      <Dialog open={Boolean(contractStatusId)} onOpenChange={(open) => { if (!open) onCloseContractStatus(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{l("Vertragsstatus aktualisieren", "Обновить статус договора", "Update contract status")}</DialogTitle>
            <DialogDescription>
              {l(
                "Passen Sie Lebenszyklus und Gültigkeitsdaten an, ohne das Patientenprofil zu verlassen.",
                "Обновляйте жизненный цикл и даты действия, не выходя из профиля пациента.",
                "Adjust lifecycle and validity dates without leaving the patient profile.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={onContractStatusSubmit}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="contract-status-edit">{l("Status", "Статус", "Status")}</Label>
                <NativeComboboxSelect
                  value={contractStatusForm.status}
                  onChange={(event) => onContractStatusValueChange(event.target.value ?? contractStatusForm.status)} id="contract-status-edit" className={selectClass}>
                    {contractStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {patientDetailStatusLabel(status)}
                      </option>
                    ))}
                  </NativeComboboxSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-signed-at-edit">{l("Unterzeichnet am", "Подписано", "Signed at")}</Label>
                <Input
                  id="contract-signed-at-edit"
                  type="datetime-local"
                  value={contractStatusForm.signedAt}
                  onChange={(event) => onContractStatusSignedAtChange(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-from-edit">{l("Gültig ab", "Действует с", "Valid from")}</Label>
                <Input
                  id="contract-valid-from-edit"
                  type="date"
                  value={contractStatusForm.validFrom}
                  onChange={(event) => onContractStatusValidFromChange(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contract-valid-to-edit">{l("Gültig bis", "Действует до", "Valid to")}</Label>
                <Input
                  id="contract-valid-to-edit"
                  type="date"
                  value={contractStatusForm.validTo}
                  onChange={(event) => onContractStatusValidToChange(event.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={onCloseContractStatus}>
                {l("Abbrechen", "Отмена", "Cancel")}
              </Button>
              <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={contractBusy}>
                {contractBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {l("Status speichern", "Сохранить статус", "Save status")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(invoiceManageId)} onOpenChange={onInvoiceManageOpenChange}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{l("Rechnung verwalten", "Управлять счётом", "Manage invoice")}</DialogTitle>
            <DialogDescription>
              {l(
                "Aktualisieren Sie den Billing-Status und setzen Sie den Mahnprozess direkt aus dem Patientenprofil fort.",
                "Обновляйте статус billing и продолжайте процесс напоминаний прямо из профиля пациента.",
                "Update billing status and continue dunning flow directly from the patient profile.",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <form className="space-y-4" onSubmit={onInvoiceStatusSubmit}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="invoice-status-edit">{l("Status", "Статус", "Status")}</Label>
                  <NativeComboboxSelect
                    value={invoiceStatusForm.status}
                    onChange={(event) => onInvoiceStatusValueChange(event.target.value ?? invoiceStatusForm.status)} id="invoice-status-edit" className={selectClass}>
                      {invoiceStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {patientDetailStatusLabel(status)}
                        </option>
                      ))}
                    </NativeComboboxSelect>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-due-date-edit">{l("Fälligkeitsdatum", "Срок", "Due date")}</Label>
                  <Input
                    id="invoice-due-date-edit"
                    type="date"
                    value={invoiceStatusForm.dueDate}
                    onChange={(event) => onInvoiceDueDateChange(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="invoice-paid-amount-edit">{l("Bezahlter Betrag", "Оплаченная сумма", "Paid amount")}</Label>
                  <Input
                    id="invoice-paid-amount-edit"
                    value={invoiceStatusForm.paidAmount}
                    onChange={(event) => onInvoicePaidAmountChange(event.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="invoice-notes-edit">{l("Notizen", "Заметки", "Notes")}</Label>
                <textarea
                  id="invoice-notes-edit"
                  className={textareaClassName}
                  value={invoiceStatusForm.notes}
                  onChange={(event) => onInvoiceNotesChange(event.target.value)}
                  placeholder={l("Billing-Notizen oder Details zur Zahlungsbestätigung", "Заметки по billing или детали подтверждения оплаты", "Billing notes or payment confirmation details")}
                />
              </div>
              <div className="flex justify-end">
                <Button type="submit" className="rounded-xl bg-slate-950 text-white hover:bg-slate-800" disabled={invoiceBusy}>
                  {invoiceBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                  {l("Rechnung speichern", "Сохранить счёт", "Save invoice")}
                </Button>
              </div>
            </form>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Mahnwesen</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {l("Verfolgen Sie versendete Mahnungen und eskalieren Sie überfällige Rechnungen.", "Отслеживайте отправленные напоминания и эскалируйте просроченные счета.", "Track sent reminders and escalate overdue invoices.")}
                  </p>
                </div>
                {canManageInvoices && nextDunningLevel(dunningEvents) ? (
                  <Button
                    type="button"
                    className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                    onClick={() => void onCreateDunning()}
                    disabled={dunningBusy}
                  >
                    {dunningBusy ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                    {l("Senden", "Отправить", "Send")} {nextDunningLevel(dunningEvents)}
                  </Button>
                ) : null}
              </div>
              <div className="mt-4 space-y-2">
                <Label htmlFor="dunning-note">{l("Mahnhinweis", "Заметка по напоминанию", "Reminder note")}</Label>
                <textarea
                  id="dunning-note"
                  className={textareaClassName}
                  value={dunningNote}
                  onChange={(event) => onDunningNoteChange(event.target.value)}
                  placeholder={l("Optionale Notiz für den Billing-Verlauf", "Необязательная заметка для trail биллинга", "Optional note for billing trail")}
                />
              </div>
              <div className="mt-4 space-y-3">
                {dunningEvents.length === 0 ? (
                  <p className="text-sm text-slate-500">{l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}</p>
                ) : (
                  dunningEvents.map((event) => (
                    <div key={event.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Badge variant="outline" className="rounded-full text-[10px]">
                          {event.level}
                        </Badge>
                        <span className="text-xs text-slate-400">{formatDateTime(event.sent_at)}</span>
                      </div>
                      <div className="mt-2 space-y-1 text-sm text-slate-600">
                        <p>{l("Offener Betrag", "Сумма к оплате", "Balance due")}: {formatMoney(event.balance_due)}</p>
                        <p>{l("Erstellt von", "Создано", "Created by")}: {event.created_by_name}</p>
                        {event.note ? <p>{event.note}</p> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="rounded-xl" onClick={onCloseInvoiceManager}>
                {l("Schließen", "Закрыть", "Close")}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

