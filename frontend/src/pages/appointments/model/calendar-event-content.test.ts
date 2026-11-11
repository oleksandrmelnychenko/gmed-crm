import type { EventContentArg } from "@fullcalendar/core";
import { describe, expect, it } from "vitest";

import {
  escapeCalendarEventHtml,
  renderStaticCalendarEventContent,
} from "./calendar-event-content";

function eventContentArg(overrides: {
  title?: unknown;
  extendedProps?: Record<string, unknown>;
} = {}): EventContentArg {
  return {
    timeText: "10:00",
    event: {
      title: overrides.title,
      start: new Date("2026-06-05T10:00:00"),
      end: new Date("2026-06-05T10:30:00"),
      extendedProps: overrides.extendedProps ?? {},
    },
  } as unknown as EventContentArg;
}

describe("escapeCalendarEventHtml", () => {
  it("treats missing values as empty text instead of throwing", () => {
    expect(escapeCalendarEventHtml(undefined)).toBe("");
    expect(escapeCalendarEventHtml("<b>Tom & Anna</b>")).toBe(
      "&lt;b&gt;Tom &amp; Anna&lt;/b&gt;",
    );
  });
});

describe("renderStaticCalendarEventContent", () => {
  it("renders cancelled events without the removed appointments_status_cancelled key", () => {
    const rendered = renderStaticCalendarEventContent(
      eventContentArg({
        title: undefined,
        extendedProps: {
          appointmentStatus: "cancelled",
          patientPid: "P-17",
          patientName: "QA Patient",
        },
      }),
      {
        apt_type_medical: "Medical",
      },
    );

    expect(rendered.html).toContain("P-17 · QA Patient");
    expect(rendered.html).toContain("Отмен");
    expect(rendered.html).not.toContain("undefined");
  });

  it("gives a 15-minute visit the one-line tile with its time (QA 2026-11-11, B-01/B-02)", () => {
    const short = {
      ...eventContentArg({ title: "Kontrolle" }),
    } as EventContentArg;
    (short.event as unknown as { end: Date }).end = new Date("2026-06-05T10:15:00");
    const rendered = renderStaticCalendarEventContent(short, {});
    expect(rendered.html).toContain("fc-apt-event-card-compact");
    expect(rendered.html).toContain('data-event-time="10:00"');

    const regular = renderStaticCalendarEventContent(eventContentArg({ title: "Kontrolle" }), {});
    expect(regular.html).not.toContain("fc-apt-event-card-compact");
    expect(regular.html).not.toContain("data-event-time");
  });
});
