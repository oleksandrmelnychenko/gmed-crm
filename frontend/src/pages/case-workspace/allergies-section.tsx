import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type AllergieItem, useCaseWorkspace } from "./context";
import { Field, inputBaseClassName } from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

const BLANK: AllergieItem = { allergie: "", reaktion: "" };

export function AllergiesSection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveAllergies,
  } = useCaseWorkspace();

  return (
    <CaseItemList<AllergieItem>
      title={tri(lang, "Allergien", "Аллергии", "Allergies")}
      description={tri(
        lang,
        "Bekannte Allergien und dokumentierte Reaktionen.",
        "Известные аллергии и задокументированные реакции.",
        "Known allergies and documented reactions.",
      )}
      items={detail?.allergien ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({
        allergie: item.allergie ?? "",
        reaktion: item.reaktion ?? "",
      })}
      isValid={(form) => form.allergie.trim().length > 0}
      save={saveAllergies}
      busy={sectionBusy === "allergies"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: tri(lang, "Neue Allergie", "Новая аллергия", "New allergy"),
        edit: tri(lang, "Allergie bearbeiten", "Редактировать аллергию", "Edit allergy"),
      }}
      emptyTitle={tri(
        lang,
        "Keine Allergien erfasst.",
        "Аллергий пока нет.",
        "No allergies recorded yet.",
      )}
      emptyHint={tri(
        lang,
        "Hinzufügen öffnet das Eingabefenster rechts.",
        "Нажмите «Добавить» — справа откроется окно ввода.",
        "Use Add to open the side editor.",
      )}
      addFirstLabel={tri(
        lang,
        "Erste Allergie hinzufügen",
        "Добавить первую запись",
        "Add first entry",
      )}
      missingPrimaryMessage={tri(
        lang,
        "Bitte den Allergiename eingeben.",
        "Укажите аллерген.",
        "Please enter the allergen.",
      )}
      renderCard={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.allergie || tri(lang, "Ohne Namen", "Без названия", "Untitled")}
            </p>
          </div>
          {item.reaktion ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              <span className="mr-1 text-[11.5px] font-medium text-muted-foreground">
                {tri(lang, "Reaktion", "Реакция", "Reaction")}:
              </span>
              {item.reaktion}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {tri(lang, "Keine Reaktion erfasst", "Реакция не указана", "No reaction recorded")}
            </p>
          )}
        </>
      )}
      renderForm={({ form, updateField, disabled }) => (
        <>
          <Field
            label={tri(lang, "Allergen", "Аллерген", "Allergen")}
            required
          >
            <Input
              value={form.allergie}
              autoFocus
              onChange={(event) => updateField("allergie", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "Reaktion", "Реакция", "Reaction")}>
            <Input
              value={form.reaktion ?? ""}
              onChange={(event) => updateField("reaktion", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
        </>
      )}
    />
  );
}
