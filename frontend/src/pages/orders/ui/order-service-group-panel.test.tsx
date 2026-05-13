import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OrderServiceGroupPanel } from "./order-service-group-panel";

describe("OrderServiceGroupPanel", () => {
  it("previews one generated billing line per doctor participant", () => {
    const html = renderToStaticMarkup(
      <OrderServiceGroupPanel
        group={{
          group_title: "Cardiology board",
          status: "ready",
          quantity: "1",
          unit_price: "120",
          currency: "EUR",
          vat_rate: "19",
          generated_line_count: 0,
          participants: [
            {
              provider_id: "provider-1",
              provider_name: "Clinic Mitte",
              doctor_id: "doctor-1",
              doctor_name: "Dr. One",
            },
            {
              provider_id: "provider-1",
              provider_name: "Clinic Mitte",
              doctor_id: "doctor-2",
              doctor_name: "Dr. Two",
            },
            {
              provider_id: "provider-1",
              provider_name: "Clinic Mitte",
              doctor_id: "doctor-3",
              doctor_name: "Dr. Three",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("3 врачей создают 3 строк биллинга");
    expect(html).toContain("Только предпросмотр");
    expect(html).toContain("Dr. One");
    expect(html).toContain("Dr. Two");
    expect(html).toContain("Dr. Three");
  });

  it("shows duplicate-safe preview counts before generation", () => {
    const html = renderToStaticMarkup(
      <OrderServiceGroupPanel
        group={{
          group_title: "Cardiology board",
          status: "generated",
          quantity: "1",
          unit_price: "120",
          currency: "EUR",
          vat_rate: "19",
          generated_line_count: 1,
          participants: [
            {
              id: "participant-1",
              provider_id: "provider-1",
              provider_name: "Clinic Mitte",
              doctor_id: "doctor-1",
              doctor_name: "Dr. One",
            },
          ],
        }}
        preview={{
          generate_count: 0,
          update_count: 0,
          skip_duplicate_count: 1,
          override_duplicates: false,
          lines: [
            {
              participant_id: "participant-1",
              provider_id: "provider-1",
              provider_name: "Clinic Mitte",
              doctor_id: "doctor-1",
              doctor_name: "Dr. One",
              description: "Cardiology board - Dr. One (Clinic Mitte)",
              quantity: "1",
              unit_price: "120",
              currency: "EUR",
              vat_rate: "19",
              existing_leistung_id: "leistung-1",
              action: "skip_duplicate",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Пропустить дубли");
    expect(html).toContain("Существующая строка");
    expect(html).toContain("leistung-1");
    expect(html).toContain("без дублей");
  });
});
