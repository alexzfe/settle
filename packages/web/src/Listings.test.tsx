import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DecisionDetail, Home, Level, Listing, Requirement, Room } from "./api";
import { formatDate } from "./format";
import { ago, byBest } from "./Listings";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground: Level = { slug: "ground", name: "Ground", storey: 0 };
const rooms: Room[] = [{ slug: "living-room", name: "Living room", level: "ground" }];
const createdAt = "2026-09-10T10:00:00Z";
const recorded = "2026-09-12T09:00:00Z";
const date = formatDate(recorded);

/** Two musts and a prefer, listed out of strength order so the board has to sort them. */
const requirements: Requirement[] = [
  {
    position: 1,
    text: "Wool, low pile",
    strength: "prefer",
    reason: { kind: "constraint", id: "two-cats", name: "Two cats" },
  },
  {
    position: 2,
    text: "At least 2.0 × 1.4 m",
    strength: "must",
    reason: { kind: "wall", id: "living-room/wall-2", name: "Wall 2", field: "length" },
  },
  {
    position: 3,
    text: "Rolls to fit through the hallway door",
    strength: "must",
    reason: { kind: "door", id: "hallway-door", name: "Door to the Hallway" },
  },
];

/** A Listing passing everything, which each fixture below varies. */
function listing(parts: Partial<Listing> & Pick<Listing, "slug" | "name">): Listing {
  return {
    price: "£450",
    recordedAt: recorded,
    checks: [
      { requirement: 1, text: "Wool, low pile", strength: "prefer", result: "pass" },
      { requirement: 2, text: "At least 2.0 × 1.4 m", strength: "must", result: "pass" },
      {
        requirement: 3,
        text: "Rolls to fit through the hallway door",
        strength: "must",
        result: "pass",
      },
    ],
    counts: { pass: 3, fail: 0, unknown: 0 },
    failedMusts: [],
    ...parts,
  };
}

/** The core track's fixture, in the web's shapes: a passing 4, a 5 that fails a must, a Held 5. */
const hay = listing({
  slug: "hay-plain-rug",
  name: "Hay Plain rug",
  url: "https://example.com/hay-plain",
  photoUrl: "https://example.com/hay-plain.jpg",
  photoVersion: "9f8e7d6c5b4a3210",
  rating: 4,
  ratingNote: "Right size, real wool, but £120 over the others",
});

const jute = listing({
  slug: "jute-loop-rug",
  name: "Jute loop rug",
  price: "£120",
  rating: 5,
  ratingNote: "Exactly the terracotta wanted, and a third of the price",
  checks: [
    { requirement: 1, text: "Wool, low pile", strength: "prefer", result: "fail", note: "jute" },
    {
      requirement: 2,
      text: "At least 2.0 × 1.4 m",
      strength: "must",
      result: "fail",
      note: "80 × 250 cm",
    },
    {
      requirement: 3,
      text: "Rolls to fit through the hallway door",
      strength: "must",
      result: "pass",
    },
  ],
  counts: { pass: 1, fail: 2, unknown: 0 },
  failedMusts: [2],
});

const held = "2026-08-27T09:00:00Z";
const nordic = listing({
  slug: "nordic-story-wool-rug",
  name: "Nordic Story wool rug",
  price: "£310",
  photoUrl: "https://example.com/nordic.jpg",
  rating: 5,
  ratingNote: "The terracotta and the size, £140 under the Hay",
  held: { reason: "out-of-stock", note: "back in March", at: held },
});

/** "Now" for the tests, three weeks and a day after the Nordic was Held. */
const now = new Date("2026-09-17T12:00:00Z");

function rug(listings: Listing[]): DecisionDetail {
  return {
    slug: "wool-rug",
    title: "Wool rug",
    kind: "purchase",
    state: "locked",
    room: { slug: "living-room", name: "Living room" },
    statement: "A large wool rug under the sofa.",
    createdAt,
    content: {},
    basis: [],
    evidence: [],
    requirements,
    listings,
    deviations: [],
    flags: [],
    conflicts: [],
    openFlags: [],
    openConflicts: [],
    stateChanges: [],
  };
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers({ now, shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The board on the rug's page, with the Listings given and any handler overridden. */
function showBoard(listings: Listing[], handlers: ApiHandlers = {}) {
  const fetch = stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }),
    get_decision: () => ({ decision: rug(listings) }),
    ...handlers,
  });
  renderRoutes("/homes/flat/decisions/wool-rug");
  return fetch;
}

