import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLang } from "@/lib/i18n";

import { type VegetativeForm, useCaseWorkspace } from "./context";
import {
  Banner,
  Field,
  Panel,
  inputBaseClassName,
  textareaBaseClassName,
} from "./primitives";

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

function hydrateVegetative(
  raw:
    | {
        appetit_durst?: string | null;
        koerpergroesse?: number | null;
        gewicht?: number | null;
        gewichtsveraenderung?: string | null;
        grund?: string | null;
      }
    | null
    | undefined,
): VegetativeForm {
  return {
    appetit_durst: raw?.appetit_durst ?? "",
    koerpergroesse:
      raw?.koerpergroesse != null && Number.isFinite(raw.koerpergroesse)
        ? String(raw.koerpergroesse)
        : "",
    gewicht:
      raw?.gewicht != null && Number.isFinite(raw.gewicht) ? String(raw.gewicht) : "",
    gewichtsveraenderung: raw?.gewichtsveraenderung ?? "",
    grund: raw?.grund ?? "",
  };
}

export function VegetativeSection() {
  const { lang } = useLang();
  const {
    detail,
    permissions,
    sectionBusy,
    sectionError,
    saveVegetative,
  } = useCaseWorkspace();

  const revisionKey = detail?.updated_at ?? detail?.id ?? "empty";

  return (
    <VegetativeSectionForm
      key={revisionKey}
      rawValue={detail?.vegetative_anamnese}
      canEdit={permissions.canEdit}
      busy={sectionBusy === "vegetative"}
      sectionError={sectionError}
      saveVegetative={saveVegetative}
      lang={lang}
    />
  );
}

type VegetativeSectionFormProps = {
  rawValue:
    | {
        appetit_durst?: string | null;
        koerpergroesse?: number | null;
        gewicht?: number | null;
        gewichtsveraenderung?: string | null;
        grund?: string | null;
      }
    | null
    | undefined;
  canEdit: boolean;
  busy: boolean;
  sectionError: string;
  saveVegetative: (form: VegetativeForm) => Promise<boolean>;
  lang: string;
};

function VegetativeSectionForm({
  rawValue,
  canEdit,
  busy,
  sectionError,
  saveVegetative,
  lang,
}: VegetativeSectionFormProps) {
  const [form, setForm] = useState<VegetativeForm>(() =>
    hydrateVegetative(rawValue),
  );

  function update<K extends keyof VegetativeForm>(
    field: K,
    value: VegetativeForm[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    await saveVegetative(form);
  }

  return (
    <Panel
      title={tri(lang, "Vegetative Anamnese", "Вегетативный анамнез", "Vegetative")}
      description={tri(
        lang,
        "Appetit, Gewicht, Körpergröße und vegetative Veränderungen.",
        "Аппетит, вес, рост и вегетативные изменения.",
        "Appetite, weight, height, and vegetative changes.",
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {sectionError ? <Banner tone="error">{sectionError}</Banner> : null}

        <Field label={tri(lang, "Appetit / Durst", "Аппетит / жажда", "Appetite / thirst")}>
          <textarea
            value={form.appetit_durst}
            onChange={(event) => update("appetit_durst", event.target.value)}
            className={textareaBaseClassName}
            rows={3}
            disabled={!canEdit || busy}
          />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={tri(lang, "Körpergröße (cm)", "Рост (см)", "Height (cm)")}
            hint={tri(lang, "Zahl, z. B. 176", "Число, например 176", "Number, e.g. 176")}
          >
            <Input
              value={form.koerpergroesse}
              onChange={(event) => update("koerpergroesse", event.target.value)}
              className={inputBaseClassName}
              disabled={!canEdit || busy}
              inputMode="numeric"
            />
          </Field>
          <Field
            label={tri(lang, "Gewicht (kg)", "Вес (кг)", "Weight (kg)")}
            hint={tri(lang, "Zahl, z. B. 78.5", "Число, например 78.5", "Number, e.g. 78.5")}
          >
            <Input
              value={form.gewicht}
              onChange={(event) => update("gewicht", event.target.value)}
              className={inputBaseClassName}
              disabled={!canEdit || busy}
              inputMode="decimal"
            />
          </Field>
        </div>

        <Field
          label={tri(
            lang,
            "Gewichtsveränderung",
            "Изменение веса",
            "Weight change",
          )}
        >
          <textarea
            value={form.gewichtsveraenderung}
            onChange={(event) => update("gewichtsveraenderung", event.target.value)}
            className={textareaBaseClassName}
            rows={3}
            disabled={!canEdit || busy}
          />
        </Field>

        <Field
          label={tri(
            lang,
            "Grund / Kontext",
            "Причина / контекст",
            "Reason / context",
          )}
        >
          <textarea
            value={form.grund}
            onChange={(event) => update("grund", event.target.value)}
            className={textareaBaseClassName}
            rows={3}
            disabled={!canEdit || busy}
          />
        </Field>

        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button
            type="submit"
            className="h-9 rounded-lg"
            disabled={busy || !canEdit}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {tri(lang, "Abschnitt speichern", "Сохранить раздел", "Save section")}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
