import { useState } from "react";

import { Input } from "@/components/ui/input";
import { inputClass } from "@/components/ui-shell";
import { cn } from "@/lib/utils";
import { INVOICE_LINE_COMMENT_MAX_LENGTH } from "../model/invoice-model";

type Props = {
  comment: string | null | undefined;
  /** Draft invoice and the right to create invoices: the remark can be typed. */
  editable: boolean;
  /** Accessible name of the field, including the position it belongs to. */
  label: string;
  placeholder: string;
  /** Saves the trimmed remark; an empty string clears it. Rejects with a readable message. */
  onSave: (comment: string) => Promise<void>;
};

/**
 * The remark of one invoice position. On a draft it is a field saved when
 * focus leaves it or Enter is pressed; on a released invoice it is plain text.
 */
export function InvoiceLineComment({ comment, editable, label, placeholder, onSave }: Props) {
  const stored = comment?.trim() ?? "";
  const [base, setBase] = useState(stored);
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The stored remark changed (saved, or the invoice was reloaded): start from it.
  if (base !== stored) {
    setBase(stored);
    setDraft(stored);
    setError(null);
  }

  if (!editable) {
    return stored ? (
      <p className="line-clamp-2 break-words text-xs leading-4 text-muted-foreground" title={stored}>
        {stored}
      </p>
    ) : null;
  }

  async function save() {
    const next = draft.trim();
    if (busy || next === stored) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Input
        aria-label={label}
        aria-invalid={error ? true : undefined}
        placeholder={placeholder}
        maxLength={INVOICE_LINE_COMMENT_MAX_LENGTH}
        disabled={busy}
        value={draft}
        className={cn(inputClass, "h-8 text-xs")}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
      />
      {error ? <p role="alert" className="text-xs leading-4 text-destructive">{error}</p> : null}
    </div>
  );
}
