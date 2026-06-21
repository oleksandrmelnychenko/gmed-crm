import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type AllergieItem, useCaseWorkspace } from "./context";
import { Field, Panel, inputBaseClassName } from "./primitives";

const BLANK: AllergieItem = { allergie: "", reaktion: "" };

export function AllergiesSection() {
  const { t } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveAllergies,
  } = useCaseWorkspace();

  return (
    <CaseItemList<AllergieItem>
      title={t.cases_clinical_section_allergies}
      description={t.cases_allergies_description}
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
        create: t.cases_allergies_sheet_create,
        edit: t.cases_allergies_sheet_edit,
      }}
      emptyTitle={t.cases_allergies_empty_title}
      emptyHint={t.cases_allergies_empty_hint}
      addFirstLabel={t.cases_allergies_add_first}
      missingPrimaryMessage={t.cases_allergies_missing_allergen}
      cardContent={(item) => (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">
              {item.allergie || t.cases_allergies_untitled}
            </p>
          </div>
          {item.reaktion ? (
            <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
              <span className="mr-1 text-[11.5px] font-medium text-muted-foreground">
                {t.cases_allergies_reaction}:
              </span>
              {item.reaktion}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {t.cases_allergies_no_reaction}
            </p>
          )}
        </>
      )}
      formContent={({ form, updateField, disabled }) => (
        <Panel title={t.cases_clinical_section_allergies}>
          <Field
            label={t.cases_allergies_allergen}
            required
          >
            <Input
              value={form.allergie}
              onChange={(event) => updateField("allergie", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={t.cases_allergies_reaction}>
            <Input
              value={form.reaktion ?? ""}
              onChange={(event) => updateField("reaktion", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
        </Panel>
      )}
    />
  );
}
