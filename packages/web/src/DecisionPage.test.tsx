import type { PaletteColor } from "@idh/core";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BasisEntry, DecisionDetail, DecisionState, DecisionSummary, Flag, Home } from "./api";
import { materialTexture } from "./DecisionPage";
import { formatDate } from "./format";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const livingRoom = { slug: "living-room", name: "Living room" };
const raised = "2026-09-14T10:00:00Z";

const direction: BasisEntry = {
  slug: "design-direction",
  title: "Warm minimalism",
  kind: "design-direction",
  state: "leaning",
  automatic: true,
};

/** What every fixture Decision shares; each adds its identity, kind, content, and the rest. */
const blank = {
  statement: "",
  createdAt: raised,
  basis: [],
  evidence: [],
  requirements: [],
  listings: [],
  deviations: [],
  flags: [],
  conflicts: [],
  openFlags: [],
  openConflicts: [],
  stateChanges: [],
};

/** A Room Direction resting on the Design Direction, flagged when the Direction was reopened. */
function calm(state: DecisionState = "locked"): DecisionDetail {
  const flag: Flag = {
    slug: "living-room-direction/flag-1",
    decision: { slug: "living-room-direction", title: "Calm and low" },
    cause: "reopened",
    source: { kind: "decision", slug: "design-direction", name: "Warm minimalism" },
    raisedAt: raised,
  };
  return {
    ...blank,
    slug: "living-room-direction",
    title: "Calm and low",
    kind: "room-direction",
    state,
    room: livingRoom,
    statement: "A calm, low living room for evenings.",
    content: {
      direction: "Low seating, warm lamps, and nothing on the walls above eye level.",
      contrast: "low",
    },
    basis: [direction],
    evidence: [
      {
        kind: "note",
        id: "evenings",
        name: "We mostly sit here in the evening.",
        stance: "supports",
      },
      {
        kind: "decision",
        id: "palette",
        name: "Earthy palette",
        stance: "undermines",
        note: "its accent is loud",
      },
    ],
    flags: [flag],
    openFlags: [flag],
  };
}

/** What a state change answers: a receipt, and the Decision's line as it now is. */
function receipt(decision: DecisionDetail): { receipt: string; decision: DecisionSummary } {
  const { slug, kind, title, statement, state, room, createdAt, openFlags, openConflicts } =
    decision;
  return {
    receipt: `${title} is now ${state}.`,
    decision: { slug, kind, title, statement, state, room, createdAt, openFlags, openConflicts },
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubDecision(decision: () => DecisionDetail, handlers: ApiHandlers = {}) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_decision: () => ({ decision: decision() }),
    ...handlers,
  });
}

/** The form of state-change buttons, apart from the actions on each open flag. */
function stateForm(): HTMLElement {
  return screen.getByRole("heading", { name: "Change its state" })
    .nextElementSibling as HTMLElement;
}

/** The labels of the state-change buttons on offer. */
function moves(): (string | null)[] {
  return [...stateForm().querySelectorAll("button")].map((button) => button.textContent);
}

/** The section a heading titles. */
function sectionOf(heading: string): HTMLElement {
  return screen.getByRole("heading", { name: heading }).closest("section") as HTMLElement;
}

/** The text of a section after its header. */
function after(heading: string): string {
  return [...sectionOf(heading).children]
    .slice(1)
    .map((child) => child.textContent)
    .join("");
}

function listElement(heading: string): HTMLElement {
  return sectionOf(heading).querySelector("ul") as HTMLElement;
}

/** The page's header: kind and scope, then the state with any Fulfilment and flag. */
function header(): { scope: string | null | undefined; state: string | null | undefined } {
  const [scope, marks] = document.querySelectorAll("article header p");
  return { scope: scope?.textContent, state: marks?.firstElementChild?.textContent };
}

/** The text of each item of the list after `heading`, leaving out any actions form in it. */
function listAfter(heading: string): string[] {
  return [...listElement(heading).querySelectorAll(":scope > li")].map((li) =>
    [...li.childNodes]
      .filter((node) => node.nodeName !== "FORM")
      .map((node) => node.textContent)
      .join(""),
  );
}

