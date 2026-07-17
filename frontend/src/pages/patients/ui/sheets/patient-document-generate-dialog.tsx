import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  fetchPatientDocumentContext,
  generateDocument,
  type PatientDocumentProfile,
} from "@/pages/documents/data/document-api";
import {
  DOCUMENT_BINDING_FIELDS,
  isDesignedAgencyDocumentTemplate,
  patientPartyBindingDefaults,
} from "@/pages/documents/model/document-bindings";
import {
  buildGeneratedDocumentManualTextDraft,
  buildGenerateDocumentAutoName,
  buildGenerateDocumentPayload,
  emptyGenerateForm,
  patientDocumentAddresseeLabel,
  patientOptionLabel,
  resolveGeneratedDocumentAccessCategory,
  resolveTemplateLanguage,
} from "@/pages/documents/model/document-model";
import type {
  DocumentTemplate,
  FrameworkContractOption,
  GenerateFormState,
  OrderOption,
  AppointmentOption,
  PatientOption,
  TemplateCatalogResponse,
} from "@/pages/documents/model/types";
import { DocumentTemplateBindingFields } from "@/pages/documents/ui/document-template-binding-fields";

import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const fieldInputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

type PatientDocumentGenerateDialogProps = {
  open: boolean;
  patientId: string | undefined;
  patient?: PatientOption;
  onOpenChange: (open: boolean) => void;
  /** Called after a document is generated (the list also refreshes via realtime). */
  onGenerated?: () => void;
};

