import { afterEach, expect, it, vi } from "vitest";
import { call } from "./api";
import { createQueryClient } from "./queries";
import { stubApi } from "./testSupport";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** list_homes answered by the proxy with these statuses in turn, then by the server. */
function homesAnswering(statuses: number[]) {
  const left = [...statuses];
  return stubApi({
    list_homes: () => {
      const status = left.shift();
      return status ? new Response("<html>Bad gateway</html>", { status }) : { homes: [] };
    },
  });
}

async function fetchHomes() {
  const fetched = createQueryClient().fetchQuery({
    queryKey: ["homes"],
    queryFn: () => call("list_homes", {}),
  });
  const settled = fetched.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

it.each([502, 503, 504])(
  "retries a query the proxy answers %i while the server restarts",
  async (status) => {
    vi.useFakeTimers();
    const fetch = homesAnswering([status, status]);
    expect(await fetchHomes()).toEqual({ value: { homes: [] } });
    expect(fetch).toHaveBeenCalledTimes(3);
  },
);

it("gives up after three retries", async () => {
  vi.useFakeTimers();
  const fetch = homesAnswering([502, 502, 502, 502, 502]);
  expect(await fetchHomes()).toHaveProperty("error");
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("does not retry a refusal", async () => {
  vi.useFakeTimers();
  const fetch = homesAnswering([500]);
  expect(await fetchHomes()).toHaveProperty("error");
  expect(fetch).toHaveBeenCalledTimes(1);
});
