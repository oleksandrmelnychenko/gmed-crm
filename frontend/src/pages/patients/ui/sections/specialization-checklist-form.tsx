import { cn } from "@/lib/utils";
import {
  checklistBmi,
  checklistGroupDeclined,
  parseChecklistTemplate,
  type ChecklistAnswer,
  type ChecklistItem,
  type SpecializationChecklist,
} from "../../data/specialization-checklist";

type Bilingual = (ru: string, de: string) => string;

const inputClass =
  "h-8 rounded-md border border-border bg-field px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/40";

/**
 * The yes/no questions of a specialization's anamnesis template. Follow-up
 * fields appear once a question is answered with "ja"; the questions of a
 * group answered with "nein" are hidden.
 */
export function SpecializationChecklistForm({
  checklist,
  tx,
  disabled = false,
  onChange,
}: {
  checklist: SpecializationChecklist;
  tx: Bilingual;
  disabled?: boolean;
  onChange: (next: SpecializationChecklist) => void;
}) {
  const items = parseChecklistTemplate(checklist.template);

  function patch(item: ChecklistItem, change: (answer: ChecklistAnswer) => ChecklistAnswer) {
    const key = String(item.index);
    onChange({ ...checklist, answers: { ...checklist.answers, [key]: change(checklist.answers[key] ?? {}) } });
  }

  return (
    <div data-specialization-checklist className="space-y-1.5">
      {items.map((item) => {
        if (checklistGroupDeclined(items, item, checklist.answers)) return null;
        const answer = checklist.answers[String(item.index)] ?? {};
        const interactive = item.yesNo || item.fields.length > 0;
        if (!interactive) {
          return (
            <p key={item.index} className={cn("pt-1 text-xs font-semibold text-foreground", item.child && "pl-4 font-medium")}>
              {item.label}
            </p>
          );
        }
        const open = !item.yesNo || answer.value === "ja";
        return (
          <div
            key={item.index}
            data-specialization-checklist-item={item.label}
            className={cn("rounded-md border border-border/60 bg-white px-2.5 py-1.5", item.child && "ml-4")}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn("text-sm text-foreground", !item.child && "font-semibold")}>{item.label}</span>
              {item.yesNo ? (
                <span role="group" aria-label={item.label} className="inline-flex rounded-md border border-border bg-white p-0.5">
                  {(["ja", "nein"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={disabled}
                      aria-pressed={answer.value === value}
                      className={cn(
                        "h-6 min-w-12 rounded px-2 text-xs font-medium transition-colors",
                        answer.value === value
                          ? value === "ja" ? "bg-orange-500 text-white" : "bg-slate-600 text-white"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                      // A second click withdraws the answer.
                      onClick={() => patch(item, (current) => ({ ...current, value: current.value === value ? null : value }))}
                    >
                      {value === "ja" ? tx("Да", "Ja") : tx("Нет", "Nein")}
                    </button>
                  ))}
                </span>
              ) : null}
            </div>
            {open && (item.options.length > 0 || item.fields.length > 0) ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                {item.options.map((option) => {
                  const checked = (answer.options ?? []).includes(option);
                  return (
                    <label key={option} className="inline-flex items-center gap-1.5 text-xs text-foreground">
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        className="size-3.5 rounded border-border accent-orange-500"
                        onChange={() =>
                          patch(item, (current) => ({
                            ...current,
                            options: checked
                              ? (current.options ?? []).filter((value) => value !== option)
                              : [...(current.options ?? []), option],
                          }))
                        }
                      />
                      {option}
                    </label>
                  );
                })}
                {item.fields.map((field) => {
                  const label = field.label || tx("Примечание", "Notiz");
                  if (field.kind === "bmi") {
                    const bmi = checklistBmi(item, answer);
                    return (
                      <span key={field.key} className="text-xs text-muted-foreground">
                        BMI: <span className="font-semibold text-foreground">{bmi || "—"}</span>
                      </span>
                    );
                  }
                  return (
                    <label
                      key={field.key}
                      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", field.kind === "text" && "min-w-48 flex-1")}
                    >
                      <span className="shrink-0">{field.unit ? `${label}, ${field.unit}` : label}</span>
                      <input
                        type="text"
                        inputMode={field.kind === "number" ? "decimal" : undefined}
                        disabled={disabled}
                        value={answer.fields?.[field.key] ?? ""}
                        className={cn(inputClass, field.kind === "number" ? "w-20" : "min-w-0 flex-1")}
                        onChange={(event) =>
                          patch(item, (current) => ({
                            ...current,
                            fields: { ...(current.fields ?? {}), [field.key]: event.target.value },
                          }))
                        }
                      />
                    </label>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
