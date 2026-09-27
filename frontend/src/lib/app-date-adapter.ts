import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import type { DateBuilderReturnType, PickersTimezone } from "@mui/x-date-pickers/models";

import { berlinNowNaive } from "@/lib/app-time-zone";

/**
 * Picker values are naive Berlin wall-clock strings ("YYYY-MM-DD",
 * "YYYY-MM-DDTHH:mm") held as browser-local dayjs objects, so the pickers
 * work in the "default"/"system" zone. For those zones this adapter's "now"
 * is the Berlin wall clock instead of the browser's: the calendar marks the
 * Berlin date as today, an empty picker opens on the Berlin month, and an
 * empty date-time field takes the Berlin time when a day is picked. Values
 * pass through unchanged. Zone-aware requests ("UTC", an IANA zone) keep the
 * real current time in that zone.
 */
export class AppAdapterDayjs extends AdapterDayjs {
  constructor(...args: ConstructorParameters<typeof AdapterDayjs>) {
    super(...args);
    // `date` is an instance field of AdapterDayjs, not a prototype method.
    const baseDate = this.date;
    this.date = <T extends string | null | undefined>(
      value?: T,
      timezone: PickersTimezone = "default",
    ): DateBuilderReturnType<T> =>
      value === undefined && (timezone === "default" || timezone === "system")
        ? (baseDate(berlinNowNaive(), timezone) as DateBuilderReturnType<T>)
        : baseDate(value, timezone);
  }
}
