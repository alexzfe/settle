import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchHealth } from "./api";

describe("fetchHealth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads /health", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "ok" }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchHealth()).resolves.toEqual({ status: "ok" });
    expect(fetch).toHaveBeenCalledWith("/health");
  });

  it("throws when the server answers with an error", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 502 }));
    await expect(fetchHealth()).rejects.toThrow("/health answered 502");
  });
});
