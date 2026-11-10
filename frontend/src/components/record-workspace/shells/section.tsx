import { SectionHeading } from "@/components/ui/section-heading";
import type { LucideIcon } from "lucide-react";
import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

import { tokens } from "../primitives/design-tokens";


export function Section({
  title,
  accessory,
  children,
  className,
  showMarker = true,
  icon,
}: {
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
  className?: string;
  showMarker?: boolean;
  icon?: LucideIcon;
}) {
  return (
    <section data-slot="record-section" className={cn("space-y-2.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className={cn(tokens.text.sectionTitle, "min-w-0 max-w-full break-words")}>
            {showMarker ? <SectionHeading icon={icon}>{title}</SectionHeading> : title}
          </h3>
        </div>
        {accessory ? <div className="min-w-0 max-w-full">{accessory}</div> : null}
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}
