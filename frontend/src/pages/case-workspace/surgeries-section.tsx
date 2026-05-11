import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

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

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function doctorOptionLabel(doctor: CaseWorkspaceDoctor) {
  const titlePrefix = doctor.title?.trim() ? `${doctor.title.trim()} ` : "";
  const specialty = doctor.fachbereich?.trim()
    ? ` · ${doctor.fachbereich.trim()}`
    : "";
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
      title={tri(lang, "Operationen", "Операции", "Surgeries")}
      description={tri(
        lang,
        "Vergangene Eingriffe und operative Behandlungen.",
        "Прошлые вмешательства и операции.",
        "Past procedures and surgical treatments.",
      )}
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
        create: tri(lang, "Neue Operation", "Новая операция", "New surgery"),
        edit: tri(lang, "Operation bearbeiten", "Редактировать операцию", "Edit surgery"),
      }}
      sheetWidth="wide"
      emptyTitle={tri(
        lang,
        "Keine Operationen erfasst.",
        "Операций пока нет.",
        "No surgeries recorded yet.",
      )}
      addFirstLabel={tri(
        lang,
        "Erste Operation hinzufügen",
        "Добавить первую запись",
        "Add first entry",
      )}
      missingPrimaryMessage={tri(
        lang,
        "Bitte den Grund angeben.",
        "Укажите причину.",
        "Please enter the reason.",
      )}
      cardContent={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="truncate text-sm font-medium text-foreground">
              {item.grund || tri(lang, "Ohne Grund", "Без причины", "Untitled")}
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
            <Field label={tri(lang, "Datum", "Дата", "Date")}>
              <Input
                type="date"
                value={form.datum ?? ""}
                onChange={(event) => updateField("datum", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field
              label={tri(lang, "Grund", "Причина", "Reason")}
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
            label={tri(lang, "Arzt aus Register", "Врач из реестра", "Doctor registry")}
            hint={tri(
              lang,
              "Auswahl füllt auch das Freitext-Feld unten.",
              "Выбор также заполняет поле ниже.",
              "Selecting also fills the free-text field below.",
            )}
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
                  {doctorOptionLabel(doctor)}
                </option>
              ))}
            </NativeComboboxSelect>
          </Field>
          <Field
            label={tri(lang, "Freitext Arzt", "Наименование врача", "Doctor label")}
            hint={tri(
              lang,
              "Altbestand oder manuelle Angabe.",
              "Устаревшие данные или ручной ввод.",
              "Legacy or manual fallback.",
            )}
          >
            <Input
              value={form.arzt ?? ""}
              onChange={(event) => updateField("arzt", event.target.value)}
              className={inputBaseClassName}
              disabled={disabled}
            />
          </Field>
          <Field label={tri(lang, "Notiz", "Заметка", "Note")}>
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
