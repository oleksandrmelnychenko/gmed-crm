import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { t as translateCatalog, useLang } from "@/lib/i18n";
import { doctorSpecialtyLabel, type SpecializationLabelLang } from "@/pages/providers/model/specialization-labels";

import { CaseItemList } from "./case-item-list";
import {
  type CaseWorkspaceDoctor,
  type OperationItem,
  useCaseWorkspace,
} from "./context";
import {
  Field,
  inputBaseClassName,
  nativeSelectClassName,
  textareaBaseClassName,
} from "./primitives";

function tri(lang: string, key: string) {
  const catalog = translateCatalog(lang === "de" ? "de" : "ru");
  return catalog.uiText[key] ?? key;
}

function doctorOptionLabel(doctor: CaseWorkspaceDoctor, lang: SpecializationLabelLang) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialtyLabel = doctorSpecialtyLabel(doctor, lang);
  const specialty = specialtyLabel ? ` - ${specialtyLabel}` : "";
  return `${doctor.provider_name} | ${titlePrefix}${doctor.name}${specialty}`;
}

const BLANK: OperationItem = {
  datum: "",
  grund: "",
  arzt_id: "",
  arzt: "",
  notiz: "",
};

export function SurgeriesSection() {
  const { t, lang } = useLang();
  const {
    detail,
    doctors,
    permissions,
    sectionBusy,
    sectionError,
    saveSurgeries,
  } = useCaseWorkspace();

  return (
    <CaseItemList<OperationItem>
      title={tri(lang, "case_ws_surgeries")}
      description={tri(lang, "case_ws_past_procedures_and_surgical_treatments")}
      items={detail?.operationen ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({
        datum: item.datum ?? "",
        grund: item.grund ?? "",
        arzt_id: item.arzt_id ?? "",
        arzt: item.arzt ?? "",
        notiz: item.notiz ?? "",
      })}
      isValid={(form) => form.grund.trim().length > 0}
      save={saveSurgeries}
      busy={sectionBusy === "surgeries"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: tri(lang, "case_ws_new_surgery"),
        edit: tri(lang, "case_ws_edit_surgery"),
      }}
      sheetWidth="wide"
      emptyTitle={tri(lang, "case_ws_no_surgeries_recorded_yet")}
      addFirstLabel={tri(lang, "case_ws_add_first_entry_2")}
      missingPrimaryMessage={tri(lang, "case_ws_please_enter_the_reason")}
      cardContent={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.grund || tri(lang, "case_ws_untitled_2")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.datum ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {item.datum}
              </Badge>
            ) : null}
            {item.arzt ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {item.arzt}
              </Badge>
            ) : null}
          </div>
          {item.notiz ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
              {item.notiz}
            </p>
          ) : null}
        </>
      )}
      formContent={({ form, setForm, updateField, disabled }) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tri(lang, "case_ws_date")}>
              <Input
                type="date"
                value={form.datum ?? ""}
                onChange={(event) => updateField("datum", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field
              label={tri(lang, "case_ws_reason")}
              required
            >
              <Input
                value={form.grund}
                onChange={(event) => updateField("grund", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>
          <Field
            label={tri(lang, "case_ws_doctor_registry")}
            hint={tri(lang, "case_ws_selecting_also_fills_the_free_text_field_below")}
          >
            <NativeComboboxSelect
              value={form.arzt_id ?? ""}
              onChange={(event) => {
                const doctorId = event.target.value;
                const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                setForm((current) => ({
                  ...current,
                  arzt_id: doctorId,
                  arzt: selectedDoctor ? selectedDoctor.name : current.arzt ?? "",
                }));
              }}
              className={nativeSelectClassName}
              disabled={disabled}
            >
              <option value="">{t.common_not_set}</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctorOptionLabel(doctor, lang)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field
            label={tri(lang, "case_ws_doctor_label")}
            hint={tri(lang, "case_ws_legacy_or_manual_fallback")}
          >
            <Input
              value={form.arzt ?? ""}
              onChange={(event) => updateField("arzt", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "case_ws_note")}>
            <textarea
              value={form.notiz ?? ""}
              onChange={(event) => updateField("notiz", event.target.value)}
              className={textareaBaseClassName}
              rows={4}
              disabled={disabled}
            />
          </Field>
        </>
      )}
    />
  );
}
