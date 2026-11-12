import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_PASSWORD, TEST_PASSWORD_COST } from "@settle/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { type RunningServer, startServer } from "./server.js";
import { setUp } from "./testing.js";

// Stopping, as a deploy does with SIGTERM: the server stops accepting, lets the requests already
// in flight finish against an open database, ends the /events streams, and only then closes.

// A short grace, so the test of a request that never finishes does not wait the real one.
const GRACE_MS = 300;

let root: string;
let server: RunningServer;
let cookie: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "settle-shutdown-"));
  server = await startServer(
    { host: "127.0.0.1", port: 0, dataDir: join(root, "data") },
    { passwordCost: TEST_PASSWORD_COST, stopGraceMs: GRACE_MS },
  );
  cookie = await setUp(server.setupUrl as string);
});
afterEach(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

it("lets a request whose body is still arriving finish, against an open database", async () => {
  const body = new URLSearchParams({ email: "sam@example.com", password: "not the password" });
  const bytes = Buffer.from(body.toString());
  const answered = new Promise<number>((resolve, reject) => {
    const sending = request(
      `${server.url}/login`,
      {
        method: "POST",
        headers: {
          origin: server.url,
          "content-type": "application/x-www-form-urlencoded",
          "content-length": bytes.length,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    sending.on("error", reject);
    // Half the body now; the rest once the stop has begun.
    sending.write(bytes.subarray(0, 10));
    setTimeout(() => sending.end(bytes.subarray(10)), 300);
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const closed = server.close();
  // The login was checked against the database, so it is a wrong password, not a reset socket
  // or a 500 from a closed database.
  expect(await answered).toBe(401);
  await closed;
});

it("does not wait on an open /events stream", async () => {
  await fetch(`${server.url}/api/create_home`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "Streamed", country: "GB", city: "London" }),
  });
  const stream = await fetch(`${server.url}/events?home=streamed`, { headers: { cookie } });
  expect(stream.status).toBe(200);
  const reader = (stream.body as ReadableStream<Uint8Array>).getReader();
  await reader.read();

  const started = Date.now();
  await server.close();
  expect(Date.now() - started).toBeLessThan(2000);
  await reader.cancel().catch(() => {});
});

it("cuts a request whose body never finishes once the grace is over", async () => {
  const cut = new Promise<void>((resolve) => {
    const sending = request(`${server.url}/login`, {
      method: "POST",
      headers: {
        origin: server.url,
        "content-type": "application/x-www-form-urlencoded",
        "content-length": 1000,
      },
    });
    // The socket is cut, so the request ends in an error rather than an answer.
    sending.on("error", () => resolve());
    sending.on("response", () => resolve());
    sending.write("email=sam%40example.com&password=");
  });
  await new Promise((resolve) => setTimeout(resolve, 100));

  const started = Date.now();
  await server.close();
  const took = Date.now() - started;
  await cut;
  expect(took).toBeGreaterThanOrEqual(GRACE_MS - 50);
  expect(took).toBeLessThan(GRACE_MS + 2000);
});

it("closes the database only once the handler of a cut request has ended", async () => {
  // Its own server: a near-zero grace, and a password cost slow enough that the login's handler
  // is still checking the password when the stop cuts its connection, then writes the Login.
  const slow = await startServer(
    { host: "127.0.0.1", port: 0, dataDir: join(root, "slow") },
    { passwordCost: { N: 2 ** 16, r: 8, p: 1 }, stopGraceMs: 1 },
  );
  await setUp(slow.setupUrl as string);
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const body = new URLSearchParams({ email: "sam@example.com", password: TEST_PASSWORD });
    const cut = fetch(`${slow.url}/login`, {
      method: "POST",
      headers: { origin: slow.url },
      body,
      redirect: "manual",
    }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));

    await slow.close();
    await cut;
    // Give a handler that outlived close() the time to reach the database.
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Hono logs a handler's error; against a closed database, startLogin's write would throw.
    expect(logged.mock.calls.flat().map(String)).toEqual([]);
  } finally {
    logged.mockRestore();
    await slow.close();
  }
});
