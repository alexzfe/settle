// The connector eval mode (claude-app handoff Q15): the live cases run as the claude.ai stand-in,
// Claude Code with no Settle Skills, connected only to a real server's Account endpoint (/mcp) by
// a Connection's token. Every rule must then come from open_session and read_skill.
//
// It starts a scratch server on its own port with a throwaway data dir, so nothing reaches the
// user's Homes on 4380, makes one Account per fixture Home (each case's Agent sees only its own
// Account's Homes), mints each a Connection through the real OAuth flow, and writes a scratch
// plugin with no Skills, only the connector, holding copies of the cases from plugin/evals-live
// and plugin/evals-connector. Each case's results land in plugin/evals-connector/results/.
//
// Usage: pnpm plugin:eval:connector [--case <glob>] [any other `claude plugin eval` option]
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repo = join(import.meta.dirname, "..");
// Not 4380 (the user's server), 4390 (the live suite) or 4391 (the server tests).
const PORT = 4392;
const BASE = `http://127.0.0.1:${PORT}`;
const MCP_URL = `${BASE}/mcp`;
const PASSWORD = "eval connector password";
// The cases' tool names say mcp__plugin_live-server_settle__*, so the scratch plugin keeps the
// live suite's plugin name and server name.
const PLUGIN_NAME = "live-server";

/**
 * The Accounts, each with the Homes it owns, by name; `account` in a case's env names one. The
 * live cases name a Home in EVAL_SETTLE_HOME instead, and get the Account owning just that Home.
 */
const ACCOUNTS = {
  "fixture-home": ["Fixture Home"],
  "fixture-flat": ["Fixture Flat"],
  "fixture-loft": ["Fixture Loft"],
  "two-homes": ["Harbour Flat", "Hill Cottage"],
};

const scratch = mkdtempSync(join(tmpdir(), "settle-connector-"));
const dataDir = join(scratch, "data");
const pluginDir = join(scratch, "plugin");
mkdirSync(dataDir);
const serverLog = join(scratch, "server.log");
let server;

function stop() {
  if (server?.exitCode === null) {
    // detached made the server its own process group, so this stops pnpm and node together.
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
  }
  rmSync(scratch, { recursive: true, force: true });
}
process.on("exit", stop);
process.on("SIGINT", () => process.exit(130));

function fail(message) {
  console.error(message);
  if (existsSync(serverLog))
    console.error(readFileSync(serverLog, "utf8").replace(/^/gm, "  server: "));
  process.exit(1);
}

const started = Date.now();
const step = (what) => console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${what}`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function healthy() {
  try {
    return (await fetch(`${BASE}/health`)).ok;
  } catch {
    return false;
  }
}

/** The Login cookie's value from a response that sets one. */
function loginOf(response) {
  const cookie = response.headers.getSetCookie().find((each) => each.startsWith("settle_login="));
  const value = cookie?.split(";")[0].slice("settle_login=".length);
  if (!value) fail(`No Login came back from ${response.url}: ${response.status}`);
  return value;
}

/** Makes an Account through a setup or invite link, as the browser form does: its Login. */
async function redeem(url, email) {
  const response = await fetch(url, {
    method: "POST",
    body: new URLSearchParams({ email, password: PASSWORD, again: PASSWORD }),
    redirect: "manual",
  });
  return loginOf(response);
}

/** Calls the web API as the Login, failing the run on a refusal. */
async function api(login, operation, body) {
  const response = await fetch(`${BASE}/api/${operation}`, {
    method: "POST",
    headers: { cookie: `settle_login=${login}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) fail(`${operation} refused: ${JSON.stringify(result)}`);
  return result;
}

const base64url = (bytes) => Buffer.from(bytes).toString("base64url");

/**
 * A Connection for the Account the Login is of, through the OAuth flow Claude Code itself uses:
 * register a loopback client, Allow as the logged-in browser would, and swap the code (PKCE S256)
 * for an access token. The token lasts an hour, which is longer than a run of a few cases.
 */
async function connect(login) {
  const redirectUri = "http://127.0.0.1:9/callback";
  const registered = await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Settle connector evals", redirect_uris: [redirectUri] }),
  });
  const { client_id: clientId } = await registered.json();
  if (!clientId) fail(`/register answered ${registered.status}`);
  const verifier = base64url(randomBytes(32));
  const allowed = await fetch(`${BASE}/authorize`, {
    method: "POST",
    headers: { cookie: `settle_login=${login}` },
    body: new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: base64url(createHash("sha256").update(verifier).digest()),
      code_challenge_method: "S256",
      resource: MCP_URL,
      state: "eval",
      decision: "allow",
    }),
    redirect: "manual",
  });
  const location = allowed.headers.get("location") ?? "";
  const code = location.startsWith(redirectUri) ? new URL(location).searchParams.get("code") : null;
  if (!code) fail(`/authorize gave no code: ${allowed.status} ${location}`);
  const token = await fetch(`${BASE}/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
  });
  const { access_token: accessToken } = await token.json();
  if (!accessToken) fail(`/token answered ${token.status}`);
  return accessToken;
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed`);
}

if (await healthy()) fail(`Port ${PORT} is already in use. Stop whatever is running there first.`);

step("Building the server...");
run("pnpm", ["--filter", "@settle/server...", "build"]);

step(`Starting the server on ${PORT} (data in ${dataDir})...`);
const log = openSync(serverLog, "w");
server = spawn("pnpm", ["--filter", "@settle/server", "start"], {
  cwd: repo,
  detached: true,
  stdio: ["ignore", log, log],
  env: { ...process.env, SETTLE_PORT: String(PORT), SETTLE_DATA_DIR: dataDir },
});
for (let i = 0; i < 50 && !(await healthy()); i++) {
  if (server.exitCode !== null) fail("The server exited during startup.");
  await sleep(200);
}
if (!(await healthy())) fail(`The server did not answer ${BASE}/health.`);

