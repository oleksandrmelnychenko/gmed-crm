import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type PainItem, useCaseWorkspace } from "./context";
import { Field, Panel, inputBaseClassName } from "./primitives";

function parseNrs(value: string): number | null {
  const trimmed = value.trim().replace(",", ".");
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nrsToString(value: number | null | undefined) {
  if (value == null) return "";
  return String(value);
}

const BLANK: PainItem = {
  lokalisierung: "",
  seit_wann: "",
  ursache: "",
  qualitaet: "",
  kontinuitaet: "",
  entwicklung: "",
  nrs_aktuell: null,
  nrs_anfang: null,
  dauer_anfang: "",
  dauer_aktuell: "",
  ausstrahlung: "",
  auftreten: "",
};

export function PainSection() {
  const { t } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    savePain,
  } = useCaseWorkspace();

  return (
    <CaseItemList<PainItem>
      title={t.cases_pain_title}
      description={t.cases_pain_description}
      items={detail?.pain_records ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({ ...BLANK, ...item })}
      isValid={(form) => form.lokalisierung.trim().length > 0}
      save={savePain}
      busy={sectionBusy === "pain"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: t.cases_pain_sheet_create,
        edit: t.cases_pain_sheet_edit,
      }}
      sheetWidth="wide"
      emptyTitle={t.cases_pain_empty_title}
      addFirstLabel={t.cases_pain_add_first}
      missingPrimaryMessage={t.cases_pain_missing_location}
      cardContent={(item) => (
        <>
          <div className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <p className="min-w-0 max-w-full break-words text-sm font-medium text-foreground">
              {item.lokalisierung || t.cases_pain_no_location}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.nrs_aktuell != null ? (
              <Badge
                variant="outline"
                className="rounded-full border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-700"
              >
                {t.uiText.cases_pain_nrs_label} {item.nrs_aktuell}
              </Badge>
            ) : null}
            {item.seit_wann ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {t.cases_pain_since} {item.seit_wann}
              </Badge>
            ) : null}
            {item.qualitaet ? (
              <Badge
                variant="outline"
                className="rounded-full border-border/60 bg-muted/25 text-[11px] font-medium text-muted-foreground"
              >
                {item.qualitaet}
              </Badge>
            ) : null}
          </div>
          {item.ursache ? (
            <p className="min-w-0 max-w-full whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted-foreground">
              <span className="mr-1 text-[11.5px] font-medium text-muted-foreground">
                {t.cases_pain_cause}:
              </span>
              {item.ursache}
            </p>
          ) : null}
        </>
      )}
      formContent={({ form, updateField, disabled }) => (
        <>
          <Panel title={t.cases_pain_group_location_timing}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_location}>
                <Input
                  value={form.lokalisierung}
                  onChange={(event) => updateField("lokalisierung", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_since_when}>
                <Input
                  value={form.seit_wann ?? ""}
                  onChange={(event) => updateField("seit_wann", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>
          </Panel>

          <Panel title={t.cases_pain_group_characteristics}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_cause}>
                <Input
                  value={form.ursache ?? ""}
                  onChange={(event) => updateField("ursache", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_quality}>
                <Input
                  value={form.qualitaet ?? ""}
                  onChange={(event) => updateField("qualitaet", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_continuity}>
                <Input
                  value={form.kontinuitaet ?? ""}
                  onChange={(event) => updateField("kontinuitaet", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_evolution}>
                <Input
                  value={form.entwicklung ?? ""}
                  onChange={(event) => updateField("entwicklung", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>
          </Panel>

          <Panel title={t.cases_pain_group_intensity}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_nrs_current}>
                <Input
                  value={nrsToString(form.nrs_aktuell)}
                  onChange={(event) => updateField("nrs_aktuell", parseNrs(event.target.value))}
                  className={inputBaseClassName}
                  disabled={disabled}
                  inputMode="numeric"
                />
              </Field>
              <Field label={t.cases_pain_nrs_initial}>
                <Input
                  value={nrsToString(form.nrs_anfang)}
                  onChange={(event) => updateField("nrs_anfang", parseNrs(event.target.value))}
                  className={inputBaseClassName}
                  disabled={disabled}
                  inputMode="numeric"
                />
              </Field>
            </div>
          </Panel>

          <Panel title={t.cases_pain_group_course}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_initial_duration}>
                <Input
                  value={form.dauer_anfang ?? ""}
                  onChange={(event) => updateField("dauer_anfang", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_current_duration}>
                <Input
                  value={form.dauer_aktuell ?? ""}
                  onChange={(event) => updateField("dauer_aktuell", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t.cases_pain_radiation}>
                <Input
                  value={form.ausstrahlung ?? ""}
                  onChange={(event) => updateField("ausstrahlung", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
              <Field label={t.cases_pain_triggers}>
                <Input
                  value={form.auftreten ?? ""}
                  onChange={(event) => updateField("auftreten", event.target.value)}
                  className={inputBaseClassName}
                  disabled={disabled}
                />
              </Field>
            </div>
          </Panel>
        </>
      )}
    />
  );
}
