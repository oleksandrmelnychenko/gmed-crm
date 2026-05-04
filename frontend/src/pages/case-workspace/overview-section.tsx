import { NativeComboboxSelect } from "@/components/ui/combobox-select";
import { useMemo, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatUnknownValue, useLang, type Translations } from "@/lib/i18n";
import {
  CASE_TEXT_SNIPPET_PLACEHOLDERS,
  appendSnippetToNarrative,
  renderCaseTextSnippet,
  type CaseTextSnippetContext,
} from "@/pages/cases.snippets";

import {
  type CaseOverviewForm,
  type CaseWorkspaceDetail,
  type CaseWorkspaceDoctor,
  type CaseWorkspaceSnippet,
  useCaseWorkspace,
} from "./context";
import {
  Banner,
  Field,
  Panel,
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

function snippetCategoryLabel(
  lang: string,
  category: string,
  translations: Translations,
) {
  const labels: Record<string, string> = {
    anamnesis: tri(lang, "Anamnese", "Анамнез", "Anamnesis"),
    cardiology: tri(lang, "Kardiologie", "Кардиология", "Cardiology"),
    general: tri(lang, "Allgemein", "Общее", "General"),
    medication: tri(lang, "Medikation", "Медикация", "Medication"),
    neurology: tri(lang, "Neurologie", "Неврология", "Neurology"),
    oncology: tri(lang, "Onkologie", "Онкология", "Oncology"),
    symptoms: tri(lang, "Symptome", "Симптомы", "Symptoms"),
  };
  return labels[category] ?? formatUnknownValue(category, translations);
}

function initialOverviewForm(
  detail: CaseWorkspaceDetail | null,
): CaseOverviewForm {
  if (!detail) {
    return {
      hauptanfragegrund: "",
      aktuelle_anamnese: "",
      zuweiser_doctor_id: "",
      zuweiser: "",
    };
  }
  return {
    hauptanfragegrund: detail.hauptanfragegrund ?? "",
    aktuelle_anamnese: detail.aktuelle_anamnese ?? "",
    zuweiser_doctor_id: detail.zuweiser_doctor_id ?? "",
    zuweiser: detail.zuweiser ?? "",
  };
}

type OverviewSectionFormProps = {
  detail: CaseWorkspaceDetail | null;
  doctors: CaseWorkspaceDoctor[];
  snippets: CaseWorkspaceSnippet[];
  canEdit: boolean;
  busy: boolean;
  sectionError: string;
  saveOverview: (form: CaseOverviewForm) => Promise<boolean>;
};

export function OverviewSection() {
  const {
    detail,
    doctors,
    snippets,
    permissions,
    sectionBusy,
    sectionError,
    saveOverview,
  } = useCaseWorkspace();

  const revisionKey = detail?.updated_at ?? detail?.id ?? "empty";

  return (
    <OverviewSectionForm
      key={revisionKey}
      detail={detail}
      doctors={doctors}
      snippets={snippets}
      canEdit={permissions.canEdit}
      busy={sectionBusy === "overview"}
      sectionError={sectionError}
      saveOverview={saveOverview}
    />
  );
}

function OverviewSectionForm({
  detail,
  doctors,
  snippets,
  canEdit,
  busy,
  sectionError,
  saveOverview,
}: OverviewSectionFormProps) {
  const { t, lang } = useLang();
  const [form, setForm] = useState<CaseOverviewForm>(() =>
    initialOverviewForm(detail),
  );

  const activeSnippets = useMemo(
    () => snippets.filter((snippet) => snippet.is_active),
    [snippets],
  );

  const snippetContext = useMemo<CaseTextSnippetContext>(
    () => ({
      patientName: "",
      patientPid: "",
      caseId: detail?.case_id ?? "",
      caseUuid: detail?.case_uuid ?? detail?.id ?? "",
      hauptanfragegrund: form.hauptanfragegrund.trim(),
      zuweiser: form.zuweiser.trim(),
      today: new Date().toISOString().slice(0, 10),
    }),
    [
      detail?.case_id,
      detail?.case_uuid,
      detail?.id,
      form.hauptanfragegrund,
      form.zuweiser,
    ],
  );

  function updateField<K extends keyof CaseOverviewForm>(
    field: K,
    value: CaseOverviewForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function insertSnippet(snippet: CaseWorkspaceSnippet) {
    const rendered = renderCaseTextSnippet(snippet.body, snippetContext);
    setForm((current) => ({
      ...current,
      aktuelle_anamnese: appendSnippetToNarrative(
        current.aktuelle_anamnese,
        rendered,
      ),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    await saveOverview(form);
  }

  return (
    <Panel
      title={tri(lang, "Übersicht", "Обзор", "Overview")}
      description={tri(
        lang,
        "Hauptanfragegrund, Zuweiser und aktuelle Anamnese.",
        "Причина обращения, направивший врач и текущий анамнез.",
        "Main reason, referrer, and current anamnesis.",
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {sectionError ? <Banner tone="error">{sectionError}</Banner> : null}

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={tri(lang, "Hauptanfragegrund", "Причина обращения", "Main reason")}
            required
          >
            <Input
              value={form.hauptanfragegrund}
              onChange={(event) => updateField("hauptanfragegrund", event.target.value)}
              className={inputBaseClassName}
              disabled={!canEdit}
            />
          </Field>
          <Field label={tri(lang, "Zuweiser", "Направивший врач", "Referrer")}>
            <NativeComboboxSelect
              value={form.zuweiser_doctor_id}
              onChange={(event) => {
                const doctorId = event.target.value;
                const selectedDoctor = doctors.find((doctor) => doctor.id === doctorId);
                setForm((current) => ({
                  ...current,
                  zuweiser_doctor_id: doctorId,
                  zuweiser: selectedDoctor ? selectedDoctor.name : current.zuweiser,
                }));
              }}
              className={nativeSelectClassName}
              disabled={!canEdit}
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
            label={tri(
              lang,
              "Bezeichnung des Zuweisers",
              "Наименование направившего врача",
              "Referrer label",
            )}
          >
            <Input
              value={form.zuweiser}
              onChange={(event) => updateField("zuweiser", event.target.value)}
              className={inputBaseClassName}
              disabled={!canEdit}
            />
          </Field>
        </div>

        <Field
          label={tri(lang, "Aktuelle Anamnese", "Текущий анамнез", "Current anamnesis")}
          required
        >
          <textarea
            value={form.aktuelle_anamnese}
            onChange={(event) => updateField("aktuelle_anamnese", event.target.value)}
            className={textareaBaseClassName}
            rows={6}
            disabled={!canEdit}
          />
        </Field>

        <div className="rounded-xl border border-border/50 bg-muted/25 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">
                {tri(
                  lang,
                  "Textbausteine",
                  "Шаблоны текста",
                  "Text snippets",
                )}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {tri(
                  lang,
                  "Wiederverwendbare Fragmente zum Einfügen in den Anamnese-Text.",
                  "Повторно используемые фрагменты для вставки в текст анамнеза.",
                  "Reusable fragments to insert into the anamnesis text.",
                )}
              </p>
            </div>
            <code className="rounded-lg border border-border/50 bg-card px-3 py-1 text-[11px] text-muted-foreground">
              {CASE_TEXT_SNIPPET_PLACEHOLDERS.join(" · ")}
            </code>
          </div>
          {activeSnippets.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">
              {tri(
                lang,
                "Keine aktiven Textbausteine vorhanden.",
                "Активных шаблонов пока нет.",
                "No active snippets yet.",
              )}
            </p>
          ) : (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {activeSnippets.map((snippet) => {
                const rendered = renderCaseTextSnippet(
                  snippet.body,
                  snippetContext,
                );
                return (
                  <div
                    key={snippet.id}
                    className="rounded-xl border border-border/50 bg-card p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {snippet.label}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {snippetCategoryLabel(lang, snippet.category, t)}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-foreground">
                      {rendered}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg"
                        onClick={() => insertSnippet(snippet)}
                        disabled={!canEdit}
                      >
                        {tri(lang, "Einfügen", "Вставить", "Insert")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button
            type="submit"
            className="h-9 rounded-lg"
            disabled={busy || !canEdit}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {tri(
              lang,
              "Übersicht speichern",
              "Сохранить обзор",
              "Save overview",
            )}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