it("shows the Decision with its content, Basis, Evidence, and flags", async () => {
  const fetch = stubDecision(() => calm());
  renderRoutes("/homes/flat/decisions/living-room-direction");
  await screen.findByRole("heading", { name: "Calm and low", level: 1 });
  expect(inputsTo(fetch, "get_decision")).toEqual([
    { home: "flat", decision: "living-room-direction" },
  ]);
  expect(header()).toEqual({ scope: "Room Direction · Living room", state: "●Locked" });
  expect(screen.getByRole("link", { name: "Needs review" }).getAttribute("href")).toBe("#flags");
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
  // The statement is the Agent's, and says so.
  const statement = screen.getByText("A calm, low living room for evenings.");
  expect(statement.parentElement?.previousElementSibling?.textContent).toBe(
    "Written by the Agent · Design Direction Session · 14 Sep",
  );
  expect(after("Direction")).toBe(
    "Low seating, warm lamps, and nothing on the walls above eye level." + "ContrastLow",
  );
  expect(listAfter("Basis")).toEqual(["◐Warm minimalismDesign Direction, Leaning, in every Basis"]);
  expect(
    within(listElement("Basis"))
      .getByRole("link", { name: "Warm minimalism" })
      .getAttribute("href"),
  ).toBe("/homes/flat/decisions/design-direction");
  expect(listAfter("Evidence")).toEqual([
    "Supports · Note We mostly sit here in the evening.",
    "Undermines · Decision Earthy palette its accent is loud",
  ]);
  // The user's words are quoted.
  expect(screen.getByText("its accent is loud").tagName).toBe("Q");
  expect(screen.getByRole("link", { name: "Earthy palette" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/palette",
  );
  expect(listAfter("Flags")).toEqual([
    `⚑ Warm minimalism was reopened, raised ${formatDate(raised)}: open`,
  ]);
  // The open flag's source links to it, and it offers the actions that clear it.
  const flags = listElement("Flags");
  expect(within(flags).getByRole("link", { name: "Warm minimalism" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/design-direction",
  );
  expect([...flags.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
    "Keep",
    "Reopen",
    "Reject",
  ]);
  expect(after("Conflicts")).toBe("None.");
  // A way back to the Agent, naming the Skill and the Decision.
  expect(
    screen.getByRole("button", { name: "Talk this Decision through" }).getAttribute("title"),
  ).toBe(
    `claude "Using the Design Direction Skill: let's talk through the Decision \\"Calm and low\\" (slug: living-room-direction)"`,
  );
});

it("says what each state change does beside its button", async () => {
  stubDecision(() => calm("locked"));
  renderRoutes("/homes/flat/decisions/living-room-direction");
  await screen.findByRole("heading", { name: "Change its state" });
  const reopen = within(stateForm()).getByRole("button", { name: "Reopen" });
  const described = document.getElementById(reopen.getAttribute("aria-describedby") ?? "");
  expect(described?.textContent).toBe(
    "Back to Leaning. Every Decision resting on it is flagged for review.",
  );
});

it.each<[DecisionState, string[]]>([
  ["candidate", ["Move to Leaning", "Lock", "Reject"]],
  ["leaning", ["Move to Candidate", "Lock", "Reject"]],
  ["locked", ["Reopen", "Reject"]],
  ["rejected", ["Revive"]],
])("offers only the legal state changes from %s", async (state, labels) => {
  stubDecision(() => calm(state));
  renderRoutes("/homes/flat/decisions/living-room-direction");
  await screen.findByRole("heading", { name: "Change its state" });
  expect(moves()).toEqual(labels);
});

it("posts the state change with the reason, then shows the new state and its moves", async () => {
  let decision = calm("locked");
  const fetch = stubDecision(() => decision, {
    set_decision_state: (input) => {
      decision = { ...decision, state: input.to };
      return receipt(decision);
    },
  });
  renderRoutes("/homes/flat/decisions/living-room-direction");
  await screen.findByRole("heading", { name: "Change its state" });

  fireEvent.change(within(stateForm()).getByLabelText("Reason (optional)"), {
    target: { value: "  we want it brighter  " },
  });
  fireEvent.click(within(stateForm()).getByRole("button", { name: "Reopen" }));
  await waitFor(() => expect(moves()).toEqual(["Move to Candidate", "Lock", "Reject"]));
  expect(header().state).toBe("◐Leaning");

  // Without a reason, none is sent.
  fireEvent.click(within(stateForm()).getByRole("button", { name: "Lock" }));
  await waitFor(() => expect(moves()).toEqual(["Reopen", "Reject"]));
  expect(inputsTo(fetch, "set_decision_state")).toEqual([
    {
      home: "flat",
      decision: "living-room-direction",
      to: "leaning",
      reason: "we want it brighter",
    },
    { home: "flat", decision: "living-room-direction", to: "locked" },
  ]);
});

it("shows a refusal inline and leaves the state as it was", async () => {
  const message = "Calm and low is Rejected. Revive it to Candidate before locking it.";
  stubDecision(() => calm("leaning"), {
    set_decision_state: () =>
      Response.json({ error: { code: "illegal_transition", message } }, { status: 409 }),
  });
  renderRoutes("/homes/flat/decisions/living-room-direction");
  await screen.findByRole("heading", { name: "Change its state" });

  fireEvent.click(screen.getByRole("button", { name: "Lock" }));

  expect((await screen.findByRole("alert")).textContent).toBe(message);
  expect(header().state).toBe("◐Leaning");
  expect(moves()).toEqual(["Move to Candidate", "Lock", "Reject"]);
});

it("renders each kind's content", async () => {
  const shown: Record<string, DecisionDetail> = {
    "design-direction": {
      ...blank,
      slug: "design-direction",
      title: "Warm minimalism",
      state: "locked",
      kind: "design-direction",
      content: {
        mood: "calm",
        temperature: "warm",
        contrast: "medium",
        keyMaterials: ["oak", "linen"],
        styleReferences: ["Japandi"],
        principles: ["Fewer, better things.", "Nothing purely decorative."],
      },
    },
    palette: {
      ...blank,
      slug: "palette",
      title: "Earthy palette",
      state: "locked",
      kind: "palette",
      content: {
        colors: [
          { name: "Setting Plaster", hex: "#e3c9b6", provenance: "estimated", role: "base" },
          { name: "Olive", provenance: "estimated", role: "accent", note: "cushions" },
        ],
      },
    },
    sofa: {
      ...blank,
      slug: "sofa",
      title: "A low sofa",
      state: "leaning",
      kind: "purchase",
      content: {},
      requirements: [
        {
          position: 1,
          text: "under 85 cm tall",
          strength: "must",
          reason: { kind: "decision", id: "living-room-direction", name: "Calm and low" },
        },
        {
          position: 2,
          text: "fits through the door",
          strength: "must",
          reason: { kind: "door", id: "front-door", name: "Front door", field: "clearWidth" },
        },
        {
          position: 3,
          text: "linen or wool cover",
          strength: "prefer",
          reason: { kind: "note", id: "cat", name: "The cat scratches fabric." },
        },
      ],
    },
    "living-room-walls": {
      ...blank,
      slug: "living-room-walls",
      title: "Plaster on the window wall",
      state: "candidate",
      kind: "room-color",
      room: livingRoom,
      content: { surface: "walls", wall: 2, color: "Setting Plaster", finish: "matt" },
    },
  };
  stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_decision: (input) => ({ decision: shown[input.decision] as DecisionDetail }),
  });
  async function show(slug: string, heading: string) {
    renderRoutes(`/homes/flat/decisions/${slug}`);
    await screen.findByRole("heading", { name: heading });
  }

  await show("design-direction", "Direction");
  // A moodboard: the mood as a pull quote, then a tile for each part.
  expect(screen.getByText("calm").closest("figure")?.textContent).toBe("calmMood");
  const tiles = [...sectionOf("Direction").querySelectorAll("h3")].map((title) => [
    title.textContent,
    [...(title.nextElementSibling?.querySelectorAll("li") ?? [])].map((li) => li.textContent),
  ]);
  expect(tiles).toEqual([
    ["Key materials", ["oak", "linen"]],
    ["Color temperature", []],
    ["Contrast", []],
    ["Guiding principles", ["Fewer, better things.", "Nothing purely decorative."]],
    ["Style references", ["Japandi"]],
  ]);
  expect(screen.getByRole("img", { name: "Warm, on a scale from warm to cool" })).toBeDefined();
  expect(screen.getByRole("img", { name: "Medium contrast" })).toBeDefined();
  expect(screen.getByText("Fewer, better things.").parentElement?.tagName).toBe("OL");
  expect(screen.getByRole("link", { name: "Japandi" }).getAttribute("target")).toBe("_blank");
  cleanup();

  await show("palette", "Colors");
  expect(
    [...screen.getByRole("list", { name: "Where each color goes" }).children].map(
      (li) => li.textContent,
    ),
  ).toEqual(["Setting PlasterBase", "OliveAccent · cushions"]);
  cleanup();

  await show("sofa", "Requirements");
  // Under a heading per strength, so no row repeats it.
  expect(
    [...sectionOf("Requirements").querySelectorAll("h3, li")].map((each) => each.textContent),
  ).toEqual([
    "Must",
    "under 85 cm tallCalm and low",
    "fits through the doorFront door, clear width",
    "Prefer",
    "linen or wool coverThe cat scratches fabric.",
  ]);
  cleanup();

  await show("living-room-walls", "Color");
  expect(after("Color")).toBe(
    "Setting Plaster (no Palette in its Basis)" + "SurfaceWalls" + "WallWall 2" + "Finishmatt",
  );
});

it("shows a cleared flag when a flag change event arrives", async () => {
  let decision = calm();
  stubDecision(() => decision);
  renderRoutes("/homes/flat/decisions/living-room-direction");
  await screen.findByText(/: open$/);

  const cleared = "2026-09-14T12:00:00Z";
  decision = {
    ...decision,
    flags: decision.flags.map((flag) => ({ ...flag, clearedAt: cleared, resolution: "keep" })),
    openFlags: [],
  };
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "flag",
      recordSlug: "living-room-direction/flag-1",
    }),
  );

  await waitFor(() =>
    expect(listAfter("Flags")).toEqual([
      `Warm minimalism was reopened, raised ${formatDate(raised)}: ` +
        `cleared ${formatDate(cleared)}, kept`,
    ]),
  );
  // A cleared flag offers no actions.
  expect(listElement("Flags").querySelectorAll("button")).toHaveLength(0);
});

