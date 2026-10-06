import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { setPortalAccountLabel, usePortalAccountLabel } from "./portal-account-label";

function Label({ userId }: { userId: string | null }) {
  return <span>{usePortalAccountLabel(userId) ?? "role"}</span>;
}

const render = (userId: string | null) => renderToStaticMarkup(<Label userId={userId} />);

describe("portal account label", () => {
  it("names the login it was set for, never another one, until it is cleared", () => {
    expect(render("parent-1")).toBe("<span>role</span>");
    setPortalAccountLabel("parent-1", "Elternteil / gesetzliche Vertretung");
    expect(render("parent-1")).toBe("<span>Elternteil / gesetzliche Vertretung</span>");
    // Another login in the same tab (after a sign-out) keeps its role name.
    expect(render("patient-2")).toBe("<span>role</span>");
    expect(render(null)).toBe("<span>role</span>");
    // Clearing for another login leaves the label alone.
    setPortalAccountLabel("patient-2", null);
    expect(render("parent-1")).toBe("<span>Elternteil / gesetzliche Vertretung</span>");
    setPortalAccountLabel("parent-1", "  ");
    expect(render("parent-1")).toBe("<span>role</span>");
  });
});
