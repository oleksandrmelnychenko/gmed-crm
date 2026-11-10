import type { EventContentArg } from "@fullcalendar/core";
import { describe, expect, it } from "vitest";

import {
  CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE,
  renderStaticCalendarEventContent,
} from "./calendar-event-content";
import { operationalScopeReason } from "./operational-scopes";
import type { AppointmentListItem } from "./types";
import {
  calendarQuickActionMenuPosition,
  calendarQuickActionsReducer,
} from "@/pages/appointments/ui/hooks/use-appointment-calendar-quick-actions";

function eventContentArg(extendedProps: Record<string, unknown>): EventContentArg {
  return {
    timeText: "10:00",
    event: {
      title: "Kontrolle",
      start: new Date("2026-06-05T10:00:00"),
      end: new Date("2026-06-05T10:30:00"),
      extendedProps,
    },
  } as unknown as EventContentArg;
}

describe("calendar event tile: quick-action button", () => {
  it("renders a named, keyboard reachable button when the role may change a status", () => {
    const { html } = renderStaticCalendarEventContent(
      eventContentArg({ patientName: "QA Patient", appointmentType: "medical" }),
      { apt_type_medical: "Medical" },
      { quickActionsLabel: 'Быстрые действия "A&B"' },
    );
    const button = html.match(/<button[^>]*>/)?.[0] ?? "";

    // A native button (in the tab order without a tabindex) with a name.
    expect(button).toContain('type="button"');
    expect(button).toContain(CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE);
    expect(button).toContain('aria-haspopup="menu"');
    expect(button).toContain(
      'aria-label="Быстрые действия &quot;A&amp;B&quot;"',
    );
    expect(button).not.toContain("tabindex");
    // One button, the last element of the tile's card: after the title, the
    // time line and the tag, so it pushes none of them.
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html.endsWith("</button></div>")).toBe(true);
    expect(html).toContain('<div class="fc-apt-event-row-primary">Kontrolle</div>');
  });

  it("renders no button without the label (roles that cannot change a status)", () => {
    const { html } = renderStaticCalendarEventContent(
      eventContentArg({ patientName: "QA Patient" }),
      {},
    );
    expect(html).not.toContain(CALENDAR_EVENT_MENU_BUTTON_ATTRIBUTE);
    expect(html).not.toContain("<button");
  });
});

describe("calendar event tile: place", () => {
  it("prints nothing where the place stands when the visit has no provider, doctor, place or curator", () => {
    const { html } = renderStaticCalendarEventContent(
      eventContentArg({ patientName: "QA Patient", appointmentType: "medical" }),
      { apt_type_medical: "Medical" },
    );

    expect(html).toContain(
      '<div class="fc-apt-event-row-secondary">10:00 - QA Patient</div>',
    );
  });

  it("keeps the known place", () => {
    const { html } = renderStaticCalendarEventContent(
      eventContentArg({ patientName: "QA Patient", location: "Raum 4" }),
      {},
    );

    expect(html).toContain(
      '<div class="fc-apt-event-row-secondary">10:00 - QA Patient - Raum 4</div>',
    );
  });
});

describe("queue row: curator or provider line", () => {
  const item = {
    id: "appointment-1",
    owner_name: null,
    provider_name: null,
  } as unknown as AppointmentListItem;

  it("is empty for a visit without curator and provider instead of the page title", () => {
    expect(
      operationalScopeReason(item, "all", "patient_manager", undefined, {
        appointments_title: "Приёмы",
      }),
    ).toBe("");
  });

  it("names the curator, else the provider", () => {
    expect(
      operationalScopeReason({ ...item, provider_name: "Clinic QA" }, "all"),
    ).toBe("Clinic QA");
    expect(
      operationalScopeReason(
        { ...item, owner_name: "Anna PM", provider_name: "Clinic QA" },
        "all",
      ),
    ).toBe("Anna PM");
  });
});

describe("calendar quick-action menu", () => {
  const viewport = { width: 1000, height: 800 };

  it("opens at the given point and stays inside the window", () => {
    expect(calendarQuickActionMenuPosition("a1", 300, 200, viewport)).toEqual({
      appointmentId: "a1",
      left: 300,
      top: 200,
    });
    expect(calendarQuickActionMenuPosition("a1", 990, 790, viewport)).toEqual({
      appointmentId: "a1",
      left: 1000 - 224 - 16,
      top: 800 - 300 - 16,
    });
    expect(calendarQuickActionMenuPosition("a1", -5, -5, viewport)).toEqual({
      appointmentId: "a1",
      left: 16,
      top: 16,
    });
  });

  it("toggles on the same event and moves to another one", () => {
    const first = calendarQuickActionMenuPosition("a1", 10, 10, viewport);
    const second = calendarQuickActionMenuPosition("a2", 50, 50, viewport);
    const opened = calendarQuickActionsReducer(
      { menu: null, scope: "series" },
      { type: "toggle-menu", appointmentId: "a1", menu: first },
    );
    expect(opened).toEqual({ menu: first, scope: "single" });
    expect(
      calendarQuickActionsReducer(opened, {
        type: "toggle-menu",
        appointmentId: "a2",
        menu: second,
      }).menu,
    ).toEqual(second);
    expect(
      calendarQuickActionsReducer(opened, {
        type: "toggle-menu",
        appointmentId: "a1",
        menu: first,
      }).menu,
    ).toBeNull();
  });
});
