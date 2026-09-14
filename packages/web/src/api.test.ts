import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, call } from "./api";

describe("call", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the input as JSON to /api/<operation> and returns the answer", async () => {
    const fetch = vi.fn(async () => Response.json({ homes: [] }));
    vi.stubGlobal("fetch", fetch);
    await expect(call("list_homes", {})).resolves.toEqual({ homes: [] });
    expect(fetch).toHaveBeenCalledWith("/api/list_homes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  });

  it("turns the error shape into an ApiError with its code, message, and status", async () => {
    const refusal = {
      error: { code: "folder_belongs_to_other_home", message: "That folder is the Cabin's." },
    };
    vi.stubGlobal("fetch", async () => Response.json(refusal, { status: 409 }));
    const error = await call("set_up_home_folder", { home: "flat", path: "/x" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "folder_belongs_to_other_home",
      message: "That folder is the Cabin's.",
      status: 409,
    });
  });

  it("reports an answer without the error shape as unexpected_response", async () => {
    vi.stubGlobal("fetch", async () => new Response("Bad Gateway", { status: 502 }));
    await expect(call("list_homes", {})).rejects.toMatchObject({
      code: "unexpected_response",
      message: expect.stringContaining("/api/list_homes answered 502"),
      status: 502,
    });
  });

  it("reports a successful answer that is not JSON as unexpected_response", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!doctype html>", { status: 200 }));
    await expect(call("list_homes", {})).rejects.toMatchObject({ code: "unexpected_response" });
  });

  it("reports a network failure as unreachable", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    await expect(call("list_homes", {})).rejects.toMatchObject({
      code: "unreachable",
      status: undefined,
    });
  });
});
