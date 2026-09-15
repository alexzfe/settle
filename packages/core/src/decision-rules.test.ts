// The server-enforced Decision rules of slice 4, written before their implementation: one test
// per row of the transitions table and per illegal transition, the Session and reason rule, Basis
// and Evidence existence, the automatic Design Direction, the flag cascade, clearing a flag, and
// Conflicts only against Locked Decisions (docs/specs/skill-set.md#rule-enforcement).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CallContext, type Core, createCore, type OperationInput } from "./core.js";
import { CoreError } from "./errors.js";
import type { DecisionDetail, DecisionState } from "./operations/schemas.js";

const web: CallContext = { caller: { kind: "web" } };

let core: Core;
let home: string;
let session: string;
const agent = (id?: string): CallContext => ({ caller: { kind: "session", session: id }, home });

beforeEach(async () => {
  core = createCore();
  home = (await core.run("create_home", web, { name: "My flat", country: "GB", city: "London" }))
    .home.slug;
  session = await openSession();
  await core.run("save_room", agent(session), { session, name: "Living room" });
  await core.run("save_room", agent(session), { session, name: "Spare room" });
});
afterEach(() => core.close());

async function openSession(target = home): Promise<string> {
  const context: CallContext = { caller: { kind: "session" }, home: target };
  return (await core.run("open_session", context, { skill: "design-direction" })).session;
}

async function refusal(promise: Promise<unknown>): Promise<CoreError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CoreError) return error;
    throw error;
  }
  throw new Error("Expected core to refuse, but it succeeded");
}

type SaveInput = Omit<OperationInput<"save_decision">, "session">;

async function save(input: SaveInput): Promise<string> {
  const { receipt } = await core.run("save_decision", agent(session), { session, ...input });
  return receipt;
}

const permission = 'The user: "yes, do it"';

async function setState(decision: string, to: DecisionState, reason = permission) {
  return core.run("set_decision_state", agent(session), { session, decision, to, reason });
}

async function detail(decision: string): Promise<DecisionDetail> {
  return (await core.run("get_decision", web, { home, decision })).decision;
}

async function stateOf(decision: string): Promise<DecisionState> {
  return (await detail(decision)).state;
}

/** Takes a new Candidate to `state` by a legal move. */
async function reach(decision: string, state: DecisionState): Promise<void> {
  if (state !== "candidate") await setState(decision, state);
}

const direction = (title = "Warm minimalism"): SaveInput => ({
  kind: "design-direction",
  title,
  statement: "Calm, warm rooms of natural materials.",
  content: { mood: "calm", temperature: "warm", contrast: "low" },
});

const other = (title: string, basis?: string[]): SaveInput => ({
  kind: "other",
  title,
  statement: `${title}, as the user said.`,
  ...(basis ? { basis } : {}),
});

const roomDirection = (basis?: string[]): SaveInput => ({
  kind: "room-direction",
  room: "living-room",
  title: "Calm evenings",
  statement: "A low, warm room for evenings.",
  content: { direction: "Low lamps, soft textiles, and nothing bright after dark." },
  ...(basis ? { basis } : {}),
});

const LEGAL: [DecisionState, DecisionState][] = [
  ["candidate", "leaning"],
  ["candidate", "locked"],
  ["candidate", "rejected"],
  ["leaning", "candidate"],
  ["leaning", "locked"],
  ["leaning", "rejected"],
  ["locked", "leaning"],
  ["locked", "rejected"],
  ["rejected", "candidate"],
];

const ILLEGAL: [DecisionState, DecisionState][] = [
  ["candidate", "candidate"],
  ["leaning", "leaning"],
  ["locked", "locked"],
  ["locked", "candidate"],
  ["rejected", "leaning"],
  ["rejected", "locked"],
  ["rejected", "rejected"],
];

describe("the transitions table", () => {
  it("starts every new Decision as a Candidate", async () => {
    await save(other("Knock through"));
    expect(await stateOf("knock-through")).toBe("candidate");
  });

  it.each(LEGAL)("allows %s to %s, recording the Session and reason", async (from, to) => {
    await save(other("Knock through"));
    await reach("knock-through", from);

    await setState("knock-through", to, 'The user: "go ahead"');

    const decision = await detail("knock-through");
    expect(decision.state).toBe(to);
    expect(decision.stateChanges.at(-1)).toMatchObject({
      from,
      to,
      origin: session,
      reason: 'The user: "go ahead"',
    });
  });

  it.each(ILLEGAL)("refuses %s to %s with illegal_transition", async (from, to) => {
    await save(other("Knock through"));
    await reach("knock-through", from);

    const error = await refusal(setState("knock-through", to));

    expect(error.code).toBe("illegal_transition");
    expect(await stateOf("knock-through")).toBe(from);
  });
});

