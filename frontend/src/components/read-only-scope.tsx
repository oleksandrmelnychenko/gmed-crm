/**
 * Read-only mode for a whole page or a form.
 *
 * `<ReadOnlyScope active={!can("orders.edit")}>` disables the shared form
 * controls rendered inside it (`Input`, date pickers, `SelectField`,
 * `NativeComboboxSelect`, `Button[type=submit]`, `Button[data-action="write"]`)
 * and hides `InfoRow` edit pencils, so a page needs one wrapper instead of a
 * `disabled` prop on every field. Filters keep working: `Input[type=search]`
 * and controls marked `data-readonly="exempt"` stay enabled, and
 * `<WritableScope>` opens a writable pocket (the data-table toolbar uses it).
 *
 * The outermost active scope shows one banner; nested scopes do not repeat it.
 * See docs/role-cabinets-plan-2026-09-20_ua.md §3.3.
 */

import { Eye } from "lucide-react";
import * as React from "react";

import { useLang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ReadOnlyContext = React.createContext(false);

/** `true` inside an active `ReadOnlyScope`. */
export function useReadOnly(): boolean {
  return React.useContext(ReadOnlyContext);
}

export type ReadOnlyExemptProps = {
  /** `exempt` keeps the control enabled inside a read-only scope (filters, search). */
  "data-readonly"?: "exempt";
};

/**
 * Whether a shared control must render disabled: it sits in a read-only scope
 * and is neither a search box nor explicitly exempt.
 */
export function readOnlyDisables(
  readOnly: boolean,
  props: ReadOnlyExemptProps & { type?: string },
): boolean {
  if (!readOnly) return false;
  if (props["data-readonly"] === "exempt") return false;
  return props.type !== "search";
}

export function ReadOnlyBanner({ className }: { className?: string }) {
  const { t } = useLang();
  return (
    <div
      role="status"
      data-testid="read-only-banner"
      className={cn(
        "flex items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground",
        className,
      )}
    >
      <Eye aria-hidden className="size-4 shrink-0" />
      <span className="font-medium text-foreground">{t.read_only_scope_title}</span>
      <span className="hidden sm:inline">· {t.read_only_scope_hint}</span>
    </div>
  );
}

export function ReadOnlyScope({
  active = true,
  banner = true,
  bannerClassName,
  children,
}: {
  /** `false` renders children writable (also inside an outer read-only scope). */
  active?: boolean;
  /** Hide the banner while still disabling controls. */
  banner?: boolean;
  bannerClassName?: string;
  children: React.ReactNode;
}) {
  const parentReadOnly = React.useContext(ReadOnlyContext);
  const showBanner = active && banner && !parentReadOnly;
  return (
    <ReadOnlyContext.Provider value={active}>
      {showBanner ? <ReadOnlyBanner className={bannerClassName} /> : null}
      {children}
    </ReadOnlyContext.Provider>
  );
}

/** A writable pocket inside a read-only scope (filter toolbars, search). */
export function WritableScope({ children }: { children: React.ReactNode }) {
  return <ReadOnlyContext.Provider value={false}>{children}</ReadOnlyContext.Provider>;
}
