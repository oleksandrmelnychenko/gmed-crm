import { useState, type ReactNode } from "react";
import { BookOpen, HelpCircle, SlidersHorizontal, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
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
  /** Visual size of the trigger button. Defaults to a compact, bare icon. */
  buttonClassName?: string;
};

export function AdminGuideButton({
  title,
  description,
  children,
  showTableToolbarGuide = true,
  buttonClassName = "size-8 rounded-lg",
}: AdminGuideButtonProps) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="ghost"
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
            <DialogTitle><SectionHeading icon={BookOpen}>{title}</SectionHeading></DialogTitle>
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
              className="h-8 rounded-lg"
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
  icon?: LucideIcon;
  title: ReactNode;
  children: ReactNode;
};

export function GuideSection({ title, icon, children }: GuideSectionProps) {
  return (
    <section className="space-y-1.5">
      <h4><SectionHeading icon={icon}>{title}</SectionHeading></h4>
      <div className="text-muted-foreground">{children}</div>
    </section>
  );
}

function TableToolbarGuide() {
  const { t } = useLang();

  return (
    <GuideSection icon={SlidersHorizontal} title={t.admin_guide_table_toolbar}>
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
