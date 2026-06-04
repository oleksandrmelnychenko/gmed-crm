import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { generateDocument } from "@/pages/documents/data/document-api";
import {
  DOCUMENT_BINDING_FIELDS,
  buildBindingsPayload,
} from "@/pages/documents/model/document-bindings";
import type {
  DocumentTemplate,
  TemplateCatalogResponse,
} from "@/pages/documents/model/types";

import { PatientSheetScaffold } from "../shared/patient-sheet-scaffold";

const fieldInputClass =
  "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

type PatientDocumentGenerateDialogProps = {
  open: boolean;
  patientId: string | undefined;
  onOpenChange: (open: boolean) => void;
  /** Called after a document is generated (the list also refreshes via realtime). */
  onGenerated?: () => void;
};

export function PatientDocumentGenerateDialog({
  open,
  patientId,
  onOpenChange,
  onGenerated,
}: PatientDocumentGenerateDialogProps) {
  const { lang } = useLang();
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [language, setLanguage] = useState("");
  const [autoName, setAutoName] = useState("");
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Reset the form whenever the sheet is closed.
  useEffect(() => {
    if (!open) {
      setTemplateId("");
      setLanguage("");
      setAutoName("");
      setBindings({});
    }
  }, [open]);

  // Load the template catalog on first open.
  useEffect(() => {
    if (!open || templatesLoaded) return;
    let active = true;
    apiFetch<TemplateCatalogResponse>("/documents/templates")
      .then((res) => {
        if (!active) return;
        setTemplates(res.templates ?? []);
        setTemplatesLoaded(true);
      })
      .catch(() => {
        if (active) setTemplatesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [open, templatesLoaded]);

  const selectedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const bindingFields = selectedTemplate ? DOCUMENT_BINDING_FIELDS[selectedTemplate.id] ?? [] : [];

  function selectTemplate(id: string) {
    setTemplateId(id);
    const template = templates.find((t) => t.id === id);
    setLanguage(template?.supported_languages?.[0] ?? "de");
    setAutoName(template?.default_auto_name ?? "");
    setBindings({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate || !patientId || busy) return;
    setBusy(true);
    try {
      const response = await generateDocument({
        template_id: selectedTemplate.id,
        patient_id: patientId,
        language: language || null,
        status: selectedTemplate.default_status,
        visibility: selectedTemplate.default_visibility,
        auto_name: autoName.trim() || null,
        bindings: buildBindingsPayload(selectedTemplate.id, bindings),
        text_block_keys: [],
      });
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
          <Button type="submit" className="h-9 rounded-lg" disabled={busy || !selectedTemplate}>
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
          value={templateId}
          className={fieldInputClass}
          onChange={(e) => selectTemplate(e.target.value)}
        >
          <option value="">
            {templatesLoaded ? tx("Выберите шаблон", "Vorlage wählen") : tx("Загрузка…", "Laden…")}
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.provider_name ? `${template.label} · ${template.provider_name}` : template.label}
            </option>
          ))}
        </NativeComboboxSelect>
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
                value={language}
                className={fieldInputClass}
                onChange={(e) => setLanguage(e.target.value)}
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
                value={autoName}
                onChange={(e) => setAutoName(e.target.value)}
                className={fieldInputClass}
                placeholder={selectedTemplate.default_auto_name}
              />
            </label>
          </div>

          {bindingFields.length > 0 ? (
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {tx("Поля шаблона", "Vorlagenfelder")}
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {bindingFields.map((field) => (
                  <label key={field.key} className="block">
                    <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                      {field.label}
                    </span>
                    {field.kind === "textarea" ? (
                      <textarea
                        value={bindings[field.key] ?? ""}
                        onChange={(e) =>
                          setBindings((current) => ({ ...current, [field.key]: e.target.value }))
                        }
                        className={cn(fieldInputClass, "h-20 py-2")}
                      />
                    ) : (
                      <Input
                        type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
                        value={bindings[field.key] ?? ""}
                        onChange={(e) =>
                          setBindings((current) => ({ ...current, [field.key]: e.target.value }))
                        }
                        className={fieldInputClass}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </PatientSheetScaffold>
  );
}