function boardSection(): HTMLElement {
  return screen
    .getByRole("heading", { name: "Listings", level: 2 })
    .closest("section") as HTMLElement;
}

/** Each Listing column's head, in the order the board puts them. */
function heads(): HTMLElement[] {
  const table = boardSection().querySelector("table") as HTMLTableElement;
  return [...table.querySelectorAll("thead th")].slice(1) as HTMLElement[];
}

/** Each Listing's name, in board order. */
function names(): (string | null)[] {
  return heads().map((head) => head.querySelector("span")?.textContent ?? null);
}

/** A Listing's Rating, which is the one thing in its head with a star count for a label. */
function starsOf(name: string): HTMLElement | null {
  return within(headOf(name)).queryByRole("img", { name: /of 5 stars$/ });
}

/** A Listing's hold line, which is the one thing in its head titled with the day it was set. */
function heldIn(head: HTMLElement): HTMLElement | null {
  return within(head).queryByTitle(/^Held on /);
}

/** The head of one Listing, found by its name. */
function headOf(name: string): HTMLElement {
  const head = heads().find((each) => each.textContent?.includes(name));
  if (!head) throw new Error(`No column head for ${name}; found ${names().join(", ")}.`);
  return head;
}

// ─── The comparator and the age, on their own ───────────────────────────────────────────────

it("sorts the board best first, and never sinks a Held Listing", () => {
  const of = (parts: Partial<Listing> & Pick<Listing, "slug">) =>
    listing({ name: parts.slug, ...parts });
  const five = of({ slug: "five", rating: 5 });
  const four = of({ slug: "four", rating: 4 });
  const alsoFour = of({ slug: "also-four", rating: 4 });
  const unrated = of({ slug: "unrated" });
  const heldFive = of({ slug: "held-five", rating: 5, held: { reason: "other", at: held } });
  const failerFive = of({ slug: "failer-five", rating: 5, failedMusts: [2] });
  const failerOne = of({ slug: "failer-one", rating: 1, failedMusts: [2] });

  // Rating descending, the unrated after the rated, then the must-failers ordered the same way.
  expect(
    [unrated, failerOne, four, failerFive, five].toSorted(byBest).map((each) => each.slug),
  ).toEqual(["five", "four", "unrated", "failer-five", "failer-one"]);
  // A tie keeps the order it was recorded in: the comparator answers 0 and the sort is stable.
  expect([four, alsoFour].toSorted(byBest).map((each) => each.slug)).toEqual(["four", "also-four"]);
  expect([alsoFour, four].toSorted(byBest).map((each) => each.slug)).toEqual(["also-four", "four"]);
  // Held is "good, not now": it sorts on its Rating like any other, above a lower-rated Listing.
  expect([four, heldFive].toSorted(byBest).map((each) => each.slug)).toEqual(["held-five", "four"]);
  // Only a failed must moves a Listing down, and it moves below every Listing that passes.
  expect([failerFive, unrated].toSorted(byBest).map((each) => each.slug)).toEqual([
    "unrated",
    "failer-five",
  ]);
});

it("says how long ago a hold was set, in the coarsest unit that is honest", () => {
  const at = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  expect(ago(at(0), now)).toBe("today");
  expect(ago(at(1), now)).toBe("yesterday");
  expect(ago(at(5), now)).toBe("5 days ago");
  expect(ago(at(7), now)).toBe("1 week ago");
  expect(ago(at(22), now)).toBe("3 weeks ago");
  expect(ago(at(40), now)).toBe("1 month ago");
  expect(ago(at(200), now)).toBe("7 months ago");
  expect(ago(at(800), now)).toBe("2 years ago");
  expect(ago("not a date", now)).toBe("at an unrecorded time");
});

// ─── The board ──────────────────────────────────────────────────────────────────────────────

it("puts the Listings best first, a Held one keeping its place and the must-failer last", async () => {
  showBoard([jute, hay, nordic]);
  await screen.findByRole("link", { name: "Hay Plain rug" });
  // Recorded order was the Jute first; the board shows the Held 5 star, then the 4, then the
  // must-failer, whatever its Rating.
  expect(names()).toEqual(["Nordic Story wool rug", "Hay Plain rug", "Jute loop rug"]);
});

