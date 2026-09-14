import { z } from "zod";
import { cityLatitude, countryCode } from "../cities.js";
import { CoreError } from "../errors.js";
import { setUpHomeFolder } from "../home-folder.js";
import { defineOperation } from "../registry.js";
import { uniqueSlug } from "../slug.js";
import type { HomeRow, LevelRow, RoomRow, SessionRow } from "../store.js";
import { homeInput, requireHome } from "./scope.js";

export interface Home {
  slug: string;
  name: string;
  country: string;
  city: string;
  latitude: number;
  homeFolderPath?: string;
}

export interface Level {
  slug: string;
  name: string;
  storey: number;
}

export interface Room {
  slug: string;
  name: string;
  /** The slug of the Level the Room is on. */
  level: string;
}

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
  handler(context) {
    const home = requireHome(context);
    const levels = context.store.levels(home.id);
    return {
      home: toHome(home),
      levels: levels.map(toLevel),
      rooms: context.store.rooms(home.id).map((room) => toRoom(room, levels)),
    };
  },
});

export const setUpHomeFolderOperation = defineOperation({
  name: "set_up_home_folder",
  description:
    "Makes a folder the Home's Home Folder: writes .mcp.json, pointing the Agent at this Home's " +
    "MCP endpoint, and .claude/settings.json, enabling the plugin and pre-approving the server. " +
    "Creates the folder if missing. Refuses a folder whose .mcp.json names another Home. Never " +
    "touches .claude/settings.local.json. Stores the path on the Home.",
  input: z.object({
    home: homeInput,
    path: z
      .string()
      .trim()
      .min(1)
      .describe("The folder's absolute path; a leading ~ stands for the user's home directory."),
  }),
  readOnly: false,
  surface: "web",
  handler(context, input) {
    return setUpHomeFolder(context, requireHome(context), input.path);
  },
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
  const { slug, name, country, city, latitude, homeFolderPath } = row;
  return {
    slug,
    name,
    country,
    city,
    latitude,
    ...(homeFolderPath === null ? {} : { homeFolderPath }),
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
