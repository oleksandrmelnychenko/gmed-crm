import { useState, type ReactNode } from "react";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLang } from "@/lib/i18n";

type AdminGuideButtonProps = {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Render the standard data-table toolbar guide section. Defaults to true. */
  showTableToolbarGuide?: boolean;
  /** Visual size of the trigger button. Defaults to h-9 w-9 outline. */
  buttonClassName?: string;
};

export function AdminGuideButton({
  title,
  description,
  children,
  showTableToolbarGuide = true,
  buttonClassName = "size-9 rounded-lg bg-card",
}: AdminGuideButtonProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        className={buttonClassName}
        title={t.admin_guide_open}
        aria-label={t.admin_guide_open}
        onClick={() => setOpen(true)}
      >
        <HelpCircle className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className="space-y-4 text-[13px]">
            {children}
            {showTableToolbarGuide ? <TableToolbarGuide /> : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="default"
              className="h-9 rounded-lg"
              onClick={() => setOpen(false)}
            >
              {t.common_close}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

type GuideSectionProps = {
  title: ReactNode;
  children: ReactNode;
};

export function GuideSection({ title, children }: GuideSectionProps) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

function TableToolbarGuide() {
  const { t } = useLang();

  return (
    <GuideSection title={t.admin_guide_table_toolbar}>
      <ul className="space-y-1">
        <li>
          <span className="font-medium text-foreground">+ {t.table_filter}</span>{" "}
          - {t.admin_guide_filter_hint}
        </li>
        <li>
          <span className="font-medium text-foreground">{"\u2191\u2193"} {t.common_sort}</span>{" "}
          - {t.admin_guide_sort_hint}
        </li>
        <li>
          <span className="font-medium text-foreground">{t.table_columns}</span>{" "}
          - {t.admin_guide_columns_hint}
        </li>
        <li>
          <span className="font-medium text-foreground">{t.table_density}</span>{" "}
          - {t.admin_guide_density_hint}
        </li>
        <li>
          <span className="font-medium text-foreground">{t.admin_guide_column_width}</span>{" "}
          - {t.admin_guide_column_width_hint}
        </li>
      </ul>
    </GuideSection>
  );
}