it("shows the Rating as stars with the Agent's reason, uncapped when it fails a must", async () => {
  showBoard([jute, hay, nordic]);
  await screen.findByRole("link", { name: "Hay Plain rug" });

  // Five stars, `rating` of them filled, with the count said for a reader who cannot see them.
  const passing = starsOf("Hay Plain rug") as HTMLElement;
  expect(passing.getAttribute("aria-label")).toBe("4 of 5 stars");
  expect(passing.querySelectorAll("svg")).toHaveLength(5);
  expect(
    [...passing.querySelectorAll("svg")].map((star) =>
      /starOn/.test(star.getAttribute("class") ?? ""),
    ),
  ).toEqual([true, true, true, true, false]);
  // A must-failer keeps every star it was given: the fail is carried by the verdict line and by
  // the shape of the stars, never by taking stars away.
  const failing = starsOf("Jute loop rug") as HTMLElement;
  expect(failing.getAttribute("aria-label")).toBe("5 of 5 stars");
  expect(failing.className).toMatch(/starsOutlined/);
  expect(passing.className).not.toMatch(/starsOutlined/);
  // The reason line is the Agent's, and is shown as the Agent's.
  const rating = within(headOf("Hay Plain rug")).getByText(
    "Right size, real wool, but £120 over the others",
  );
  expect(rating.parentElement?.previousElementSibling?.textContent).toBe("Written by the Agent");
  // And the bold verdict line is still exactly where it was.
  expect(
    within(headOf("Jute loop rug")).getByText("Fails a must: At least 2.0 × 1.4 m").tagName,
  ).toBe("STRONG");
});

it("shows no stars at all for a Listing the Agent has not rated", async () => {
  showBoard([listing({ slug: "linen", name: "Linen rug" })]);
  await screen.findByText("Linen rug");
  expect(starsOf("Linen rug")).toBeNull();
});

it("says how long ago a Listing was Held, with its reason and note", async () => {
  showBoard([nordic]);
  await screen.findByText("Nordic Story wool rug");
  const line = heldIn(headOf("Nordic Story wool rug")) as HTMLElement;
  expect(line.textContent).toBe("Held 3 weeks ago: out of stock (back in March)");
  expect(line.getAttribute("title")).toBe(`Held on ${formatDate(held)}`);
  // Held is never a flag, a block, or a pause, here or anywhere the user can read it.
  expect(boardSection().textContent).not.toMatch(/flag|block|unavailable|paus/i);
});

// ─── The picture ────────────────────────────────────────────────────────────────────────────

it("shows the stored picture by its version, falls back to the link, and invites a paste", async () => {
  showBoard([hay, nordic, listing({ slug: "linen", name: "Linen rug" })]);
  await screen.findByRole("link", { name: "Hay Plain rug" });

  // The bytes the app holds, addressed by the version of those bytes so a replacement is a new
  // address the browser cannot answer from its cache.
  const stored = within(headOf("Hay Plain rug")).getByAltText("Hay Plain rug");
  expect(stored.getAttribute("src")).toBe(
    "/api/get_listing_photo?home=flat&listing=hay-plain-rug&v=9f8e7d6c5b4a3210",
  );
  // Among the first four on the board, so it loads at once rather than waiting to be scrolled to.
  expect(stored.getAttribute("loading")).toBe("eager");
  // No bytes: the source link hotlinked, which is what the board did before it stored anything,
  // with the text link still behind it.
  expect(
    within(headOf("Nordic Story wool rug"))
      .getByAltText("Nordic Story wool rug")
      .getAttribute("src"),
  ).toBe("https://example.com/nordic.jpg");
  expect(
    within(headOf("Nordic Story wool rug"))
      .getByRole("link", { name: "photo" })
      .getAttribute("href"),
  ).toBe("https://example.com/nordic.jpg");
  // Neither: an empty slot that says what to do with it.
  expect(within(headOf("Linen rug")).queryByAltText("Linen rug")).toBeNull();
  expect(
    within(headOf("Linen rug")).getByRole("button", {
      name: "No picture yet. Paste or choose one.",
    }),
  ).toBeDefined();
});

