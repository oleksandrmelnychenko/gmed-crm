import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { t as translateCatalog, useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type VorerkrankungItem, useCaseWorkspace } from "./context";
import {
  Field,
  inputBaseClassName,
  textareaBaseClassName,
} from "./primitives";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
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
      title={tri(lang, "case_ws_preconditions")}
      description={tri(lang, "case_ws_known_diagnoses_and_preconditions_for_this_patient")}
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
        create: tri(lang, "case_ws_new_precondition"),
        edit: tri(lang, "case_ws_edit_precondition"),
      }}
      emptyTitle={tri(lang, "case_ws_no_preconditions_recorded_yet")}
      emptyHint={tri(lang, "case_ws_use_add_to_open_the_side_editor")}
      addFirstLabel={tri(lang, "case_ws_add_first_entry")}
      missingPrimaryMessage={tri(lang, "case_ws_please_enter_the_condition_name")}
      cardContent={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.erkrankung || tri(lang, "case_ws_untitled")}
            </p>
          </div>
          {item.erstdiagnose ? (
            <Badge
              variant="outline"
              className="self-start rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
            >
              {tri(lang, "case_ws_first_diagnosis")}:{" "}
              {item.erstdiagnose}
            </Badge>
          ) : null}
          {item.notiz ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {item.notiz}
            </p>
          ) : (
            <p className="text-xs italic text-muted-foreground">
              {tri(lang, "case_ws_no_note")}
            </p>
          )}
        </>
      )}
      formContent={({ form, updateField, disabled }) => (
        <>
          <Field
            label={tri(lang, "case_ws_condition")}
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
            label={tri(lang, "case_ws_first_diagnosis")}
            hint={tri(lang, "case_ws_free_text_e_g_year_or_short_description")}
          >
            <Input
              value={form.erstdiagnose ?? ""}
              onChange={(event) => updateField("erstdiagnose", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "case_ws_note")}>
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
