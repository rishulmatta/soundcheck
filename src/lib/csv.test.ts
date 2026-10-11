import { describe, expect, it } from "vitest";
import { Plan } from "@/lib/types";
import sample from "@/fixtures/plan.sample.json";
import { CSV_COLUMNS, csvCell, planToCsv } from "@/lib/csv";

/** Minimal RFC 4180 parser for round-trip checks. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += ch;
  }
  return rows;
}

const plan = Plan.parse(sample);

describe("csvCell", () => {
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(0.58)).toBe("0.58");
  });
  it("neutralises spreadsheet formulas in text", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell(-1)).toBe("-1");
  });
});

describe("planToCsv", () => {
  it("writes a header and one row per stop", () => {
    const rows = parseCsv(planToCsv(plan));
    expect(rows[0]).toEqual([...CSV_COLUMNS]);
    expect(rows).toHaveLength(plan.stops.length + 1);
    const first = Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, rows[1][i]]));
    expect(first).toMatchObject({
      order: "1",
      city: "Seattle",
      country: "US",
      quadrant: "established",
      legDays: "0",
      topAgeBucket: "30_to_34",
      femaleScore: "0.16",
      openers: "Harbor Lights | Dry Pines",
      suggestion: "1,800-cap hall",
    });
    expect(first.whyHere).toBe(plan.stops[0].whyHere);
  });

  it("round-trips awkward text", () => {
    const tricky = structuredClone(plan);
    tricky.stops = [{ ...plan.stops[0], whyHere: 'Says "primed", then\na newline, and commas' }];
    const rows = parseCsv(planToCsv(tricky));
    expect(rows[1][CSV_COLUMNS.indexOf("whyHere")]).toBe('Says "primed", then\na newline, and commas');
  });
});
