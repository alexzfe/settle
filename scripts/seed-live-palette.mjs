// Seeds one Home through its MCP endpoint as a Design Direction and a Color Session would leave
// it, for the live smoke suite's Purchase case (scripts/plugin-eval-live.sh): a Settled Design
// Direction, a Settled Palette "Warm clay", a measured Living room, and the Home's narrowest access.
// Usage: node scripts/seed-live-palette.mjs http://127.0.0.1:4390/mcp/homes/<home slug>
const [url] = process.argv.slice(2);
if (!url) throw new Error("Usage: node scripts/seed-live-palette.mjs <MCP endpoint URL>");

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

const measured = (mm) => ({ mm, provenance: "measured" });

// The opening's first line is "Session: <id>".
const opened = await call("open_session", { skill: "color" });
const text = opened.content?.find((block) => block.type === "text")?.text ?? "";
const session = /^Session: (\S+)/m.exec(text)?.[1];
if (!session) throw new Error(`open_session returned no Session id: ${JSON.stringify(opened)}`);

await call("save_home", {
  session,
  accessWidth: measured(760),
  accessNote: "the front door",
});
await call("save_room", {
  session,
  name: "Living room",
  functions: ["living"],
  ceilingHeight: measured(2600),
  walls: [
    { position: 1, length: measured(4200) },
    { position: 2, length: measured(3600) },
    { position: 3, length: measured(4200) },
    { position: 4, length: measured(3600) },
  ],
});

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

await call("save_decision", {
  session,
  kind: "palette",
  title: "Warm clay",
  statement: "Soft plaster and clay tones, a warm stone for the living room, a terracotta accent.",
  content: {
    colors: [
      {
        name: "Pointing",
        brand: "Farrow & Ball",
        code: "No. 2003",
        hex: "#efe9dc",
        provenance: "measured",
        role: "base",
        note: "ceilings and woodwork throughout",
      },
      {
        name: "Setting Plaster",
        brand: "Farrow & Ball",
        code: "No. 231",
        hex: "#e0c2b0",
        provenance: "measured",
        role: "base",
        note: "walls in the bedrooms",
      },
      {
        name: "Jitney",
        brand: "Farrow & Ball",
        code: "No. 293",
        hex: "#c7b299",
        provenance: "measured",
        role: "secondary",
        note: "living room walls",
      },
      {
        name: "warm terracotta",
        hex: "#b86a4b",
        provenance: "estimated",
        role: "accent",
        note: "cushions and a rug",
      },
    ],
  },
});
await call("set_decision_state", {
  session,
  decision: "warm-clay",
  to: "settled",
  reason: 'The user: "yes, those are our colours"',
});

await call("close_session", {
  session,
  summary: {
    changed: "Settled the Design Direction 'Warm minimalism' and the Palette 'Warm clay'.",
    open: "Nothing bought yet.",
    next: "Buy for the living room in Purchase.",
  },
});
console.log(`Settled 'Warm minimalism' and the Palette 'Warm clay' in Session ${session}.`);
