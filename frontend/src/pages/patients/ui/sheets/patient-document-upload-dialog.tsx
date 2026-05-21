import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import {
  Field as FormField,
  Section as FormSection,
  checkboxClass,
  inputClass,
  selectClass,
} from "@/components/ui-shell";

import { uploadPatientDocument } from "../../data/patient-detail-mutations";
import type {
  AppointmentItem,
  DocumentStatus,
  DocumentVisibility,
  OrderItem,
} from "../../model/detail-tab-types";
import {
  blankDocumentUploadForm,
  type DocumentUploadFormState,
} from "../../model/sheet-forms";
import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const DOCUMENT_STATUS_OPTIONS: DocumentStatus[] = ["draft", "active", "archived"];
const DOCUMENT_VISIBILITY_OPTIONS: DocumentVisibility[] = [
  "internal",
  "released_internal",
  "released_external",
  "patient_visible",
];

type PatientDocumentUploadDialogProps = {
  open: boolean;
  patientId: string | undefined;
  orders: OrderItem[];
  appointments: AppointmentItem[];
  dictionary: Record<string, string>;
  l: Localize;
  lang: string;
  textareaClassName: string;
  statusLabel: (status: string) => string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

type Localize = (key: string) => string;
type DocumentUploadFormSetter = Dispatch<SetStateAction<DocumentUploadFormState>>;

function PatientDocumentUploadDialog({
  open,
  patientId,
  orders,
  appointments,
  dictionary,
  l,
  textareaClassName,
  statusLabel,
  formatDate,
  onOpenChange,
  onSaved,
  onError,
}: PatientDocumentUploadDialogProps) {
  const [form, setForm] = useState<DocumentUploadFormState>(blankDocumentUploadForm);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setForm(blankDocumentUploadForm());
      setBusy(false);
    }
  }, [open]);

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    setForm((current) => ({
      ...current,
      file: event.target.files?.[0] ?? null,
    }));
  }

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!patientId || !form.file || !form.art.trim()) {
        onError(dictionary.common_failed_create);
        return;
      }

      setBusy(true);
      onError("");
      try {
        const formData = new FormData();
        formData.append("file", form.file);
        formData.append("patient_id", patientId);
        if (form.orderId) formData.append("order_id", form.orderId);
        if (form.appointmentId) formData.append("appointment_id", form.appointmentId);
        if (form.autoName.trim()) formData.append("auto_name", form.autoName.trim());
        formData.append("art", form.art.trim());
        if (form.category.trim()) formData.append("category", form.category.trim());
        formData.append("status", form.status);
        formData.append("visibility", form.visibility);
        if (form.isMedical) formData.append("is_medical", "true");
        if (form.notes.trim()) formData.append("notes", form.notes.trim());
        await uploadPatientDocument(formData);
        toast.success(dictionary.common_active);
        onOpenChange(false);
        onSaved();
      } catch (error) {
        onError(
          error instanceof Error ? error.message : dictionary.common_failed_create
        );
      } finally {
        setBusy(false);
      }
    },
    [
      dictionary.common_active,
      dictionary.common_failed_create,
      form,
      onError,
      onOpenChange,
      onSaved,
      patientId,
    ]
  );

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="form-heavy"
      onSubmit={handleSubmit}
      title={l("patients_upload_patient_document")}
      description={l("patients_files_uploaded_here_are_linked_directly_to_this_patient")}
      bodyClassName="space-y-4 px-5 py-4"
      footer={
        <DocumentUploadFooter
          busy={busy}
          l={l}
          onCancel={() => onOpenChange(false)}
        />
      }
    >
      <DocumentFileSection form={form} l={l} onFileChange={handleFileChange} setForm={setForm} />
      <DocumentDetailsSection
        form={form}
        l={l}
        setForm={setForm}
        statusLabel={statusLabel}
      />
      <DocumentContextSection
        appointments={appointments}
        form={form}
        formatDate={formatDate}
        l={l}
        orders={orders}
        setForm={setForm}
      />
      <DocumentAdditionalSection
        form={form}
        l={l}
        setForm={setForm}
        textareaClassName={textareaClassName}
      />
    </PatientSheetScaffold>
  );
}

type DocumentUploadFooterProps = {
  busy: boolean;
  l: Localize;
  onCancel: () => void;
};

function DocumentUploadFooter({ busy, l, onCancel }: DocumentUploadFooterProps) {
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 rounded-lg"
        onClick={onCancel}
      >
        {l("patients_cancel")}
      </Button>
      <Button
        type="submit"
        size="sm"
        className="h-8 rounded-lg gap-1.5"
        disabled={busy}
      >
        {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
        {l("patients_upload_document")}
      </Button>
    </>
  );
}

type DocumentFileSectionProps = {
  form: DocumentUploadFormState;
  l: Localize;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  setForm: DocumentUploadFormSetter;
};

