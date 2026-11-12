import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Actions } from "./Actions";
import { createQueryClient } from "./queries";

afterEach(cleanup);

it("keeps focus on the pressed button while it works, marking it unavailable rather than disabled", async () => {
  const post = vi.fn(() => new Promise<never>(() => {}));
  render(
    <QueryClientProvider client={createQueryClient()}>
      <Actions home="flat" actions={[{ label: "Keep", post }]} />
    </QueryClientProvider>,
  );
  const keep = screen.getByRole("button", { name: "Keep" });
  keep.focus();
  fireEvent.click(keep);
  await waitFor(() => expect(keep.getAttribute("aria-disabled")).toBe("true"));
  expect(keep.hasAttribute("disabled")).toBe(false);
  expect(document.activeElement).toBe(keep);
  // A second press while it works sends nothing more.
  fireEvent.click(keep);
  expect(post).toHaveBeenCalledTimes(1);
});
