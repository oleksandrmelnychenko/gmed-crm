import { useId, useMemo, useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { checkboxClass, tokens } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Banner, Field, Panel, textareaBaseClassName } from "./primitives";

type SpecialtyBooleanFlag<T> = {
  key: keyof T & string;
  label: string;
};

type SpecialtyTextField<T> = {
  key: keyof T & string;
  label: string;
  hint?: string;
  rows?: number;
};

export type SpecialtySectionProps<T extends Record<string, unknown>> = {
  title: string;
  description: string;
  blankValue: T;
  rawValue: Partial<T> | null | undefined;
  booleanFlags: ReadonlyArray<SpecialtyBooleanFlag<T>>;
  textFields: ReadonlyArray<SpecialtyTextField<T>>;
  save: (form: T) => Promise<boolean>;
  busy: boolean;
  sectionError: string;
  canEdit: boolean;
  revisionKey: string;
};

export function SpecialtySection<T extends Record<string, unknown>>({
  revisionKey,
  ...props
}: SpecialtySectionProps<T>) {
  return <SpecialtySectionContent key={revisionKey} {...props} />;
}

type SpecialtySectionContentProps<T extends Record<string, unknown>> = Omit<
  SpecialtySectionProps<T>,
  "revisionKey"
>;

function SpecialtySectionContent<T extends Record<string, unknown>>({
  title,
  description,
  blankValue,
  rawValue,
  booleanFlags,
  textFields,
  save,
  busy,
  sectionError,
  canEdit,
}: SpecialtySectionContentProps<T>) {
  const { t } = useLang();

  const hydrate = useMemo<T>(
    () => ({ ...blankValue, ...(rawValue ?? {}) }) as T,
    [blankValue, rawValue],
  );

  const [form, setForm] = useState<T>(() => hydrate);

  function toggleBoolean(key: keyof T & string) {
    setForm((current) => ({ ...current, [key]: !current[key] }) as T);
  }

  function updateText(key: keyof T & string, value: string) {
    setForm((current) => ({ ...current, [key]: value }) as T);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    await save(form);
  }

  const isRelevant = Boolean((form as { is_relevant?: boolean }).is_relevant);
  const relevantInputId = useId();
  const relevantLabel = t.cases_workspace_specialty_relevant;

  return (
    <Panel title={title} description={description}>
      <form onSubmit={handleSubmit} className="space-y-5">
        {sectionError ? <Banner tone="error">{sectionError}</Banner> : null}

        <label
          htmlFor={relevantInputId}
          aria-label={relevantLabel}
          className={cn(
            "flex cursor-pointer items-center justify-between gap-3 rounded-xl px-4 py-3 transition-colors",
            isRelevant
              ? "border border-primary/35 bg-primary/5"
              : cn(tokens.surface.mutedCard, "hover:bg-muted/30"),
          )}
        >
          <div>
            <p className="text-sm font-medium text-foreground">
              {t.cases_workspace_specialty_relevant}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {t.cases_workspace_specialty_relevant_hint}
            </p>
          </div>
          <input
            id={relevantInputId}
            type="checkbox"
            className={checkboxClass}
            checked={isRelevant}
            onChange={() => toggleBoolean("is_relevant" as keyof T & string)}
            disabled={!canEdit || busy}
          />
        </label>

        {booleanFlags.length > 0 ? (
          <div>
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" />
              {t.cases_workspace_specialty_key_signs}
            </p>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {booleanFlags.map((flag) => {
                const checked = Boolean(form[flag.key]);
                return (
                  <label
                    key={flag.key}
                    className={cn(
                      "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors",
                      checked
                        ? "border border-primary/35 bg-primary/5 text-foreground"
                        : cn(tokens.surface.card, "text-foreground hover:bg-muted/30"),
                    )}
                  >
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={checked}
                      onChange={() => toggleBoolean(flag.key)}
                      disabled={!canEdit || busy}
                    />
                    <span className="leading-tight">
                      {flag.label}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          {textFields.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              hint={field.hint}
            >
              <textarea
                value={(form[field.key] as string | undefined) ?? ""}
                onChange={(event) => updateText(field.key, event.target.value)}
                className={textareaBaseClassName}
                rows={field.rows ?? 3}
                disabled={!canEdit || busy}
              />
            </Field>
          ))}
        </div>

        <div className="flex justify-end border-t border-border/60 pt-4">
          <Button
            type="submit"
            className="h-9 rounded-lg"
            disabled={busy || !canEdit}
          >
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t.cases_workspace_specialty_save}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
