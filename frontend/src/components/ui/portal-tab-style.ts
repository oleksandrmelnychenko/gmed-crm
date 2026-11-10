import { cn } from "@/lib/utils";

export function portalTabTone(selected: boolean) {
  return selected ? "border-border bg-muted/50 font-semibold text-foreground"
    : "border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground";
}

export function portalFilterClass(selected: boolean) {
  return cn("inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-2.5 py-1 text-sm leading-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", portalTabTone(selected));
}
