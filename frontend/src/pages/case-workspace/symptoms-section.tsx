import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type SymptomItem, useCaseWorkspace } from "./context";
import { Field, inputBaseClassName } from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
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
      title={tri(lang, "Symptome", "Симптомы", "Symptoms")}
      description={tri(
        lang,
        "Klinische Beschwerden und betroffene Fachrichtung.",
        "Клинические жалобы и соответствующая специальность.",
        "Clinical complaints and related specialty.",
      )}
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
        create: tri(lang, "Neues Symptom", "Новый симптом", "New symptom"),
        edit: tri(lang, "Symptom bearbeiten", "Редактировать симптом", "Edit symptom"),
      }}
      emptyTitle={tri(
        lang,
        "Keine Symptome erfasst.",
        "Симптомов пока нет.",
        "No symptoms recorded yet.",
      )}
      addFirstLabel={tri(
        lang,
        "Erstes Symptom hinzufügen",
        "Добавить первый симптом",
        "Add first entry",
      )}
      missingPrimaryMessage={tri(
        lang,
        "Bitte die Beschreibung eingeben.",
        "Введите описание.",
        "Please enter a description.",
      )}
      cardContent={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.beschreibung ||
                tri(lang, "Ohne Beschreibung", "Без описания", "Untitled")}
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
        <>
          <Field
            label={tri(lang, "Beschreibung", "Описание", "Description")}
            required
          >
            <Input
              value={form.beschreibung}
              onChange={(event) => updateField("beschreibung", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "Fachrichtung", "Специальность", "Specialty")}>
            <Input
              value={form.fachrichtung ?? ""}
              onChange={(event) => updateField("fachrichtung", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
        </>
      )}
    />
  );
}