describe("a state change from the Agent", () => {
  beforeEach(() => save(other("Knock through")));

  it("is refused without a Session", async () => {
    const error = await refusal(
      core.run("set_decision_state", agent(), {
        decision: "knock-through",
        to: "leaning",
        reason: permission,
      } as OperationInput<"set_decision_state">),
    );
    expect(["session_required", "validation"]).toContain(error.code);
    expect(await stateOf("knock-through")).toBe("candidate");
  });

  it.each(["", "   "])("is refused with reason_required for the reason %j", async (reason) => {
    const error = await refusal(setState("knock-through", "leaning", reason));
    expect(error.code).toBe("reason_required");
    expect(error.message).toContain("reason");
    expect(await stateOf("knock-through")).toBe("candidate");
  });

  it("is refused from a closed Session, pointing at open_session", async () => {
    await core.run("close_session", agent(session), {
      session,
      summary: { changed: "A Candidate.", open: "Everything.", next: "Design Direction." },
    });
    const error = await refusal(setState("knock-through", "leaning"));
    expect(error.code).toBe("session_closed");
    expect(error.message).toContain("open_session");
    expect(await stateOf("knock-through")).toBe("candidate");
  });
});

describe("a state change from the web UI", () => {
  it("needs neither a Session nor a reason, and is logged as from the web", async () => {
    await save(other("Knock through"));

    await core.run("set_decision_state", web, { home, decision: "knock-through", to: "locked" });

    const decision = await detail("knock-through");
    expect(decision.state).toBe("locked");
    expect(decision.stateChanges.at(-1)).toEqual({
      from: "candidate",
      to: "locked",
      origin: "web",
      at: expect.any(String),
    });
    const { changes } = await core.run("get_change_log", web, { home });
    expect(changes[0]).toMatchObject({ origin: "web", recordKind: "decision", field: "state" });
  });

  it("follows the same transitions table", async () => {
    await save(other("Knock through"));
    await setState("knock-through", "rejected");
    const error = await refusal(
      core.run("set_decision_state", web, { home, decision: "knock-through", to: "locked" }),
    );
    expect(error.code).toBe("illegal_transition");
  });
});

describe("Basis and Evidence", () => {
  it("refuses a Basis entry that is not a Decision of this Home, saving nothing", async () => {
    const elsewhere = (
      await core.run("create_home", web, { name: "Cottage", country: "GB", city: "London" })
    ).home.slug;
    const theirs = await openSession(elsewhere);
    await core.run(
      "save_decision",
      { caller: { kind: "session", session: theirs }, home: elsewhere },
      { session: theirs, ...other("Their porch") },
    );

    const unknown = await refusal(save(other("Knock through", ["no-such-decision"])));
    const foreign = await refusal(save(other("Knock through", ["their-porch"])));

    expect([unknown.code, foreign.code]).toEqual(["not_found", "not_found"]);
    expect(unknown.message).toContain("find_decisions");
    const { decisions } = await core.run("list_decisions", web, { home });
    expect(decisions).toEqual([]);
  });

  it("refuses a Decision resting on itself", async () => {
    await save(other("Knock through"));
    const error = await refusal(
      save({ ...other("Knock through", ["knock-through"]), decision: "knock-through" }),
    );
    expect(error.code).toBe("validation");
  });

  it.each([
    ["note", "no-such-note"],
    ["session", "design-direction-zzzz"],
    ["decision", "no-such-decision"],
  ] as const)("refuses %s Evidence that does not exist in this Home", async (kind, id) => {
    const error = await refusal(
      save({ ...other("Knock through"), evidence: [{ kind, id, stance: "supports" }] }),
    );
    expect(error.code).toBe("not_found");
  });

  it("refuses a Session of another Home as Evidence", async () => {
    const elsewhere = (
      await core.run("create_home", web, { name: "Cottage", country: "GB", city: "London" })
    ).home.slug;
    const theirs = await openSession(elsewhere);
    const error = await refusal(
      save({
        ...other("Knock through"),
        evidence: [{ kind: "session", id: theirs, stance: "supports" }],
      }),
    );
    expect(error.code).toBe("not_found");
  });

  it("records Evidence from this Home's Notes, Sessions, and Decisions", async () => {
    await core.run("save_note", agent(session), { session, text: "The cats scratch fabric" });
    await save(other("Keep the floors"));
    await save({
      ...other("Knock through"),
      evidence: [
        { kind: "note", id: "the-cats-scratch-fabric", stance: "undermines" },
        { kind: "session", id: session, stance: "supports", note: "The user showed a photo." },
        { kind: "decision", id: "keep-the-floors", stance: "supports" },
      ],
    });
    expect((await detail("knock-through")).evidence).toEqual([
      expect.objectContaining({
        kind: "note",
        id: "the-cats-scratch-fabric",
        stance: "undermines",
      }),
      expect.objectContaining({ kind: "session", id: session, note: "The user showed a photo." }),
      expect.objectContaining({ kind: "decision", id: "keep-the-floors", stance: "supports" }),
    ]);
  });
});