it("loads the first four pictures at once and the rest when scrolled to", async () => {
  const rugs = [1, 2, 3, 4, 5].map((n) =>
    listing({
      slug: `rug-${n}`,
      name: `Rug ${n}`,
      photoUrl: `https://example.com/rug-${n}.jpg`,
      rating: 6 - n,
    }),
  );
  showBoard(rugs);
  await screen.findByText("Rug 1");
  expect(
    rugs.map((rug) => within(headOf(rug.name)).getByAltText(rug.name).getAttribute("loading")),
  ).toEqual(["eager", "eager", "eager", "eager", "lazy"]);
});

it("fetches the linked picture in one click, only where the app holds no copy", async () => {
  let listings = [hay, nordic, listing({ slug: "linen", name: "Linen rug" })];
  let refuse = true;
  const fetch = showBoard(listings, {
    get_decision: () => ({ decision: rug(listings) }),
    set_listing_photo: () => {
      if (refuse) {
        return Response.json(
          { error: { code: "fetch_failed", message: "That page did not answer." } },
          { status: 400 },
        );
      }
      listings = listings.map((each) =>
        each.slug === nordic.slug ? { ...each, photoVersion: "0123456789abcdef" } : each,
      );
      return { decision: "wool-rug", listing: { ...nordic, photoVersion: "0123456789abcdef" } };
    },
  });
  await screen.findByRole("link", { name: "Hay Plain rug" });

  // A stored copy already, or nothing to fetch: no action.
  const action = { name: "Fetch the picture" };
  expect(within(headOf("Hay Plain rug")).queryByRole("button", action)).toBeNull();
  expect(within(headOf("Linen rug")).queryByRole("button", action)).toBeNull();

  // Refused: core's own words, where it happened.
  fireEvent.click(within(headOf("Nordic Story wool rug")).getByRole("button", action));
  expect((await within(headOf("Nordic Story wool rug")).findByRole("alert")).textContent).toBe(
    "That page did not answer.",
  );

  refuse = false;
  fireEvent.click(within(headOf("Nordic Story wool rug")).getByRole("button", action));
  await waitFor(() =>
    expect(within(headOf("Nordic Story wool rug")).queryByRole("button", action)).toBeNull(),
  );
  expect(
    within(headOf("Nordic Story wool rug"))
      .getByAltText("Nordic Story wool rug")
      .getAttribute("src"),
  ).toBe("/api/get_listing_photo?home=flat&listing=nordic-story-wool-rug&v=0123456789abcdef");

  const forms = fetch.mock.calls
    .filter(([url]) => url === "/api/set_listing_photo")
    .map(([, init]) => init?.body as FormData);
  expect(forms).toHaveLength(2);
  expect([...(forms[1] as FormData).entries()]).toEqual([
    ["home", "flat"],
    ["listing", "nordic-story-wool-rug"],
    ["url", "https://example.com/nordic.jpg"],
  ]);
});

it("does not hotlink a picture whose address is not a safe link", async () => {
  const nasty = listing({ slug: "nasty", name: "Nasty rug", photoUrl: "javascript:alert(1)" });
  showBoard([nasty]);
  await screen.findByText("Nasty rug");
  expect(within(headOf("Nasty rug")).queryByAltText("Nasty rug")).toBeNull();
  expect(within(headOf("Nasty rug")).queryByRole("link", { name: "photo" })).toBeNull();
});

it("sends a chosen file to the paste box, and shows core's refusal when it refuses", async () => {
  let refuse = true;
  const fetch = showBoard([hay], {
    set_listing_photo: () =>
      refuse
        ? Response.json(
            {
              error: {
                code: "unsupported_file",
                message: "That file is not a JPEG, PNG, or WebP.",
              },
            },
            { status: 400 },
          )
        : { decision: "wool-rug", listing: { ...hay, photoVersion: "0123456789abcdef" } },
  });
  await screen.findByRole("link", { name: "Hay Plain rug" });

  // The paste box is on every Listing, not only where a fetch failed.
  fireEvent.click(
    within(headOf("Hay Plain rug")).getByRole("button", { name: "Change the picture" }),
  );
  const chooser = screen.getByLabelText("Picture file");
  const bad = new File(["not an image"], "notes.txt", { type: "text/plain" });
  fireEvent.change(chooser, { target: { files: [bad] } });

  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "That file is not a JPEG, PNG, or WebP.",
  );

  refuse = false;
  const good = new File(["\xff\xd8\xff"], "rug.jpg", { type: "image/jpeg" });
  fireEvent.change(chooser, { target: { files: [good] } });

  await waitFor(() => expect(screen.queryByLabelText("Picture file")).toBeNull());
  const sent = fetch.mock.calls.filter(([url]) => url === "/api/set_listing_photo");
  expect(sent).toHaveLength(2);
  const form = sent[1]?.[1]?.body as FormData;
  expect([...form.keys()]).toEqual(["home", "listing", "file"]);
  expect(form.get("home")).toBe("flat");
  expect(form.get("listing")).toBe("hay-plain-rug");
  expect((form.get("file") as File).name).toBe("rug.jpg");
});

