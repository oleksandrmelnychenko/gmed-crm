import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DocumentItem } from "@/pages/documents/model/types";
import { OrderResignAction } from "./order-resign-action";

const state = vi.hoisted(() => ({
  role: "ceo",
  click: null as (() => void) | null,
  fetch: vi.fn(),
  generate: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: state.role } }) }));
vi.mock("@/lib/use-staff-navigate", () => ({ useStaffNavigate: () => ({ staffGo: state.navigate }) }));
vi.mock("@/pages/documents/data/document-api", () => ({
  fetchDocuments: state.fetch,
  generateDocument: state.generate,
}));
// Capture the real action callback without mounting a browser or reaching an API.
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: ComponentProps<"button">) => {
    state.click = onClick ? () => onClick({} as never) : null;
    return <button {...props}>{children}</button>;
  },
}));

const document = (patch: Partial<DocumentItem> = {}): DocumentItem => ({
  id: "current-order-document",
  order_id: "order-1",
  generated_template_id: "single_order",
  is_latest_version: true,
  status: "active",
  ...patch,
}) as DocumentItem;

function render(lang: string, patientId: string | null = "patient-1", leadId: string | null = "lead-1") {
  return renderToStaticMarkup(<OrderResignAction orderId="order-1" patientId={patientId} leadId={leadId} lang={lang} />);
}

describe("OrderResignAction", () => {
  beforeEach(() => {
    state.role = "ceo";
    state.click = null;
    state.fetch.mockReset().mockResolvedValue([]);
    state.generate.mockReset().mockResolvedValue({ id: "new-document" });
    state.navigate.mockReset();
  });

  it.each([
    ["ru", "Создать новую версию заказа на подпись"],
    ["de", "Neue Auftragsversion zur Unterschrift erstellen"],
  ])("generates German from the %s UI and replaces the current document for the same order", async (lang, label) => {
    state.fetch.mockResolvedValue([
      document({ id: "other-order", order_id: "order-2" }),
      document({ id: "archived", status: "archived" }),
      document({ id: "older", is_latest_version: false }),
      document({ id: "estimate", generated_template_id: "order_cost_estimate" }),
      document(),
    ]);
    expect(render(lang)).toContain(label);
    expect(state.fetch).not.toHaveBeenCalled();
    state.click!();
    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());
    expect(state.fetch).toHaveBeenCalledWith("/documents?order_id=order-1");
    expect(state.generate).toHaveBeenCalledExactlyOnceWith({
      template_id: "single_order",
      order_id: "order-1",
      patient_id: "patient-1",
      language: "de",
      replace_document_id: "current-order-document",
    });
    expect(state.navigate).toHaveBeenCalledWith("/documents?order_id=order-1&document=new-document");
  });

  it("uses the lead identity before conversion and creates the first German version when none exists", async () => {
    state.role = "patient_manager";
    expect(render("ru", null, "lead-1")).toContain("order-resign-action");
    state.click!();
    await vi.waitFor(() => expect(state.navigate).toHaveBeenCalledOnce());
    expect(state.generate).toHaveBeenCalledExactlyOnceWith({
      template_id: "single_order",
      order_id: "order-1",
      lead_id: "lead-1",
      language: "de",
      replace_document_id: undefined,
    });
  });

  it.each(["sales", "medical_manager", "ceo_assistant"])("offers no generation to %s", (role) => {
    state.role = role;
    expect(render("de")).toBe("");
    expect(state.click).toBeNull();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.generate).not.toHaveBeenCalled();
  });

  it("offers no generation without a patient or lead identity", () => {
    expect(render("ru", null, null)).toBe("");
    expect(state.click).toBeNull();
    expect(state.generate).not.toHaveBeenCalled();
  });

  it("does not navigate when generation fails", async () => {
    state.generate.mockRejectedValue(new Error("Synthetic generation error"));
    render("ru");
    state.click!();
    await vi.waitFor(() => expect(state.generate).toHaveBeenCalledOnce());
    expect(state.navigate).not.toHaveBeenCalled();
  });
});
