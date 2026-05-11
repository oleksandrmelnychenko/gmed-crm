import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type VorerkrankungItem, useCaseWorkspace } from "./context";
import {
  Field,
  inputBaseClassName,
  textareaBaseClassName,
} from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

const BLANK: VorerkrankungItem = {
  erkrankung: "",
  erstdiagnose: "",
  notiz: "",
};

export function PreconditionsSection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    savePreconditions,
  } = useCaseWorkspace();

  return (
    <CaseItemList<VorerkrankungItem>
      title={tri(lang, "Vorerkrankungen", "Предзаболевания", "Preconditions")}
      description={tri(
        lang,
        "Bekannte Diagnosen und Vorerkrankungen des Patienten.",
        "Известные диагнозы и предзаболевания пациента.",
        "Known diagnoses and preconditions for this patient.",
      )}
      items={detail?.vorerkrankungen ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({
        erkrankung: item.erkrankung ?? "",
        erstdiagnose: item.erstdiagnose ?? "",
        notiz: item.notiz ?? "",
      })}
      isValid={(form) => form.erkrankung.trim().length > 0}
      save={savePreconditions}
      busy={sectionBusy === "preconditions"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: tri(lang, "Neue Vorerkrankung", "Новая запись", "New precondition"),
        edit: tri(lang, "Vorerkrankung bearbeiten", "Редактировать запись", "Edit precondition"),
      }}
      emptyTitle={tri(
        lang,
        "Noch keine Vorerkrankungen erfasst.",
        "Предзаболеваний пока нет.",
        "No preconditions recorded yet.",
      )}
      emptyHint={tri(
        lang,
        "Hinzufügen öffnet das Eingabefenster rechts.",
        "Нажмите «Добавить» — справа откроется окно ввода.",
        "Use Add to open the side editor.",
      )}
      addFirstLabel={tri(
        lang,
        "Erste Erkrankung hinzufügen",
        "Добавить первую запись",
        "Add first entry",
      )}
      missingPrimaryMessage={tri(
        lang,
        "Bitte den Erkrankungsnamen eingeben.",
        "Укажите название заболевания.",
        "Please enter the condition name.",
      )}
      cardContent={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.erkrankung || tri(lang, "Ohne Namen", "Без названия", "Untitled")}
            </p>
          </div>
          {item.erstdiagnose ? (
            <Badge
              variant="outline"
              className="self-start rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
            >
              {tri(lang, "Erstdiagnose", "Первый диагноз", "First diagnosis")}:{" "}
              {item.erstdiagnose}
            </Badge>
          ) : null}
          {item.notiz ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {item.notiz}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {tri(lang, "Keine Notiz", "Без заметки", "No note")}
            </p>
          )}
        </>
      )}
      formContent={({ form, updateField, disabled }) => (
        <>
          <Field
            label={tri(lang, "Erkrankung", "Заболевание", "Condition")}
            required
          >
            <Input
              value={form.erkrankung}
              onChange={(event) => updateField("erkrankung", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field
            label={tri(lang, "Erstdiagnose", "Первый диагноз", "First diagnosis")}
            hint={tri(
              lang,
              "Freitext, z. B. Jahr oder kurze Beschreibung.",
              "Произвольный текст — например, год или краткое описание.",
              "Free text, e.g., year or short description.",
            )}
          >
            <Input
              value={form.erstdiagnose ?? ""}
              onChange={(event) => updateField("erstdiagnose", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "Notiz", "Заметка", "Note")}>
            <textarea
              value={form.notiz ?? ""}
              onChange={(event) => updateField("notiz", event.target.value)}
              className={textareaBaseClassName}
              rows={5}
              disabled={disabled}
            />
          </Field>
        </>
      )}
    />
  );
}
