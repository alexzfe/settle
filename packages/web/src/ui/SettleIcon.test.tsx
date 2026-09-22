import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SettleIcon, SettleMark } from "./SettleIcon";
import { STATE_LEVEL, StateMark } from "./StateMark";

afterEach(cleanup);

it("fills the circle to the level: a ring, a low chord, half, then a solid disc", () => {
  const { container } = render(
    <>
      <SettleIcon level={0} />
      <SettleIcon level={1} />
      <SettleIcon level={2} />
      <SettleIcon level={3} />
    </>,
  );
  const [empty, low, half, full] = [...container.querySelectorAll("svg")];
  expect(empty?.querySelector("path")).toBeNull();
  expect(low?.querySelector("path")?.getAttribute("d")).toBe("M4.39 16.8A9 9 0 0 0 19.61 16.8Z");
  expect(half?.querySelector("path")?.getAttribute("d")).toBe("M3 12A9 9 0 0 0 21 12Z");
  expect(full?.querySelector("circle")?.getAttribute("fill")).toBe("currentColor");
  expect(full?.querySelector("path")).toBeNull();
});

it("thickens the stroke as the mark shrinks, so the ring never disappears", () => {
  const stroke = (size: number) => {
    const { container } = render(<SettleIcon size={size} />);
    return container.querySelector("svg")?.getAttribute("stroke-width");
  };
  expect([16, 17, 20, 28, 40, 56].map(stroke)).toEqual(["2.8", "2.6", "2.6", "2.3", "2.1", "2"]);
});

it("keeps the brand mark's waterline out of every state", () => {
  render(<SettleMark />);
  expect(screen.getByRole("img", { name: "Settle" }).querySelector("path")?.getAttribute("d")).toBe(
    "M3.67 15.4A9 9 0 0 0 20.33 15.4Z",
  );
  expect(Object.values(STATE_LEVEL).sort()).toEqual([0, 1, 2, 3]);
});

it("draws each state at 17px and names it", () => {
  render(
    <>
      <StateMark state="candidate" />
      <StateMark state="leaning" />
      <StateMark state="settled" />
      <StateMark state="rejected" />
    </>,
  );
  for (const name of ["Candidate", "Leaning", "Settled", "Rejected"]) {
    expect(screen.getByRole("img", { name }).querySelector("svg")?.getAttribute("width")).toBe(
      "17",
    );
  }
  expect(screen.getByRole("img", { name: "Rejected" }).querySelector("path")).toBeNull();
});