describe("the Design Direction in every Basis", () => {
  it("is in every other Decision's Basis automatically, and never listed twice", async () => {
    await save(direction());
    await setState("warm-minimalism", "locked");
    await save(other("Keep the floors"));

    await save(roomDirection(["warm-minimalism", "keep-the-floors"]));

    expect((await detail("calm-evenings")).basis).toEqual([
      expect.objectContaining({ slug: "warm-minimalism", automatic: true }),
      expect.objectContaining({ slug: "keep-the-floors", automatic: false }),
    ]);
  });

  // A Decision saved before the Direction was settled: basis-rules.test.ts.
});

describe("the flag cascade", () => {
  it("flags, but never changes, every Decision resting on a reopened one", async () => {
    await save(direction());
    await setState("warm-minimalism", "locked");
    await save(roomDirection());
    await setState("calm-evenings", "locked");
    await save({
      kind: "room-use",
      room: "spare-room",
      title: "Office",
      statement: "The spare room becomes an office.",
      content: { functions: ["office"] },
    });
    await save(other("Paint it black"));
    await setState("paint-it-black", "rejected");

    const { receipt } = await setState("warm-minimalism", "leaning");

    const room = await detail("calm-evenings");
    expect(room.state).toBe("locked");
    expect(room.openFlags).toEqual([
      expect.objectContaining({
        cause: "reopened",
        source: expect.objectContaining({ kind: "decision", slug: "warm-minimalism" }),
      }),
    ]);
    expect((await detail("office")).openFlags).toHaveLength(1);
    expect((await detail("paint-it-black")).openFlags).toEqual([]);
    expect((await detail("warm-minimalism")).openFlags).toEqual([]);
    expect(receipt).toContain("Calm evenings (calm-evenings)");
    expect(receipt).toContain("Office (office)");
    expect(receipt).not.toContain("paint-it-black");
  });

  it("flags every Decision with a rejected one in its Basis, and no other", async () => {
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "locked");
    await save(other("Oil the boards", ["keep-the-floors"]));
    await setState("oil-the-boards", "leaning");
    await save(other("New skirting"));

    await setState("keep-the-floors", "rejected");

    expect((await detail("oil-the-boards")).openFlags).toEqual([
      expect.objectContaining({ cause: "rejected", slug: "oil-the-boards/flag-1" }),
    ]);
    expect((await detail("oil-the-boards")).state).toBe("leaning");
    expect((await detail("new-skirting")).openFlags).toEqual([]);
  });

  it("flags nothing on a Lock, a lean, or a revival", async () => {
    await save(other("Keep the floors"));
    await save(other("Oil the boards", ["keep-the-floors"]));
    await setState("keep-the-floors", "leaning");
    await setState("keep-the-floors", "locked");
    await setState("oil-the-boards", "rejected");
    await setState("oil-the-boards", "candidate");
    expect((await detail("oil-the-boards")).openFlags).toEqual([]);
  });
});

