import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CountBadge } from "@/components/ui-shell";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { CaseItemEditSheet } from "./item-sheet";
import { Panel } from "./primitives";

type SheetState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit"; index: number };

export type CaseItemListProps<T> = {
  title: string;
  description: string;
  items: readonly T[];
  blankItem: T;
  cloneItem: (item: T) => T;
  isValid: (form: T) => boolean;
  validate?: (form: T) => string | null;
  save: (nextItems: T[]) => Promise<boolean>;
  renderCard: (item: T, index: number) => ReactNode;
  renderForm: (args: {
    form: T;
    setForm: (next: T) => void;
    updateField: <K extends keyof T>(field: K, value: T[K]) => void;
    disabled: boolean;
  }) => ReactNode;
  busy: boolean;
  sectionError: string;
  canEdit: boolean;
  sheetTitle: { create: string; edit: string };
  sheetDescription?: string;
  sheetWidth?: "default" | "wide";
  emptyTitle: string;
  emptyHint?: string;
  addFirstLabel: string;
  missingPrimaryMessage: string;
};

export function CaseItemList<T>({
  title,
  description,
  items,
  blankItem,
  cloneItem,
  isValid,
  validate,
  save,
  renderCard,
  renderForm,
  busy,
  sectionError,
  canEdit,
  sheetTitle,
  sheetDescription,
  sheetWidth = "default",
  emptyTitle,
  emptyHint,
  addFirstLabel,
  missingPrimaryMessage,
}: CaseItemListProps<T>) {
  const { t } = useLang();
  const [sheet, setSheet] = useState<SheetState>({ mode: "closed" });
  const [form, setForm] = useState<T>(blankItem);
  const [sheetError, setSheetError] = useState("");

  const closeSheet = useCallback(() => {
    setSheet({ mode: "closed" });
    setSheetError("");
  }, []);

  const updateField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setForm((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  function openCreate() {
    if (!canEdit) return;
    setForm({ ...blankItem });
    setSheetError("");
    setSheet({ mode: "create" });
  }

  function openEdit(index: number) {
    const item = items[index];
    if (!item) return;
    setForm(cloneItem(item));
    setSheetError("");
    setSheet({ mode: "edit", index });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;

    if (!isValid(form)) {
      setSheetError(missingPrimaryMessage);
      return;
    }
    const customError = validate?.(form);
    if (customError) {
      setSheetError(customError);
      return;
    }

    const mutable = [...items];
    if (sheet.mode === "create") {
      mutable.push(form);
    } else if (sheet.mode === "edit") {
      mutable[sheet.index] = form;
    } else {
      return;
    }
    const ok = await save(mutable);
    if (ok) {
      closeSheet();
    } else {
      setSheetError(t.cases_workspace_item_save_failed);
    }
  }

  async function handleDelete() {
    if (sheet.mode !== "edit") return;
    if (!canEdit) return;
    const mutable = items.filter((_, idx) => idx !== sheet.index);
    const ok = await save(mutable);
    if (ok) {
      closeSheet();
    } else {
      setSheetError(t.cases_workspace_item_remove_failed);
    }
  }

  const populated = items.length > 0;

  return (
    <>
      <Panel
        title={title}
        description={description}
        action={
          <>
            <CountBadge>
              {items.length} {t.cases_workspace_item_count_label}
            </CountBadge>
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg"
                onClick={openCreate}
                disabled={busy}
              >
                <Plus className="size-4" />
                {t.cases_workspace_item_add}
              </Button>
            ) : null}
          </>
        }
      >
        {sectionError ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {sectionError}
          </div>
        ) : null}

        {!populated ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-muted/25 px-4 py-8 text-center">
            <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
            {emptyHint ? (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {emptyHint}
              </p>
            ) : null}
            {canEdit ? (
              <Button
                type="button"
                variant="outline"
                className="mt-4 h-8 rounded-lg"
                onClick={openCreate}
                disabled={busy}
              >
                <Plus className="size-4" />
                {addFirstLabel}
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item, index) => (
              <button
                type="button"
                key={`case-item-${index}`}
                onClick={() => openEdit(index)}
                disabled={busy || !canEdit}
                className={cn(
                  "group relative flex flex-col gap-2 rounded-xl border border-border/50 bg-card px-4 py-3 text-left transition-colors",
                  "hover:border-border hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  "disabled:opacity-60 disabled:cursor-not-allowed",
                )}
              >
                {renderCard(item, index)}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <CaseItemEditSheet
        open={sheet.mode !== "closed"}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeSheet();
        }}
        mode={sheet.mode === "edit" ? "edit" : "create"}
        title={sheet.mode === "edit" ? sheetTitle.edit : sheetTitle.create}
        description={sheetDescription}
        busy={busy}
        error={sheetError}
        canSubmit={canEdit && isValid(form)}
        canDelete={canEdit}
        onSubmit={handleSubmit}
        onDelete={sheet.mode === "edit" ? handleDelete : undefined}
        width={sheetWidth}
      >
        {renderForm({
          form,
          setForm,
          updateField,
          disabled: !canEdit || busy,
        })}
      </CaseItemEditSheet>
    </>
  );
}