it("sends a pasted image and an image address to the paste box", async () => {
  const fetch = showBoard([hay], {
    set_listing_photo: () => ({ decision: "wool-rug", listing: hay }),
  });
  await screen.findByRole("link", { name: "Hay Plain rug" });
  fireEvent.click(
    within(headOf("Hay Plain rug")).getByRole("button", { name: "Change the picture" }),
  );

  // An image pasted from the clipboard onto the target.
  const target = screen.getByRole("button", { name: /^Paste an image here/ });
  const pasted = new File(["\x89PNG"], "clip.png", { type: "image/png" });
  fireEvent.paste(target, { clipboardData: { files: [pasted] } });
  await waitFor(() => expect(screen.queryByLabelText("Picture file")).toBeNull());

  fireEvent.click(
    within(headOf("Hay Plain rug")).getByRole("button", { name: "Change the picture" }),
  );
  fireEvent.change(screen.getByLabelText(/^Or the address of an image/), {
    target: { value: "https://example.com/better.jpg" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Fetch it" }));
  await waitFor(() => expect(screen.queryByLabelText("Picture file")).toBeNull());

  const forms = fetch.mock.calls
    .filter(([url]) => url === "/api/set_listing_photo")
    .map(([, init]) => init?.body as FormData);
  expect(forms).toHaveLength(2);
  const [pastedForm, urlForm] = forms as [FormData, FormData];
  expect((pastedForm.get("file") as File).name).toBe("clip.png");
  expect(urlForm.get("url")).toBe("https://example.com/better.jpg");
  expect(urlForm.get("file")).toBeNull();
});

// ─── Holding, releasing, and dropping ───────────────────────────────────────────────────────

it("holds a Listing with a reason from the list and a note, and releases it again", async () => {
  let listings = [hay];
  const fetch = showBoard(listings, {
    get_decision: () => ({ decision: rug(listings) }),
    hold_listing: (input) => {
      listings = [input.held ? { ...hay, held: { ...input.held, at: held } } : hay];
      return { decision: "wool-rug", listing: listings[0] as Listing };
    },
  });
  await screen.findByRole("link", { name: "Hay Plain rug" });

  fireEvent.click(within(headOf("Hay Plain rug")).getByRole("button", { name: "Hold" }));
  const why = within(headOf("Hay Plain rug")).getByLabelText(/^Why/);
  // The fixed list, in core's own words, plus "another reason" for what it is missing.
  expect(
    [...why.querySelectorAll("option")].map((each) => [
      each.getAttribute("value"),
      each.textContent,
    ]),
  ).toEqual([
    ["out-of-stock", "Out of stock"],
    ["discontinued", "Discontinued"],
    ["too-expensive-now", "Too expensive now"],
    ["other", "Another reason"],
  ]);
  fireEvent.change(why, { target: { value: "discontinued" } });
  fireEvent.change(within(headOf("Hay Plain rug")).getByLabelText(/^Note \(optional\)/), {
    target: { value: "the shop has stopped replying" },
  });
  fireEvent.click(within(headOf("Hay Plain rug")).getByRole("button", { name: "Hold it" }));

  // The hold shows at once, without waiting for the change event to come round.
  await waitFor(() => expect(heldIn(headOf("Hay Plain rug"))).not.toBeNull());
  expect(inputsTo(fetch, "hold_listing")).toEqual([
    {
      home: "flat",
      listing: "hay-plain-rug",
      held: { reason: "discontinued", note: "the shop has stopped replying" },
    },
  ]);

  fireEvent.click(within(headOf("Hay Plain rug")).getByRole("button", { name: "Release" }));
  await waitFor(() => expect(heldIn(headOf("Hay Plain rug"))).toBeNull());
  expect(inputsTo(fetch, "hold_listing")).toHaveLength(2);
  expect(inputsTo(fetch, "hold_listing")[1]).toEqual({
    home: "flat",
    listing: "hay-plain-rug",
    held: null,
  });
});

it("drops a Listing after one confirm in the page, and asks for no reason", async () => {
  let listings = [hay, jute];
  const fetch = showBoard(listings, {
    get_decision: () => ({ decision: rug(listings) }),
    drop_listing: () => {
      listings = [hay];
      return { decision: "wool-rug", listing: "jute-loop-rug" };
    },
  });
  await screen.findByRole("link", { name: "Hay Plain rug" });

  fireEvent.click(within(headOf("Jute loop rug")).getByRole("button", { name: "Drop" }));
  // It says what will go, once, in the page — no browser dialog and no reason field.
  const confirm = within(headOf("Jute loop rug")).getByText(/^Drops Jute loop rug/);
  expect(confirm.textContent).toBe("Drops Jute loop rug, its checks, and its picture, for good.");
  expect(within(headOf("Jute loop rug")).queryByLabelText(/reason/i)).toBeNull();
  expect(fetch.mock.calls.some(([url]) => url === "/api/drop_listing")).toBe(false);

  // Backing out leaves it alone.
  fireEvent.click(within(headOf("Jute loop rug")).getByRole("button", { name: "Keep it" }));
  expect(within(headOf("Jute loop rug")).queryByText(/^Drops/)).toBeNull();

  fireEvent.click(within(headOf("Jute loop rug")).getByRole("button", { name: "Drop" }));
  fireEvent.click(within(headOf("Jute loop rug")).getByRole("button", { name: "Drop it" }));

  await waitFor(() => expect(names()).toEqual(["Hay Plain rug"]));
  expect(inputsTo(fetch, "drop_listing")).toEqual([{ home: "flat", listing: "jute-loop-rug" }]);
});

// ─── The matrix, the phone, and live updates ────────────────────────────────────────────────

it("keeps the matrix: Requirements down the side, musts first, a failed must marked", async () => {
  showBoard([hay, jute]);
  await screen.findByRole("link", { name: "Hay Plain rug" });
  const table = boardSection().querySelector("table") as HTMLTableElement;
  const rows = [...table.querySelectorAll("tbody tr")].map((row) =>
    [...row.children].map((cell) =>
      [...cell.childNodes].map((node) => node.textContent).join(cell.tagName === "TD" ? " / " : ""),
    ),
  );
  expect(rows).toEqual([
    ["Must At least 2.0 × 1.4 m", "✓ Pass", "✕ Fail / 80 × 250 cm"],
    ["Must Rolls to fit through the hallway door", "✓ Pass", "✓ Pass"],
    ["Prefer Wool, low pile", "✓ Pass", "✕ Fail / jute"],
  ]);
  // Only the failed must is marked hard, not the failed prefer.
  expect([...table.querySelectorAll("tbody strong")].map((each) => each.textContent)).toEqual([
    "Fail",
  ]);
  // No overall score anywhere: the Rating says how good, the checks say whether it qualifies.
  expect(within(table).queryByText(/\d+ pass/)).toBeNull();
});

it("stacks one card per Listing on a phone, with the same head and the same order", async () => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {} })),
  );
  showBoard([jute, hay, nordic]);
  await screen.findByText("Hay Plain rug");
  expect(boardSection().querySelector("table")).toBeNull();
  const cards = [...(boardSection().querySelector("ul")?.children ?? [])] as HTMLElement[];
  expect(cards.map((card) => card.querySelector("span")?.textContent)).toEqual([
    "Nordic Story wool rug",
    "Hay Plain rug",
    "Jute loop rug",
  ]);
  // The head is the head wherever it is shown: picture, Rating, hold, and the board's controls.
  const nordicCard = cards[0] as HTMLElement;
  expect(within(nordicCard).getByAltText("Nordic Story wool rug")).toBeDefined();
  expect(heldIn(nordicCard)?.textContent).toBe("Held 3 weeks ago: out of stock (back in March)");
  expect(within(nordicCard).getByRole("button", { name: "Release" })).toBeDefined();
  expect(within(nordicCard).getByRole("button", { name: "Drop" })).toBeDefined();
  // And each Requirement's result beneath it, musts first.
  expect([...nordicCard.querySelectorAll("ul li")].map((li) => li.textContent)).toEqual([
    "✓ PassMust: At least 2.0 × 1.4 m",
    "✓ PassMust: Rolls to fit through the hallway door",
    "✓ PassPrefer: Wool, low pile",
  ]);
});

