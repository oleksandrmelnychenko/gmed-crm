import { useId, type FormEvent, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

import {
  AdminSheetScaffold,
  SheetActionsFooter,
} from "@/components/admin-page-patterns";
import { EmptyCell, checkboxClass, tokens } from "@/components/ui-shell";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { appointmentPreviewInfoCardClassName } from "@/pages/appointments/appearance/surface-appearance";

export function AppointmentWorkspaceSectionIntro({
  title,
  description,
  accessory,
}: {
  title: ReactNode;
  description: ReactNode;
  accessory?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{title}</h2>
        <p className="max-w-3xl text-xs text-muted-foreground">{description}</p>
      </div>
      {accessory ? <div className="shrink-0">{accessory}</div> : null}
    </div>
  );
}

export function AppointmentClinicalToggleCard({
  checked,
  disabled = false,
  title,
  description,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      aria-label={title}
      className={cn(
        "flex items-start gap-3",
        appointmentPreviewInfoCardClassName,
        disabled && "opacity-60",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className={cn(checkboxClass, "mt-0.5")}
      />
      <span className="min-w-0 space-y-1">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  );
}

export function AppointmentEditorSheet({
  open,
  onOpenChange,
  title,
  description,
  maxWidthClassName = "sm:max-w-[560px]",
  onSubmit,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  maxWidthClassName?: string;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  const content = (
    <AdminSheetScaffold
      title={title}
      description={description}
      headerClassName="px-4 py-3"
      bodyClassName="min-h-0 overscroll-y-contain space-y-4 px-5 py-4"
      footer={<SheetActionsFooter>{footer}</SheetActionsFooter>}
    >
      {children}
    </AdminSheetScaffold>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("w-full border-l border-border p-0", maxWidthClassName)}
      >
        {onSubmit ? (
          <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>
            {content}
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">{content}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function AppointmentPreviewSheet({
  open,
  onOpenChange,
  title,
  description,
  maxWidthClassName = "sm:max-w-[560px]",
  headerClassName,
  bodyClassName,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  maxWidthClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn("w-full border-l border-border p-0", maxWidthClassName)}
      >
        <AdminSheetScaffold
          title={title}
          description={description}
          headerClassName={cn("px-4 py-3", headerClassName)}
          bodyClassName={cn(
            "min-h-0 overscroll-y-contain",
            bodyClassName,
            "space-y-4 px-5 py-4",
          )}
        >
          {children}
        </AdminSheetScaffold>
      </SheetContent>
    </Sheet>
  );
}

export function AppointmentPreviewSheetLoadingState({
  open,
  onOpenChange,
  title,
  description,
  maxWidthClassName = "sm:max-w-[560px]",
  bodyClassName,
  loadingLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  maxWidthClassName?: string;
  bodyClassName?: string;
  loadingLabel: ReactNode;
}) {
  return (
    <AppointmentPreviewSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      maxWidthClassName={maxWidthClassName}
      bodyClassName={bodyClassName}
    >
      <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 size-4 animate-spin" />
        {loadingLabel}
      </div>
    </AppointmentPreviewSheet>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={tokens.text.label}>{label}</span>
      {children}
    </label>
  );
}

export function AppointmentSectionHeading({
  title,
  description,
}: {
  title: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-[var(--brand)]" />
        <h3 className={cn(tokens.text.sectionTitle, "truncate")}>{title}</h3>
      </div>
      {description ? (
        <p className={cn(tokens.text.muted, "max-w-3xl")}>{description}</p>
      ) : null}
    </div>
  );
}

export function AppointmentDotLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="size-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
      <p className={cn(tokens.text.eyebrow, "truncate")}>{children}</p>
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <EmptyCell>{text}</EmptyCell>;
}
