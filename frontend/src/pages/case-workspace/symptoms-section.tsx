import { useMemo } from "react";

import { Input } from "@/components/ui/input";
import type { ColumnDef } from "@/components/data-table/types";
import { t as translateCatalog, useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type SymptomItem, useCaseWorkspace } from "./context";
import { Field, Panel, inputBaseClassName } from "./primitives";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

const BLANK: SymptomItem = {
  beschreibung: "",
  fachrichtung: "",
};

export function SymptomsSection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveSymptoms,
  } = useCaseWorkspace();

  const columns = useMemo<ColumnDef<SymptomItem>[]>(
    () => [
      {
        id: "beschreibung",
        label: tri(lang, "case_ws_description"),
        accessor: (item) => item.beschreibung,
        filterType: "text",
        searchable: true,
        sortable: true,
        required: true,
        width: 420,
        render: (item) => (
          <span className="block max-w-[420px] truncate text-xs font-medium text-foreground">
            {item.beschreibung || tri(lang, "case_ws_untitled_3")}
          </span>
        ),
      },
      {
        id: "fachrichtung",
        label: tri(lang, "case_ws_specialty"),
        accessor: (item) => item.fachrichtung ?? "",
        filterType: "enum",
        filterOptions: () =>
          [
            ...new Set(
              (detail?.symptome ?? [])
                .map((item) => item.fachrichtung?.trim())
                .filter((value): value is string => Boolean(value)),
            ),
          ].map((value) => ({ value, label: value })),
        sortable: true,
        width: 240,
        render: (item) =>
          item.fachrichtung?.trim() ? (
            <span className="inline-flex rounded-full border border-border/60 bg-muted/25 px-2 py-0.5 font-mono text-[10px] font-medium text-foreground">
              {item.fachrichtung}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
      },
    ],
    [detail?.symptome, lang],
  );

  return (
    <CaseItemList<SymptomItem>
      columns={columns}
      title={tri(lang, "case_ws_symptoms")}
      description={tri(lang, "case_ws_clinical_complaints_and_related_specialty")}
      items={detail?.symptome ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({
        beschreibung: item.beschreibung ?? "",
        fachrichtung: item.fachrichtung ?? "",
      })}
      isValid={(form) => form.beschreibung.trim().length > 0}
      save={saveSymptoms}
      busy={sectionBusy === "symptoms"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: tri(lang, "case_ws_new_symptom"),
        edit: tri(lang, "case_ws_edit_symptom"),
      }}
      emptyTitle={tri(lang, "case_ws_no_symptoms_recorded_yet")}
      addFirstLabel={tri(lang, "case_ws_add_first_entry_3")}
      missingPrimaryMessage={tri(lang, "case_ws_please_enter_a_description")}
      formContent={({ form, updateField, disabled }) => (
        <Panel title={tri(lang, "case_ws_symptoms")}>
          <Field
            label={tri(lang, "case_ws_description")}
            required
          >
            <Input
              value={form.beschreibung}
              onChange={(event) => updateField("beschreibung", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "case_ws_specialty")}>
            <Input
              value={form.fachrichtung ?? ""}
              onChange={(event) => updateField("fachrichtung", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
        </Panel>
      )}
    />
  );
}
