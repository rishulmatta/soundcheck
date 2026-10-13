/**
 * The touring window is stored as prose ("Jan–Mar 2027") because the planner treats it as context, not a schedule.
 * These helpers give the month-range picker a structured view of that prose and write it back in the same shape,
 * so the schema, the seeds and the revision diff never see anything but the string.
 */

export interface YearMonth {
  year: number;
  /** 0 = January. */
  month: number;
}

export interface MonthRange {
  start: YearMonth;
  end: YearMonth;
}

export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export const MONTH_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** Seasons promoters write by hand; winter straddles the year boundary and is read as ending in the named year. */
const SEASONS: Record<string, { start: number; end: number; startYearOffset: 0 | -1 }> = {
  spring: { start: 2, end: 4, startYearOffset: 0 },
  summer: { start: 5, end: 7, startYearOffset: 0 },
  fall: { start: 8, end: 10, startYearOffset: 0 },
  autumn: { start: 8, end: 10, startYearOffset: 0 },
  winter: { start: 11, end: 1, startYearOffset: -1 },
};

export const ymIndex = (ym: YearMonth) => ym.year * 12 + ym.month;
export const sameYearMonth = (a: YearMonth, b: YearMonth) => a.year === b.year && a.month === b.month;

/** Order a pair of months so the range always runs forward. */
export function orderRange(a: YearMonth, b: YearMonth): MonthRange {
  return ymIndex(a) <= ymIndex(b) ? { start: a, end: b } : { start: b, end: a };
}

export function formatWindow(r: MonthRange): string {
  const { start, end } = orderRange(r.start, r.end);
  if (sameYearMonth(start, end)) return `${MONTH_SHORT[start.month]} ${start.year}`;
  if (start.year === end.year) return `${MONTH_SHORT[start.month]}–${MONTH_SHORT[end.month]} ${end.year}`;
  return `${MONTH_SHORT[start.month]} ${start.year}–${MONTH_SHORT[end.month]} ${end.year}`;
}

function monthIndex(word: string): number | undefined {
  const w = word.toLowerCase();
  if (w.length < 3) return undefined;
  const i = MONTH_LONG.findIndex((m) => m.toLowerCase().startsWith(w) || w === m.slice(0, 3).toLowerCase());
  return i === -1 ? undefined : i;
}

const MONTH = "([A-Za-z]{3,9})\\.?";
const YEAR = "(\\d{4})";
const DASH = "\\s*(?:[-–—]|to|through|until)\\s*";
const RANGE = new RegExp(`^${MONTH}\\s*${YEAR}?${DASH}${MONTH}\\s*${YEAR}$`, "i");
const SINGLE = new RegExp(`^${MONTH}\\s*${YEAR}$`, "i");

/**
 * Read a stored window back into a range. Accepts what the picker writes, the seeds' hand-written seasons and the
 * common ways a person types a month span. Anything else returns undefined and the picker shows the text as is.
 */
export function parseWindow(text: string | undefined): MonthRange | undefined {
  if (!text) return undefined;
  const s = text.trim().replace(/\s+/g, " ");

  const range = RANGE.exec(s);
  if (range) {
    const [, m1, y1, m2, y2] = range;
    const a = monthIndex(m1);
    const b = monthIndex(m2);
    if (a === undefined || b === undefined) return undefined;
    const endYear = Number(y2);
    const startYear = y1 ? Number(y1) : a <= b ? endYear : endYear - 1;
    return orderRange({ year: startYear, month: a }, { year: endYear, month: b });
  }

  const single = SINGLE.exec(s);
  if (single) {
    const [, word, y] = single;
    const year = Number(y);
    const season = SEASONS[word.toLowerCase()];
    if (season) return { start: { year: year + season.startYearOffset, month: season.start }, end: { year, month: season.end } };
    const m = monthIndex(word);
    if (m === undefined) return undefined;
    return { start: { year, month: m }, end: { year, month: m } };
  }

  return undefined;
}
