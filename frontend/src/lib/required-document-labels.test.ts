import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { uiText } from "./i18n";
import {
  knownDocumentCodeLabel,
  localizeDocumentCategory,
  localizeDocumentCode,
} from "./required-document-labels";

const ru = (key: string) => uiText(key, "ru");
const de = (key: string) => uiText(key, "de");

/** Every id the migrations put into `ref_document_categories`. */
function serverDocumentCategoryKeys(): string[] {
  const directory = new URL("../../../migrations/", import.meta.url);
  const keys = new Set<string>();
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, directory), "utf8");
    for (const insert of sql.split("INSERT INTO ref_document_categories").slice(1)) {
      const values = insert.slice(0, insert.indexOf("ON CONFLICT"));
      for (const match of values.matchAll(/\(\s*'([a-z0-9_]+)'\s*,/g)) {
        keys.add(match[1]);
      }
    }
  }
  return [...keys].sort();
}

/** Category keys and document types the generated-document templates write. */
function serverTemplateDocumentCodes(): string[] {
  const source = readFileSync(
    new URL("../../../crates/server/src/routes/documents.rs", import.meta.url),
    "utf8",
  );
  const codes = new Set<string>();
  for (const match of source.matchAll(/^\s*(?:art|category): "([a-z0-9_]+)",$/gm)) {
    codes.add(match[1]);
  }
  return [...codes].sort();
}

describe("required document labels", () => {
  it("localizes the uploaded document backend code", () => {
    const l = (key: string) =>
      key === "required_doc_uploaded_document" ? "Загруженный документ" : key;

    expect(localizeDocumentCode("uploaded_document", l)).toBe(
      "Загруженный документ",
    );
  });

  it("labels every server document category and type in Russian and German", () => {
    const keys = [...serverDocumentCategoryKeys(), ...serverTemplateDocumentCodes()];
    expect(keys.length).toBeGreaterThan(80);

    const missing = keys.filter((key) => {
      const russian = knownDocumentCodeLabel(key, ru);
      const german = knownDocumentCodeLabel(key, de);
      return (
        !russian ||
        !german ||
        !/[А-Яа-яЁё]/.test(russian) ||
        /[А-Яа-яЁё]/.test(german) ||
        russian.startsWith("document_") ||
        german.startsWith("document_")
      );
    });
    expect(missing).toEqual([]);
  });

  it("uses the German medical document terms", () => {
    expect(localizeDocumentCode("medical_arztbrief", de)).toBe("Arztbrief");
    expect(localizeDocumentCode("medical_befund", de)).toBe("Befund");
    expect(localizeDocumentCode("medical_lab_results", de)).toBe("Laborbefund");
    expect(localizeDocumentCode("medical_entlassungsbrief", de)).toBe("Entlassungsbrief");
    expect(localizeDocumentCode("medical_prescription", de)).toBe("Rezept");
    expect(localizeDocumentCode("medical_ueberweisung", de)).toBe("Überweisung");
    expect(localizeDocumentCode("consent_form", de)).toBe("Einverständniserklärung");
    expect(localizeDocumentCode("finance_order_cost_estimate", de)).toBe("Kostenvoranschlag");
    expect(localizeDocumentCode("invoice", de)).toBe("Rechnung");
    expect(localizeDocumentCode("medical_arztbrief", ru)).toBe("Врачебное письмо");
  });

  it("labels a server category by its key and keeps the server name for unknown keys", () => {
    const category = {
      key: "medical_arztbrief",
      label: "Doctor letter",
      label_de: "Arztbrief",
      label_en: "Doctor letter",
      parent_key: "medical",
      breadcrumb_label: "Medical / Doctor letter",
      breadcrumb_label_de: "Medizinisch / Arztbrief",
    };
    expect(localizeDocumentCategory(category, "ru", ru)).toBe("Врачебное письмо");
    expect(localizeDocumentCategory(category, "ru", ru, true)).toBe(
      `${ru("required_doc_medical")} / Врачебное письмо`,
    );
    expect(localizeDocumentCategory(category, "de", de, true)).toBe(
      "Medizinisch / Arztbrief",
    );

    const added = {
      key: "medical_new_type",
      label: "New type",
      label_de: "Neuer Typ",
      parent_key: "medical",
      breadcrumb_label: "Medical / New type",
      breadcrumb_label_de: "Medizinisch / Neuer Typ",
    };
    expect(localizeDocumentCategory(added, "de", de)).toBe("Neuer Typ");
    expect(localizeDocumentCategory(added, "ru", ru, true)).toBe(
      `${ru("required_doc_medical")} / New type`,
    );
  });
});
