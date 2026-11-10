import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";

import { selectClass } from "@/components/ui-shell";
import { Button } from "@/components/ui/button";
import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { ApiRequestError, apiFetch, isLocalizedApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Lang } from "@/lib/i18n";
import { generateDocument } from "@/pages/documents/data/document-api";
import type { TemplateCatalogResponse } from "@/pages/documents/model/types";

/**
 * A document for a lead from one of the agency's imported templates (owner
 * request 2026-11-11): the templates saved under «Документы → Импорт
 * шаблона» are offered in the lead's documents too, filled with the lead's
 * data. Shown only to the roles that generate documents and only when at
 * least one imported template is active.
 */

// The server lets the CEO and the patient manager generate (`generate_document`).
const GENERATING_ROLES = ["ceo", "patient_manager"];

type ImportedTemplateOption = { id: string; label: string; language: string };

export function LeadTemplateDocument({
  leadId,
  lang,
  disabled = false,
  onGenerated,
}: {
  leadId: string;
  lang: Lang;
  disabled?: boolean;
  /** The id of the created document; the caller reloads the lead's list. */
  onGenerated: (documentId: string) => void;
}) {
  const { user } = useAuth();
  const allowed = GENERATING_ROLES.includes(user?.role ?? "");
  const tx = (ru: string, de: string) => (lang === "de" ? de : ru);

  const [templates, setTemplates] = useState<ImportedTemplateOption[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    apiFetch<TemplateCatalogResponse>("/documents/templates")
      .then((response) => {
        if (!active) return;
        const imported = response.templates
          .filter((template) => template.template_kind === "agency")
          .map((template) => ({
            id: template.id,
            label: template.label,
            language: template.supported_languages[0] ?? "de",
          }));
        setTemplates(imported);
        setTemplateId((current) =>
          imported.some((template) => template.id === current) ? current : (imported[0]?.id ?? ""),
        );
      })
      // Without the catalog the block simply is not offered.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [allowed]);

  if (!allowed || templates.length === 0) return null;

  async function handleGenerate() {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setBusy(true);
    setError("");
    try {
      const generated = await generateDocument({
        template_id: template.id,
        lead_id: leadId,
        language: template.language,
        document_language: template.language,
        document_direction: "outgoing",
        document_variant: "original",
        status: "active",
      });
      if (generated.id) onGenerated(generated.id);
    } catch (cause) {
      const fallback = tx("Не удалось создать документ.", "Das Dokument konnte nicht erstellt werden.");
      setError(
        isLocalizedApiError(cause) || (cause instanceof ApiRequestError && cause.body?.message?.trim())
          ? (cause as Error).message || fallback
          : fallback,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-w-0 space-y-2 rounded-xl border border-border/50 bg-card p-3"
      data-testid="lead-template-document"
    >
      <p className="text-sm font-medium">
        {tx("Документ из шаблона", "Dokument aus Vorlage")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeComboboxSelect
          aria-label={tx("Шаблон документа", "Dokumentvorlage")}
          value={templateId}
          onChange={(event) => setTemplateId(event.target.value)}
          disabled={busy || disabled}
          className={`${selectClass} min-w-0 flex-1 basis-56`}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.label}
            </option>
          ))}
        </NativeComboboxSelect>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleGenerate()}
          disabled={busy || disabled || !templateId}
        >
          {busy ? <LoaderCircle className="animate-spin" /> : <FileText />}
          {tx("Создать документ", "Dokument erstellen")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