/** The Palette's base color, identified exactly. */
const settingPlaster: PaletteColor = {
  name: "Setting Plaster",
  brand: "Farrow & Ball",
  code: "231",
  lrv: 62,
  hex: "#e3c9b6",
  provenance: "measured",
  role: "base",
  note: "walls throughout",
};

/** A Locked Palette resting on the Design Direction: one color identified exactly, one by eye. */
const earthy: DecisionDetail = {
  ...blank,
  slug: "earthy-palette",
  title: "Earthy palette",
  kind: "palette",
  state: "locked",
  statement: "Warm plaster with olive accents.",
  basis: [direction],
  content: {
    colors: [
      settingPlaster,
      { name: "Olive", provenance: "estimated", role: "accent", note: "cushions" },
    ],
  },
};

/**
 * A Room color for the living room's Wall 1 with the Palette in force in its Basis, and, as
 * get_decision gives it, its color as that Palette has it when it has one of that name.
 */
function windowWall(color = settingPlaster.name): DecisionDetail {
  return {
    ...blank,
    slug: "window-wall-color",
    title: "Plaster on the window wall",
    kind: "room-color",
    state: "leaning",
    room: livingRoom,
    basis: [
      direction,
      {
        slug: "earthy-palette",
        title: "Earthy palette",
        kind: "palette",
        state: "locked",
        automatic: true,
      },
    ],
    content: { surface: "walls", wall: 1, color, finish: "eggshell" },
    ...(color === settingPlaster.name ? { paletteColor: settingPlaster } : {}),
  };
}

