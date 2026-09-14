import { z } from "zod";
import { CoreError } from "../errors.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { type OpeningBlock, type OverviewView, renderOpening } from "../render.js";
import type { HomeRow, SessionRow } from "../store.js";
import { loadHome, overviewView } from "./model.js";
import { requireHome, requireSession, sessionInput } from "./scope.js";

export const SKILLS = ["home-intake", "design-direction", "color", "purchase"] as const;
export type Skill = (typeof SKILLS)[number];

/** What each Skill's opening holds. Slice 4 adds the Decisions block to every Skill but Home Intake. */
const OPENING_BLOCKS: Record<Skill, readonly OpeningBlock[]> = {
  "home-intake": ["overview"],
  "design-direction": ["overview"],
  color: ["overview"],
  purchase: ["overview"],
};

// No 0/o or 1/l/i, so a Session id read back by the AI can't be mistyped.
const SUFFIX_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SUFFIX_LENGTH = 4;

export interface OpenSessionResult {
  session: string;
  /** The Home's name. */
  home: string;
  /** The opening blocks the Session had not been sent yet, rendered; empty when none. */
  opening: string;
}

export const openSession = defineOperation({
  name: "open_session",
  description:
    "Opens a Session for this Home and returns its opening: the Home's name and its Home " +
    "Overview (the Home's facts and Levels, the Constraints every Skill must obey, how many " +
    "Items are Unplaced, and one line per Room with its slug, Level, size, light, use, Item " +
    "count, and Gaps: the facts advice still needs). Call it first, when a Skill starts, before any other tool of this server, and pass " +
    "the returned Session id as `session` on every later call in the conversation. A Session is " +
    "one interview with the user; the app keeps its record (Skills used and a summary), not the " +
    "transcript. When another Skill starts later in the same conversation, call it again with " +
    "`session` and that `skill`: it joins the open Session and returns only what the Session has " +
    "not been sent yet. If the Home Overview is no longer in view, for example after context " +
    "compaction, call it with `session` and `resend: true` to get the whole opening again. After " +
    "close_session, call it without `session` to start a new Session. It records the Session " +
    "and never changes the Home.",
  input: z.object({
    skill: z.enum(SKILLS).describe("The Skill that is starting."),
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
  readOnly: true,
  surface: "agent",
  handler(context, input): OpenSessionResult {
    const home = requireHome(context);
    if (context.caller.kind === "session" && context.caller.session !== undefined) {
      return joinSession(context, home, input.skill, input.resend === true);
    }
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
        opening: renderOpening(overview(context, home), blocks),
      };
    });
  },
  text: ({ session, opening }) =>
    [
      `Session: ${session}`,
      `Pass session "${session}" on every write in this conversation.`,
      "",
      opening ||
        "This Session already has the opening. If the Home Overview is no longer in view, call " +
          "open_session again with resend: true.",
    ].join("\n"),
});

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
    opening: renderOpening(overview(context, home), blocks),
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

export function overview(context: OperationContext, home: HomeRow): OverviewView {
  return overviewView(loadHome(context.store, home));
}
