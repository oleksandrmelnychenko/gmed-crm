import type { FormEvent } from "react";

import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Field as FormField,
  Section as FormSection,
  inputClass,
  selectClass,
} from "@/components/ui-shell";

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

type ContractCreateFooterProps = {
  busy: boolean;
  cancelLabel: string;
  l: LocalizeFn;
  onCancel: () => void;
};

function ContractCreateFooter({
  busy,
  cancelLabel,
  l,
  onCancel,
}: ContractCreateFooterProps) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-lg"
        onClick={onCancel}
      >
        {cancelLabel}
      </Button>
      <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={busy}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
        {l("Vertrag erstellen", "Sozdat dogovor", "Create contract")}
      </Button>
    </>
  );
}

type DunningEventsListProps = {
  dunningEvents: DunningEvent[];
  formatDateTime: DateTimeFormatter;
  formatMoney: MoneyFormatter;
  l: LocalizeFn;
};

function DunningEventsList({
  dunningEvents,
  formatDateTime,
  formatMoney,
  l,
}: DunningEventsListProps) {
  return (
    <div className="mt-4 space-y-3">
      {dunningEvents.length === 0 ? (
        <p className="text-sm text-zinc-500">{l("Noch nicht erfasst.", "Не зафиксировано.", "Not recorded yet.")}</p>
      ) : (
        dunningEvents.map((event) => (
          <div key={event.id} className="rounded-xl border border-zinc-200 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline" className="rounded-full text-[10px]">
                {event.level}
              </Badge>
              <span className="text-xs text-zinc-400">{formatDateTime(event.sent_at)}</span>
            </div>
            <div className="mt-2 space-y-1 text-sm text-zinc-600">
              <p>{l("Offener Betrag", "Сумма к оплате", "Balance due")}: {formatMoney(event.balance_due)}</p>
              <p>{l("Erstellt von", "Создано", "Created by")}: {event.created_by_name}</p>
              {event.note ? <p>{event.note}</p> : null}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

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
        bodyClassName="px-4 py-4 space-y-3"
        footer={
          <ContractCreateFooter
            busy={contractBusy}
            cancelLabel={cancelLabel}
            l={l}
            onCancel={() => onContractCreateOpenChange(false)}
          />
        }
      >
        <FormSection title={l("Vertrag", "Договор", "Contract")}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label={l("Status", "Статус", "Status")} htmlFor="contract-status">
            <NativeComboboxSelect
              id="contract-status"
              value={contractCreateForm.status}
              onChange={(event) => onContractCreateStatusChange(event.target.value ?? contractCreateForm.status)}
              className={selectClass}
            >
                {contractStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {patientDetailStatusLabel(status)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </FormField>
            <FormField
              label={l("Unterzeichnet am", "Подписано", "Signed at")}
              htmlFor="contract-signed-at"
            >
            <Input
              id="contract-signed-at"
              type="datetime-local"
              value={contractCreateForm.signedAt}
              onChange={(event) => onContractCreateSignedAtChange(event.target.value)}
              className={inputClass}
            />
            </FormField>
            <FormField label={l("Gueltig ab", "Действует с", "Valid from")} htmlFor="contract-valid-from">
            <Input
              id="contract-valid-from"
              type="date"
              value={contractCreateForm.validFrom}
              onChange={(event) => onContractCreateValidFromChange(event.target.value)}
              className={inputClass}
            />
            </FormField>
            <FormField label={l("Gueltig bis", "Действует до", "Valid to")} htmlFor="contract-valid-to">
            <Input
              id="contract-valid-to"
              type="date"
              value={contractCreateForm.validTo}
              onChange={(event) => onContractCreateValidToChange(event.target.value)}
              className={inputClass}
            />
            </FormField>
          </div>
        </FormSection>
      </PatientSheetScaffold>

      <PatientSheetScaffold
        open={Boolean(contractStatusId)}
        onOpenChange={(open) => {
          if (!open) onCloseContractStatus();
        }}
        width="narrow"
        onSubmit={onContractStatusSubmit}
        title={l("Vertragsstatus aktualisieren", "Обновить статус договора", "Update contract status")}
        description={l(
          "Passen Sie Lebenszyklus und Gültigkeitsdaten an, ohne das Patientenprofil zu verlassen.",
          "Обновляйте жизненный цикл и даты действия, не выходя из профиля пациента.",
          "Adjust lifecycle and validity dates without leaving the patient profile.",
        )}
        bodyClassName="px-4 py-4 space-y-3"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={onCloseContractStatus}
            >
              {l("Abbrechen", "Отмена", "Cancel")}
            </Button>
            <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={contractBusy}>
              {contractBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {l("Status speichern", "Сохранить статус", "Save status")}
            </Button>
          </>
        }
      >
        <FormSection title={l("Vertrag", "Договор", "Contract")}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label={l("Status", "Статус", "Status")} htmlFor="contract-status-edit">
              <NativeComboboxSelect
                id="contract-status-edit"
                value={contractStatusForm.status}
                onChange={(event) => onContractStatusValueChange(event.target.value ?? contractStatusForm.status)}
                className={selectClass}
              >
                {contractStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {patientDetailStatusLabel(status)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </FormField>
            <FormField
              label={l("Unterzeichnet am", "Подписано", "Signed at")}
              htmlFor="contract-signed-at-edit"
            >
              <Input
                id="contract-signed-at-edit"
                type="datetime-local"
                value={contractStatusForm.signedAt}
                onChange={(event) => onContractStatusSignedAtChange(event.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label={l("Gültig ab", "Действует с", "Valid from")} htmlFor="contract-valid-from-edit">
              <Input
                id="contract-valid-from-edit"
                type="date"
                value={contractStatusForm.validFrom}
                onChange={(event) => onContractStatusValidFromChange(event.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label={l("Gültig bis", "Действует до", "Valid to")} htmlFor="contract-valid-to-edit">
              <Input
                id="contract-valid-to-edit"
                type="date"
                value={contractStatusForm.validTo}
                onChange={(event) => onContractStatusValidToChange(event.target.value)}
                className={inputClass}
              />
            </FormField>
          </div>
        </FormSection>
      </PatientSheetScaffold>

      <PatientSheetScaffold
        open={Boolean(invoiceManageId)}
        onOpenChange={onInvoiceManageOpenChange}
        width="form-heavy"
        onSubmit={onInvoiceStatusSubmit}
        title={l("Rechnung verwalten", "Управлять счётом", "Manage invoice")}
        description={l(
          "Aktualisieren Sie den Billing-Status und setzen Sie den Mahnprozess direkt aus dem Patientenprofil fort.",
          "Обновляйте статус billing и продолжайте процесс напоминаний прямо из профиля пациента.",
          "Update billing status and continue dunning flow directly from the patient profile.",
        )}
        bodyClassName="px-4 py-4 space-y-3"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-lg"
              onClick={onCloseInvoiceManager}
            >
              {l("Schließen", "Закрыть", "Close")}
            </Button>
            <Button type="submit" size="sm" className="h-8 rounded-lg gap-1.5" disabled={invoiceBusy}>
              {invoiceBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
              {l("Rechnung speichern", "Сохранить счёт", "Save invoice")}
            </Button>
          </>
        }
      >
        <FormSection title={l("Rechnung", "Счёт", "Invoice")}>
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label={l("Status", "Статус", "Status")} htmlFor="invoice-status-edit">
              <NativeComboboxSelect
                id="invoice-status-edit"
                value={invoiceStatusForm.status}
                onChange={(event) => onInvoiceStatusValueChange(event.target.value ?? invoiceStatusForm.status)}
                className={selectClass}
              >
                {invoiceStatusOptions.map((status) => (
                  <option key={status} value={status}>
                    {patientDetailStatusLabel(status)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </FormField>
            <FormField label={l("Fälligkeitsdatum", "Срок", "Due date")} htmlFor="invoice-due-date-edit">
              <Input
                id="invoice-due-date-edit"
                type="date"
                value={invoiceStatusForm.dueDate}
                onChange={(event) => onInvoiceDueDateChange(event.target.value)}
                className={inputClass}
              />
            </FormField>
            <FormField label={l("Bezahlter Betrag", "Оплаченная сумма", "Paid amount")} htmlFor="invoice-paid-amount-edit">
              <Input
                id="invoice-paid-amount-edit"
                value={invoiceStatusForm.paidAmount}
                onChange={(event) => onInvoicePaidAmountChange(event.target.value)}
                className={inputClass}
                placeholder="0.00"
              />
            </FormField>
          </div>
        </FormSection>

        <FormSection title={l("Zusatzlich", "Дополнительно", "Additional")}>
          <FormField label={l("Notizen", "Заметки", "Notes")} htmlFor="invoice-notes-edit">
            <textarea
              id="invoice-notes-edit"
              className={textareaClassName}
              value={invoiceStatusForm.notes}
              onChange={(event) => onInvoiceNotesChange(event.target.value)}
              placeholder={l(
                "Billing-Notizen oder Details zur Zahlungsbestätigung",
                "Заметки по billing или детали подтверждения оплаты",
                "Billing notes or payment confirmation details",
              )}
            />
          </FormField>
        </FormSection>

        <FormSection
          title={l("Mahnwesen", "Напоминания", "Dunning")}
          accessory={
            canManageInvoices && nextDunningLevel(dunningEvents) ? (
              <Button
                type="button"
                size="sm"
                className="h-8 rounded-lg gap-1.5"
                onClick={() => void onCreateDunning()}
                disabled={dunningBusy}
              >
                {dunningBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                {l("Senden", "Отправить", "Send")} {nextDunningLevel(dunningEvents)}
              </Button>
            ) : null
          }
        >
          <p className="text-xs leading-5 text-muted-foreground">
            {l(
              "Verfolgen Sie versendete Mahnungen und eskalieren Sie überfällige Rechnungen.",
              "Отслеживайте отправленные напоминания и эскалируйте просроченные счета.",
              "Track sent reminders and escalate overdue invoices.",
            )}
          </p>
          <div className="mt-3">
            <FormField label={l("Mahnhinweis", "Заметка по напоминанию", "Reminder note")} htmlFor="dunning-note">
              <textarea
                id="dunning-note"
                className={textareaClassName}
                value={dunningNote}
                onChange={(event) => onDunningNoteChange(event.target.value)}
                placeholder={l(
                  "Optionale Notiz für den Billing-Verlauf",
                  "Необязательная заметка для trail биллинга",
                  "Optional note for billing trail",
                )}
              />
            </FormField>
          </div>
          <DunningEventsList
            dunningEvents={dunningEvents}
            formatDateTime={formatDateTime}
            formatMoney={formatMoney}
            l={l}
          />
        </FormSection>
      </PatientSheetScaffold>
    </>
  );
}