it("lists a Palette's colors with swatches, roles, and notes, and a placeholder without a hex", async () => {
  stubDecision(() => earthy);
  renderRoutes("/homes/flat/decisions/earthy-palette");
  await screen.findByRole("heading", { name: "Colors" });
  // Large chips, then where each color goes with its LRV.
  // (Provenance is left out of the text: the Values track decides how it reads.)
  const chips = [...sectionOf("Colors").querySelectorAll("figure li")];
  expect(chips.map((chip) => chip.textContent)).toEqual([
    expect.stringMatching(/^Setting PlasterFarrow & Ball 231baseLRV 62/),
    expect.stringMatching(/^No screen color recordedOliveaccent/),
  ]);
  const list = screen.getByRole("list", { name: "Where each color goes" });
  expect([...list.children].map((li) => li.textContent)).toEqual([
    "Setting PlasterBase · walls throughoutLRV 62 · light",
    "OliveAccent · cushions",
  ]);
  expect(within(list).getByRole("img", { name: "LRV 62 of 100: light" })).toBeDefined();
  const [plaster, olive] = [...list.querySelectorAll("li")];
  const swatch = within(plaster as HTMLElement).getByTitle("Approximately #e3c9b6");
  expect(swatch.style.backgroundColor).toBe("rgb(227, 201, 182)");
  const placeholder = within(olive as HTMLElement).getByTitle("No screen color recorded");
  expect(placeholder.style.backgroundColor).toBe("");
});

