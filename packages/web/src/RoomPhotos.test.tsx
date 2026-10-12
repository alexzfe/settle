import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Home, Photo, Room, RoomDetail } from "./api";
import { photoGroups, wallsWithoutPhoto } from "./ItemPhotos";
import { preparePhoto } from "./photoPrep";
import { type ApiHandlers, FakeEventSource, inputsTo, renderRoutes, stubApi } from "./testSupport";

vi.mock("./photoPrep", () => ({ preparePhoto: vi.fn(), prepareDocumentImage: vi.fn() }));

const flat: Home = { slug: "flat", name: "Flat", country: "Spain", city: "Madrid", latitude: 40.4 };
const ground = { slug: "ground", name: "Ground", storey: 0 };

const walls = [
  { position: 1, label: "window wall" },
  { position: 2 },
  { position: 3 },
  { position: 4 },
];

/** A bedroom with four live Walls, the first labelled, and nothing else recorded. */
function bedroom(): RoomDetail {
  return {
    slug: "bedroom",
    name: "Bedroom",
    level: ground,
    functions: [],
    outdoor: false,
    timesOfUse: [],
    windowless: false,
    walls: walls.map((wall) => ({
      slug: `bedroom/wall-${wall.position}`,
      beyond: { kind: "unknown" as const },
      ...wall,
    })),
    windows: [],
    doors: [],
    surfaces: [],
    features: [],
    items: [],
    lights: [],
    gaps: [],
  };
}

const sofaSide: Photo = {
  id: 12,
  version: "v12",
  takenOn: "2026-10-12",
  caption: "by the sofa",
  wall: { position: 2, archived: false },
};
const wholeRoom: Photo = { id: 11, version: "v11", takenOn: "2026-10-12" };
const windowWall: Photo = {
  id: 9,
  version: "v9",
  takenOn: "2026-10-01",
  wall: { position: 1, label: "window wall", archived: false },
};
const oldWall: Photo = {
  id: 5,
  version: "v5",
  takenOn: "2026-03-14",
  wall: { position: 5, archived: true },
};

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 12, 10) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.mocked(preparePhoto).mockReset();
});

function stubRoom(photos: () => Photo[], handlers: ApiHandlers = {}) {
  return stubApi({
    list_homes: () => ({ homes: [flat] }),
    get_home: () => ({
      home: flat,
      levels: [ground],
      rooms: [{ slug: "bedroom", name: "Bedroom", level: "ground" }],
      unplacedItems: 0,
    }),
    get_room: () => ({ room: bedroom(), decisions: [], photos: photos() }),
    ...handlers,
  });
}

describe("photoGroups", () => {
  it("groups by the day taken, newest first, and calls today Today", () => {
    expect(
      photoGroups([sofaSide, wholeRoom, windowWall, oldWall], new Date(2026, 9, 12)).map(
        (group) => `${group.label} · ${group.photos.length}`,
      ),
    ).toEqual(["Today · 2", "1 Oct 2026 · 1", "14 Mar 2026 · 1"]);
  });
});

describe("wallsWithoutPhoto", () => {
  it("names the live Walls no Photo shows, and nothing once every one has one", () => {
    expect(wallsWithoutPhoto(walls, [sofaSide, wholeRoom, oldWall])).toBe(
      "No photo yet: window wall, wall 3, wall 4",
    );
    const all = walls.map((wall, at) => ({
      ...wholeRoom,
      id: at,
      wall: { ...wall, archived: false },
    }));
    expect(wallsWithoutPhoto(walls, all)).toBeUndefined();
  });
});

