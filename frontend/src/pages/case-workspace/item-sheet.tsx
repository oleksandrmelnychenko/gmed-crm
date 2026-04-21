import { LoaderCircle, Trash2 } from "lucide-react";
import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
      ? tri(lang, "Hinzufügen", "Добавить", "Add")
      : tri(lang, "Änderungen speichern", "Сохранить изменения", "Save changes");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex flex-col gap-0 border-l border-slate-200 p-0",
          width === "wide" ? "w-full sm:max-w-[720px]" : "w-full sm:max-w-[520px]",
        )}
      >
        <SheetHeader className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-orange-50/40 to-transparent px-5 py-4">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-orange-500 shadow-[0_0_0_3px_rgba(249,115,22,0.15)]"
            />
            <SheetTitle className="text-[15px] font-semibold tracking-tight text-slate-950">
              {title}
            </SheetTitle>
          </div>
          {description ? (
            <SheetDescription className="text-[12.5px] leading-relaxed text-slate-500">
              {description}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <form
          onSubmit={(event) => {
            if (!canSubmit || busy) {
              event.preventDefault();
              return;
            }
            void onSubmit(event);
          }}
          className="flex flex-1 min-h-0 flex-col"
        >
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
            {error ? <Banner tone="error">{error}</Banner> : null}
            {children}
          </div>

          <footer className="shrink-0 border-t border-slate-200 bg-slate-50/60 px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                {mode === "edit" && onDelete ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-2xl border-rose-200 text-rose-700 hover:bg-rose-50"
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
                  className="rounded-2xl"
                  onClick={() => onOpenChange(false)}
                  disabled={busy}
                >
                  {t.common_cancel}
                </Button>
                <Button
                  type="submit"
                  className="rounded-2xl bg-slate-950 text-white hover:bg-slate-800"
                  disabled={busy || !canSubmit}
                >
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {submitLabel ?? defaultSubmit}
                </Button>
              </div>
            </div>
          </footer>
        </form>
      </SheetContent>
    </Sheet>
  );
}
