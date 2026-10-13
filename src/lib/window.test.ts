import { describe, expect, it } from "vitest";
import { formatWindow, parseWindow } from "./window";

describe("parseWindow", () => {
  it("reads what the picker writes", () => {
    expect(parseWindow("Jan–Mar 2027")).toEqual({ start: { year: 2027, month: 0 }, end: { year: 2027, month: 2 } });
    expect(parseWindow("Feb 2027")).toEqual({ start: { year: 2027, month: 1 }, end: { year: 2027, month: 1 } });
    expect(parseWindow("Dec 2026–Feb 2027")).toEqual({ start: { year: 2026, month: 11 }, end: { year: 2027, month: 1 } });
  });

  it("reads hand-typed variants", () => {
    expect(parseWindow("january - march 2027")).toEqual({ start: { year: 2027, month: 0 }, end: { year: 2027, month: 2 } });
    expect(parseWindow("Sept to Nov 2027")).toEqual({ start: { year: 2027, month: 8 }, end: { year: 2027, month: 10 } });
    expect(parseWindow("  Mar–Apr  2027 ")).toEqual({ start: { year: 2027, month: 2 }, end: { year: 2027, month: 3 } });
  });

  it("wraps a backwards month pair to the previous year", () => {
    expect(parseWindow("Nov–Feb 2027")).toEqual({ start: { year: 2026, month: 10 }, end: { year: 2027, month: 1 } });
  });

  it("maps seasons to month ranges", () => {
    expect(parseWindow("Spring 2027")).toEqual({ start: { year: 2027, month: 2 }, end: { year: 2027, month: 4 } });
    expect(parseWindow("fall 2027")).toEqual({ start: { year: 2027, month: 8 }, end: { year: 2027, month: 10 } });
    expect(parseWindow("Winter 2027")).toEqual({ start: { year: 2026, month: 11 }, end: { year: 2027, month: 1 } });
  });

  it("gives up on prose it cannot place", () => {
    expect(parseWindow(undefined)).toBeUndefined();
    expect(parseWindow("")).toBeUndefined();
    expect(parseWindow("next fall")).toBeUndefined();
    expect(parseWindow("Q2 2027")).toBeUndefined();
    expect(parseWindow("Foo–Mar 2027")).toBeUndefined();
  });
});

describe("formatWindow", () => {
  it("writes the stored shapes", () => {
    expect(formatWindow({ start: { year: 2027, month: 0 }, end: { year: 2027, month: 2 } })).toBe("Jan–Mar 2027");
    expect(formatWindow({ start: { year: 2027, month: 1 }, end: { year: 2027, month: 1 } })).toBe("Feb 2027");
    expect(formatWindow({ start: { year: 2026, month: 11 }, end: { year: 2027, month: 1 } })).toBe("Dec 2026–Feb 2027");
  });

  it("orders a reversed pair", () => {
    expect(formatWindow({ start: { year: 2027, month: 2 }, end: { year: 2027, month: 0 } })).toBe("Jan–Mar 2027");
  });

  it("round-trips", () => {
    for (const s of ["Jan–Mar 2027", "Feb 2027", "Dec 2026–Feb 2027", "Oct 2026–Jan 2027"]) {
      expect(formatWindow(parseWindow(s)!)).toBe(s);
    }
  });
});