export function PatientDocumentGenerateDialog({
  open,
  patientId,
  patient,
  onOpenChange,
  onGenerated,
}: PatientDocumentGenerateDialogProps) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templatesError, setTemplatesError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState<GenerateFormState>(() =>
    emptyGenerateForm(patientId ?? ""),
  );
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [appointments, setAppointments] = useState<AppointmentOption[]>([]);
  const [frameworkContracts, setFrameworkContracts] = useState<
    FrameworkContractOption[] | null
  >(null);
  const [patientProfile, setPatientProfile] =
    useState<PatientDocumentProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const patientOptions = useMemo(
    () => (patient && patient.id === patientId ? [patient] : []),
    [patient, patientId],
  );

  // Reset the form whenever the sheet is closed.
  useEffect(() => {
    if (!open) {
      setForm(emptyGenerateForm(patientId ?? ""));
    }
  }, [open, patientId]);

  // Load the template catalog on first open. On failure we surface the error and
  // leave `templatesLoaded` false so reopening (or the retry link) tries again —
  // a transient failure must not strand the dialog with a permanently empty list.
  useEffect(() => {
    if (!open || templatesLoaded) return;
    let active = true;
    setTemplatesError(false);
    apiFetch<TemplateCatalogResponse>("/documents/templates")
      .then((res) => {
        if (!active) return;
        setTemplates(res.templates ?? []);
        setTemplatesLoaded(true);
      })
      .catch(() => {
        if (!active) return;
        setTemplatesError(true);
        toast.error(
          lang === "de"
            ? "Vorlagen konnten nicht geladen werden"
            : "Не удалось загрузить шаблоны",
        );
      });
    return () => {
      active = false;
    };
  }, [open, templatesLoaded, reloadKey, lang]);

  useEffect(() => {
    if (!open || !patientId) {
      setOrders([]);
      setAppointments([]);
      setFrameworkContracts(null);
      setPatientProfile(null);
      return;
    }
    let active = true;
    void fetchPatientDocumentContext(patientId).then((context) => {
      if (!active) return;
      setOrders(context.orders);
      setAppointments(context.appointments);
      setFrameworkContracts(context.frameworkContracts);
      setPatientProfile(context.profile);
      setForm((current) => ({
        ...current,
        bindings: {
          ...patientPartyBindingDefaults(context.profile),
          ...current.bindings,
        },
      }));
    });
    return () => {
      active = false;
    };
  }, [open, patientId]);

  const selectedTemplate = templates.find((t) => t.id === form.templateId) ?? null;
  const bindingFields = selectedTemplate ? DOCUMENT_BINDING_FIELDS[selectedTemplate.id] ?? [] : [];
  const designedAgencyTemplate = Boolean(
    selectedTemplate &&
      isDesignedAgencyDocumentTemplate(selectedTemplate.id),
  );
  const selectedTemplateIsCompliance = Boolean(
    selectedTemplate &&
      [
        "confidentiality_release",
        "privacy_information",
        "privacy_consents",
      ].includes(selectedTemplate.id),
  );
  const frameworkContractMissing = Boolean(
    selectedTemplate?.id === "framework_contract" &&
      frameworkContracts !== null &&
      frameworkContracts.length === 0,
  );
  const patientLabel = patientOptions[0] ? patientOptionLabel(patientOptions[0]) : "";
  const patientAddressee = patientDocumentAddresseeLabel(
    patientId ?? "",
    patientOptions,
  );
  const generatedManualTextDraft = selectedTemplate
    ? buildGeneratedDocumentManualTextDraft({
        template: selectedTemplate,
        form,
        patientLabel,
        patientAddressee,
        availableTemplateBlocks: [],
        lang,
        labels: {
          documentDate: tx("Дата документа", "Dokumentdatum"),
          sourceInstitution: tx("Источник: учреждение", "Quelle: Institution"),
          addresseePerson: tx("Адресат: персона", "Adressat: Person"),
          ordersPatient: tx("Пациент", "Patient"),
          ordersTitle: tx("Заказ", "Auftrag"),
          appointmentsTitle: tx("Термин", "Termin"),
          sectionBindings: tx("Поля шаблона", "Vorlagenfelder"),
          textBlocks: tx("Текстовые блоки", "Textbausteine"),
        },
      })
    : "";
  const displayedGeneratedManualText = form.manualTextDirty
    ? form.manualText
    : generatedManualTextDraft;

  function selectTemplate(id: string) {
    const template = templates.find((t) => t.id === id);
    const nextForm = emptyGenerateForm(patientId ?? "");
    if (!template) {
      setForm({ ...nextForm, templateId: id });
      return;
    }
    const nextLanguage = resolveTemplateLanguage(
      patientId ?? "",
      template,
      patientOptions,
    );
    const patientAddressee = patientDocumentAddresseeLabel(
      patientId ?? "",
      patientOptions,
    );
    const formWithTemplate: GenerateFormState = {
      ...nextForm,
      templateId: template.id,
      autoName: template.default_auto_name,
      status: template.default_status,
      visibility: template.default_visibility,
      language: nextLanguage,
      documentLanguage: nextLanguage,
      accessCategory: resolveGeneratedDocumentAccessCategory(
        template,
        nextForm.accessCategory,
      ),
      addresseePerson: patientAddressee,
      bindings: patientPartyBindingDefaults(patientProfile),
    };
    setForm({
      ...formWithTemplate,
      autoName:
        buildGenerateDocumentAutoName({
          template,
          form: formWithTemplate,
          patients: patientOptions,
        }) || template.default_auto_name,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !patientId || busy) return;
    setBusy(true);
    try {
      const response = await generateDocument(
        buildGenerateDocumentPayload({
          template: selectedTemplate,
          form,
          patients: patientOptions,
          displayedManualText: displayedGeneratedManualText,
        }),
      );
      toast.success(
        tx(
          `Документ создан: ${response.auto_name}`,
          `Dokument erstellt: ${response.auto_name}`,
        ),
      );
      onGenerated?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : tx("Не удалось сгенерировать документ", "Dokument konnte nicht erstellt werden"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <PatientSheetScaffold
      open={open}
      onOpenChange={onOpenChange}
      width="form-heavy"
      onSubmit={handleSubmit}
      title={tx("Сгенерировать из шаблона", "Aus Vorlage erstellen")}
      description={tx(
        "Документ создаётся для этого пациента и появится в списке.",
        "Das Dokument wird für diesen Patienten erstellt und erscheint in der Liste.",
      )}
      bodyClassName="space-y-4 px-5 py-4"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-9 rounded-lg" onClick={() => onOpenChange(false)}>
            {tx("Отмена", "Abbrechen")}
          </Button>
          <Button
            type="submit"
            className="h-9 rounded-lg"
            disabled={
              busy ||
              !selectedTemplate ||
              !patientId ||
              frameworkContractMissing
            }
          >
            {busy ? tx("Создаётся…", "Wird erstellt…") : tx("Сгенерировать", "Erstellen")}
          </Button>
        </div>
      }
    >
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
          {tx("Шаблон", "Vorlage")}
        </span>
        <NativeComboboxSelect
          value={form.templateId}
          className={fieldInputClass}
          onChange={(e) => selectTemplate(e.target.value)}
        >
          <option value="">
            {templatesError
              ? tx("Ошибка загрузки", "Ladefehler")
              : templatesLoaded
                ? tx("Выберите шаблон", "Vorlage wählen")
                : tx("Загрузка…", "Laden…")}
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.provider_name ? `${template.label} · ${template.provider_name}` : template.label}
            </option>
          ))}
        </NativeComboboxSelect>
        {templatesError ? (
          <p className="mt-1 text-[11px] text-destructive">
            {tx("Не удалось загрузить шаблоны.", "Vorlagen konnten nicht geladen werden.")}{" "}
            <button
              type="button"
              className="font-medium underline underline-offset-2"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {tx("Повторить", "Erneut versuchen")}
            </button>
          </p>
        ) : null}
      </label>

      {selectedTemplate ? (
        <>
          {selectedTemplate.description ? (
            <p className="text-xs text-muted-foreground">{selectedTemplate.description}</p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {tx("Язык", "Sprache")}
              </span>
              <NativeComboboxSelect
                value={form.language}
                className={fieldInputClass}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    language: e.target.value,
                    documentLanguage: e.target.value,
                    manualText: "",
                    manualTextDirty: false,
                  }))
                }
              >
                {(selectedTemplate.supported_languages.length > 0
                  ? selectedTemplate.supported_languages
                  : ["de"]
                ).map((code) => (
                  <option key={code} value={code}>
                    {code.toUpperCase()}
                  </option>
                ))}
              </NativeComboboxSelect>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                {tx("Название файла", "Dateiname")}
              </span>
              <Input
                value={form.autoName}
                onChange={(e) =>
                  setForm((current) => ({ ...current, autoName: e.target.value }))
                }
                className={fieldInputClass}
                placeholder={selectedTemplate.default_auto_name}
              />
            </label>
          </div>

          {!selectedTemplateIsCompliance ? (
            <div className="grid gap-3 border-y border-border py-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {tx("Заказ", "Auftrag")}
                </span>
                <NativeComboboxSelect
                  value={form.orderId}
                  className={fieldInputClass}
                  onChange={(event) => {
                    const orderId = event.target.value;
                    setForm((current) => ({
                      ...current,
                      orderId,
                      bindings: orderId
                        ? {
                            ...current.bindings,
                            service_lines_text: "",
                            estimate_total: "",
                          }
                        : current.bindings,
                    }));
                  }}
                >
                  <option value="">
                    {tx("Без привязки к заказу", "Ohne Auftragsbezug")}
                  </option>
                  {orders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.order_number}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {tx("Термин", "Termin")}
                </span>
                <NativeComboboxSelect
                  value={form.appointmentId}
                  className={fieldInputClass}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      appointmentId: event.target.value,
                    }))
                  }
                >
                  <option value="">
                    {tx("Без привязки к термину", "Ohne Terminbezug")}
                  </option>
                  {appointments.map((appointment) => (
                    <option key={appointment.id} value={appointment.id}>
                      {appointment.title} · {appointment.date}
                    </option>
                  ))}
                </NativeComboboxSelect>
              </label>
              {frameworkContractMissing ? (
                <p className="text-xs text-destructive md:col-span-2">
                  {tx(
                    "Сначала создайте рамочный договор для пациента.",
                    "Erstellen Sie zuerst einen Rahmenvertrag für den Patienten.",
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          {bindingFields.length > 0 ? (
            <div className="rounded-lg border border-border/60 p-4">
              <DocumentTemplateBindingFields
                fields={bindingFields}
                bindings={form.bindings}
                lang={lang}
                templateId={selectedTemplate.id}
                useOrderServices={Boolean(
                  form.orderId &&
                    ["single_order", "cost_estimate"].includes(
                      selectedTemplate.id,
                    ),
                )}
                onChange={(key, value) =>
                  setForm((current) => ({
                    ...current,
                    manualText: "",
                    manualTextDirty: false,
                    bindings: {
                      ...current.bindings,
                      [key]: value,
                    },
                  }))
                }
              />
            </div>
          ) : null}

          {!designedAgencyTemplate ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-muted-foreground">
                  {tx("Финальный текст PDF", "Finaler PDF-Text")}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg"
                  disabled={!form.manualTextDirty}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      manualText: "",
                      manualTextDirty: false,
                    }))
                  }
                >
                  {tx("Вернуть текст шаблона", "Vorlagentext wiederherstellen")}
                </Button>
              </div>
              <textarea
                value={displayedGeneratedManualText}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    manualText: e.target.value,
                    manualTextDirty: true,
                  }))
                }
                className={cn(
                  fieldInputClass,
                  "min-h-[220px] py-2 leading-relaxed",
                )}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {tx(
                  "Если изменить текст, PDF будет создан именно из этой версии.",
                  "Wenn der Text bearbeitet wird, entsteht das PDF genau aus dieser Version.",
                )}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </PatientSheetScaffold>
  );
}
