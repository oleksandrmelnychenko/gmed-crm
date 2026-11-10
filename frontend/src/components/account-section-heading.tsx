import { SectionHeading } from "@/components/ui/section-heading";
import type { LucideIcon } from "lucide-react";

export function AccountSectionHeading({ icon: Icon, title, id, as: Heading = "h3" }: {
  icon: LucideIcon; title: string; id?: string; as?: "h2" | "h3";
}) {
  return (
    <Heading id={id} className="inline-flex min-w-0 items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
      <SectionHeading icon={Icon}>{title}</SectionHeading>
    </Heading>
  );
}
