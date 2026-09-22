// Seeds a Settled Design Direction into one Home through its MCP endpoint, as a Design Direction
// Session would leave it, for the live smoke suite's Color case (scripts/plugin-eval-live.sh).
// Usage: node scripts/seed-live-direction.mjs http://127.0.0.1:4390/mcp/homes/<home slug>
const [url] = process.argv.slice(2);
if (!url) throw new Error("Usage: node scripts/seed-live-direction.mjs <MCP endpoint URL>");

let id = 0;

/** Calls one tool and returns its result; throws on a JSON-RPC error or a refused call. */
async function call(name, args) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const body = await response.json();
  if (body.error || body.result?.isError) {
    throw new Error(`${name}: ${JSON.stringify(body.error ?? body.result.content)}`);
  }
  return body.result;
}

// The opening's first line is "Session: <id>".
const opened = await call("open_session", { skill: "design-direction" });
const text = opened.content?.find((block) => block.type === "text")?.text ?? "";
const session = /^Session: (\S+)/m.exec(text)?.[1];
if (!session) throw new Error(`open_session returned no Session id: ${JSON.stringify(opened)}`);

await call("save_decision", {
  session,
  kind: "design-direction",
  title: "Warm minimalism",
  statement: "Calm, warm rooms of natural materials that age well.",
  content: {
    mood: "calm, grounded",
    temperature: "warm",
    contrast: "low",
    keyMaterials: ["oak", "linen", "limewash", "unlacquered brass"],
    styleReferences: ["Japandi", "1970s Danish modern"],
    principles: ["Fewer, better things", "Daylight first, then low warm lamps"],
  },
});
await call("set_decision_state", {
  session,
  decision: "warm-minimalism",
  to: "settled",
  reason: 'The user: "yes, settle it"',
});
await call("close_session", {
  session,
  summary: {
    changed: "Settled the Design Direction 'Warm minimalism'.",
    open: "The Palette.",
    next: "Choose the Palette in Color.",
  },
});
console.log(`Settled the Design Direction 'Warm minimalism' in Session ${session}.`);
