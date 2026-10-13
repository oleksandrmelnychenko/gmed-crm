import { LoaderCircle, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { PatientSheetScaffold } from "@/pages/patients/ui/shared/patient-sheet-scaffold";
import { useLang } from "@/lib/i18n";

import { Banner } from "./primitives";

type CaseItemEditSheetProps = {
  open: boolean;
  dirty?: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  title: string;
  description?: string;
  submitLabel?: string;
  busy?: boolean;
  error?: string;
  canSubmit?: boolean;
  canDelete?: boolean;
  onSubmit: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  children: ReactNode;
  width?: "default" | "wide";
  presentation?: "sheet" | "dialog";
};

export function CaseItemEditSheet({
  open,
  dirty,
  onOpenChange,
  mode,
  title,
  description,
  submitLabel,
  busy = false,
  error,
  canSubmit = true,
  canDelete = true,
  onSubmit,
  onDelete,
  children,
  width = "default",
  presentation = "sheet",
}: CaseItemEditSheetProps) {
  const { t } = useLang();
  const defaultSubmit =
    mode === "create"
      ? t.cases_workspace_item_submit_create
      : t.cases_workspace_item_submit_edit;

  return (
    <PatientSheetScaffold
      dirty={dirty}
      requireChanges={mode === "edit"}
      open={open}
      onOpenChange={onOpenChange}
      presentation={presentation}
      title={title}
      description={description}
      maxWidthClassName={presentation === "dialog"
        ? width === "wide" ? "sm:max-w-[760px]" : "sm:max-w-[560px]"
        : width === "wide" ? "sm:max-w-[720px]" : "sm:max-w-[520px]"}
      footer={
        <div className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {mode === "edit" && onDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => void onDelete()}
                  disabled={busy || !canDelete}
                >
                  <Trash2 className="size-4" />
                  {t.cases_workspace_item_remove}
                </Button>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-lg"
                onClick={() => onOpenChange(false)}
                disabled={busy}
              >
                {t.common_cancel}
              </Button>
              <Button
                type="button"
                className="h-9 rounded-lg"
                requireChanges={mode === "edit"}
                disabled={busy || !canSubmit}
                onClick={() => void onSubmit()}
              >
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {submitLabel ?? defaultSubmit}
              </Button>
            </div>
          </div>
        </div>
      }
    >
      {error ? <Banner tone="error">{error}</Banner> : null}
      {children}
    </PatientSheetScaffold>
  );
}
