import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { CaseItemList } from "./case-item-list";
import { type PainItem, useCaseWorkspace } from "./context";
import { Field, inputBaseClassName } from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

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
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    savePain,
  } = useCaseWorkspace();

  return (
    <CaseItemList<PainItem>
      title={tri(lang, "Schmerz", "Боль", "Pain")}
      description={tri(
        lang,
        "Schmerz-Lokalisation, Qualität und Intensität.",
        "Локализация, характер и интенсивность боли.",
        "Pain location, quality, and intensity.",
      )}
      items={detail?.pain_records ?? []}
      blankItem={BLANK}
      cloneItem={(item) => ({ ...BLANK, ...item })}
      isValid={(form) => form.lokalisierung.trim().length > 0}
      save={savePain}
      busy={sectionBusy === "pain"}
      sectionError={sectionError}
      canEdit={permissions.canEdit}
      sheetTitle={{
        create: tri(lang, "Neuer Schmerzbefund", "Новая запись о боли", "New pain record"),
        edit: tri(lang, "Schmerzbefund bearbeiten", "Редактировать запись о боли", "Edit pain record"),
      }}
      sheetWidth="wide"
      emptyTitle={tri(
        lang,
        "Keine Schmerzbefunde erfasst.",
        "Записей о боли пока нет.",
        "No pain records yet.",
      )}
      addFirstLabel={tri(
        lang,
        "Ersten Befund hinzufügen",
        "Добавить первую запись",
        "Add first entry",
      )}
      missingPrimaryMessage={tri(
        lang,
        "Bitte die Lokalisation angeben.",
        "Укажите локализацию.",
        "Please enter the location.",
      )}
      renderCard={(item) => (
        <>
          <div className="flex items-center gap-2">
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-orange-500" />
            <p className="truncate text-sm font-semibold text-slate-950">
              {item.lokalisierung ||
                tri(lang, "Ohne Lokalisation", "Без локализации", "No location")}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {item.nrs_aktuell != null ? (
              <Badge
                variant="outline"
                className="rounded-full border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-700"
              >
                NRS {item.nrs_aktuell}
              </Badge>
            ) : null}
            {item.seit_wann ? (
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600"
              >
                {tri(lang, "seit", "с", "since")} {item.seit_wann}
              </Badge>
            ) : null}
            {item.qualitaet ? (
              <Badge
                variant="outline"
                className="rounded-full border-slate-200 bg-slate-50 text-[11px] font-medium text-slate-600"
              >
                {item.qualitaet}
              </Badge>
            ) : null}
          </div>
          {item.ursache ? (
            <p className="line-clamp-3 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                {tri(lang, "Ursache", "Причина", "Cause")}:
              </span>
              {item.ursache}
            </p>
          ) : null}
        </>
      )}
      renderForm={({ form, updateField, disabled }) => (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={tri(lang, "Lokalisation", "Локализация", "Location")}
              required
            >
              <Input
                value={form.lokalisierung}
                autoFocus
                onChange={(event) => updateField("lokalisierung", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Seit wann", "С какого времени", "Since when")}>
              <Input
                value={form.seit_wann ?? ""}
                onChange={(event) => updateField("seit_wann", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tri(lang, "Ursache", "Причина", "Cause")}>
              <Input
                value={form.ursache ?? ""}
                onChange={(event) => updateField("ursache", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Qualität", "Характер", "Quality")}>
              <Input
                value={form.qualitaet ?? ""}
                onChange={(event) => updateField("qualitaet", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tri(lang, "Kontinuität", "Постоянство", "Continuity")}>
              <Input
                value={form.kontinuitaet ?? ""}
                onChange={(event) => updateField("kontinuitaet", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Entwicklung", "Развитие", "Evolution")}>
              <Input
                value={form.entwicklung ?? ""}
                onChange={(event) => updateField("entwicklung", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field
              label={tri(lang, "NRS aktuell (0–10)", "NRS сейчас (0–10)", "NRS current (0–10)")}
            >
              <Input
                value={nrsToString(form.nrs_aktuell)}
                onChange={(event) => updateField("nrs_aktuell", parseNrs(event.target.value))}
                className={inputBaseClassName}
                disabled={disabled}
                inputMode="numeric"
              />
            </Field>
            <Field
              label={tri(lang, "NRS Anfang", "NRS в начале", "NRS initial")}
            >
              <Input
                value={nrsToString(form.nrs_anfang)}
                onChange={(event) => updateField("nrs_anfang", parseNrs(event.target.value))}
                className={inputBaseClassName}
                disabled={disabled}
                inputMode="numeric"
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tri(lang, "Dauer Anfang", "Длительность в начале", "Initial duration")}>
              <Input
                value={form.dauer_anfang ?? ""}
                onChange={(event) => updateField("dauer_anfang", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Dauer aktuell", "Длительность сейчас", "Current duration")}>
              <Input
                value={form.dauer_aktuell ?? ""}
                onChange={(event) => updateField("dauer_aktuell", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label={tri(lang, "Ausstrahlung", "Иррадиация", "Radiation")}>
              <Input
                value={form.ausstrahlung ?? ""}
                onChange={(event) => updateField("ausstrahlung", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
            <Field label={tri(lang, "Auftreten", "Провоцирующие факторы", "Triggers")}>
              <Input
                value={form.auftreten ?? ""}
                onChange={(event) => updateField("auftreten", event.target.value)}
                className={inputBaseClassName}
                disabled={disabled}
              />
            </Field>
          </div>
        </>
      )}
    />
  );
}
