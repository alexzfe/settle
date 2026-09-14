import { describe, expect, it } from "vitest";
import {
  compass,
  formatColor,
  formatLength,
  formatLogValue,
  sentence,
  wallNameOf,
  words,
} from "./format";

describe("formatLength", () => {
  it("shows millimetres as metres with two decimals, Estimated ones marked with ~", () => {
    expect(formatLength({ mm: 3620, provenance: "measured" })).toBe("3.62 m");
    expect(formatLength({ mm: 3505, provenance: "blueprint" })).toBe("3.51 m");
    expect(formatLength({ mm: 1200, provenance: "estimated" })).toBe("~1.20 m");
  });
});

describe("formatColor", () => {
  it("names the maker and code when known, and marks an Estimated color", () => {
    const plaster = { name: "Setting Plaster", brand: "Farrow & Ball", code: "231" };
    expect(formatColor({ ...plaster, provenance: "measured" })).toBe(
      "Setting Plaster (Farrow & Ball 231)",
    );
    expect(formatColor({ name: "warm grey", provenance: "estimated" })).toBe("~warm grey");
  });
});

describe("words and sentence", () => {
  it("read fixed-list values and field names as words", () => {
    expect(words("dim-to-warm")).toBe("dim to warm");
    expect(words("art_and_mirrors")).toBe("art and mirrors");
    expect(words("sillHeight")).toBe("sill height");
    expect(sentence("radiator-or-heater")).toBe("Radiator or heater");
    expect(sentence("1-3")).toBe("1-3");
  });
});

describe("wallNameOf", () => {
  it("names a Wall by its position in its slug", () => {
    expect(wallNameOf("living-room/wall-12")).toBe("Wall 12");
    expect(wallNameOf("roof")).toBe("roof");
  });
});

describe("compass", () => {
  it("capitalises short directions and spells out long ones", () => {
    expect(compass("ne")).toBe("NE");
    expect(compass("south-west")).toBe("South west");
  });
});

describe("formatLogValue", () => {
  it("reads lengths and colors with their Provenance", () => {
    expect(formatLogValue({ mm: 2600, provenance: "estimated" })).toBe("~2.60 m (Estimated)");
    const source = { blueprint: "estate-agent-plan", page: 2, printed: `13'9"` };
    expect(formatLogValue({ mm: 4190, provenance: "blueprint", source })).toBe(
      `4.19 m (Blueprint p.2: 13'9")`,
    );
    expect(formatLogValue({ name: "Setting Plaster", provenance: "measured" })).toBe(
      "Setting Plaster (Measured)",
    );
  });

  it("reads plain values, lists, and records, leaving out what is empty", () => {
    expect(formatLogValue(undefined)).toBe("");
    expect(formatLogValue(null)).toBe("");
    expect(formatLogValue(true)).toBe("yes");
    expect(formatLogValue(4)).toBe("4");
    expect(formatLogValue(["morning", "evening"])).toBe("morning, evening");
    expect(
      formatLogValue({
        name: "Kitchen",
        level: "ground",
        ceilingHeight: { mm: 2500, provenance: "measured" },
        label: undefined,
      }),
    ).toBe("name: Kitchen; level: ground; ceiling height: 2.50 m (Measured)");
  });
});