describe("Room Photos", () => {
  it("shows only the add control and the open tips while the Room has no Photos", async () => {
    stubRoom(() => []);
    renderRoutes("/homes/flat/rooms/bedroom");
    await screen.findByRole("heading", { name: "Bedroom" });
    expect(document.querySelector('img[src*="get_photo"]')).toBeNull();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Choose photo" })).toBeDefined();
    const tips = screen.getByRole("region", { name: "A good room photo" });
    expect(within(tips).getAllByRole("listitem")[0]?.textContent).toBe(
      "Take one photo of each wall, standing against the opposite wall. Use the wide lens (0.5×) if you have one, and hold the phone level.",
    );
    // Which Walls lack a Photo is said only in the add panel, once a photo is picked.
    expect(screen.queryByText(/No photo yet/)).toBeNull();
  });

  it("shows the newest large, the rest grouped by date, and folds the tips", async () => {
    stubRoom(() => [sofaSide, wholeRoom, windowWall]);
    renderRoutes("/homes/flat/rooms/bedroom");
    const main = await screen.findByRole("img", { name: "Bedroom" });
    expect(main.getAttribute("src")).toBe(
      "/api/get_photo?home=flat&room=bedroom&photo=12&size=full&v=v12",
    );
    expect(main.closest("figure")?.querySelector("figcaption")?.textContent).toBe(
      "12 Oct 2026 · wall 2by the sofa",
    );
    const today = screen.getByRole("region", { name: "Photos from Today" });
    expect(within(today).getByText("Today · 2")).toBeDefined();
    expect(
      within(today)
        .getAllByRole("button")
        .map((thumb) => thumb.getAttribute("aria-label")),
    ).toEqual(["Open the photo from 12 Oct 2026 of wall 2", "Open the photo from 12 Oct 2026"]);
    const october = screen.getByRole("region", { name: "Photos from 1 Oct 2026" });
    expect(within(october).getByText("1 Oct 2026 · 1")).toBeDefined();
    expect(october.querySelector("img")?.getAttribute("src")).toBe(
      "/api/get_photo?home=flat&room=bedroom&photo=9&size=thumb&v=v9",
    );
    expect(screen.queryByRole("region", { name: "A good room photo" })).toBeNull();
    expect(screen.getByText("How to take a good room photo").tagName).toBe("SUMMARY");
  });

  it("adds a Photo of a Wall, with the Walls still without one beside the picker", async () => {
    const file = new Blob(["small"], { type: "image/jpeg" });
    const thumb = new Blob(["smaller"], { type: "image/jpeg" });
    vi.mocked(preparePhoto).mockResolvedValue({ file, thumb, takenOn: "2026-10-12" });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() }),
    );
    let sent: FormData | undefined;
    const fetch = stubRoom(() => [sofaSide], {
      add_photo: (form) => {
        sent = form;
        return { photos: [sofaSide] };
      },
    });
    renderRoutes("/homes/flat/rooms/bedroom");
    await screen.findByRole("button", { name: "Choose photo" });
    const picked = new File(["big"], "IMG_0001.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Photo file"), { target: { files: [picked] } });
    const form = await screen.findByRole("form", { name: "Add a photo" });
    const wall = within(form).getByLabelText<HTMLSelectElement>("Wall");
    expect(wall.value).toBe("");
    expect([...wall.options].map((option) => option.textContent)).toEqual([
      "Whole room",
      "window wall",
      "wall 2",
      "wall 3",
      "wall 4",
    ]);
    expect(within(form).getByText("No photo yet: window wall, wall 3, wall 4")).toBeDefined();
    fireEvent.change(wall, { target: { value: "3" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toBeDefined());
    const posted = sent as FormData;
    expect(posted.get("room")).toBe("bedroom");
    expect(posted.get("item")).toBeNull();
    expect(posted.get("wall")).toBe("3");
    await waitFor(() => expect(inputsTo(fetch, "get_room")).toHaveLength(2));
  });

  it("sends no Wall for the whole Room", async () => {
    vi.mocked(preparePhoto).mockResolvedValue({ file: new Blob(["a"]), thumb: new Blob(["b"]) });
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: vi.fn() }),
    );
    let sent: FormData | undefined;
    stubRoom(() => [], {
      add_photo: (form) => {
        sent = form;
        return { photos: [wholeRoom] };
      },
    });
    renderRoutes("/homes/flat/rooms/bedroom");
    await screen.findByRole("button", { name: "Choose photo" });
    fireEvent.change(screen.getByLabelText("Photo file"), {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    const form = await screen.findByRole("form", { name: "Add a photo" });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent).toBeDefined());
    expect((sent as FormData).get("room")).toBe("bedroom");
    expect((sent as FormData).has("wall")).toBe(false);
  });

  it("shows a Photo's Wall in the viewer, changes it, clears it, and deletes the Photo", async () => {
    let photos = [sofaSide, oldWall];
    const fetch = stubRoom(() => photos, {
      edit_photo: () => ({ photos }),
      delete_photo: (input) => {
        photos = photos.filter((photo) => photo.id !== input.photo);
        return { photos };
      },
    });
    renderRoutes("/homes/flat/rooms/bedroom");
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Open the photo from 14 Mar 2026 of wall 5 (archived)",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("wall 5 (archived)")).toBeDefined();
    // An archived Wall stays on offer for its own Photo, so it is kept unless changed.
    fireEvent.click(within(dialog).getByRole("button", { name: "Change the wall" }));
    const picker = within(dialog).getByLabelText<HTMLSelectElement>("Wall");
    expect(picker.value).toBe("5");
    expect([...picker.options].map((option) => option.textContent)).toContain("wall 5 (archived)");
    fireEvent.change(picker, { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(inputsTo(fetch, "edit_photo")).toHaveLength(1));
    expect(inputsTo(fetch, "edit_photo")[0]).toEqual({
      home: "flat",
      room: "bedroom",
      photo: 5,
      wall: 4,
    });
    await waitFor(() =>
      expect(within(dialog).queryByRole("form", { name: "Change the wall" })).toBeNull(),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Change the wall" }));
    fireEvent.change(within(dialog).getByLabelText("Wall"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(inputsTo(fetch, "edit_photo")).toHaveLength(2));
    expect(inputsTo(fetch, "edit_photo")[1]).toMatchObject({ photo: 5, wall: null });

    fireEvent.click(await within(dialog).findByRole("button", { name: "Delete" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete it" }));
    await waitFor(() => expect(inputsTo(fetch, "delete_photo")).toHaveLength(1));
    expect(inputsTo(fetch, "delete_photo")[0]).toEqual({ home: "flat", room: "bedroom", photo: 5 });
  });

  it("says Whole room for a Photo of no Wall", async () => {
    stubRoom(() => [wholeRoom]);
    renderRoutes("/homes/flat/rooms/bedroom");
    fireEvent.click(await screen.findByRole("button", { name: "Open the photo from 12 Oct 2026" }));
    expect(within(screen.getByRole("dialog")).getByText("Whole room")).toBeDefined();
  });
});

describe("Room tiles", () => {
  it("show the main Photo's thumbnail only for a Room that has one", async () => {
    const rooms: Room[] = [
      { slug: "bedroom", name: "Bedroom", level: "ground", photo: { id: 12, version: "v12" } },
      { slug: "hall", name: "Hall", level: "ground" },
    ];
    stubApi({
      list_homes: () => ({ homes: [flat] }),
      get_home: () => ({ home: flat, levels: [ground], rooms, unplacedItems: 0 }),
      list_decisions: () => ({ decisions: [] }),
      get_room: (input) => ({
        room: { ...bedroom(), slug: input.room, walls: [] },
        decisions: [],
        photos: [],
      }),
    });
    renderRoutes("/homes/flat/rooms");
    const bedroomTile = (await screen.findByRole("link", { name: "Bedroom" })).closest("li");
    expect(bedroomTile?.querySelector("img")?.getAttribute("src")).toBe(
      "/api/get_photo?home=flat&room=bedroom&photo=12&size=thumb&v=v12",
    );
    const hallTile = screen.getByRole("link", { name: "Hall" }).closest("li");
    expect(hallTile?.querySelector("img")).toBeNull();
  });
});
