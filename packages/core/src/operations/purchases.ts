import { CoreError } from "../errors.js";
import { optional } from "../optional.js";
import { equal } from "../provenance.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { DECISION_KIND_LABELS as KINDS, listingLine, titled } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { DecisionRow, ListingRow, RequirementRow } from "../store.js";
import { type DecisionModel, loadDecisions, requireDecision } from "./decisions.js";
import {
  activeRequirements,
  guideOf,
  measureFirst,
  outOfDate,
  toListings,
} from "./purchase-views.js";
import {
  type CheckResult,
  type ListingDimensions,
  QUICK_LINE_KINDS,
  type QuickLine,
  type ReceiptResult,
  recordListingInput,
  saveGuidesInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { Writer } from "./writer.js";

// The Purchase operations of slice 6 (docs/specs/skill-set.md#purchase): the Shopping Guides,
// Listings, and the web's Shopping views and exports.

export const saveGuides = defineOperation({
  name: "save_guides",
  description:
    "Saves the Shopping Guides of one Purchase Decision and returns a receipt. The Quick Guide " +
    "is a companion to the Full Guide, glanced at in a shop, in front of one candidate, or with " +
    "a seller: fragments, not sentences, numbers first, the whole of it one phone screen. " +
    "lookingFor is its top line, what the user is hunting for in about 80 characters " +
    '("Semi-sheer · warm cream · made-to-measure · 2–2.5× fullness"). quickLines are your own ' +
    "lines, at most 8 in all, each with a kind: avoid (write these first; a guide with none is " +
    "suspect), test (what to try in the shop), ask (what to ask the seller). A why only when it " +
    "changes a judgment in the shop, in five words or fewer. fullGuide is the Full Guide, " +
    "Markdown to read ahead of time, under headings that suit the product; every must " +
    "Requirement explains why. Each replaces what is saved; leave one out to keep it. The app " +
    "assembles the Quick Guide itself: the looking-for line, a Measure first line for every " +
    "must resting on an Estimated or unrecorded value, the musts, your avoids, the prefers, " +
    "then your tests and asks. So never repeat a Requirement or a Measure first line in " +
    "quickLines; a changed Requirement shows in the Quick Guide at once. The Full Guide is " +
    "marked out of date when a Requirement changes after it was written: save it again then. A " +
    "Rejected Purchase has no Guides. Needs the open Session's id as `session`.",
  input: saveGuidesInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    if (
      input.lookingFor === undefined &&
      input.quickLines === undefined &&
      input.fullGuide === undefined
    ) {
      throw new CoreError(
        "validation",
        "Give lookingFor, quickLines, fullGuide, or any of them: the Guides to save for this " +
          "Purchase.",
      );
    }
    const receipt = context.write(session.slug, (log) => {
      const model = loadDecisions(context.store, home);
      const writer = new Writer(context, home, log, undefined);
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

export const recordListing = defineOperation({
  name: "record_listing",
  description:
    "Records a Listing for one Purchase Decision (a real product the user brings: its name, " +
    "link, price, size, and photo) checked against every Requirement, and returns a receipt " +
    "with its pass, fail, and unknown counts and any must it fails. Judge each Requirement from " +
    "what the listing says: pass, fail, or unknown when it doesn't say or can't be judged from " +
    "it, with a few words on what decided it. A new Listing needs a check for every Requirement " +
    "not Archived. Pass `listing` (its slug) to change one: the fields given replace what is " +
    "recorded, and the checks given replace those of their Requirements; it must then have a " +
    "check for every Requirement, those added since included. Tell the user plainly which musts " +
    "it fails. A Listing never changes the Purchase's state; a Rejected or Fulfilled Purchase " +
    "takes none. Needs the open Session's id as `session`.",
  input: recordListingInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const receipt = context.write(session.slug, (log) => {
      const model = loadDecisions(context.store, home);
      const writer = new Writer(context, home, log, undefined);
      const decision = requirePurchase(model, input.decision, "Listings");
      const subject = titled(decision);
      if (decision.state === "rejected") {
        throw new CoreError(
          "illegal_transition",
          `${subject} is Rejected, so it takes no Listings. Revive it (set_decision_state to ` +
            "candidate) only if the user asks.",
        );
      }
      if (decision.fulfilledAt !== null) {
        throw new CoreError(
          "validation",
          `${subject} was Fulfilled on ${decision.fulfilledAt.slice(0, 10)}: what was bought is ` +
            "recorded, so it takes no more Listings.",
        );
      }
      const requirements = activeRequirements(model, decision);
      if (requirements.length === 0) {
        throw new CoreError(
          "validation",
          `${subject} has no Requirements yet to check a Listing against: save them with ` +
            "save_decision first.",
        );
      }
      const own = model.listings.filter((each) => each.decisionId === decision.id);
      const listing =
        input.listing === undefined ? undefined : own.find((each) => each.slug === input.listing);
      if (input.listing !== undefined && !listing) {
        throw new CoreError(
          "not_found",
          `${subject} has no Listing "${input.listing}"` +
            (own.length > 0
              ? `; its Listings are ${own.map((each) => each.slug).join(", ")}`
              : "") +
            ". Leave out listing to add one.",
        );
      }
      if (!listing && !input.name) {
        throw new CoreError(
          "validation",
          "To add a Listing, give its name and a check for every Requirement. To change a " +
            "recorded one, give its slug as `listing`.",
        );
      }
      const checks = planChecks(model, subject, requirements, listing, input.checks ?? []);
      const row = storeListing(context, model, writer, decision, listing, input);
      const changedChecks = storeChecks(context, model, row, checks);
      if (listing && changedChecks > 0) {
        writer.logged({
          recordKind: "decision",
          record: decision,
          field: `listing ${row.slug} checks`,
          new: checks.map(({ requirement, result, note }) => ({
            requirement: requirement.position,
            result,
            ...optional({ note }),
          })),
        });
      }
      const view = toListings(model, decision).find((each) => each.slug === row.slug);
      const head = !listing
        ? "added"
        : writer.changed
          ? "changed"
          : "already recorded like this, nothing changed";
      writer.line(`Listing for ${subject}`, `${head}: ${view ? listingLine(view) : row.slug}`);
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

interface PlannedCheck {
  requirement: RequirementRow;
  result: CheckResult;
  note: string | undefined;
}

/**
 * The checks given, each naming a Requirement not Archived, once. Refused unless the Listing then
 * has a check for every Requirement, naming those missing.
 */
function planChecks(
  model: DecisionModel,
  subject: string,
  requirements: RequirementRow[],
  listing: ListingRow | undefined,
  inputs: { requirement: number; result: CheckResult; note?: string | undefined }[],
): PlannedCheck[] {
  const planned: PlannedCheck[] = [];
  for (const input of inputs) {
    const requirement = requirements.find((each) => each.position === input.requirement);
    if (!requirement) {
      throw new CoreError(
        "not_found",
        `${subject} has no Requirement ${input.requirement} to check (Archived ones take no ` +
          `checks); its Requirements are ${requirements.map((each) => each.position).join(", ")}.`,
      );
    }
    if (planned.some((each) => each.requirement === requirement)) {
      throw new CoreError(
        "validation",
        `Two checks name Requirement ${requirement.position}: give one for each Requirement.`,
      );
    }
    planned.push({ requirement, result: input.result, note: input.note });
  }
  const checked = new Set([
    ...planned.map((each) => each.requirement.id),
    ...(listing
      ? model.listingChecks
          .filter((each) => each.listingId === listing.id)
          .map((each) => each.requirementId)
      : []),
  ]);
  const missing = requirements.filter((each) => !checked.has(each.id));
  if (missing.length > 0) {
    throw new CoreError(
      "validation",
      "A Listing needs a check for every Requirement. Give one for " +
        missing.map((each) => `${each.position} (${each.strength}: ${each.text})`).join(", ") +
        " too, with result unknown when the listing doesn't say. Nothing was recorded.",
    );
  }
  return planned;
}

/** Adds a Listing, or changes the fields given of one recorded; returns its row. */
function storeListing(
  context: OperationContext,
  model: DecisionModel,
  writer: Writer,
  decision: DecisionRow,
  listing: ListingRow | undefined,
  input: {
    name?: string | undefined;
    url?: string | undefined;
    price?: string | undefined;
    dimensions?: ListingDimensions | undefined;
    photo?: string | undefined;
  },
): ListingRow {
  const { store } = context;
  const values = {
    name: input.name,
    url: input.url,
    price: input.price,
    dimensions: input.dimensions,
    photoPath: input.photo,
  };
  if (!listing) {
    const name = input.name as string;
    const slug = uniqueSlug(name, "listing", (taken) =>
      store.slugTaken("listings", taken, model.home.id),
    );
    const row = store.insert("listings", {
      homeId: model.home.id,
      decisionId: decision.id,
      slug,
      name,
      url: values.url ?? null,
      price: values.price ?? null,
      dimensions: values.dimensions ?? null,
      photoPath: values.photoPath ?? null,
      recordedAt: context.now(),
    });
    model.listings.push(row);
    writer.logged({
      recordKind: "decision",
      record: decision,
      field: `listing ${slug}`,
      new: optional(values),
    });
    return row;
  }
  const current = listing as unknown as Record<string, unknown>;
  const patch = Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => value !== undefined && !equal(value, current[key] ?? null),
    ),
  );
  if (Object.keys(patch).length > 0) {
    store.update("listings", listing.id, patch);
    writer.logged({
      recordKind: "decision",
      record: decision,
      field: `listing ${listing.slug}`,
      old: Object.fromEntries(Object.keys(patch).map((key) => [key, current[key]])),
      new: patch,
    });
    Object.assign(listing, patch);
  }
  return listing;
}

/** Stores the planned checks of a Listing; returns how many changed. */
function storeChecks(
  context: OperationContext,
  model: DecisionModel,
  listing: ListingRow,
  checks: PlannedCheck[],
): number {
  let changed = 0;
  for (const { requirement, result, note } of checks) {
    const row = model.listingChecks.find(
      (each) => each.listingId === listing.id && each.requirementId === requirement.id,
    );
    if (row) {
      if (row.result === result && row.note === (note ?? null)) continue;
      context.store.update("listing_checks", row.id, { result, note: note ?? null });
      Object.assign(row, { result, note: note ?? null });
    } else {
      model.listingChecks.push(
        context.store.insert("listing_checks", {
          homeId: model.home.id,
          listingId: listing.id,
          requirementId: requirement.id,
          result,
          note: note ?? null,
        }),
      );
    }
    changed++;
  }
  return changed;
}

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
  input: {
    lookingFor?: string | undefined;
    quickLines?: QuickLine[] | undefined;
    fullGuide?: string | undefined;
  },
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
      lookingFor: null,
      quickLines: [],
      fullMarkdown: null,
      writtenAt: null,
      requirementsChangedAt: null,
      lanToken: lanToken(context),
    });
    model.guides.push(guide);
  }
  const { lookingFor, quickLines, fullGuide } = input;
  if (lookingFor !== undefined && lookingFor !== guide.lookingFor) {
    store.update("guides", guide.id, { lookingFor });
    writer.logged({
      recordKind: "decision",
      record: decision,
      field: "looking for",
      old: guide.lookingFor,
      new: lookingFor,
    });
    guide.lookingFor = lookingFor;
    heads.push("Looking-for line saved");
  }
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

/**
 * "its Quick Guide has no looking-for line, 1 Measure first line (…), 2 musts, 2 prefers, and 3
 * lines of yours (1 avoid, 2 tests)".
 */
function quickGuideSummary(model: DecisionModel, decision: DecisionRow): string {
  const requirements = activeRequirements(model, decision);
  const guide = guideOf(model, decision);
  const measure = measureFirst(model, decision).map((line) => line.replace(/^Measure first: /, ""));
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const own = guide?.quickLines ?? [];
  const kinds = QUICK_LINE_KINDS.map((kind) => ({
    kind,
    n: own.filter((each) => each.kind === kind).length,
  }))
    .filter(({ n }) => n > 0)
    .map(({ kind, n }) => count(n, kind));
  const parts = [
    guide?.lookingFor ? "a looking-for line" : "no looking-for line",
    measure.length > 0
      ? `${count(measure.length, "Measure first line")} (${measure.join("; ")})`
      : "no Measure first line",
    count(requirements.filter((each) => each.strength === "must").length, "must"),
    count(requirements.filter((each) => each.strength === "prefer").length, "prefer"),
    `${count(own.length, "line")} of yours${kinds.length > 0 ? ` (${kinds.join(", ")})` : ""}`,
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
