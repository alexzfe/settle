import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, authStatus, call, login, unreachableMessage } from "./api";

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
      error: { code: "home_not_found", message: "There is no Home 'cabin'." },
    };
    vi.stubGlobal("fetch", async () => Response.json(refusal, { status: 404 }));
    const error = await call("home_folder_setup", { home: "cabin" }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "home_not_found",
      message: "There is no Home 'cabin'.",
      status: 404,
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

  it("goes to the login on a 401, still refusing the call", async () => {
    const go = vi.spyOn(login, "go").mockImplementation(() => {});
    const refusal = { error: { code: "unauthorized", message: "Log in first." } };
    vi.stubGlobal("fetch", async () => Response.json(refusal, { status: 401 }));
    await expect(call("list_homes", {})).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    expect(go).toHaveBeenCalledTimes(1);
    go.mockRestore();
  });

  it("never goes to the login for any other refusal", async () => {
    const go = vi.spyOn(login, "go").mockImplementation(() => {});
    const refusal = { error: { code: "forbidden", message: "Not here." } };
    vi.stubGlobal("fetch", async () => Response.json(refusal, { status: 403 }));
    await expect(call("list_homes", {})).rejects.toMatchObject({ status: 403 });
    expect(go).not.toHaveBeenCalled();
    go.mockRestore();
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

describe("unreachableMessage", () => {
  it("says how to start the server only when the page is served from this computer", () => {
    const start = "The server is not answering. Start it with pnpm dev.";
    expect(unreachableMessage("localhost")).toBe(start);
    expect(unreachableMessage("127.0.0.1")).toBe(start);
    expect(unreachableMessage("settle.example.com")).toBe("The server is not answering.");
  });
});

describe("authStatus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks GET /api/auth_status whether the server has a login", async () => {
    const fetch = vi.fn(async () => Response.json({ auth: true }));
    vi.stubGlobal("fetch", fetch);
    await expect(authStatus()).resolves.toEqual({ auth: true });
    expect(fetch).toHaveBeenCalledWith("/api/auth_status", { method: "GET" });
  });
});
