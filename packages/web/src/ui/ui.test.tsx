import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgentWritten, shortDate } from "./AgentWritten";
import { EmptyState } from "./EmptyState";
import { FlagMark, StatePill } from "./StatePill";

afterEach(cleanup);

it("pairs each state with a symbol and its name", () => {
  render(
    <>
      <StatePill state="candidate" />
      <StatePill state="leaning" />
      <StatePill state="locked" />
      <StatePill state="rejected" />
    </>,
  );
  expect(screen.getByText("Candidate").parentElement?.textContent).toBe("○Candidate");
  expect(screen.getByText("Leaning").parentElement?.textContent).toBe("◐Leaning");
  expect(screen.getByText("Locked").parentElement?.textContent).toBe("●Locked");
  expect(screen.getByText("Rejected")).toBeTruthy();
});

it("labels a Flag for screen readers", () => {
  render(<FlagMark>Wall 5's length changed</FlagMark>);
  expect(screen.getByRole("img", { name: "Flagged" })).toBeTruthy();
});

it("says the Agent wrote it, where, and when", () => {
  render(
    <AgentWritten source="Purchase Session" date="2026-09-14T10:00:00Z">
      <p>Buy the low one.</p>
    </AgentWritten>,
  );
  expect(screen.getByText(/Written by the Agent/).textContent).toBe(
    "Written by the Agent · Purchase Session · 14 Sep",
  );
});

it("leaves out a date it cannot read", () => {
  expect(shortDate("not a date")).toBeUndefined();
});

it("offers to ask the Agent only when an empty state has a prompt", () => {
  const { rerender } = render(<EmptyState text="No Rooms yet" />);
  expect(screen.queryByRole("button")).toBeNull();
  rerender(<EmptyState text="No Rooms yet" prompt={`claude "record my home"`} />);
  expect(screen.getByRole("button", { name: /Ask the Agent/ })).toBeTruthy();
});
