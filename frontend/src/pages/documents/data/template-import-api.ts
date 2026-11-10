import { apiFetch, apiFetchFile } from "@/lib/api";

/**
 * Imported agency document templates (owner request 2026-11-10): a Word or
 * text file becomes a draft, its variables are checked, and an activated
 * version is offered in "generate from template".
 */
export type ImportedTemplateStatus = "draft" | "active" | "disabled";

export type ImportedTemplate = {
  id: string;
  /** The id "generate from template" uses: `agency_template:<id>`. */
  public_id: string;
  family_id: string;
  version_number: number;
  label: string;
  description: string | null;
  language: string;
  status: ImportedTemplateStatus;
  source_filename: string | null;
  created_at: string | null;
  activated_at: string | null;
  disabled_at: string | null;
  created_by_name: string | null;
  activated_by_name: string | null;
  body: string;
  /** The text with sample data in place of the variables. */
  preview_text: string;
  used_variables: string[];
  /** `{{...}}` the server does not know, as written. */
  unknown_variables: string[];
  /** A `{{` without its `}}`. */
  unclosed_variable: boolean;
  can_activate: boolean;
};

export type ImportedTemplateVariable = { key: string; sample: string };

export type ImportedTemplatesResponse = {
  templates: ImportedTemplate[];
  variables: ImportedTemplateVariable[];
  max_file_bytes: number;
  max_body_chars: number;
};

const BASE = "/documents/template-imports";

export function fetchImportedTemplates() {
  return apiFetch<ImportedTemplatesResponse>(BASE, { cache: "no-store" });
}

export function importTemplateFile(input: {
  file: File;
  label: string;
  description: string;
  language: string;
  familyId?: string | null;
}) {
  const formData = new FormData();
  formData.append("label", input.label.trim());
  formData.append("description", input.description.trim());
  formData.append("language", input.language);
  if (input.familyId) formData.append("family_id", input.familyId);
  // The file goes last: the server reads the text fields before it.
  formData.append("file", input.file);
  return apiFetch<{ template: ImportedTemplate }>(BASE, {
    method: "POST",
    body: formData,
    // The import includes the malware scan.
    timeoutMs: 120_000,
  });
}

export function updateImportedTemplate(
  id: string,
  payload: { label?: string; description?: string; language?: string; body?: string },
) {
  return apiFetch<{ template: ImportedTemplate }>(`${BASE}/${id}/update`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function activateImportedTemplate(id: string) {
  return apiFetch<{ template: ImportedTemplate }>(`${BASE}/${id}/activate`, {
    method: "POST",
  });
}

export function disableImportedTemplate(id: string) {
  return apiFetch<{ template: ImportedTemplate }>(`${BASE}/${id}/disable`, {
    method: "POST",
  });
}

/** The template as a PDF with sample data; the caller revokes the URL. */
export async function createImportedTemplatePreviewUrl(id: string) {
  const { blob } = await apiFetchFile(`${BASE}/${id}/preview`, { cache: "no-store" });
  return URL.createObjectURL(
    blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }),
  );
}

export const TEMPLATE_IMPORT_ACCEPT =
  ".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

/** What the picker lets through; the server checks the content itself. */
export function isTemplateImportFileName(name: string) {
  return /\.(docx|txt)$/i.test(name.trim());
}

/** The default template name of a chosen file: its name without extension. */
export function templateLabelFromFileName(name: string) {
  return name.trim().replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
}
