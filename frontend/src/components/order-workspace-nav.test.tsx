import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { OrderWorkspaceNavView } from "./order-workspace-nav";

vi.mock("@/lib/i18n", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/i18n")>();
  return { ...actual, useLang: () => ({ lang: "ru" as const, t: actual.t("ru"), setLang: () => {} }) };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "staff-1", email: "pm@example.org", name: "PM", role: "patient_manager" } }),
}));

function render(props: Partial<Parameters<typeof OrderWorkspaceNavView>[0]> = {}) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <OrderWorkspaceNavView
        orderId="order-1"
        currentSection="gates"
        context={{}}
        orderPhase="execution"
        partialRead={false}
        {...props}
      />
    </MemoryRouter>,
  );
}

// Static markup escapes the query separator in attributes.
const links = (html: string) =>
  [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map(match => match[1].replaceAll("&amp;", "&"));

describe("OrderWorkspaceNavView", () => {
  it("keeps every section in the rail and marks the phases not reached yet", () => {
    const html = render();
    expect(links(html)).toEqual([
      "/orders",
      "/orders/order-1",
      "/orders/order-1?section=pipeline",
      "/orders/order-1?section=gates",
      "/orders/order-1?section=planning",
      "/orders/order-1?section=execution",
      "/orders/order-1?section=followup",
      "/orders/order-1?section=workflow",
      "/orders/order-1?section=services",
      "/orders/order-1?section=invoices",
    ]);
    // Closure is ahead of an order in execution; planning and execution are reached.
    expect(html).toContain('title="Откроется на этапе «Закрытие»"');
    expect(html).not.toContain("Оформление»");
    expect(html).not.toContain("Исполнение»");
    expect(html).toContain('aria-current="page"');
  });

  it("locks nothing while the phase is unknown", () => {
    expect(render({ orderPhase: null })).not.toContain("Откроется на этапе");
  });

  it("leads back to the patient card only when the order was opened from it", () => {
    expect(links(render())[0]).toBe("/orders");
    const fromPatient = render({ context: { patient: "patient-7" } });
    expect(links(fromPatient)[0]).toBe("/patients/patient-7?tab=orders");
    expect(links(fromPatient)[3]).toBe("/orders/order-1?patient=patient-7&section=gates");
  });

  it("shows one fixed view for a partial projection", () => {
    const html = render({ partialRead: true, currentSection: "overview" });
    expect(links(html)).toEqual(["/orders", "/orders/order-1"]);
  });

  it("renders the mobile strip with the same links", () => {
    const html = render({ mobile: true });
    expect(html).toContain('data-workspace-rail="order-mobile"');
    expect(links(html)).toHaveLength(10);
  });
});
