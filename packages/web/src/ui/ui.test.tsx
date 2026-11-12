import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AgentWritten, shortDate } from "./AgentWritten";
import { Callout } from "./Callout";
import { EmptyState } from "./EmptyState";
import { FlagMark } from "./StateMark";

afterEach(cleanup);

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

it("sets a Callout off as a note named by its title, not as an unnamed landmark", () => {
  render(
    <Callout tone="important" title="Measure first">
      <p>Measure the doorway.</p>
    </Callout>,
  );
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.getByRole("note", { name: "Measure first" })).toBeTruthy();
});