it("redraws the board when the Agent records a Listing, with the new picture's version", async () => {
  let listings = [hay];
  showBoard(listings, { get_decision: () => ({ decision: rug(listings) }) });
  await screen.findByRole("link", { name: "Hay Plain rug" });

  listings = [{ ...hay, photoVersion: "ffffffffffffffff" }, jute];
  act(() =>
    FakeEventSource.open().emit("change", {
      home: "flat",
      recordKind: "decision",
      recordSlug: "wool-rug",
    }),
  );

  await waitFor(() => expect(names()).toEqual(["Hay Plain rug", "Jute loop rug"]));
  // A replaced picture arrives at a new address, so the browser cannot serve the old bytes back.
  expect(within(headOf("Hay Plain rug")).getByAltText("Hay Plain rug").getAttribute("src")).toBe(
    "/api/get_listing_photo?home=flat&listing=hay-plain-rug&v=ffffffffffffffff",
  );
});

/** The board's scrolling box, made wider inside than out, as jsdom lays nothing out itself. */
function scrollingBoard(): HTMLElement {
  const box = boardSection().querySelector("table")?.parentElement as HTMLElement;
  let left = 0;
  Object.defineProperties(box, {
    scrollWidth: { configurable: true, value: 2000 },
    clientWidth: { configurable: true, value: 800 },
    scrollLeft: {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = value;
      },
    },
  });
  return box;
}

