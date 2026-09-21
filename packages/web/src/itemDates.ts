// An Item's register dates (bought on, warranty until), which are known to a year, a month, or a
// day, and read at that precision: "2023", "Mar 2025", "14 Mar 2025". Core refuses any other form.

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

export type Precision = "year" | "month" | "day";

interface PartialDate {
  precision: Precision;
  year: number;
  /** 1 to 12; absent at year precision. */
  month?: number;
  /** 1 to 31; with day precision only. */
  day?: number;
}

/** "2024", "2024-03", or "2024-03-14" as its parts, or undefined for anything else. */
function parse(value: string): PartialDate | undefined {
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date: PartialDate = {
    precision: day ? "day" : month ? "month" : "year",
    year: Number(year),
    ...(month ? { month: Number(month) } : {}),
    ...(day ? { day: Number(day) } : {}),
  };
  if (date.month !== undefined && (date.month < 1 || date.month > 12)) return undefined;
  if (date.day !== undefined && (date.day < 1 || date.day > daysIn(date.year, date.month ?? 1))) {
    return undefined;
  }
  return date;
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

function write({ precision, year, month = 1, day = 1 }: PartialDate): string {
  if (precision === "year") return String(year);
  if (precision === "month") return `${year}-${pad(month)}`;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Whether `value` is a date the register takes: a year, a month, or a day. */
export function isPartialDate(value: string): boolean {
  return parse(value) !== undefined;
}

/** A register date at its own precision: "2023", "Mar 2025", "14 Mar 2025". */
export function formatPartialDate(value: string): string {
  const date = parse(value);
  if (!date) return value;
  const month = date.month === undefined ? "" : `${MONTHS[date.month - 1]} `;
  const day = date.day === undefined ? "" : `${date.day} `;
  return `${day}${month}${date.year}`;
}

/** A timestamp as a day in the reader's time zone: "14 Sep 2026". */
export function longDate(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * How a warranty stands on `today`: "ends in 5 months", "ended 2 months ago", "ends this month".
 * Undefined for a bare year, which is too rough to count down from. A month-precise warranty runs
 * to the end of that month.
 */
export function warrantyCountdown(until: string, today = new Date()): string | undefined {
  const date = parse(until);
  if (!date || date.month === undefined) return undefined;
  const months = (date.year - today.getFullYear()) * 12 + (date.month - 1 - today.getMonth());
  if (date.day === undefined) {
    if (months === 0) return "ends this month";
    return months > 0
      ? `ends in ${plural(months, "month")}`
      : `ended ${plural(-months, "month")} ago`;
  }
  const end = new Date(date.year, date.month - 1, date.day);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days === 0) return "ends today";
  // Whole months between the two days, counted the way a calendar does: 14 Mar to 13 May is one.
  const [early, late] = days > 0 ? [start.getDate(), date.day] : [date.day, start.getDate()];
  const count = Math.abs(months) - (late < early ? 1 : 0);
  if (count < 1) {
    return days > 0 ? `ends in ${plural(days, "day")}` : `ended ${plural(-days, "day")} ago`;
  }
  return days > 0 ? `ends in ${plural(count, "month")}` : `ended ${plural(count, "month")} ago`;
}

/** A warranty's length as typed, "2 years" or "18 months", in months; undefined otherwise. */
export function lengthInMonths(text: string): number | undefined {
  const match = /^(\d+)\s*(years?|yrs?|y|months?|mos?)$/i.exec(text.trim());
  if (!match) return undefined;
  const [, count, unit = ""] = match;
  return Number(count) * (unit.toLowerCase().startsWith("y") ? 12 : 1);
}

/**
 * What the pencil's "warranty until" box means: a date as typed, or a length ("2 years") counted
 * from `boughtOn` at its precision. An error says why it cannot be read, for the form to show.
 */
export function warrantyUntil(
  typed: string,
  boughtOn: string,
): { value: string } | { error: string } {
  const text = typed.trim();
  if (isPartialDate(text)) return { value: text };
  const months = lengthInMonths(text);
  if (months === undefined) {
    return {
      error: 'Give warranty until as 2027, 2027-03, 2027-03-14, or a length like "2 years".',
    };
  }
  const bought = parse(boughtOn);
  if (!bought) {
    return {
      error: "A length needs a bought on date to count from. Fill in bought on, or give the date.",
    };
  }
  if (bought.precision === "year") {
    if (months % 12 !== 0) {
      return {
        error:
          "Bought on is only a year, so a length in months cannot be counted from it. Give the " +
          "month it was bought, or the warranty's date.",
      };
    }
    return { value: write({ ...bought, year: bought.year + months / 12 }) };
  }
  const index = bought.year * 12 + (bought.month ?? 1) - 1 + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const day = bought.day === undefined ? undefined : Math.min(bought.day, daysIn(year, month));
  return { value: write({ ...bought, year, month, ...(day === undefined ? {} : { day }) }) };
}
