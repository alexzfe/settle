import { describe, expect, it } from "vitest";
import type { FindRow } from "../api";
import { find, fit, fold } from "./match";

function row(kind: FindRow["kind"], name: string, extra: Partial<FindRow> = {}): FindRow {
  const tier2 = kind === "listing" || kind === "feature";
  return {
    kind,
    slug: name.toLowerCase().replaceAll(" ", "-"),
    name,
    where: "",
    path: `/homes/flat/${kind}s/${name}`,
    tier: tier2 ? 2 : 1,
    label: kind.charAt(0).toUpperCase() + kind.slice(1),
    retired: false,
    changedAt: "2026-09-10T10:00:00Z",
    ...extra,
  };
}

const names = (rows: FindRow[]) => rows.map((each) => each.name);

describe("fold", () => {
  it("drops case and accents", () => {
    expect(fold("Baño Pequeño")).toBe("bano pequeno");
  });
});

describe("fit", () => {
  it("treats every word as an unfinished prefix, in any order", () => {
    expect(fit("Main bedroom bed frame", ["bed", "fra"])).toBe("starts");
    expect(fit("Main bedroom bed frame", ["fra", "bed"])).toBe("starts");
    expect(fit("Main bedroom bed frame", ["ma", "be", "fr"])).toBe("starts");
  });

  it("needs every word", () => {
    expect(fit("Main bedroom bed frame", ["bed", "sofa"])).toBeUndefined();
  });

  it("counts a match inside a word, below one at a word start", () => {
    expect(fit("Headboard", ["board"])).toBe("inside");
    expect(fit("Bed frame", ["bed", "rame"])).toBe("inside");
  });

  it("finds a word start after punctuation", () => {
    expect(fit("Radiator — under-window", ["win"])).toBe("starts");
  });

  it("folds accents on both sides", () => {
    expect(fit("Baño", ["bano"])).toBe("exact");
    expect(fit("Bano de visitas", ["baño"].map(fold))).toBe("starts");
  });

  it("calls the whole name exact, whatever the spacing and case", () => {
    expect(fit("Radiator", ["radiator"])).toBe("exact");
    expect(fit("Living  room", ["living", "room"])).toBe("exact");
  });
});

describe("find", () => {
  it("ranks the bed frame first for 'bed fra'", () => {
    const rows = [
      row("room", "Main bedroom"),
      row("item", "Bedside lamp"),
      row("decision", "Main bedroom bed frame"),
      row("listing", "Oak bed frame 160"),
    ];
    expect(names(find(rows, "bed fra"))).toEqual(["Main bedroom bed frame", "Oak bed frame 160"]);
  });

  it("does not care about word order", () => {
    const rows = [row("decision", "Main bedroom bed frame")];
    expect(find(rows, "fra bed")).toEqual(find(rows, "bed fra"));
    expect(find(rows, "fra bed")).toHaveLength(1);
  });

  it("matches only the name, never the breadcrumb, label, or state", () => {
    const rows = [
      row("item", "Lamp", { where: "Main bedroom" }),
      row("decision", "Sofa", { state: "Rejected", retired: true }),
    ];
    expect(find(rows, "bedroom")).toEqual([]);
    expect(find(rows, "item")).toEqual([]);
    expect(find(rows, "rejected")).toEqual([]);
  });

  it("puts a mid-word match below a word-start one", () => {
    const rows = [
      row("item", "Headboard", { changedAt: "2026-09-20T10:00:00Z" }),
      row("item", "Board game shelf", { changedAt: "2026-09-01T10:00:00Z" }),
    ];
    expect(names(find(rows, "board"))).toEqual(["Board game shelf", "Headboard"]);
  });

  it("puts tier 1 above tier 2", () => {
    const rows = [
      row("feature", "Radiator cover", { changedAt: "2026-09-20T10:00:00Z" }),
      row("item", "Radiator shelf"),
    ];
    expect(names(find(rows, "radi"))).toEqual(["Radiator shelf", "Radiator cover"]);
  });

  it("puts an exact name at the top from tier 2", () => {
    const rows = [row("item", "Radiator shelf"), row("feature", "Radiator")];
    expect(names(find(rows, "radiator"))).toEqual(["Radiator", "Radiator shelf"]);
  });

  it("puts retired rows last, above nothing", () => {
    const rows = [
      row("decision", "Keep the old sofa", {
        state: "Rejected",
        retired: true,
        changedAt: "2026-09-20T10:00:00Z",
      }),
      row("listing", "Sofa bed", { tier: 2 }),
      row("item", "Sofa"),
    ];
    expect(names(find(rows, "sof"))).toEqual(["Sofa", "Sofa bed", "Keep the old sofa"]);
  });

  it("breaks ties by the most recent change", () => {
    const rows = [
      row("item", "Lamp one", { changedAt: "2026-09-01T10:00:00Z" }),
      row("item", "Lamp two", { changedAt: "2026-09-19T10:00:00Z" }),
    ];
    expect(names(find(rows, "lamp"))).toEqual(["Lamp two", "Lamp one"]);
  });

  it("lists the Rooms on an empty query, retired last", () => {
    const rows = [
      row("room", "Old study", { state: "Archived", retired: true }),
      row("item", "Lamp"),
      row("room", "Kitchen"),
      row("room", "Baño"),
    ];
    expect(names(find(rows, "  "))).toEqual(["Kitchen", "Baño", "Old study"]);
  });
});
