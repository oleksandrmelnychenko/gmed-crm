import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { CountrySelect } from "@/components/ui/country-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { generateDocument } from "@/pages/documents/data/document-api";
import {
  DOCUMENT_BINDING_FIELDS,
  documentBindingFieldLabel,
  isFixedLegalDocumentTemplate,
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
  GenerateFormState,
  PatientOption,
  TemplateCatalogResponse,
} from "@/pages/documents/model/types";

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

  const selectedTemplate = templates.find((t) => t.id === form.templateId) ?? null;
  const bindingFields = selectedTemplate ? DOCUMENT_BINDING_FIELDS[selectedTemplate.id] ?? [] : [];
  const fixedLegalTemplate = Boolean(
    selectedTemplate && isFixedLegalDocumentTemplate(selectedTemplate.id),
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
          <Button type="submit" className="h-9 rounded-lg" disabled={busy || !selectedTemplate || !patientId}>
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

          {bindingFields.length > 0 ? (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {selectedTemplate.id === "privacy_consents"
                  ? tx("Согласия и подпись", "Einwilligungen und Unterschrift")
                  : selectedTemplate.id === "confidentiality_release"
                    ? tx("Подпись", "Unterschrift")
                    : tx("Поля шаблона", "Vorlagenfelder")}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {bindingFields.map((field) => (
                  <label
                    key={field.key}
                    className={cn(
                      "block",
                      field.kind === "boolean" &&
                        "flex min-h-11 items-start gap-3 rounded-lg border border-border/70 px-3 py-2.5 md:col-span-2",
                    )}
                  >
                    {field.kind === "boolean" ? (
                      <>
                        <input
                          type="checkbox"
                          checked={form.bindings[field.key] === "true"}
                          onChange={(e) =>
                            setForm((current) => ({
                              ...current,
                              manualText: "",
                              manualTextDirty: false,
                              bindings: {
                                ...current.bindings,
                                [field.key]: String(e.target.checked),
                              },
                            }))
                          }
                          className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                        />
                        <span className="min-w-0 text-sm leading-5 text-foreground">
                          {documentBindingFieldLabel(field, lang)}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                          {documentBindingFieldLabel(field, lang)}
                        </span>
                        {field.kind === "country" ? (
                          <CountrySelect
                            value={form.bindings[field.key] ?? null}
                            onChange={(value) =>
                              setForm((current) => ({
                                ...current,
                                manualText: "",
                                manualTextDirty: false,
                                bindings: {
                                  ...current.bindings,
                                  [field.key]: value ?? "",
                                },
                              }))
                            }
                            lang="de"
                            className={fieldInputClass}
                            aria-label={documentBindingFieldLabel(field, lang)}
                          />
                        ) : field.kind === "textarea" ? (
                          <textarea
                            value={form.bindings[field.key] ?? ""}
                            onChange={(e) =>
                              setForm((current) => ({
                                ...current,
                                manualText: "",
                                manualTextDirty: false,
                                bindings: {
                                  ...current.bindings,
                                  [field.key]: e.target.value,
                                },
                              }))
                            }
                            className={cn(fieldInputClass, "h-20 py-2")}
                          />
                        ) : (
                          <Input
                            type={
                              field.kind === "date"
                                ? "date"
                                : field.kind === "number"
                                  ? "number"
                                  : "text"
                            }
                            value={form.bindings[field.key] ?? ""}
                            onChange={(e) =>
                              setForm((current) => ({
                                ...current,
                                manualText: "",
                                manualTextDirty: false,
                                bindings: {
                                  ...current.bindings,
                                  [field.key]: e.target.value,
                                },
                              }))
                            }
                            className={fieldInputClass}
                          />
                        )}
                      </>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {!fixedLegalTemplate ? (
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
