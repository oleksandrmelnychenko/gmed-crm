import type { ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { Info } from "lucide-react";

/** An optional explanation, accessible by mouse, keyboard and touch. */
export function InfoHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:size-10"
      >
        <Info aria-hidden="true" className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner sideOffset={6} className="z-[100]">
          <Popover.Popup aria-label={label} className="max-w-[min(360px,calc(100vw-24px))] rounded-lg border border-border bg-card p-3 font-sans text-xs font-normal leading-5 text-foreground shadow-md">
            <Popover.Description>{children}</Popover.Description>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
