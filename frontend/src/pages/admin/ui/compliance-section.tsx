import { type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AdminSectionTitle } from "@/components/admin-page-patterns";

/** A consistent section for the privacy registers and their patient evidence. */
export function ComplianceSection({
  icon,
  title,
  accessory,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
        <AdminSectionTitle icon={icon}>{title}</AdminSectionTitle>
        {accessory ? <div className="min-w-0 max-w-full">{accessory}</div> : null}
      </div>
      <div className="min-w-0 space-y-4 p-4">{children}</div>
    </section>
  );
}
