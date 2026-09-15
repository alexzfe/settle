import { CoreError } from "../errors.js";
import { equal } from "../provenance.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { DECISION_KIND_LABELS as KINDS, titled } from "../render.js";
import type { DecisionRow } from "../store.js";
import { type DecisionModel, loadDecisions, requireDecision } from "./decisions.js";
import { activeRequirements, guideOf, measureFirst, outOfDate } from "./purchase-views.js";
import { type ReceiptResult, saveGuidesInput } from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { Writer } from "./writer.js";

// The Purchase operations of slice 6 (docs/specs/skill-set.md#purchase): the Shopping Guides,
// Listings, and the web's Shopping views and exports.

export const saveGuides = defineOperation({
  name: "save_guides",
  description:
    "Saves the Shopping Guides of one Purchase Decision and returns a receipt. quickLines are " +
    "the Quick Guide's own lines, for the shop: what to avoid and what to test there, one short " +
    "line each. fullGuide is the Full Guide, Markdown to read ahead of time, under headings that " +
    "suit the product; every must Requirement explains why. Each replaces what is saved; leave " +
    "one out to keep it. The app assembles the Quick Guide itself, for the phone: a Measure " +
    "first line at the top for every must resting on an Estimated or unrecorded value, then the " +
    "musts, then the prefers, then your lines. So never repeat the Requirements or Measure first " +
    "in quickLines; a changed Requirement shows in the Quick Guide at once. The Full Guide is " +
    "marked out of date when a Requirement changes after it was written: save it again then. A " +
    "Rejected Purchase has no Guides. Needs the open Session's id as `session`.",
  input: saveGuidesInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    if (input.quickLines === undefined && input.fullGuide === undefined) {
      throw new CoreError(
        "validation",
        "Give quickLines, fullGuide, or both: the Guides to save for this Purchase.",
      );
    }
    const receipt = context.write(session.slug, (log) => {
      const model = loadDecisions(context.store, home);
      const writer = new Writer(context.store, home, log, undefined);
      const decision = requirePurchase(model, input.decision, "Guides");
      if (decision.state === "rejected") {
        throw new CoreError(
          "illegal_transition",
          `${titled(decision)} is Rejected, and a Rejected Purchase has no Guides. Revive it ` +
            "(set_decision_state to candidate) only if the user asks.",
        );
      }
      const heads = storeGuides(context, model, writer, decision, input);
      const subject = titled(decision);
      writer.line(subject, heads.join("; ") || "Guides already saved like this, nothing changed");
      writer.line(subject, quickGuideSummary(model, decision));
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

/** A Purchase of the Home by slug; `what` names what belongs to Purchases alone. */
export function requirePurchase(model: DecisionModel, slug: string, what: string): DecisionRow {
  const decision = requireDecision(model, slug);
  if (decision.kind !== "purchase") {
    throw new CoreError(
      "validation",
      `${titled(decision)} is a ${KINDS[decision.kind]}, and ${what} belong to Purchase ` +
        "Decisions only.",
    );
  }
  return decision;
}

/** Stores a Purchase's Guides; returns the receipt's heads, one per part that changed. */
function storeGuides(
  context: OperationContext,
  model: DecisionModel,
  writer: Writer,
  decision: DecisionRow,
  input: { quickLines?: string[] | undefined; fullGuide?: string | undefined },
): string[] {
  const { store } = context;
  const at = context.now();
  const heads: string[] = [];
  let guide = guideOf(model, decision);
  if (!guide) {
    guide = store.insert("guides", {
      homeId: model.home.id,
      decisionId: decision.id,
      slug: `${decision.slug}/guides`,
      quickLines: [],
      fullMarkdown: null,
      writtenAt: null,
      requirementsChangedAt: null,
      lanToken: lanToken(context),
    });
    model.guides.push(guide);
  }
  const { quickLines, fullGuide } = input;
  if (quickLines !== undefined && !equal(guide.quickLines, quickLines)) {
    store.update("guides", guide.id, { quickLines });
    writer.logged({
      recordKind: "decision",
      record: decision,
      field: "quick guide lines",
      old: guide.quickLines,
      new: quickLines,
    });
    guide.quickLines = quickLines;
    heads.push(`Quick Guide lines saved (${quickLines.length})`);
  }
  if (fullGuide !== undefined && (fullGuide !== guide.fullMarkdown || outOfDate(guide))) {
    const rewritten = guide.fullMarkdown !== null;
    store.update("guides", guide.id, {
      fullMarkdown: fullGuide,
      writtenAt: at,
      requirementsChangedAt: null,
    });
    writer.logged({ recordKind: "decision", record: decision, field: "full guide", new: at });
    Object.assign(guide, { fullMarkdown: fullGuide, writtenAt: at, requirementsChangedAt: null });
    heads.push(`Full Guide ${rewritten ? "rewritten" : "written"}, up to date`);
  }
  return heads;
}

/** "its Quick Guide has 1 Measure first line (…), 2 musts, 2 prefers, and 3 lines of yours". */
function quickGuideSummary(model: DecisionModel, decision: DecisionRow): string {
  const requirements = activeRequirements(model, decision);
  const measure = measureFirst(model, decision).map((line) => line.replace(/^Measure first: /, ""));
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const parts = [
    measure.length > 0
      ? `${count(measure.length, "Measure first line")} (${measure.join("; ")})`
      : "no Measure first line",
    count(requirements.filter((each) => each.strength === "must").length, "must"),
    count(requirements.filter((each) => each.strength === "prefer").length, "prefer"),
    `${count(guideOf(model, decision)?.quickLines.length ?? 0, "line")} of yours`,
  ];
  return `its Quick Guide has ${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

// No 0/O or 1/l/I, so a token read off a screen can't be mistyped; 24 of them is about 139 bits.
const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TOKEN_LENGTH = 24;

/** An unguessable token naming a Quick Guide on the LAN listener. */
function lanToken(context: OperationContext): string {
  let token = "";
  for (let i = 0; i < TOKEN_LENGTH; i++) {
    token += TOKEN_ALPHABET[context.random(TOKEN_ALPHABET.length)];
  }
  return token;
}
