import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { chipSize, LrvBar, lrvWord, PaletteChips } from "./Swatch";
import { renderRoutes } from "./testSupport";

afterEach(cleanup);

it.each([
  [5, "dark, soaks up light"],
  [19, "dark, soaks up light"],
  [20, "mid"],
  [50, "mid"],
  [51, "light"],
  [80, "light"],
  [81, "very bright"],
])("reads LRV %i as %s", (lrv, word) => {
  expect(lrvWord(lrv)).toBe(word);
});

it("sizes chips by role", () => {
  expect(["base", "secondary", "accent", undefined].map(chipSize)).toEqual([
    "wide",
    "medium",
    "narrow",
    "medium",
  ]);
});

/** Renders inside a router, since a Provenance tag may link to a Blueprint. */
function renderAt(element: React.ReactNode) {
  return renderRoutes("/homes/house", [{ path: "/homes/:home", element }]);
}

it("shows each Palette color as a chip, with a placeholder where no hex is recorded", () => {
  renderAt(
    <PaletteChips
      colors={[
        {
          name: "Setting Plaster",
          brand: "Farrow & Ball",
          code: "231",
          lrv: 62,
          hex: "#e3c9b6",
          provenance: "measured",
          role: "base",
        },
        { name: "Warm grey", provenance: "estimated", role: "accent" },
      ]}
    />,
  );
  const plaster = screen.getByTitle("Approximately #e3c9b6");
  expect(plaster.style.backgroundColor).toBe("rgb(227, 201, 182)");
  expect(screen.getByText("Farrow & Ball 231")).toBeTruthy();
  expect(screen.getByText("LRV 62")).toBeTruthy();
  expect(screen.getByText("No screen color recorded")).toBeTruthy();
  expect(screen.getByText(/Screen colors are approximate/)).toBeTruthy();
});

it("draws an LRV as a bar with words", () => {
  renderAt(<LrvBar lrv={62} />);
  expect(screen.getByRole("img", { name: "LRV 62 of 100: light" })).toBeTruthy();
});
