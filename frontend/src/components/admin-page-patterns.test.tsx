import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SheetActionsFooter, SheetFormFooter } from "@/components/admin-page-patterns";
import { OverlayDirtyContext, type OverlayDirtyContextValue } from "@/components/ui/dismissal-guard";
import { t } from "@/lib/i18n";

function overlay(requireChanges: boolean, isDirty: boolean): OverlayDirtyContextValue {
  return {
    requireChanges,
    isDirty,
    confirmDismiss: () => true,
    updateField: () => undefined,
    resetDirty: () => undefined,
    resetVersion: 0,
  };
}

function render(value: OverlayDirtyContextValue, child: ReactNode) {
  return renderToStaticMarkup(
    createElement(OverlayDirtyContext.Provider, { value }, child),
  );
}

const formFooter = createElement(SheetFormFooter, {
  cancelLabel: "Cancel",
  submitLabel: "Save",
  onCancel: () => undefined,
});

// The server snapshot of the UI language is Russian.
const noChanges = t("ru").common_save_no_changes;

describe("sheet footers of a sheet that saves only changes", () => {
  it("explain the disabled Save while nothing changed", () => {
    const html = render(overlay(true, false), formFooter);

    expect(html).toContain(noChanges);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  it("drop the hint once the form changed or when changes are not required", () => {
    expect(render(overlay(true, true), formFooter)).not.toContain(noChanges);
    expect(render(overlay(false, false), formFooter)).not.toContain(noChanges);
  });

  it("show the hint in an actions footer only when it holds the Save", () => {
    const actions = (noChangesHint: boolean) =>
      createElement(SheetActionsFooter, { noChangesHint }, createElement("button", { type: "submit" }, "Save"));

    expect(render(overlay(true, false), actions(true))).toContain(noChanges);
    expect(render(overlay(true, false), actions(false))).not.toContain(noChanges);
  });
});
