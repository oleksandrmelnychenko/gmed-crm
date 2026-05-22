import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

  return (
    <CaseItemList<SymptomItem>
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
      cardContent={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.beschreibung ||
                tri(lang, "case_ws_untitled_3")}
            </p>
          </div>
          {item.fachrichtung ? (
            <Badge
              variant="outline"
              className="self-start rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
            >
              {item.fachrichtung}
            </Badge>
          ) : null}
        </>
      )}
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
