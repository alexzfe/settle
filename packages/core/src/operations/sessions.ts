import { z } from "zod";
import { CoreError } from "../errors.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { type OpeningBlock, renderOpening } from "../render.js";
import type { HomeRow, SessionRow } from "../store.js";
import { openingView } from "./decisions.js";
import { homesOfAgent } from "./homes.js";
import { homeInput, requireHome, requireSession, sessionInput } from "./scope.js";

export const SKILLS = ["home-intake", "design-direction", "color", "purchase"] as const;
export type Skill = (typeof SKILLS)[number];

/**
 * What each Skill's opening holds. Home Intake makes no design Decisions, so it gets no
 * Home-wide Decisions block; open flags and Conflicts go to every Skill.
 */
const OPENING_BLOCKS: Record<Skill, readonly OpeningBlock[]> = {
  "home-intake": ["overview", "flags"],
  "design-direction": ["overview", "decisions", "flags"],
  color: ["overview", "decisions", "flags"],
  purchase: ["overview", "decisions", "flags"],
};

// No 0/o or 1/l/i, so a Session id read back by the AI can't be mistyped.
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SUFFIX_LENGTH = 4;

export interface OpenSessionResult {
  session: string;
  /** The Home's name. */
  home: string;
  /** The Home's page in the app, where the user uploads what the Agent can't take in the chat. */
  app: string;
  /** The opening blocks the Session had not been sent yet, rendered; empty when none. */
  opening: string;
  /**
   * Through a Connection, where the Agent has no native Skills: the Session protocol and the
   * menu of Skills, sent with a new Session's opening and again on `resend`.
   */
  skills?: { skill: Skill; protocol: string; menu: { name: Skill; trigger: string }[] };
}

export const openSession = defineOperation({
  name: "open_session",
  description:
    "Opens a Session for one Home and returns its opening: the Home's name and its Home " +
    "Overview (the Home's facts and Levels, the Constraints every Skill must obey, how many " +
    "Items are Unplaced, and one line per Room with its slug, Level, size, light, use, Item " +
    "count, and Gaps: the facts advice still needs); for every Skill but home-intake, the " +
    "Home-wide Decisions in force (the Design Direction and Palette in full, marked Settled or " +
    "Leaning, then the other Home-wide Settled Decisions); and the open flags and Conflicts, one " +
    "line each. Without native Settle Skills, it also starts with the rules for working in " +
    "Settle and the menu of Skills to read. Call it first, before any other tool of this server except " +
    "list_homes, and pass the returned Session id as `session` on every later call in the " +
    "conversation: the Session is locked to its Home. Which Home: when the user has one, leave " +
    "out `home` and it opens; when they have several, ask the user which (list_homes gives the " +
    "names), unless they named it, and pass its slug as `home`. A Session is " +
    "one interview with the user; the app keeps its record (Skills used and a summary), not the " +
    "transcript. When another Skill starts later in the same conversation, call it again with " +
    "`session` and that `skill`: it joins the open Session and returns only what the Session has " +
    "not been sent yet. If the Home Overview is no longer in view, for example after context " +
    "compaction, call it with `session` and `resend: true` to get the whole opening again. After " +
    "close_session, call it without `session` to start a new Session. It records the Session " +
    "and never changes the Home.",
  input: z.object({
    skill: z
      .enum(SKILLS)
      .describe(
        "The Skill that is starting: home-intake records the Home's Rooms and belongings; " +
          "design-direction its style; color its Palette and paint; purchase things to buy.",
      ),
    home: homeInput
      .optional()
      .describe(
        "The slug of the Home to open, from list_homes. Leave out when the user has one Home, " +
          "or with `session`.",
      ),
    session: sessionInput
      .optional()
      .describe(
        "Leave out to open a new Session. To join the Session this conversation already has, " +
          "pass its id.",
      ),
    resend: z
      .boolean()
      .optional()
      .describe("With `session`: return the whole opening again, not only what is new."),
  }),
  // It records a Session (or a joining Skill), so it is no read tool, though it never changes
  // the Home.
  readOnly: false,
  surface: "agent",
  handler(context, input): OpenSessionResult {
    if (context.caller.kind === "session" && context.caller.session !== undefined) {
      return joinSession(context, requireHome(context), input.skill, input.resend === true);
    }
    const home = chosenHome(context);
    const { store } = context;
    const slug = newSessionSlug(context, input.skill);
    const blocks = OPENING_BLOCKS[input.skill];
    return context.write(slug, (log) => {
      const session = store.insertSession({
        homeId: home.id,
        slug,
        openedAt: context.now(),
        closedAt: null,
        skills: [input.skill],
        openingSent: [...blocks],
        summary: null,
      });
      log({ home, recordKind: "session", record: session, new: { skills: session.skills } });
      return {
        session: slug,
        home: home.name,
        app: appPage(context, home),
        opening: renderOpening(openingView(store, home), blocks),
        ...skillsFor(context, input.skill),
      };
    });
  },
  text: ({ session, app, opening, skills }) =>
    [
      `Session: ${session}`,
      `Pass session "${session}" on every call in this conversation.`,
      `The Home in the app: ${app}`,
      ...(skills ? ["", renderSkills(session, skills)] : []),
      "",
      opening ||
        "This Session already has the opening. If the Home Overview is no longer in view, call " +
          "open_session again with resend: true.",
    ].join("\n"),
});

