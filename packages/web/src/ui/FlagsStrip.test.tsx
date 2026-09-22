import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import type { DecisionSummary } from "../api";
import { renderRoutes, stubApi } from "../testSupport";
import { FlagsStrip, flagsSummary } from "./FlagsStrip";

afterEach(cleanup);

function decision(
  title: string,
  flags: number,
  conflicts: number,
): Pick<DecisionSummary, "title" | "openFlags" | "openConflicts"> {
  return {
    title,
    openFlags: Array(flags).fill({}),
    openConflicts: Array(conflicts).fill({}),
  };
}

it("counts Flags and Conflicts together and names the Decisions they are on", () => {
  const summary = (list: ReturnType<typeof decision>[]) => flagsSummary(list as DecisionSummary[]);
  expect(summary([decision("Sofa", 0, 0)])).toBeUndefined();
  expect(
    summary([decision("Kitchen bin", 1, 0), decision("Sofa", 0, 0), decision("Bed frame", 1, 1)]),
  ).toEqual({
    counts: "2 Flags, 1 Conflict",
    names: "Kitchen bin, Bed frame need a look.",
  });
  expect(summary([decision("Rug", 0, 2)])).toEqual({
    counts: "2 Conflicts",
    names: "Rug needs a look.",
  });
  expect(summary(["A", "B", "C", "D", "E"].map((title) => decision(title, 1, 0)))?.names).toBe(
    "A, B, C and 2 more need a look.",
  );
});

it("links the strip to the flagged Decisions, and shows nothing at zero", async () => {
  let decisions = [decision("Kitchen bin", 1, 0)];
  stubApi({ list_decisions: () => ({ decisions: decisions as DecisionSummary[] }) });
  const routes = [{ path: "/homes/:home", element: <FlagsStrip home="house" /> }];
  const view = renderRoutes("/homes/house", routes);
  const review = await screen.findByRole("link", { name: "Review" });
  expect(review.getAttribute("href")).toBe("/homes/house/decisions?flagged=1");
  expect(screen.getByRole("complementary", { name: "Flags" }).textContent).toBe(
    "1 Flag Kitchen bin needs a look.Review",
  );
  view.unmount();

  decisions = [decision("Kitchen bin", 0, 0)];
  const { container } = renderRoutes("/homes/house", routes);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(container.textContent).toBe("");
});
