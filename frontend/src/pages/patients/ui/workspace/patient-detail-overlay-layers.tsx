import type { FormEvent } from "react";

import type { AppointmentItem, OrderItem, RelationItem } from "../../model/detail-tab-types";
import type { PatientsDictionary, PatientDetail } from "../../model/list-model";
import { MemoizedPatientDocumentUploadDialog } from "../sheets/patient-document-upload-dialog";
import { PatientFinancialDialogs } from "../sheets/patient-financial-dialogs";
import { MemoizedPatientProfileEditorSheet } from "../sheets/patient-profile-editor-sheet";
import { MemoizedPatientRelationEditorSheet } from "../sheets/patient-relation-editor-sheet";
import type { DunningEvent } from "../../model/detail-tab-types";

type LocalizeFn = (de: string, ru: string, en: string) => string;
type StatusLabelFn = (status: string) => string;
type DateFormatter = (value?: string | null, fallback?: string) => string;
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

type PatientDetailOverlayLayersProps = {
  appointments: AppointmentItem[];
  canManageInvoices: boolean;
  canManageRelations: boolean;
  contractBusy: boolean;
  contractCreateForm: ContractFormState;
  contractCreateOpen: boolean;
  contractStatusForm: ContractFormState;
  contractStatusId: string;
  contractStatusOptions: readonly string[];
  detail: PatientDetail;
  dictionary: PatientsDictionary;
  documentUploadOpen: boolean;
  dunningBusy: boolean;
  dunningEvents: DunningEvent[];
  dunningNote: string;
  editingRelation: RelationItem | null;
  formatDate: DateFormatter;
  formatDateTime: DateTimeFormatter;
  formatMoney: MoneyFormatter;
  invoiceBusy: boolean;
  invoiceManageId: string;
  invoiceStatusForm: InvoiceStatusFormState;
  invoiceStatusOptions: readonly string[];
  lang: string;
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
  onDocumentUploadOpenChange: (open: boolean) => void;
  onDunningNoteChange: (value: string) => void;
  onError: (message: string) => void;
  onInvoiceDueDateChange: (value: string) => void;
  onInvoiceManageOpenChange: (open: boolean) => void;
  onInvoiceNotesChange: (value: string) => void;
  onInvoicePaidAmountChange: (value: string) => void;
  onInvoiceStatusSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onInvoiceStatusValueChange: (value: string) => void;
  onProfileEditorOpenChange: (open: boolean) => void;
  onRelationEditorOpenChange: (open: boolean) => void;
  onSaved: () => void;
  orders: OrderItem[];
  patientId?: string;
  patientDetailStatusLabel: StatusLabelFn;
  profileEditorOpen: boolean;
  relationEditorOpen: boolean;
  textareaClassName: string;
};

export function PatientDetailOverlayLayers({
  appointments,
  canManageInvoices,
  canManageRelations,
  contractBusy,
  contractCreateForm,
  contractCreateOpen,
  contractStatusForm,
  contractStatusId,
  contractStatusOptions,
  detail,
  dictionary,
  documentUploadOpen,
  dunningBusy,
  dunningEvents,
  dunningNote,
  editingRelation,
  formatDate,
  formatDateTime,
  formatMoney,
  invoiceBusy,
  invoiceManageId,
  invoiceStatusForm,
  invoiceStatusOptions,
  lang,
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
  onDocumentUploadOpenChange,
  onDunningNoteChange,
  onError,
  onInvoiceDueDateChange,
  onInvoiceManageOpenChange,
  onInvoiceNotesChange,
  onInvoicePaidAmountChange,
  onInvoiceStatusSubmit,
  onInvoiceStatusValueChange,
  onProfileEditorOpenChange,
  onRelationEditorOpenChange,
  onSaved,
  orders,
  patientId,
  patientDetailStatusLabel,
  profileEditorOpen,
  relationEditorOpen,
  textareaClassName,
}: PatientDetailOverlayLayersProps) {
  return (
    <>
      <MemoizedPatientProfileEditorSheet
        open={profileEditorOpen}
        patientId={patientId}
        detail={detail}
        dictionary={dictionary}
        lang={lang}
        statusLabel={patientDetailStatusLabel}
        onOpenChange={onProfileEditorOpenChange}
        onSaved={onSaved}
        onError={onError}
      />

      <MemoizedPatientRelationEditorSheet
        open={relationEditorOpen}
        patientId={patientId}
        selfPatientId={detail.id}
        canManageRelations={canManageRelations}
        editingRelation={editingRelation}
        dictionary={dictionary}
        lang={lang}
        textareaClassName={textareaClassName}
        onOpenChange={onRelationEditorOpenChange}
        onSaved={onSaved}
        onError={onError}
      />

      <MemoizedPatientDocumentUploadDialog
        open={documentUploadOpen}
        patientId={patientId}
        orders={orders}
        appointments={appointments}
        dictionary={dictionary}
        lang={lang}
        textareaClassName={textareaClassName}
        statusLabel={patientDetailStatusLabel}
        formatDate={formatDate}
        onOpenChange={onDocumentUploadOpenChange}
        onSaved={onSaved}
        onError={onError}
      />

      <PatientFinancialDialogs
        canManageInvoices={canManageInvoices}
        cancelLabel={dictionary.common_cancel}
        contractBusy={contractBusy}
        contractCreateForm={contractCreateForm}
        contractCreateOpen={contractCreateOpen}
        contractStatusForm={contractStatusForm}
        contractStatusId={contractStatusId}
        contractStatusOptions={contractStatusOptions}
        dunningBusy={dunningBusy}
        dunningEvents={dunningEvents}
        dunningNote={dunningNote}
        formatDateTime={formatDateTime}
        formatMoney={formatMoney}
        invoiceBusy={invoiceBusy}
        invoiceManageId={invoiceManageId}
        invoiceStatusForm={invoiceStatusForm}
        invoiceStatusOptions={invoiceStatusOptions}
        l={l}
        nextDunningLevel={nextDunningLevel}
        onCloseContractStatus={onCloseContractStatus}
        onCloseInvoiceManager={onCloseInvoiceManager}
        onContractCreateOpenChange={onContractCreateOpenChange}
        onContractCreateSignedAtChange={onContractCreateSignedAtChange}
        onContractCreateStatusChange={onContractCreateStatusChange}
        onContractCreateSubmit={onContractCreateSubmit}
        onContractCreateValidFromChange={onContractCreateValidFromChange}
        onContractCreateValidToChange={onContractCreateValidToChange}
        onContractStatusSignedAtChange={onContractStatusSignedAtChange}
        onContractStatusSubmit={onContractStatusSubmit}
        onContractStatusValueChange={onContractStatusValueChange}
        onContractStatusValidFromChange={onContractStatusValidFromChange}
        onContractStatusValidToChange={onContractStatusValidToChange}
        onCreateDunning={onCreateDunning}
        onDunningNoteChange={onDunningNoteChange}
        onInvoiceDueDateChange={onInvoiceDueDateChange}
        onInvoiceManageOpenChange={onInvoiceManageOpenChange}
        onInvoiceNotesChange={onInvoiceNotesChange}
        onInvoicePaidAmountChange={onInvoicePaidAmountChange}
        onInvoiceStatusSubmit={onInvoiceStatusSubmit}
        onInvoiceStatusValueChange={onInvoiceStatusValueChange}
        patientDetailStatusLabel={patientDetailStatusLabel}
        textareaClassName={textareaClassName}
      />
    </>
  );
}
