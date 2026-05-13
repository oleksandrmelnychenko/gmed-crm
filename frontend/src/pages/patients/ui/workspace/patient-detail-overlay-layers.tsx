import { lazy, Suspense, type FormEvent } from "react";

import type { AppointmentItem, OrderItem, RelationItem } from "../../model/detail-tab-types";
import type { PatientsDictionary, PatientDetail } from "../../model/list-model";
import type { DunningEvent } from "../../model/detail-tab-types";

const loadPatientProfileEditorSheet = () => import("../sheets/patient-profile-editor-sheet");
const loadPatientRelationEditorSheet = () => import("../sheets/patient-relation-editor-sheet");
const loadPatientDocumentUploadDialog = () => import("../sheets/patient-document-upload-dialog");
const loadPatientFinancialDialogs = () => import("../sheets/patient-financial-dialogs");

const LazyPatientProfileEditorSheet = lazy(async () => {
  const mod = await loadPatientProfileEditorSheet();
  return { default: mod.MemoizedPatientProfileEditorSheet };
});

const LazyPatientRelationEditorSheet = lazy(async () => {
  const mod = await loadPatientRelationEditorSheet();
  return { default: mod.MemoizedPatientRelationEditorSheet };
});

const LazyPatientDocumentUploadDialog = lazy(async () => {
  const mod = await loadPatientDocumentUploadDialog();
  return { default: mod.MemoizedPatientDocumentUploadDialog };
});

const LazyPatientFinancialDialogs = lazy(async () => {
  const mod = await loadPatientFinancialDialogs();
  return { default: mod.PatientFinancialDialogs };
});

type LocalizeFn = (key: string) => string;
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
  const hasFinancialDialogsOpen =
    contractCreateOpen || Boolean(contractStatusId) || Boolean(invoiceManageId);

  return (
    <>
      {profileEditorOpen ? (
        <Suspense fallback={null}>
          <LazyPatientProfileEditorSheet
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
        </Suspense>
      ) : null}

      {relationEditorOpen ? (
        <Suspense fallback={null}>
          <LazyPatientRelationEditorSheet
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
        </Suspense>
      ) : null}

      {documentUploadOpen ? (
        <Suspense fallback={null}>
          <LazyPatientDocumentUploadDialog
            open={documentUploadOpen}
            patientId={patientId}
            orders={orders}
            appointments={appointments}
            dictionary={dictionary}
            l={l}
            lang={lang}
            textareaClassName={textareaClassName}
            statusLabel={patientDetailStatusLabel}
            formatDate={formatDate}
            onOpenChange={onDocumentUploadOpenChange}
            onSaved={onSaved}
            onError={onError}
          />
        </Suspense>
      ) : null}

      {hasFinancialDialogsOpen ? (
        <Suspense fallback={null}>
          <LazyPatientFinancialDialogs
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
        </Suspense>
      ) : null}
    </>
  );
}