describe("clearing a flag", () => {
  /** A Locked Decision flagged because the one it rests on was reopened. */
  async function flagged(): Promise<string> {
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "locked");
    await save(other("Oil the boards", ["keep-the-floors"]));
    await setState("oil-the-boards", "locked");
    await setState("keep-the-floors", "leaning");
    return (await detail("oil-the-boards")).openFlags[0]?.slug ?? "";
  }

  it("keep clears it and leaves the Decision as it is", async () => {
    const flag = await flagged();
    await core.run("resolve_flag", web, { home, flag, resolution: "keep", reason: "Still right." });
    const decision = await detail("oil-the-boards");
    expect(decision.state).toBe("locked");
    expect(decision.openFlags).toEqual([]);
    expect(decision.flags).toEqual([
      expect.objectContaining({ slug: flag, resolution: "keep", clearedAt: expect.any(String) }),
    ]);
  });

  it("reopen clears it by Reopening the Decision, which cascades", async () => {
    const flag = await flagged();
    await save(other("Wax finish", ["oil-the-boards"]));

    await core.run("resolve_flag", web, { home, flag, resolution: "reopen" });

    const decision = await detail("oil-the-boards");
    expect(decision.state).toBe("leaning");
    expect(decision.openFlags).toEqual([]);
    expect(decision.flags[0]).toMatchObject({ resolution: "reopen" });
    expect((await detail("wax-finish")).openFlags).toEqual([
      expect.objectContaining({ cause: "reopened" }),
    ]);
  });

  it("reject clears it by Rejecting the Decision", async () => {
    const flag = await flagged();
    await core.run("resolve_flag", web, { home, flag, resolution: "reject" });
    const decision = await detail("oil-the-boards");
    expect(decision.state).toBe("rejected");
    expect(decision.openFlags).toEqual([]);
    expect(decision.flags[0]).toMatchObject({ resolution: "reject" });
  });

  it("reopen goes through the transitions table: a flagged Leaning Decision can't be Reopened", async () => {
    await flagged();
    await save(other("Wax finish", ["keep-the-floors"]));
    await setState("wax-finish", "leaning");
    await setState("keep-the-floors", "rejected");
    const flag = (await detail("wax-finish")).openFlags[0]?.slug ?? "";

    const error = await refusal(
      core.run("resolve_flag", web, { home, flag, resolution: "reopen" }),
    );

    expect(error.code).toBe("illegal_transition");
    expect((await detail("wax-finish")).openFlags).toHaveLength(1);
  });

  it("the Agent clears it by Reopening, Rejecting, or keeping the Decision's state", async () => {
    await flagged();
    const { receipt } = await setState("oil-the-boards", "locked", 'The user: "keep it"');
    expect((await detail("oil-the-boards")).openFlags).toEqual([]);
    expect((await detail("oil-the-boards")).flags[0]).toMatchObject({ resolution: "keep" });
    expect(receipt).toContain("oil-the-boards/flag-1");

    await setState("keep-the-floors", "locked");
    await setState("keep-the-floors", "rejected");
    expect((await detail("oil-the-boards")).openFlags).toHaveLength(1);
    await setState("oil-the-boards", "rejected");
    expect((await detail("oil-the-boards")).openFlags).toEqual([]);
  });
});

describe("Conflicts", () => {
  it("can be raised only against a Locked Decision", async () => {
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "leaning");
    const error = await refusal(
      core.run("flag_conflict", agent(session), {
        session,
        decision: "keep-the-floors",
        description: "The user now says the tiles crack.",
      }),
    );
    expect(error.code).toBe("not_locked");
    expect((await detail("keep-the-floors")).conflicts).toEqual([]);
  });

  it("stays open against a Locked Decision until the user keeps, Reopens, or Rejects it", async () => {
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "locked");
    await core.run("flag_conflict", agent(session), {
      session,
      decision: "keep-the-floors",
      description: "The user now says the tiles crack.",
    });
    const raised = await detail("keep-the-floors");
    expect(raised.state).toBe("locked");
    expect(raised.openConflicts).toEqual([
      expect.objectContaining({ slug: "keep-the-floors/conflict-1", session }),
    ]);

    await core.run("resolve_conflict", web, {
      home,
      conflict: "keep-the-floors/conflict-1",
      resolution: "reopen",
      reason: "The tiles do crack.",
    });

    const resolved = await detail("keep-the-floors");
    expect(resolved.state).toBe("leaning");
    expect(resolved.openConflicts).toEqual([]);
    expect(resolved.conflicts[0]).toMatchObject({ resolution: "reopen" });
  });
});