it("shows a Room color's Surface, Wall, and finish, with its color from the Palette in its Basis", async () => {
  const fetch = stubDecision(() => windowWall());
  renderRoutes("/homes/flat/decisions/window-wall-color");
  await screen.findByText(/Farrow & Ball 231/);
  // The color as a large chip, with its LRV on a bar.
  expect(sectionOf("Color").querySelector("figure li")?.textContent).toMatch(
    /^Setting PlasterFarrow & Ball 231baseLRV 62/,
  );
  expect(screen.getByRole("img", { name: "LRV 62 of 100: light" })).toBeDefined();
  expect(sectionOf("Color").querySelector("dl")?.textContent).toBe(
    "SurfaceWalls" + "WallWall 1" + "Finisheggshell",
  );
  expect(screen.getByTitle("Approximately #e3c9b6")).toBeDefined();
  // The color comes with the Room color, so the Palette is not fetched for it.
  expect(inputsTo(fetch, "get_decision")).toEqual([
    { home: "flat", decision: "window-wall-color" },
  ]);
  // The Palette is marked automatic, as the Design Direction is.
  expect(listAfter("Basis")).toEqual([
    "◐Warm minimalismDesign Direction, Leaning, in every Basis",
    "●Earthy palettePalette, Locked, in every Basis using its colors",
  ]);
  expect(screen.getByRole("link", { name: "Earthy palette" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/earthy-palette",
  );
});

it("keeps the placeholder for a Room color the Palette in its Basis does not have", async () => {
  stubDecision(() => windowWall("Inchyra Blue"));
  renderRoutes("/homes/flat/decisions/window-wall-color");
  await screen.findByText(/not a color of/);
  expect(after("Color")).toBe(
    "Inchyra Blue (not a color of Earthy palette)" +
      "SurfaceWalls" +
      "WallWall 1" +
      "Finisheggshell",
  );
  expect(screen.getByTitle("No screen color recorded")).toBeDefined();
});

it("shows the color and finish a Fulfilled Room color left on its Surface", async () => {
  stubDecision(() => ({
    ...windowWall(),
    state: "locked",
    fulfilledAt: "2026-09-14T15:00:00Z",
    fulfilment: {
      surface: "living-room/wall-1/surface",
      color: {
        name: "Setting Plaster",
        brand: "Farrow & Ball",
        code: "231",
        hex: "#e3c9b6",
        provenance: "measured",
      },
      finish: "satin",
    },
  }));
  renderRoutes("/homes/flat/decisions/window-wall-color");
  const painted = await screen.findByText(/^Fulfilled as:/);
  expect(painted.textContent).toMatch(
    /^Fulfilled as: Setting Plaster \(Farrow & Ball 231\).*, satin$/,
  );
  expect(within(painted).getByTitle("Approximately #e3c9b6")).toBeDefined();
});

it("picks a small texture for each key material by its words", () => {
  expect(
    [
      "White oak",
      "Stonewashed linen",
      "Terracotta tiles",
      "Aged brass",
      "Travertine",
      "Rattan",
      "Glass",
    ].map(materialTexture),
  ).toEqual(["oak", "linen", "terracotta", "brass", "stone", "oak", "neutral"]);
});
