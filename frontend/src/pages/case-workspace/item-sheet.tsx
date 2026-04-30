import { LoaderCircle, Trash2 } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { AdminSheetScaffold } from "@/components/admin-page-patterns";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { Banner } from "./primitives";

type CaseItemEditSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  title: string;
  description?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  canSubmit?: boolean;
  canDelete?: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  children: ReactNode;
  width?: "default" | "wide";
};

function tri(lang: string, de: string, ru: string, en: string) {
  if (lang === "de") return de;
  if (lang === "ru") return ru;
  return en;
}

export function CaseItemEditSheet({
  open,
  onOpenChange,
  mode,
  title,
  description,
  submitLabel,
  busy = false,
  error,
  canSubmit = true,
  canDelete = true,
  onSubmit,
  onDelete,
  children,
  width = "default",
}: CaseItemEditSheetProps) {
  const { t, lang } = useLang();
  const defaultSubmit =
    mode === "create"
      ? tri(lang, "Hinzufugen", "Добавить", "Add")
      : tri(lang, "Anderungen speichern", "Сохранить изменения", "Save changes");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "w-full border-l border-border p-0",
          width === "wide" ? "sm:max-w-[720px]" : "sm:max-w-[520px]",
        )}
      >
        <form
          onSubmit={(event) => {
            if (!canSubmit || busy) {
              event.preventDefault();
              return;
            }
            void onSubmit(event);
          }}
          className="flex h-full min-h-0 flex-col"
        >
          <AdminSheetScaffold
            title={title}
            description={description}
            headerClassName="px-5 py-4"
            bodyClassName="px-5 py-5 space-y-4"
            footer={
              <div className="shrink-0 border-t border-border bg-muted/25 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    {mode === "edit" && onDelete ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => void onDelete()}
                        disabled={busy || !canDelete}
                      >
                        <Trash2 className="size-4" />
                        {tri(lang, "Entfernen", "Удалить", "Remove")}
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 rounded-lg"
                      onClick={() => onOpenChange(false)}
                      disabled={busy}
                    >
                      {t.common_cancel}
                    </Button>
                    <Button
                      type="submit"
                      className="h-9 rounded-lg"
                      disabled={busy || !canSubmit}
                    >
                      {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                      {submitLabel ?? defaultSubmit}
                    </Button>
                  </div>
                </div>
              </div>
            }
          >
            {error ? <Banner tone="error">{error}</Banner> : null}
            {children}
          </AdminSheetScaffold>
        </form>
      </SheetContent>
    </Sheet>
  );
}