describe("content, scope, and Requirements by kind", () => {
  it("refuses content missing a field the kind needs, naming it", async () => {
    const error = await refusal(
      save({ kind: "room-direction", room: "living-room", title: "Calm", statement: "Calm." }),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("direction");
  });

  it("refuses content fields of another kind", async () => {
    const error = await refusal(
      save({ ...direction(), content: { mood: "calm", functions: ["office"] } }),
    );
    expect(error.code).toBe("validation");
    expect(error.message).toContain("functions");
  });

  it("keeps a Design Direction Home-wide and a Room Direction on one Room", async () => {
    const withRoom = await refusal(save({ ...direction(), room: "living-room" }));
    const withoutRoom = await refusal(save({ ...roomDirection(), room: undefined }));
    expect([withRoom.code, withoutRoom.code]).toEqual(["validation", "validation"]);
  });

  it("takes Requirements on a Purchase only, each with a reason that exists", async () => {
    const onOther = await refusal(
      save({
        ...other("Knock through"),
        requirements: [
          { text: "Under 85 cm", strength: "must", reason: { kind: "room", id: "living-room" } },
        ],
      }),
    );
    const noReason = await refusal(
      save({
        kind: "purchase",
        room: "living-room",
        title: "Rug",
        statement: "A wool rug.",
        requirements: [
          {
            text: "At least 2 m long",
            strength: "must",
            reason: { kind: "wall", id: "nowhere/wall-9" },
          },
        ],
      }),
    );
    expect([onOther.code, noReason.code]).toEqual(["validation", "not_found"]);
  });
});

describe("Locked Decisions", () => {
  it("refuse any change but new Evidence until they are Reopened", async () => {
    await save(other("Keep the floors"));
    await setState("keep-the-floors", "locked");

    const changed = await refusal(
      save({ ...other("Keep the floors"), decision: "keep-the-floors", statement: "Rip them up." }),
    );
    await save({
      ...other("Keep the floors"),
      decision: "keep-the-floors",
      evidence: [{ kind: "session", id: session, stance: "supports" }],
    });

    expect(changed.code).toBe("illegal_transition");
    expect(changed.message).toContain("Reopen");
    const decision = await detail("keep-the-floors");
    expect(decision.statement).toBe("Keep the floors, as the user said.");
    expect(decision.evidence).toHaveLength(1);
  });

  it("are one Design Direction at a time", async () => {
    await save(direction());
    await setState("warm-minimalism", "locked");
    await save(direction("Industrial"));
    const error = await refusal(setState("industrial", "locked"));
    expect(error.code).toBe("illegal_transition");
    expect(error.message).toContain("warm-minimalism");
  });
});

describe("record_fulfilment", () => {
  const office: SaveInput = {
    kind: "room-use",
    room: "spare-room",
    title: "Office",
    statement: "The spare room becomes an office.",
    content: { functions: ["office"] },
  };

  it("sets a Locked Room use's functions on its Room and marks it Fulfilled", async () => {
    await save(office);
    await setState("office", "locked");

    await core.run("record_fulfilment", agent(session), {
      session,
      decision: "office",
      roomFunctions: ["office", "storage"],
    });

    const { room, decisions } = await core.run("get_room", web, { home, room: "spare-room" });
    expect(room.functions).toEqual(["office", "storage"]);
    expect(decisions).toEqual([]);
    const decision = await detail("office");
    expect(decision.state).toBe("locked");
    expect(decision.fulfilledAt).toEqual(expect.any(String));
    expect(decision.fulfilment).toEqual({ roomFunctions: ["office", "storage"] });
  });

  it("leaves a Fulfilled Decision Locked for good: no Reopen or Reject, from the Agent or the web, and no Conflict", async () => {
    await save(office);
    await setState("office", "locked");
    await core.run("record_fulfilment", agent(session), { session, decision: "office" });

    const reopen = await refusal(setState("office", "leaning"));
    const reject = await refusal(
      core.run("set_decision_state", web, { home, decision: "office", to: "rejected" }),
    );
    const conflict = await refusal(
      core.run("flag_conflict", agent(session), {
        session,
        decision: "office",
        description: "The user now wants a guest room.",
      }),
    );

    expect([reopen.code, reject.code, conflict.code]).toEqual([
      "illegal_transition",
      "illegal_transition",
      "validation",
    ]);
    expect(reopen.message).toContain("Office (office) was Fulfilled on");
    const decision = await detail("office");
    expect(decision.state).toBe("locked");
    expect(decision.conflicts).toEqual([]);
  });

  it("refuses a Decision that is not Locked with not_locked", async () => {
    await save(office);
    await setState("office", "leaning");
    const error = await refusal(
      core.run("record_fulfilment", agent(session), { session, decision: "office" }),
    );
    expect(error.code).toBe("not_locked");
    expect((await core.run("get_room", web, { home, room: "spare-room" })).room.functions).toEqual(
      [],
    );
  });
});

describe("Archive, never delete", () => {
  it("keeps Rejected Decisions, which find_decisions still lists", async () => {
    await save(other("Paint it black"));
    await setState("paint-it-black", "rejected");
    const { decisions } = await core.run("find_decisions", agent(session), {
      session,
      state: "rejected",
    });
    expect(decisions.map((decision) => decision.slug)).toEqual(["paint-it-black"]);
  });
});
