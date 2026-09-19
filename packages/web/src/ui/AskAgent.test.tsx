import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskAgent, buildPrompt, CopyButton } from "./AskAgent";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("buildPrompt", () => {
  it("names the Skill and the slug in a quoted claude line", () => {
    expect(
      buildPrompt({ skill: "Purchase", text: "let's talk through the sofa", slug: "sofa" }),
    ).toBe(`claude "Using the Purchase Skill: let's talk through the sofa (slug: sofa)"`);
  });

  it("leaves out what it is not given", () => {
    expect(buildPrompt({ text: "what should I do next?" })).toBe(`claude "what should I do next?"`);
  });

  it("escapes what a double-quoted shell string would read", () => {
    expect(buildPrompt({ text: 'a "big" $5 `rug` \\ here' })).toBe(
      'claude "a \\"big\\" \\$5 \\`rug\\` \\\\ here"',
    );
  });
});

it("copies the prompt and says where to run it, for a few seconds", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { container } = render(<AskAgent prompt={`claude "hi"`} />);
  const note = () => container.querySelector("[aria-live]")?.textContent;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Ask the Agent/ }));
  });
  expect(writeText).toHaveBeenCalledWith(`claude "hi"`);
  expect(note()).toBe("Copied. Run it with claude in your Home Folder");
  act(() => vi.advanceTimersByTime(6000));
  expect(note()).toBe("");
});

it("shows the prompt to copy by hand when copying fails", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
  });
  const { container } = render(<AskAgent prompt={`claude "hi"`} label="Fill the Gaps" />);
  const note = () => container.querySelector("[aria-live]")?.textContent;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Fill the Gaps/ }));
  });
  expect(note()).toBe(`Copy this and run it in your Home Folder: claude "hi"`);
});

it("copies a command and says so, or asks for it to be copied by hand", async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { container } = render(<CopyButton text="curl -fsSL x | sh" label="Copy the command" />);
  const note = () => container.querySelector("[aria-live]")?.textContent;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy the command" }));
  });
  expect(writeText).toHaveBeenCalledWith("curl -fsSL x | sh");
  expect(note()).toBe("Copied.");

  writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy the command" }));
  });
  expect(note()).toBe("Could not copy. Select it and copy it by hand.");
});