let setupUrl;
for (let i = 0; i < 50 && !setupUrl; i++) {
  setupUrl = readFileSync(serverLog, "utf8").match(new RegExp(`${BASE}/setup/[A-Za-z0-9_-]+`))?.[0];
  if (!setupUrl) await sleep(200);
}
if (!setupUrl) fail("The server printed no setup link.");

step("Making the Accounts and their Homes...");
const logins = {};
const tokens = {};
const homeAccount = {};
for (const [account, homes] of Object.entries(ACCOUNTS)) {
  const email = `${account}@example.com`;
  if (Object.keys(logins).length === 0) {
    logins[account] = await redeem(setupUrl, email);
  } else {
    const { invite } = await api(logins["fixture-home"], "create_invite", {});
    logins[account] = await redeem(invite.url, email);
  }
  for (const name of homes) {
    const { home } = await api(logins[account], "create_home", {
      name,
      country: "GB",
      city: "London",
    });
    homeAccount[home.slug] = account;
  }
}

step("Uploading the fixture Blueprint and seeding...");
// As the live suite: the fixture one-page A3 ground floor, its page unmapped, on Fixture Home.
const form = new FormData();
form.set("home", "fixture-home");
form.set("label", "Ground floor plan");
const pdf = readFileSync(join(repo, "packages/core/fixture/blueprint-a3.pdf"));
form.set("file", new Blob([pdf], { type: "application/pdf" }), "blueprint-a3.pdf");
const uploaded = await fetch(`${BASE}/api/upload_blueprint`, {
  method: "POST",
  headers: { cookie: `settle_login=${logins["fixture-home"]}` },
  body: form,
});
if (!uploaded.ok) fail(`upload_blueprint refused: ${await uploaded.text()}`);

// As the live suite: a Settled Design Direction on Fixture Flat, and a Palette too on Fixture Loft.
run("node", ["scripts/seed-live-direction.mjs", `${BASE}/mcp/homes/fixture-flat`], {
  EVAL_SETTLE_LOGIN: logins["fixture-flat"],
});
run("node", ["scripts/seed-live-palette.mjs", `${BASE}/mcp/homes/fixture-loft`], {
  EVAL_SETTLE_LOGIN: logins["fixture-loft"],
});

step("Connecting each Account...");
for (const account of Object.keys(ACCOUNTS)) tokens[account] = await connect(logins[account]);

// The scratch plugin: the connector and nothing else, so no Settle Skill is there to load.
mkdirSync(join(pluginDir, ".claude-plugin"), { recursive: true });
writeFileSync(
  join(pluginDir, ".claude-plugin", "plugin.json"),
  JSON.stringify({
    name: PLUGIN_NAME,
    version: "0.0.1",
    description: "Scratch plugin for the connector evals: Settle's Account endpoint, no Skills.",
  }),
);
writeFileSync(
  join(pluginDir, ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      settle: {
        type: "http",
        url: MCP_URL,
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code expands it from the case's env.
        headers: { Authorization: "Bearer ${EVAL_SETTLE_TOKEN}" },
      },
    },
  }),
);

/**
 * A case's prompt.md for the scratch plugin: its own plugin alone, and the token of the Account
 * its env names (EVAL_SETTLE_ACCOUNT), or of the one owning its EVAL_SETTLE_HOME.
 */
function connectorCase(text, name) {
  const [, frontmatter, body] =
    /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text) ?? fail(`${name}: no frontmatter`);
  const account =
    /^\s+EVAL_SETTLE_ACCOUNT:\s*(\S+)/m.exec(frontmatter)?.[1] ??
    homeAccount[/^\s+EVAL_SETTLE_HOME:\s*(\S+)/m.exec(frontmatter)?.[1] ?? "fixture-home"];
  if (!tokens[account]) fail(`${name}: no Account "${account}"`);
  const kept = frontmatter
    .replace(/^plugins:.*\n?/m, "")
    .replace(/^env:\n(?:\s+.*\n?)*/m, "")
    .trimEnd();
  return [
    "---",
    kept,
    'plugins: ["../.."]',
    "env:",
    `  EVAL_SETTLE_TOKEN: ${tokens[account]}`,
    "---",
    body,
  ].join("\n");
}

for (const suite of ["evals-live", "evals-connector"]) {
  const dir = join(repo, "plugin", suite);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const prompt = join(dir, name, "prompt.md");
    if (!existsSync(prompt)) continue;
    const target = join(pluginDir, "evals", name);
    cpSync(join(dir, name), target, { recursive: true });
    writeFileSync(join(target, "prompt.md"), connectorCase(readFileSync(prompt, "utf8"), name));
  }
}

step("Running the evals...");
const results = join(
  repo,
  "plugin",
  "evals-connector",
  "results",
  new Date().toISOString().replaceAll(":", "-"),
);
mkdirSync(results, { recursive: true });
const evals = spawnSync(
  "claude",
  [
    "plugin",
    "eval",
    pluginDir,
    "--mocks",
    "off",
    "--allow-tools",
    `mcp__plugin_${PLUGIN_NAME}_settle__*`,
    "--trust-plugin",
    "--ablation",
    "none",
    "--no-publish",
    "--runs",
    "1",
    "--max-cost-usd",
    "6",
    "--model",
    "claude-sonnet-5",
    "--output-dir",
    results,
    ...process.argv.slice(2),
  ],
  { cwd: repo, stdio: "inherit" },
);
console.log(`Results: ${results}`);
// The server child would keep Node alive; exit stops it and removes the scratch folder.
process.exit(evals.status ?? 1);
