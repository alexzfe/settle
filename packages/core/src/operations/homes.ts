import { z } from "zod";
import { cityLatitude, countryCode } from "../cities.js";
import { CoreError } from "../errors.js";
import { homeFolderSetup } from "../home-folder.js";
import { optional } from "../optional.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { named } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { HomeRow, LevelRow, RoomRow, SessionRow } from "../store.js";
import {
  blueprintName,
  findLevel,
  list,
  requireBlueprint,
  requirePage,
  requireSources,
} from "./lookup.js";
import {
  type blueprintPageLevelInput,
  type GetHomeResult,
  type Home,
  type HomeFolderSetupResult,
  type Level,
  type levelInput,
  type ReceiptResult,
  type Room,
  saveHomeInput,
} from "./schemas.js";
import { homeInput, requireHome, requireSession } from "./scope.js";
import { Writer } from "./writer.js";

export type { Home, Level, Room };

export interface Session {
  slug: string;
  skills: string[];
  openedAt: string;
  closedAt?: string;
  summary?: { changed: string; open: string; next: string };
}

export const createHome = defineOperation({
  name: "create_home",
  description:
    "Creates a Home from its name, country, and city, with one Level, Ground (storey 0). The " +
    "latitude comes from the bundled GeoNames city table, rounded to 0.1°; when the city is not " +
    "in it the call is refused with city_not_found, and the form asks for the latitude.",
  input: z.object({
    name: z.string().trim().min(1).describe("The user's name for the Home."),
    country: z
      .string()
      .trim()
      .min(1)
      .describe('The country, as an ISO code ("GB") or its English name ("United Kingdom").'),
    city: z.string().trim().min(1).describe("The city or town; never a street address."),
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe("Degrees north, negative for south. Only needed when the city is not found."),
  }),
  readOnly: false,
  surface: "web",
  handler(context, input) {
    const found = input.latitude ?? cityLatitude(input.country, input.city);
    if (found === undefined) {
      throw new CoreError(
        "city_not_found",
        countryCode(input.country)
          ? `"${input.city}" is not in the city table for ${input.country}. Check the spelling, ` +
              "try the nearest larger town, or enter the latitude."
          : `"${input.country}" is not a country the city table knows. Use its two-letter code ` +
              "(such as GB) or its English name, or enter the latitude.",
      );
    }
    const latitude = Math.round(found * 10) / 10 || 0;
    const { store } = context;
    return context.write("web", (log) => {
      const slug = uniqueSlug(input.name, "home", (taken) => store.slugTaken("homes", taken));
      const home = store.insertHome({
        slug,
        name: input.name,
        country: input.country,
        city: input.city,
        latitude,
      });
      log({ home, recordKind: "home", record: home, new: toHome(home) });
      const ground = store.insertLevel({
        homeId: home.id,
        slug: "ground",
        name: "Ground",
        storey: 0,
      });
      log({ home, recordKind: "level", record: ground, new: toLevel(ground) });
      return { home: toHome(home) };
    });
  },
});

export const listHomes = defineOperation({
  name: "list_homes",
  description: "Every Home in the app, by name.",
  input: z.object({}),
  readOnly: true,
  surface: "web",
  handler: (context) => ({ homes: context.store.homes().map(toHome) }),
});

export const getHome = defineOperation({
  name: "get_home",
  description: "One Home with its Levels, in storey order, and its Rooms.",
  input: z.object({ home: homeInput }),
  readOnly: true,
  surface: "web",
  handler(context): GetHomeResult {
    const home = requireHome(context);
    const levels = context.store.levels(home.id);
    return {
      home: toHome(home),
      levels: levels.map(toLevel),
      rooms: context.store
        .rooms(home.id)
        .filter((room) => room.archivedAt === null)
        .map((room) => toRoom(room, levels)),
      unplacedItems: context.store
        .list("items", home.id)
        .filter((item) => item.archivedAt === null && item.roomId === null).length,
      ...optional({ lanUrl: context.lanUrl }),
    };
  },
});