it("scrolls sideways when its ground is dragged with the mouse", async () => {
  showBoard([hay, jute]);
  await screen.findByRole("link", { name: "Hay Plain rug" });
  const box = scrollingBoard();
  const cell = within(box).getAllByRole("cell")[0] as HTMLElement;
  const mouse = { pointerType: "mouse", pointerId: 1, button: 0, buttons: 1 };

  // Under six pixels it is still a click, and nothing moves.
  fireEvent.pointerDown(cell, { ...mouse, clientX: 500 });
  fireEvent.pointerMove(cell, { ...mouse, clientX: 496 });
  expect(box.scrollLeft).toBe(0);

  // Past it, the board follows the mouse, with a hand to show it has hold of the board.
  fireEvent.pointerMove(cell, { ...mouse, clientX: 380 });
  expect(box.scrollLeft).toBe(120);
  expect(box.className).toMatch(/dragging/);
  fireEvent.pointerUp(cell, { ...mouse, buttons: 0, clientX: 380 });
  expect(box.className).not.toMatch(/dragging/);
  fireEvent.pointerMove(cell, { ...mouse, buttons: 0, clientX: 100 });
  expect(box.scrollLeft).toBe(120);

  // A touch scrolls natively, so the board leaves it alone.
  fireEvent.pointerDown(cell, { ...mouse, pointerType: "touch", clientX: 500 });
  fireEvent.pointerMove(cell, { ...mouse, pointerType: "touch", clientX: 300 });
  expect(box.scrollLeft).toBe(120);
});

it("leaves a press on a control or the picture alone, so a click still clicks", async () => {
  showBoard([hay, jute]);
  await screen.findByRole("link", { name: "Hay Plain rug" });
  const box = scrollingBoard();
  const mouse = { pointerType: "mouse", pointerId: 1, button: 0, buttons: 1 };
  const drop = within(headOf("Jute loop rug")).getByRole("button", { name: "Drop" });
  const picture = within(headOf("Hay Plain rug")).getByAltText("Hay Plain rug");

  for (const pressed of [drop, picture]) {
    fireEvent.pointerDown(pressed, { ...mouse, clientX: 500 });
    fireEvent.pointerMove(pressed, { ...mouse, clientX: 300 });
    fireEvent.pointerUp(pressed, { ...mouse, buttons: 0, clientX: 300 });
    expect(box.scrollLeft).toBe(0);
  }
  fireEvent.click(drop);
  expect(within(headOf("Jute loop rug")).getByText(/^Drops Jute loop rug/)).toBeDefined();
});

it("still says when a price is not recorded, and when it was recorded", async () => {
  showBoard([listing({ slug: "unpriced", name: "Unpriced rug", price: undefined })]);
  await screen.findByText("Unpriced rug");
  expect(within(headOf("Unpriced rug")).getByText("Price not recorded")).toBeDefined();
  expect(within(headOf("Unpriced rug")).getByText(`recorded ${date}`)).toBeDefined();
});
