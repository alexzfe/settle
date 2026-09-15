import type { PaletteColor } from "@idh/core";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BasisEntry, DecisionDetail, DecisionState, DecisionSummary, Flag, Home } from "./api";
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

function after(heading: string): string | null | undefined {
  return screen.getByRole("heading", { name: heading }).nextElementSibling?.textContent;
}

function listElement(heading: string): HTMLElement {
  return screen.getByRole("heading", { name: heading }).nextElementSibling as HTMLElement;
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
  expect(document.querySelector("dl")?.textContent).toBe(
    "KindRoom Direction" + "ScopeLiving room" + "StateLocked",
  );
  expect(screen.getByRole("link", { name: "Living room" }).getAttribute("href")).toBe(
    "/homes/flat/rooms/living-room",
  );
  expect(screen.getByText("A calm, low living room for evenings.")).toBeDefined();
  expect(after("Direction")).toBe(
    "Low seating, warm lamps, and nothing on the walls above eye level.",
  );
  expect(listAfter("Basis")).toEqual([
    "Warm minimalism, Design Direction, Leaning, in every Basis",
  ]);
  expect(
    within(listElement("Basis"))
      .getByRole("link", { name: "Warm minimalism" })
      .getAttribute("href"),
  ).toBe("/homes/flat/decisions/design-direction");
  expect(listAfter("Evidence")).toEqual([
    "Supports: Note We mostly sit here in the evening.",
    "Undermines: Decision Earthy palette (its accent is loud)",
  ]);
  expect(screen.getByRole("link", { name: "Earthy palette" }).getAttribute("href")).toBe(
    "/homes/flat/decisions/palette",
  );
  expect(listAfter("Flags")).toEqual([
    `Warm minimalism was reopened, raised ${formatDate(raised)}: open`,
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
  expect(screen.getByText("State").nextElementSibling?.textContent).toBe("Leaning");

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
  expect(screen.getByText("State").nextElementSibling?.textContent).toBe("Leaning");
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
  expect(after("Direction")).toBe(
    "Moodcalm" +
      "Color temperatureWarm" +
      "ContrastMedium" +
      "Key materialsoak, linen" +
      "Style referencesJapandi" +
      "Guiding principlesFewer, better things.Nothing purely decorative.",
  );
  cleanup();

  await show("palette", "Colors");
  expect(listAfter("Colors")).toEqual([
    "~Setting Plaster Estimated, base",
    "~Olive Estimated, accent, cushions",
  ]);
  cleanup();

  await show("sofa", "Requirements");
  expect(listAfter("Requirements")).toEqual([
    "Must: under 85 cm tall (Calm and low)",
    "Must: fits through the door (Front door, clear width)",
    "Prefer: linen or wool cover (The cat scratches fabric.)",
  ]);
  cleanup();

  await show("living-room-walls", "Color");
  expect(after("Color")).toBe(
    "SurfaceWalls" + "WallWall 2" + "ColorSetting Plaster (no Palette in its Basis)" + "Finishmatt",
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
  expect(listAfter("Colors")).toEqual([
    "Setting Plaster (Farrow & Ball 231), LRV 62 Measured, base, walls throughout",
    "~Olive Estimated, accent, cushions",
  ]);
  const list = screen.getByRole("heading", { name: "Colors" }).nextElementSibling as HTMLElement;
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
  expect(after("Color")).toBe(
    "SurfaceWalls" +
      "WallWall 1" +
      "ColorSetting Plaster (Farrow & Ball 231), LRV 62 Measured, base" +
      "Finisheggshell",
  );
  expect(screen.getByTitle("Approximately #e3c9b6")).toBeDefined();
  // The color comes with the Room color, so the Palette is not fetched for it.
  expect(inputsTo(fetch, "get_decision")).toEqual([
    { home: "flat", decision: "window-wall-color" },
  ]);
  // The Palette is marked automatic, as the Design Direction is.
  expect(listAfter("Basis")).toEqual([
    "Warm minimalism, Design Direction, Leaning, in every Basis",
    "Earthy palette, Palette, Locked, in every Basis using its colors",
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
    "SurfaceWalls" +
      "WallWall 1" +
      "ColorInchyra Blue (not a color of Earthy palette)" +
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
  expect(painted.textContent).toBe(
    "Fulfilled as: Setting Plaster (Farrow & Ball 231) Measured, satin",
  );
  expect(within(painted).getByTitle("Approximately #e3c9b6")).toBeDefined();
});