export const saveHome = defineOperation({
  name: "save_home",
  description:
    "Records this Home's own facts, its Levels, and which Level each Blueprint page shows, and " +
    "returns a receipt with one line per change. The facts: tenure (owned, rented, or other; it never implies a restriction by " +
    "itself, since what the user may change is recorded as Constraints), planned stay, building " +
    "type and era, whether there is a lift and its door width and car depth, and the narrowest " +
    "point on the way into the Home with what it is (for getting furniture in). Levels: add one " +
    "with its name and storey (0 for ground, -1 for a basement, 5 for a fifth-floor flat; a flat " +
    "is a single Level), rename or renumber one by its slug (the slug never changes), or remove " +
    "one no Room is on. Blueprint pages: name each page's Level in blueprintPages (the Home " +
    "Overview lists the Blueprints and their pages), before reading dimensions off it. Give " +
    "only what the user stated; fields left out stay as they are. The " +
    "Home's name, country, and city are set in the app. Lengths are whole millimetres with a " +
    "Provenance: measured, blueprint, or estimated. A value is never replaced by one of weaker " +
    "Provenance (measured > blueprint > estimated) unless the user says so: that part is " +
    "refused, the receipt states both values, and only if the user agrees do you call again " +
    "with overrideProvenance quoting their words. Needs the open Session's id as `session`.",
  input: saveHomeInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    requireSources(context.store, home, input);
    const receipt = context.write(session.slug, (log) => {
      const writer = new Writer(context, home, log, input.overrideProvenance);
      const {
        session: _session,
        levels,
        blueprintPages,
        overrideProvenance: _override,
        ...facts
      } = input;
      const subject = named(home);
      writer.line(subject, undefined, writer.patch("homes", "home", home, subject, facts));
      for (const level of levels ?? []) saveLevel(context, home, writer, level);
      for (const page of blueprintPages ?? []) mapBlueprintPage(context, home, writer, page);
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

function saveLevel(
  context: OperationContext,
  home: HomeRow,
  writer: Writer,
  input: z.output<typeof levelInput>,
): void {
  const { store } = context;
  const levels = store.levels(home.id);
  const level =
    input.level !== undefined
      ? levels.find((each) => each.slug === input.level)
      : input.name !== undefined
        ? findLevel(levels, input.name)
        : undefined;
  if (input.level !== undefined && !level) {
    throw new CoreError(
      "not_found",
      `This Home has no Level "${input.level}". Its Levels are ${list(levels)}.`,
    );
  }
  if (input.remove) {
    if (!level) throw new CoreError("validation", "To remove a Level, give its slug as `level`.");
    const rooms = store.rooms(home.id).filter((room) => room.levelId === level.id);
    if (rooms.length > 0) {
      throw new CoreError(
        "referenced_cannot_delete",
        `${named(level)} can't be removed: ${list(rooms)} ${rooms.length === 1 ? "is" : "are"} on ` +
          "it, Archived Rooms included. Move them to another Level with save_room first.",
      );
    }
    if (levels.length === 1) {
      throw new CoreError(
        "validation",
        `${named(level)} is the Home's only Level, and every Home keeps at least one.`,
      );
    }
    const unmapped = unmapLevel(context, home, writer, level);
    store.deleteLevel(level.id);
    writer.logged({ recordKind: "level", record: level, field: "removed", old: toLevel(level) });
    writer.line(named(level), "removed");
    for (const page of unmapped) writer.line(page, "no longer shows a Level");
    return;
  }
  if (!level) {
    if (input.name === undefined || input.storey === undefined) {
      throw new CoreError(
        "validation",
        "To add a Level, give its name and storey (0 for ground, -1 for a basement).",
      );
    }
    const slug = uniqueSlug(input.name, "level", (taken) =>
      store.slugTaken("levels", taken, home.id),
    );
    const created = writer.create(
      "levels",
      "level",
      { homeId: home.id, slug, name: input.name, storey: input.storey },
      { name: input.name, storey: input.storey },
    );
    writer.line(named(created), `added, storey ${created.storey}`);
    return;
  }
  const subject = named({ name: input.name ?? level.name, slug: level.slug });
  writer.line(
    subject,
    undefined,
    writer.patch("levels", "level", level, subject, { name: input.name, storey: input.storey }),
  );
}

/** Records which Level a Blueprint page shows. */
function mapBlueprintPage(
  context: OperationContext,
  home: HomeRow,
  writer: Writer,
  input: z.output<typeof blueprintPageLevelInput>,
): void {
  const { store } = context;
  const blueprint = requireBlueprint(store.list("blueprints", home.id), input.blueprint);
  const page = requirePage(store.list("blueprint_pages", home.id), blueprint, input.page);
  const levels = store.levels(home.id);
  const level = findLevel(levels, input.level);
  if (!level) {
    throw new CoreError(
      "not_found",
      `This Home has no Level "${input.level}". Its Levels are ${list(levels)}. Name one of ` +
        "those, or add the Level in `levels` in the same call.",
    );
  }
  const subject = `${blueprintName(blueprint)} page ${page.page}`;
  if (page.levelId === level.id) {
    writer.line(subject, `already shows ${level.name}, nothing changed`);
    return;
  }
  const was = levels.find((each) => each.id === page.levelId);
  store.update("blueprint_pages", page.id, { levelId: level.id });
  writer.logged({
    recordKind: "blueprint",
    record: blueprint,
    field: `page ${page.page} level`,
    old: was?.slug,
    new: level.slug,
  });
  writer.line(subject, was ? `shows ${level.name}, was ${was.name}` : `shows ${level.name}`);
}

/** Before a Level is removed: the Blueprint pages showing it show no Level. Returns them. */
function unmapLevel(
  context: OperationContext,
  home: HomeRow,
  writer: Writer,
  level: LevelRow,
): string[] {
  const { store } = context;
  const blueprints = store.list("blueprints", home.id);
  return store
    .list("blueprint_pages", home.id)
    .filter((page) => page.levelId === level.id)
    .map((page) => {
      const blueprint = blueprints.find((each) => each.id === page.blueprintId);
      if (!blueprint) throw new Error(`Blueprint page ${page.id} has no Blueprint`);
      store.update("blueprint_pages", page.id, { levelId: null });
      writer.logged({
        recordKind: "blueprint",
        record: blueprint,
        field: `page ${page.page} level`,
        old: level.slug,
        new: null,
      });
      return `${blueprintName(blueprint)} page ${page.page}`;
    });
}

export const homeFolderSetupOperation = defineOperation({
  name: "home_folder_setup",
  description:
    "How to make a folder this Home's Home Folder on a computer: the command to paste inside " +
    "it, which fetches GET /api/home_folder_script and writes .mcp.json (pointing the Agent at " +
    "this Home's MCP endpoint) and .claude/settings.json (enabling the plugin and pre-approving " +
    "the server); the one-time plugin install line; and the two files, to show. Writes nothing.",
  input: z.object({ home: homeInput }),
  readOnly: true,
  surface: "web",
  handler: (context): HomeFolderSetupResult =>
    homeFolderSetup(context.origin, requireHome(context).slug),
});

export const listSessions = defineOperation({
  name: "list_sessions",
  description: "The Home's Sessions, newest first, with their Skills and summaries.",
  input: z.object({ home: homeInput }),
  readOnly: true,
  surface: "web",
  handler(context) {
    const home = requireHome(context);
    return { sessions: context.store.sessions(home.id).map(toSession) };
  },
});

export function toHome(row: HomeRow): Home {
  const { slug, name, country, city, latitude } = row;
  return {
    slug,
    name,
    country,
    city,
    latitude,
    ...optional({
      tenure: row.tenure,
      plannedStay: row.plannedStay,
      buildingType: row.buildingType,
      buildingEra: row.buildingEra,
      lift: row.lift,
      liftDoorWidth: row.liftDoorWidth,
      liftCarDepth: row.liftCarDepth,
      accessWidth: row.accessWidth,
      accessNote: row.accessNote,
    }),
  };
}

export function toLevel({ slug, name, storey }: LevelRow): Level {
  return { slug, name, storey };
}

export function toRoom(row: RoomRow, levels: LevelRow[]): Room {
  const level = levels.find((candidate) => candidate.id === row.levelId);
  if (!level) throw new Error(`Room ${row.slug} is on a Level its Home does not have`);
  return { slug: row.slug, name: row.name, level: level.slug };
}

export function toSession(row: SessionRow): Session {
  return {
    slug: row.slug,
    skills: row.skills,
    openedAt: row.openedAt,
    ...(row.closedAt === null ? {} : { closedAt: row.closedAt }),
    ...(row.summary === null ? {} : { summary: row.summary }),
  };
}
