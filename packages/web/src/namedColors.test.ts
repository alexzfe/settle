import { expect, it } from "vitest";
import { namedColorHex } from "./namedColors";

it("reads a plain color word", () => {
  expect(namedColorHex("terracotta")).toBe("#b5643c");
  expect(namedColorHex("Silver")).toBe("#c5c9cb");
});

it("reads the color word out of what the Agent recorded", () => {
  expect(namedColorHex("brown (café), matt")).toBe(namedColorHex("brown"));
  expect(namedColorHex("gray")).toBe(namedColorHex("grey"));
});

it("moves the shade for the words in front of it", () => {
  const grey = namedColorHex("grey") ?? "";
  const dark = namedColorHex("dark grey") ?? "";
  const light = namedColorHex("light grey") ?? "";
  expect(dark < grey).toBe(true);
  expect(light > grey).toBe(true);
  // A word behind the color is not a shade: "grey, dark finish" is still grey.
  expect(namedColorHex("grey, dark finish")).toBe(grey);
});

it("gives nothing for a name that does not say a color", () => {
  expect(namedColorHex("Setting Plaster")).toBeUndefined();
  expect(namedColorHex("")).toBeUndefined();
});
