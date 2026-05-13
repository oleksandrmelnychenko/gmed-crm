import { type ReactNode } from "react";

import { Pencil } from "lucide-react";

import { formatUiText, useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";

export function InfoRow({
  label,
  value,
  onEdit,
  editLabel,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  onEdit?: () => void;
  editLabel?: string;
  className?: string;
}) {
  const { t } = useLang();
  const resolvedEditLabel =
    editLabel ??
    (typeof label === "string"
      ? formatUiText(t.uiText.common_edit_label, { label })
      : t.common_edit);

  return (
    <div className={cn("group relative flex flex-col gap-1", className)}>
      <span className={tokens.text.label}>{label}</span>
      <span className={tokens.text.body}>{value}</span>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={resolvedEditLabel}
          className="absolute top-0 right-0 rounded-md p-1 text-muted-foreground/70 opacity-0 transition group-hover:opacity-100 hover:bg-muted hover:text-foreground"
        >
          <Pencil className={tokens.control.iconButton} />
        </button>
      ) : null}
    </div>
  );
}
