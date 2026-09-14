import { describe, expect, it } from "vitest";
import { slugify, uniqueSlug } from "./slug.js";

describe("slugify", () => {
  it("makes kebab-case from a name", () => {
    expect(slugify("Living room", "room")).toBe("living-room");
    expect(slugify("Mia's room", "room")).toBe("mias-room");
    expect(slugify("  Café / Bar  ", "room")).toBe("cafe-bar");
    expect(slugify("Ground", "level")).toBe("ground");
  });

  it("falls back when nothing of the name survives", () => {
    expect(slugify("客厅", "room")).toBe("room");
    expect(slugify("!!!", "home")).toBe("home");
  });

  it("cuts a long name at a word boundary", () => {
    const slug = slugify("a very long room name ".repeat(6), "room");
    expect(slug.length).toBeLessThanOrEqual(60);
    expect(slug).not.toMatch(/-$/);
  });
});

describe("uniqueSlug", () => {
  it("appends -2, -3 until the slug is free", () => {
    const taken = new Set(["kitchen", "kitchen-2"]);
    expect(uniqueSlug("Kitchen", "room", (slug) => taken.has(slug))).toBe("kitchen-3");
    expect(uniqueSlug("Hallway", "room", (slug) => taken.has(slug))).toBe("hallway");
  });
});
