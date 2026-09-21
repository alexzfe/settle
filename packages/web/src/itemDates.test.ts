import { describe, expect, it } from "vitest";
import { cmFromMm, mmFromCm } from "./format";
import {
  formatPartialDate,
  isPartialDate,
  lengthInMonths,
  warrantyCountdown,
  warrantyUntil,
} from "./itemDates";

describe("formatPartialDate", () => {
  it.each([
    ["2023", "2023"],
    ["2025-03", "Mar 2025"],
    ["2025-03-14", "14 Mar 2025"],
  ])("reads %s at its own precision: %s", (value, text) => {
    expect(formatPartialDate(value)).toBe(text);
  });

  it("takes only a year, a month, or a real day", () => {
    expect(["2024", "2024-03", "2024-02-29"].every(isPartialDate)).toBe(true);
    expect(["24", "2024-3", "2024-13", "2023-02-29", "March 2024", ""].some(isPartialDate)).toBe(
      false,
    );
  });
});

describe("warrantyCountdown", () => {
  const today = new Date(2026, 8, 21); // 21 Sep 2026

  it("counts nothing down from a bare year", () => {
    expect(warrantyCountdown("2027", today)).toBeUndefined();
  });

  it("counts months to the end of a month-precise warranty", () => {
    expect(warrantyCountdown("2027-03", today)).toBe("ends in 6 months");
    expect(warrantyCountdown("2026-10", today)).toBe("ends in 1 month");
    expect(warrantyCountdown("2026-09", today)).toBe("ends this month");
    expect(warrantyCountdown("2026-07", today)).toBe("ended 2 months ago");
  });

  it("counts whole months, or days in the last month, to a day-precise warranty", () => {
    expect(warrantyCountdown("2027-03-14", today)).toBe("ends in 5 months");
    expect(warrantyCountdown("2027-03-21", today)).toBe("ends in 6 months");
    expect(warrantyCountdown("2026-10-05", today)).toBe("ends in 14 days");
    expect(warrantyCountdown("2026-09-21", today)).toBe("ends today");
    expect(warrantyCountdown("2026-09-20", today)).toBe("ended 1 day ago");
    expect(warrantyCountdown("2025-09-22", today)).toBe("ended 11 months ago");
  });
});

describe("warrantyUntil", () => {
  it("reads a length in years or months", () => {
    expect(lengthInMonths("2 years")).toBe(24);
    expect(lengthInMonths("1 year")).toBe(12);
    expect(lengthInMonths("18 months")).toBe(18);
    expect(lengthInMonths("soon")).toBeUndefined();
  });

  it("keeps a date as typed", () => {
    expect(warrantyUntil("2027-03", "")).toEqual({ value: "2027-03" });
  });

  it("counts a length from bought on, at bought on's precision", () => {
    expect(warrantyUntil("2 years", "2024")).toEqual({ value: "2026" });
    expect(warrantyUntil("2 years", "2024-03")).toEqual({ value: "2026-03" });
    expect(warrantyUntil("18 months", "2024-11")).toEqual({ value: "2026-05" });
    expect(warrantyUntil("1 year", "2024-02-29")).toEqual({ value: "2025-02-28" });
    expect(warrantyUntil("2 years", "2024-03-14")).toEqual({ value: "2026-03-14" });
  });

  it("refuses a length with no bought on, or months from a bare year, saying why", () => {
    expect(warrantyUntil("2 years", "")).toEqual({ error: expect.stringMatching(/bought on/) });
    expect(warrantyUntil("18 months", "2024")).toEqual({
      error: expect.stringMatching(/only a year/),
    });
    expect(warrantyUntil("whenever", "2024")).toEqual({ error: expect.stringMatching(/2 years/) });
  });
});

describe("centimetres", () => {
  it("turns typed centimetres into whole millimetres, and back", () => {
    expect(mmFromCm("153")).toBe(1530);
    expect(mmFromCm(" 153.5 ")).toBe(1535);
    expect(mmFromCm("153,5")).toBe(1535);
    expect(mmFromCm("1.5 m")).toBeUndefined();
    expect(mmFromCm("")).toBeUndefined();
    expect(cmFromMm(1530)).toBe("153");
    expect(cmFromMm(1535)).toBe("153.5");
  });
});
