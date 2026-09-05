import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";

import {
  OrderServiceGroupPanel,
  OrderServiceGroupWizard,
  serviceGroupPriceChoiceLabel,
} from "./order-service-group-panel";

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

    expect(html).toContain("3 врачей создают 3 строк расчёта");
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

describe("OrderServiceGroupWizard catalog pricing", () => {
  it("formats a price version with period and recommended marker", () => {
    const label = serviceGroupPriceChoiceLabel(
      {
        id: "price-1",
        name: "Standard",
        unit_price: "120",
        currency: "EUR",
        vat_rate: "19",
        valid_from: "2026-07-01",
        valid_to: null,
        created_at: "2026-06-01T10:00:00Z",
        is_effective: true,
        is_catalog_fallback: false,
      },
      "ru-RU",
      "бессрочно",
      "Рекомендуется на дату услуги",
    );

    expect(label).toContain("120,00");
    expect(label).toContain("01.07.2026 — бессрочно");
    expect(label).toContain("Рекомендуется на дату услуги");
  });

  it("renders catalog service and price selectors in the embedded wizard", () => {
    const html = renderToStaticMarkup(
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <OrderServiceGroupWizard
          embedded
          providers={[]}
          taxonomyNodes={[]}
          providerDoctors={{}}
          orderDate="2026-07-15"
          agencyServices={[
            {
              id: "service-1",
              service_key: "consultation",
              service_name: "Consultation",
              description: "Catalog consultation",
              unit_label: "hour",
              unit_price: "100",
              currency: "EUR",
              vat_rate: "19",
              is_active: true,
              valid_from: "2026-01-01",
              valid_to: null,
              created_at: "2026-01-01T10:00:00Z",
              updated_at: null,
              price_versions: [
                {
                  id: "price-1",
                  name: "Standard",
                  unit_price: "120",
                  currency: "EUR",
                  vat_rate: "19",
                  valid_from: "2026-07-01",
                  valid_to: null,
                  created_at: "2026-06-01T10:00:00Z",
                },
              ],
            },
          ]}
          onCreate={() => undefined}
        />
      </LocalizationProvider>,
    );

    expect(html).toContain("Услуга каталога");
    expect(html).toContain("Цена каталога");
    expect(html).toContain("Ручная группа без позиции каталога");
    expect(html).toContain("Сначала выберите услугу каталога");
  });
});
