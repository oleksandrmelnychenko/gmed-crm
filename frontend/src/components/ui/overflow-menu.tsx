import { Menu } from "@base-ui/react/menu";
import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type OverflowMenuItem = {
  key: string;
  label: ReactNode;
  icon?: ReactNode;
  /** Extra text after the label, e.g. a count or the current state. */
  detail?: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  /** Tooltip, e.g. why a disabled item is blocked. */
  title?: string;
  className?: string;
};

const ITEM_CLASS =
  "flex min-h-9 w-full cursor-pointer select-none items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none data-disabled:cursor-default data-disabled:opacity-70 data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

/**
 * A "more" button whose menu holds the secondary actions of a crowded bar
 * (page header, top bar), so the bar fits its width instead of drawing
 * buttons over each other.
 */
export function OverflowMenu({
  label,
  items,
  triggerContent,
  triggerClassName,
  align = "end",
}: {
  /** Accessible name and tooltip of the trigger. */
  label: string;
  items: OverflowMenuItem[];
  /** Trigger content; a "…" icon when omitted. */
  triggerContent?: ReactNode;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border bg-background px-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted motion-reduce:transition-none [&_svg]:size-4 [&_svg]:shrink-0",
          triggerClassName,
        )}
      >
        {triggerContent ?? <MoreHorizontal aria-hidden="true" />}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align={align} sideOffset={6} collisionPadding={12} className="isolate z-[150]">
          <Menu.Popup className="min-w-52 max-w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl outline-none duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 motion-reduce:animate-none">
            {items.map((item) => (
              <Menu.Item
                key={item.key}
                className={cn(ITEM_CLASS, item.className)}
                disabled={item.disabled}
                title={item.title}
                onClick={item.onSelect}
              >
                {item.icon}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail !== undefined && item.detail !== null ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{item.detail}</span>
                ) : null}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
