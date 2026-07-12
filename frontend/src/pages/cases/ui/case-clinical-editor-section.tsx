import type { FormEvent, ReactNode } from "react";
import { LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CaseClinicalField({
  label,
  children,
  hint,
  required = false,
  error = "",
}: {
  label: ReactNode;
  children: ReactNode;
  required?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11.5px] font-medium leading-tight text-muted-foreground">
        {label}
        {required ? <span aria-hidden="true" className="ml-1 text-rose-500">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-xs leading-snug text-rose-600">{error}</span>
      ) : hint ? (
        <span className="block text-xs leading-snug text-muted-foreground">{hint}</span>
      ) : null}
    </label>
  );
}

type CaseClinicalEditorSectionProps = {
  title: string;
  description?: string;
  count: number;
  itemsLabel: string;
  addLabel?: string;
  emptyTitle: string;
  emptyText: string;
  busy?: boolean;
  error?: string;
  canEdit?: boolean;
  autosave?: boolean;
  saveLabel?: string;
  onAdd?: () => void;
  onSave?: (event: FormEvent<HTMLFormElement>) => void;
  children?: ReactNode;
  tone?: "default" | "warning" | "danger";
};

const TONE_CLASSES = {
  default: "border-border bg-card",
  warning: "border-orange-200 bg-orange-50/30",
  danger: "border-rose-200 bg-rose-50/30",
} as const;

export function CaseClinicalEditorSection({
  title,
  description = "",
  count,
  itemsLabel,
  addLabel,
  emptyTitle,
  emptyText,
  busy = false,
  error = "",
  canEdit = true,
  autosave = false,
  saveLabel = "Save",
  onAdd,
  onSave,
  children,
  tone = "default",
}: CaseClinicalEditorSectionProps) {
  const hasContent = Array.isArray(children) ? children.length > 0 : Boolean(children);
  const content = (
    <>
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}
      {!hasContent ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
          <h4 className="text-sm font-semibold text-foreground">{emptyTitle}</h4>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{emptyText}</p>
        </div>
      ) : children}
      {!autosave && onSave ? (
        <div className="flex justify-end border-t border-border pt-4">
          <Button type="submit" className="h-9 rounded-lg px-3.5" disabled={busy || !canEdit}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {saveLabel}
          </Button>
        </div>
      ) : null}
    </>
  );

  return (
    <section className={cn("overflow-hidden rounded-xl border", TONE_CLASSES[tone])}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/80 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]",
                count > 0
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border bg-muted/30 text-muted-foreground",
              )}
            >
              {count > 0 ? <span aria-hidden className="size-1.5 rounded-full bg-[var(--brand)]" /> : null}
              {count} {itemsLabel}
            </span>
          </div>
          {description ? <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {canEdit && onAdd && addLabel ? (
          <Button type="button" variant="outline" size="sm" className="rounded-lg" onClick={onAdd}>
            <Plus className="size-4" />
            {addLabel}
          </Button>
        ) : null}
      </header>
      <div className="p-4">
        {autosave || !onSave ? (
          <div className="space-y-4">{content}</div>
        ) : (
          <form onSubmit={onSave} className="space-y-4">{content}</form>
        )}
      </div>
    </section>
  );
}
