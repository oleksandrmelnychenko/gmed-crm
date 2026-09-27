import { DateCalendar } from "@mui/x-date-pickers/DateCalendar";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import dayjs from "dayjs";
import "dayjs/locale/de";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppAdapterDayjs } from "./app-date-adapter";

// The suite runs in whatever zone the machine has (Europe/Kyiv on the dev
// machine, UTC in CI). 21:30Z on 27 Sep is still the 27th in Berlin but
// already the 28th in Kyiv; 22:30Z on 30 Sep is 1 Oct in Berlin but still
// 30 Sep in UTC. A picker that reads the browser day fails in one of them.
const BERLIN_27_KYIV_28 = new Date("2026-09-27T21:30:00Z");
const BERLIN_OCT_1_UTC_SEP_30 = new Date("2026-09-30T22:30:00Z");

function renderCalendar(value?: string) {
  return renderToStaticMarkup(
    <LocalizationProvider dateAdapter={AppAdapterDayjs} adapterLocale="de">
      <DateCalendar value={value ? dayjs(value) : null} />
    </LocalizationProvider>,
  );
}

function markedToday(markup: string): string | undefined {
  return /<button[^>]*aria-current="date"[^>]*>(\d+)</.exec(markup)?.[1];
}

describe("AppAdapterDayjs", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads 'now' as the Berlin wall clock", () => {
    const adapter = new AppAdapterDayjs({ locale: "de" });

    vi.setSystemTime(BERLIN_27_KYIV_28);
    expect(adapter.date().format("YYYY-MM-DD HH:mm")).toBe("2026-09-27 23:30");
    expect(adapter.date(undefined, "system").format("YYYY-MM-DD HH:mm")).toBe("2026-09-27 23:30");

    vi.setSystemTime(BERLIN_OCT_1_UTC_SEP_30);
    expect(adapter.date(undefined, "default").format("YYYY-MM-DD HH:mm")).toBe("2026-10-01 00:30");
  });

  it("keeps naive values as they are", () => {
    const adapter = new AppAdapterDayjs();

    vi.setSystemTime(BERLIN_27_KYIV_28);
    expect(adapter.date("2026-09-28").format("YYYY-MM-DD HH:mm")).toBe("2026-09-28 00:00");
    expect(adapter.date("2026-09-27T23:45").format("YYYY-MM-DD HH:mm")).toBe("2026-09-27 23:45");
    expect(adapter.date(null)).toBeNull();
    expect(adapter.isSameDay(adapter.date(), adapter.date("2026-09-27"))).toBe(true);
  });

  it("marks the Berlin date as today in the calendar", () => {
    vi.setSystemTime(BERLIN_27_KYIV_28);
    expect(markedToday(renderCalendar())).toBe("27");
    expect(markedToday(renderCalendar("2026-09-10"))).toBe("27");

    vi.setSystemTime(BERLIN_OCT_1_UTC_SEP_30);
    expect(markedToday(renderCalendar())).toBe("1");
    expect(markedToday(renderCalendar("2026-10-20"))).toBe("1");
  });

  it("opens an empty calendar on the Berlin month", () => {
    vi.setSystemTime(new Date("2026-09-30T21:30:00Z")); // 30 Sep in Berlin, 1 Oct in Kyiv
    expect(renderCalendar()).toContain("September 2026");

    vi.setSystemTime(BERLIN_OCT_1_UTC_SEP_30);
    expect(renderCalendar()).toContain("Oktober 2026");
  });
});
