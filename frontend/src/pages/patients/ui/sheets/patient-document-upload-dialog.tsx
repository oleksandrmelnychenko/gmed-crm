import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import {
  memo,
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";

import { Button } from "@/components/ui/button";
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
import { toast } from "@/components/ui/toast";
import { checkboxClass, selectClass } from "@/components/ui-shell";

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {l(
              "Patientendokument hochladen",
              "Загрузить документ пациента",
              "Upload patient document"
            )}
          </DialogTitle>
          <DialogDescription>
            {l(
              "Hier hochgeladene Dateien werden direkt mit diesem Patienten verknüpft und können auch einem Auftrag oder Termin zugeordnet werden.",
              "Загруженные здесь файлы привязываются напрямую к пациенту и также могут быть связаны с заказом или приёмом.",
              "Files uploaded here are linked directly to this patient and can also be attached to an order or appointment."
            )}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="document-file">{l("Datei", "Файл", "File")}</Label>
              <Input id="document-file" type="file" onChange={handleFileChange} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-name">
                {l("Anzeigename", "Отображаемое имя", "Display name")}
              </Label>
              <Input
                id="document-name"
                value={form.autoName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, autoName: event.target.value }))
                }
                placeholder={l(
                  "Optionaler sichtbarer Name für den Patienten",
                  "Необязательное имя для отображения пациенту",
                  "Optional patient-facing name"
                )}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-art">{l("Typ", "Тип", "Type")}</Label>
              <Input
                id="document-art"
                value={form.art}
                onChange={(event) =>
                  setForm((current) => ({ ...current, art: event.target.value }))
                }
                placeholder="report"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-category">{l("Kategorie", "Категория", "Category")}</Label>
              <Input
                id="document-category"
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({ ...current, category: event.target.value }))
                }
                placeholder="medical"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-status">{l("Status", "Статус", "Status")}</Label>
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
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-visibility">
                {l("Sichtbarkeit", "Видимость", "Visibility")}
              </Label>
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
                    {visibility === "internal"
                      ? l("Intern", "Внутреннее", "Internal")
                      : visibility === "released_internal"
                        ? l("Intern freigegeben", "Внутренне опубликовано", "Released internal")
                        : visibility === "released_external"
                          ? l("Extern freigegeben", "Внешне опубликовано", "Released external")
                          : l("Für Patienten sichtbar", "Видно пациенту", "Patient visible")}
                  </option>
                ))}
              </NativeComboboxSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-order">{l("Auftrag", "Заказ", "Order")}</Label>
              <NativeComboboxSelect
                id="document-order"
                className={selectClass}
                value={form.orderId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, orderId: event.target.value }))
                }
              >
                <option value="">
                  {l("Keine Auftragsverknüpfung", "Без привязки к заказу", "No order link")}
                </option>
                {orders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.order_number}
                  </option>
                ))}
              </NativeComboboxSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="document-appointment">{l("Termin", "Приём", "Appointment")}</Label>
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
                  {l("Keine Terminverknüpfung", "Без привязки к приёму", "No appointment link")}
                </option>
                {appointments.map((appointment) => (
                  <option key={appointment.id} value={appointment.id}>
                    {appointment.title} · {formatDate(appointment.date)}
                  </option>
                ))}
              </NativeComboboxSelect>
            </div>
            <label className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/25 px-3 py-2 text-sm text-foreground">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="document-notes">{l("Notizen", "Заметки", "Notes")}</Label>
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
                "Optional processing or visibility notes"
              )}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="rounded-xl"
              onClick={() => onOpenChange(false)}
            >
              {l("Abbrechen", "Отмена", "Cancel")}
            </Button>
            <Button
              type="submit"
              className="rounded-xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={busy}
            >
              {busy ? <span className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
              {l("Dokument hochladen", "Загрузить документ", "Upload document")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const MemoizedPatientDocumentUploadDialog = memo(
  PatientDocumentUploadDialog
);
