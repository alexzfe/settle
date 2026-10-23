import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TEST_PASSWORD, TEST_PASSWORD_COST } from "@settle/core";
import { extract } from "tar";
import { afterAll, beforeAll, expect, it } from "vitest";
import { writeBackup } from "./backup.js";
import { type RunningServer, startServer } from "./server.js";
import { setUp } from "./testing.js";

// settle backup, end to end: taken from a running server, unpacked into an empty data dir, and
// started again, it serves the same Homes and files to the same Account.

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, ...new Array(56)]);

let root: string;
let server: RunningServer;
let cookie: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "settle-backup-"));
  server = await startServer(
    { host: "127.0.0.1", port: 0, dataDir: join(root, "data") },
    { passwordCost: TEST_PASSWORD_COST },
  );
  cookie = await setUp(server.setupUrl as string);
});
afterAll(async () => {
  await server.close();
  rmSync(root, { recursive: true, force: true });
});

async function api(base: string, operation: string, body: unknown, as = cookie) {
  const response = await fetch(`${base}/api/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: as },
    body: JSON.stringify(body),
  });
  return response.json();
}

it("writes a .tar.gz that restores into a server serving the same Homes and files", async () => {
  await api(server.url, "create_home", { name: "Kept home", country: "GB", city: "London" });
  // An Item, through the Agent's tools, to give it a Photo, which lands in uploads/.
  const tool = async (name: string, args: unknown) => {
    const response = await fetch(`${server.url}/mcp/homes/kept-home`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        cookie,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    return ((await response.json()) as { result: { content: { text: string }[] } }).result
      .content[0]?.text as string;
  };
  const opening = await tool("open_session", { skill: "home-intake" });
  const session = /^Session: (\S+)$/m.exec(opening)?.[1] ?? "";
  await tool("save_items", { session, items: [{ name: "Lamp", category: "lighting" }] });
  const photo = new FormData();
  photo.set("home", "kept-home");
  photo.set("item", "lamp");
  photo.set("file", new File([JPEG], "lamp.jpg", { type: "image/jpeg" }));
  photo.set("thumb", new File([JPEG], "thumb.jpg", { type: "image/jpeg" }));
  const added = await fetch(`${server.url}/api/add_photo`, {
    method: "POST",
    headers: { cookie },
    body: photo,
  });
  expect(added.status).toBe(200);
  const { photos } = (await added.json()) as { photos: { id: number }[] };

  // Taken while the server runs.
  const archive = join(root, "settle.tgz");
  await writeBackup(join(root, "data"), createWriteStream(archive));
  const restored = join(root, "restored");
  mkdirSync(restored);
  await extract({ file: archive, cwd: restored });
  expect(existsSync(join(restored, "settle.sqlite"))).toBe(true);
  expect(existsSync(join(restored, "uploads", "kept-home", "photos"))).toBe(true);

  const again = await startServer(
    { host: "127.0.0.1", port: 0, dataDir: restored },
    { passwordCost: TEST_PASSWORD_COST },
  );
  try {
    // Its Account came with it, so there is nothing to set up, and the password still works.
    expect(again.setupUrl).toBeUndefined();
    const login = await fetch(`${again.url}/login`, {
      method: "POST",
      headers: { origin: again.url },
      body: new URLSearchParams({ email: "sam@example.com", password: TEST_PASSWORD }),
      redirect: "manual",
    });
    expect(login.status).toBe(303);
    const restoredCookie = (login.headers.get("set-cookie") ?? "").split(";")[0] as string;
    expect(await api(again.url, "list_homes", {}, restoredCookie)).toEqual(
      await api(server.url, "list_homes", {}),
    );
    const served = await fetch(
      `${again.url}/api/get_photo?home=kept-home&item=lamp&photo=${photos[0]?.id}&size=full`,
      { headers: { cookie: restoredCookie } },
    );
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
  } finally {
    await again.close();
  }
});

it("refuses a data dir with no database, saying which", async () => {
  await expect(
    writeBackup(join(root, "empty"), createWriteStream(join(root, "x.tgz"))),
  ).rejects.toThrow(/no Settle database at .*empty/);
});