function DocumentFileSection({
  form,
  l,
  onFileChange,
  setForm,
}: DocumentFileSectionProps) {
  return (
    <FormSection title={l("patients_file")}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("patients_file")} htmlFor="document-file">
          <Input
            id="document-file"
            type="file"
            className={inputClass}
            onChange={onFileChange}
          />
        </FormField>
        <FormField
          label={l("patients_display_name")}
          htmlFor="document-name"
        >
          <Input
            id="document-name"
            value={form.autoName}
            onChange={(event) =>
              setForm((current) => ({ ...current, autoName: event.target.value }))
            }
            className={inputClass}
            placeholder={l("patients_optional_patient_facing_name")}
          />
        </FormField>
      </div>
    </FormSection>
  );
}

type DocumentDetailsSectionProps = {
  form: DocumentUploadFormState;
  l: Localize;
  setForm: DocumentUploadFormSetter;
  statusLabel: (status: string) => string;
};

function documentVisibilityLabel(
  visibility: DocumentVisibility,
  l: Localize,
): string {
  switch (visibility) {
    case "internal":
      return l("patients_internal_2");
    case "released_internal":
      return l("patients_released_internal");
    case "released_external":
      return l("patients_released_external");
    case "patient_visible":
      return l("patients_patient_visible");
  }
}

function DocumentDetailsSection({
  form,
  l,
  setForm,
  statusLabel,
}: DocumentDetailsSectionProps) {
  return (
    <FormSection title={l("patients_document")}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("patients_type")} htmlFor="document-art">
          <Input
            id="document-art"
            value={form.art}
            onChange={(event) =>
              setForm((current) => ({ ...current, art: event.target.value }))
            }
            className={inputClass}
            placeholder={l("patients_document_art_placeholder")}
          />
        </FormField>
        <FormField label={l("patients_category")} htmlFor="document-category">
          <Input
            id="document-category"
            value={form.category}
            onChange={(event) =>
              setForm((current) => ({ ...current, category: event.target.value }))
            }
            className={inputClass}
            placeholder={l("patients_document_category_placeholder")}
          />
        </FormField>
        <FormField label={l("patients_status")} htmlFor="document-status">
          <NativeComboboxSelect
            id="document-status"
            className={selectClass}
            value={form.status}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                status: event.target.value as DocumentStatus,
              }))
            }
          >
            {DOCUMENT_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
        <FormField
          label={l("patients_visibility")}
          htmlFor="document-visibility"
        >
          <NativeComboboxSelect
            id="document-visibility"
            className={selectClass}
            value={form.visibility}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                visibility: event.target.value as DocumentVisibility,
              }))
            }
          >
            {DOCUMENT_VISIBILITY_OPTIONS.map((visibility) => (
              <option key={visibility} value={visibility}>
                {documentVisibilityLabel(visibility, l)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
      </div>

      <label className="flex min-h-9 items-center gap-3 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground">
        <input
          type="checkbox"
          className={checkboxClass}
          checked={form.isMedical}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              isMedical: event.target.checked,
            }))
          }
        />
        {l("patients_medical_document")}
      </label>
    </FormSection>
  );
}

type DocumentContextSectionProps = {
  appointments: AppointmentItem[];
  form: DocumentUploadFormState;
  formatDate: PatientDocumentUploadDialogProps["formatDate"];
  l: Localize;
  orders: OrderItem[];
  setForm: DocumentUploadFormSetter;
};

function DocumentContextSection({
  appointments,
  form,
  formatDate,
  l,
  orders,
  setForm,
}: DocumentContextSectionProps) {
  return (
    <FormSection title={l("patients_context")}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("patients_order")} htmlFor="document-order">
          <NativeComboboxSelect
            id="document-order"
            className={selectClass}
            value={form.orderId}
            onChange={(event) =>
              setForm((current) => ({ ...current, orderId: event.target.value }))
            }
          >
            <option value="">
              {l("patients_no_order_link")}
            </option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.order_number}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
        <FormField label={l("patients_appointment")} htmlFor="document-appointment">
          <NativeComboboxSelect
            id="document-appointment"
            className={selectClass}
            value={form.appointmentId}
            onChange={(event) =>
              setForm((current) => ({
                ...current,
                appointmentId: event.target.value,
              }))
            }
          >
            <option value="">
              {l("patients_no_appointment_link")}
            </option>
            {appointments.map((appointment) => (
              <option key={appointment.id} value={appointment.id}>
                {appointment.title} · {formatDate(appointment.date)}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
      </div>
    </FormSection>
  );
}

type DocumentAdditionalSectionProps = {
  form: DocumentUploadFormState;
  l: Localize;
  setForm: DocumentUploadFormSetter;
  textareaClassName: string;
};

function DocumentAdditionalSection({
  form,
  l,
  setForm,
  textareaClassName,
}: DocumentAdditionalSectionProps) {
  return (
    <FormSection title={l("patients_additional")}>
      <FormField label={l("appointments_notes")} htmlFor="document-notes">
        <textarea
          id="document-notes"
          className={textareaClassName}
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder={l("patients_optional_processing_or_visibility_notes")}
        />
      </FormField>
    </FormSection>
  );
}

export const MemoizedPatientDocumentUploadDialog = memo(
  PatientDocumentUploadDialog
);
