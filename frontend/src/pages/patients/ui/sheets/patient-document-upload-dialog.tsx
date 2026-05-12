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
  lang: string;
  textareaClassName: string;
  statusLabel: (status: string) => string;
  formatDate: (value?: string | null, fallback?: string) => string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onError: (message: string) => void;
};

type Localize = (de: string, ru: string, en: string) => string;
type DocumentUploadFormSetter = Dispatch<SetStateAction<DocumentUploadFormState>>;

function PatientDocumentUploadDialog({
  open,
  patientId,
  orders,
  appointments,
  dictionary,
  lang,
  textareaClassName,
  statusLabel,
  formatDate,
  onOpenChange,
  onSaved,
  onError,
}: PatientDocumentUploadDialogProps) {
  const [form, setForm] = useState<DocumentUploadFormState>(blankDocumentUploadForm);
  const [busy, setBusy] = useState(false);
  const l = (de: string, ru: string, en: string) =>
    lang === "de" ? de : lang === "ru" ? ru : en;

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
      title={l(
        "Patientendokument hochladen",
        "Загрузить документ пациента",
        "Upload patient document",
      )}
      description={l(
        "Hier hochgeladene Dateien werden direkt mit diesem Patienten verknuepft und koennen auch einem Auftrag oder Termin zugeordnet werden.",
        "Загруженные здесь файлы привязываются напрямую к пациенту и также могут быть связаны с заказом или приёмом.",
        "Files uploaded here are linked directly to this patient and can also be attached to an order or appointment.",
      )}
      bodyClassName="px-4 py-4 space-y-3"
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
        {l("Abbrechen", "Отмена", "Cancel")}
      </Button>
      <Button
        type="submit"
        size="sm"
        className="h-8 rounded-lg gap-1.5"
        disabled={busy}
      >
        {busy ? <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
        {l("Dokument hochladen", "Загрузить документ", "Upload document")}
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
    <FormSection title={l("Datei", "Файл", "File")}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("Datei", "Файл", "File")} htmlFor="document-file">
          <Input
            id="document-file"
            type="file"
            className={inputClass}
            onChange={onFileChange}
          />
        </FormField>
        <FormField
          label={l("Anzeigename", "Отображаемое имя", "Display name")}
          htmlFor="document-name"
        >
          <Input
            id="document-name"
            value={form.autoName}
            onChange={(event) =>
              setForm((current) => ({ ...current, autoName: event.target.value }))
            }
            className={inputClass}
            placeholder={l(
              "Optionaler sichtbarer Name fuer den Patienten",
              "Необязательное имя для отображения пациенту",
              "Optional patient-facing name",
            )}
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
      return l("Intern", "Внутреннее", "Internal");
    case "released_internal":
      return l("Intern freigegeben", "Внутренне опубликовано", "Released internal");
    case "released_external":
      return l("Extern freigegeben", "Внешне опубликовано", "Released external");
    case "patient_visible":
      return l("Fuer Patienten sichtbar", "Видно пациенту", "Patient visible");
  }
}

function DocumentDetailsSection({
  form,
  l,
  setForm,
  statusLabel,
}: DocumentDetailsSectionProps) {
  return (
    <FormSection title={l("Dokument", "Документ", "Document")}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("Typ", "Тип", "Type")} htmlFor="document-art">
          <Input
            id="document-art"
            value={form.art}
            onChange={(event) =>
              setForm((current) => ({ ...current, art: event.target.value }))
            }
            className={inputClass}
            placeholder="report"
          />
        </FormField>
        <FormField label={l("Kategorie", "Категория", "Category")} htmlFor="document-category">
          <Input
            id="document-category"
            value={form.category}
            onChange={(event) =>
              setForm((current) => ({ ...current, category: event.target.value }))
            }
            className={inputClass}
            placeholder="medical"
          />
        </FormField>
        <FormField label={l("Status", "Статус", "Status")} htmlFor="document-status">
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
          label={l("Sichtbarkeit", "Видимость", "Visibility")}
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
        {l("Medizinisches Dokument", "Медицинский документ", "Medical document")}
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
    <FormSection title={l("Kontext", "Контекст", "Context")}>
      <div className="grid gap-3 md:grid-cols-2">
        <FormField label={l("Auftrag", "Заказ", "Order")} htmlFor="document-order">
          <NativeComboboxSelect
            id="document-order"
            className={selectClass}
            value={form.orderId}
            onChange={(event) =>
              setForm((current) => ({ ...current, orderId: event.target.value }))
            }
          >
            <option value="">
              {l("Keine Auftragsverknuepfung", "Без привязки к заказу", "No order link")}
            </option>
            {orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.order_number}
              </option>
            ))}
          </NativeComboboxSelect>
        </FormField>
        <FormField label={l("Termin", "Приём", "Appointment")} htmlFor="document-appointment">
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
              {l("Keine Terminverknuepfung", "Без привязки к приёму", "No appointment link")}
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
    <FormSection title={l("Zusatzlich", "Дополнительно", "Additional")}>
      <FormField label={l("Notizen", "Заметки", "Notes")} htmlFor="document-notes">
        <textarea
          id="document-notes"
          className={textareaClassName}
          value={form.notes}
          onChange={(event) =>
            setForm((current) => ({ ...current, notes: event.target.value }))
          }
          placeholder={l(
            "Optionale Verarbeitungs- oder Sichtbarkeitsnotizen",
            "Необязательные заметки по обработке или видимости",
            "Optional processing or visibility notes",
          )}
        />
      </FormField>
    </FormSection>
  );
}

export const MemoizedPatientDocumentUploadDialog = memo(
  PatientDocumentUploadDialog
);
