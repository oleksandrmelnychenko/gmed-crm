import { useId, type ComponentProps, type ReactNode } from "react";
import { AdminSectionTitle } from "@/components/admin-page-patterns";
import { cn } from "@/lib/utils";

export function DatevSetupSection({
  title, description, action, children, className, bodyClassName, ...props
}: Omit<ComponentProps<"section">, "title"> & {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  bodyClassName?: string;
}) {
  const titleId = useId();
  return (
    <section {...props} aria-labelledby={titleId} className={cn("min-w-0 overflow-hidden rounded-lg border border-border/70 bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3.5 py-2.5">
        <AdminSectionTitle><span id={titleId}>{title}</span></AdminSectionTitle>
        {action ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      <div className={cn("min-w-0 space-y-3 p-3.5", bodyClassName)}>
        {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
        {children}
      </div>
    </section>
  );
}