function appPage(context: OperationContext, home: HomeRow): string {
  return `${context.origin}/homes/${home.slug}`;
}

/**
 * The Home a new Session opens on: the URL's for a Home Folder, the one named as `home`, or
 * through a Connection the Account's only Home. With several and none named, the refusal lists
 * their names, which the Agent may see before choosing, and tells it to ask.
 */
function chosenHome(context: OperationContext): HomeRow {
  if (context.home !== undefined) return requireHome(context);
  const homes = homesOfAgent(context);
  const [only] = homes;
  if (homes.length === 1 && only) return only;
  if (homes.length === 0) {
    throw new CoreError(
      "not_found",
      `There is no Home to work on yet. Ask the user to create one in the app: ${context.origin}`,
    );
  }
  const names = homes.map((home) => `${home.name} (slug ${home.slug})`).join(", ");
  throw new CoreError(
    "validation",
    `The user has ${homes.length} Homes: ${names}. Unless they already said which, ask them ` +
      "which one to work on, then call open_session with its slug as `home`.",
  );
}

/** The protocol and menu, for the Agent through a Connection, which has no native Skills. */
function skillsFor(context: OperationContext, skill: Skill): Pick<OpenSessionResult, "skills"> {
  if (context.caller.kind !== "session" || context.caller.account === undefined) return {};
  const { protocol, skills } = context.skillTexts();
  return {
    skills: { skill, protocol, menu: skills.map(({ name, trigger }) => ({ name, trigger })) },
  };
}

function renderSkills(
  session: string,
  { skill, protocol, menu }: NonNullable<OpenSessionResult["skills"]>,
): string {
  return [
    "## Session protocol",
    "",
    "These rules hold for every Skill, all conversation long.",
    "",
    protocol,
    "",
    "## Skills",
    "",
    "Each Skill below is how Settle does one kind of work. Before that work starts, call " +
      "read_skill with its name and follow what it returns as the Skill. Never call read_skill " +
      "for a Skill already loaded in this conversation.",
    "",
    ...menu.map(({ name, trigger }) => `- ${name}: ${trigger}`),
    "",
    `Now read the ${skill} Skill: read_skill with name "${skill}" and session "${session}".`,
  ].join("\n");
}

function joinSession(
  context: OperationContext,
  home: HomeRow,
  skill: Skill,
  resend: boolean,
): OpenSessionResult {
  const session = requireSession(context, home, { open: true });
  const skills = session.skills.includes(skill) ? session.skills : [...session.skills, skill];
  const wanted = new Set(skills.flatMap((each) => OPENING_BLOCKS[each as Skill] ?? []));
  const blocks = [...wanted].filter((block) => resend || !session.openingSent.includes(block));
  const updated: SessionRow = {
    ...session,
    skills,
    openingSent: [...new Set([...session.openingSent, ...blocks])],
  };
  if (skills !== session.skills || updated.openingSent.length !== session.openingSent.length) {
    context.write(session.slug, (log) => {
      context.store.updateSession(updated);
      if (skills !== session.skills) {
        log({
          home,
          recordKind: "session",
          record: session,
          field: "skills",
          old: session.skills,
          new: skills,
        });
      }
    });
  }
  return {
    session: session.slug,
    home: home.name,
    app: appPage(context, home),
    opening: renderOpening(openingView(context.store, home), blocks),
    ...(resend ? skillsFor(context, skill) : {}),
  };
}

export const closeSession = defineOperation({
  name: "close_session",
  description:
    "Closes the Session with a three-part summary the user reads in the app: what changed, what " +
    "is still open, and the suggested next Skill. Call it when the user wraps up, not after " +
    "each task. Once closed, the Session refuses every write; if the user wants to carry on, " +
    "call open_session without `session` to start a new Session in the same conversation. The " +
    "summary is for the user only: no later Session reads it.",
  input: z.object({
    session: sessionInput,
    summary: z.object({
      changed: z
        .string()
        .trim()
        .min(1)
        .describe("What changed in the Home's record during the Session, in plain words."),
      open: z
        .string()
        .trim()
        .min(1)
        .describe('What is still open or undecided; "Nothing" when nothing is.'),
      next: z
        .string()
        .trim()
        .min(1)
        .describe('The suggested next Skill and why, e.g. "Home Intake: record the upstairs".'),
    }),
  }),
  readOnly: false,
  surface: "agent",
  handler(context, input) {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    context.write(session.slug, (log) => {
      const closedAt = context.now();
      context.store.updateSession({ ...session, closedAt, summary: input.summary });
      const record = session;
      log({ home, recordKind: "session", record, field: "closed_at", new: closedAt });
      log({ home, recordKind: "session", record, field: "summary", new: input.summary });
    });
    return { ok: true as const };
  },
  text: () =>
    "Session closed. Its summary is saved and shown to the user in the app. For any further " +
    "work, call open_session to start a new Session.",
});

function newSessionSlug(context: OperationContext, skill: Skill): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let suffix = "";
    for (let i = 0; i < SUFFIX_LENGTH; i++) {
      suffix += SUFFIX_ALPHABET[context.random(SUFFIX_ALPHABET.length)];
    }
    const slug = `${skill}-${suffix}`;
    if (!context.store.slugTaken("sessions", slug)) return slug;
  }
  throw new CoreError("validation", "Could not find a free Session id; try again.");
}
