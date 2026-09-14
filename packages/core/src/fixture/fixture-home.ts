import { type CallContext, type Core, type CoreOptions, createCore } from "../core.js";
import { openStore } from "../store.js";

/**
 * The fixture Home: fictional, built from code on every run, and the data behind every renderer
 * snapshot. Its name and city match the Home the live smoke suite creates, so both are
 * fixture-home. It grows with each slice; in slice 1 it has two Levels and four Rooms.
 */
export const FIXTURE_ROOMS = [
  { name: "Living room", level: "ground" },
  { name: "Kitchen", level: "ground" },
  { name: "Hallway", level: "ground" },
  { name: "Main bedroom", level: "first" },
] as const;

export interface FixtureHome {
  core: Core;
  /** The Home's slug. */
  home: string;
  /** The closed Session that recorded its Rooms. */
  session: string;
}

export async function createFixtureHome(
  options: Omit<CoreOptions, "store"> = {},
): Promise<FixtureHome> {
  const store = openStore(options.database ?? ":memory:");
  const core = createCore({ ...options, store });
  const web: CallContext = { caller: { kind: "web" } };

  const { home } = await core.run("create_home", web, {
    name: "Fixture Home",
    country: "GB",
    city: "London",
  });
  // No operation adds a Level until save_home in slice 2, so the fixture writes it directly.
  const row = store.home(home.slug);
  if (!row) throw new Error("The fixture Home was not created");
  store.insertLevel({ homeId: row.id, slug: "first", name: "First", storey: 1 });

  const agent = (session?: string): CallContext => ({
    caller: { kind: "session", session },
    home: home.slug,
  });
  const { session } = await core.run("open_session", agent(), { skill: "home-intake" });
  for (const room of FIXTURE_ROOMS) {
    await core.run("save_room", agent(session), { session, name: room.name, level: room.level });
  }
  await core.run("close_session", agent(session), {
    session,
    summary: {
      changed:
        "Recorded four Rooms: the living room, kitchen, and hallway on Ground, and the " +
        "main bedroom on First.",
      open: "The Rooms' measurements, Windows, and Items.",
      next: "Home Intake again, to measure each Room.",
    },
  });
  return { core, home: home.slug, session };
}
