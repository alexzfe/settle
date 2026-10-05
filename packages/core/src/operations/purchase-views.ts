import { optional } from "../optional.js";
import { fieldLabel, isMeasurement, length } from "../render.js";
import {
  type DecisionRow,
  type GuideRow,
  type ListingRow,
  MEASUREMENT_KEYS,
  type RequirementRow,
} from "../store.js";
import type { DecisionModel } from "./decisions.js";
import { reasonRecord } from "./reasons.js";
import {
  type CheckResult,
  type Deviation,
  type Guides,
  type Held,
  type Listing,
  type ListingCheck,
  QUICK_GUIDE_LINE_KINDS,
  type QuickGuide,
  type QuickGuideLine,
} from "./schemas.js";

// A Purchase's Quick Guide, Guides, Listings, and Deviations, as results carry them. The Quick
// Guide is assembled here from the Requirements and the AI's own lines, never stored whole, so it
// can't go stale when a Requirement changes. Only its frame is fixed: Measure first at the top when
// a must rests on an Estimated value, and musts before prefers.

/** A Decision's Requirements not Archived, by position. */
export function activeRequirements(model: DecisionModel, decision: DecisionRow): RequirementRow[] {
  return model.requirements
    .filter((each) => each.decisionId === decision.id && each.archivedAt === null)
    .sort((a, b) => a.position - b.position);
}

export function guideOf(model: DecisionModel, decision: DecisionRow): GuideRow | undefined {
  return model.guides.find((each) => each.decisionId === decision.id);
}

/**
 * The "Measure first" lines: one for every value a must Requirement rests on that is Estimated,
 * or not recorded at all when the reason names a length field. A reason naming a field rests on
 * that field only; one naming none rests on every length of its record. Each value once, in the
 * Requirements' order.
 */
export function measureFirst(model: DecisionModel, decision: DecisionRow): string[] {
  const lines: string[] = [];
  for (const requirement of activeRequirements(model, decision)) {
    if (requirement.strength !== "must") continue;
    const record = reasonRecord(model, requirement.reasonKind, requirement.reasonId);
    const row = record?.row as Record<string, unknown> | undefined;
    // An Archived record's values are history: there is nothing left there to measure.
    if (!record || !row || (row.archivedAt !== undefined && row.archivedAt !== null)) continue;
    const fields =
      requirement.reasonField !== null
        ? [requirement.reasonField]
        : Object.keys(row).filter((key) => MEASUREMENT_KEYS.has(key));
    // Read by the user in the shop, so the record goes by its name alone, never its slug.
    const what = requirement.reasonKind === "home" ? "" : `${record.name} `;
    for (const field of fields) {
      const value = row[field];
      const line = isMeasurement(value)
        ? value.provenance === "estimated"
          ? `Measure first: ${what}${fieldLabel(field)} (${length(value)})`
          : undefined
        : value == null && requirement.reasonField !== null && MEASUREMENT_KEYS.has(field)
          ? `Measure first: ${what}${fieldLabel(field)} (not recorded)`
          : undefined;
      if (line && !lines.includes(line)) lines.push(line);
    }
  }
  return lines;
}

/** The phone page's path on the server: "/guide/wool-rug?home=fixture-home". */
export function guidePath(model: DecisionModel, decision: DecisionRow): string {
  return `/guide/${encodeURIComponent(decision.slug)}?home=${encodeURIComponent(model.home.slug)}`;
}

/**
 * The Quick Guide: the looking-for line, then its lines in the order of QUICK_GUIDE_LINE_KINDS
 * (Measure first, must, avoid, prefer, test, ask): the musts and prefers each by position, the AI's
 * own lines each in the order saved. Grouped here, as it is read: Requirement positions are
 * identifiers and never re-sorted.
 */
export function toQuickGuide(model: DecisionModel, decision: DecisionRow): QuickGuide {
  const requirements = activeRequirements(model, decision);
  const guide = guideOf(model, decision);
  const linesOf = (kind: QuickGuideLine["kind"]): QuickGuideLine[] =>
    kind === "measure-first"
      ? measureFirst(model, decision).map((text) => ({ kind, text }))
      : kind === "must" || kind === "prefer"
        ? requirements
            .filter((each) => each.strength === kind)
            .map((each) => ({ kind, text: each.text, requirement: each.position }))
        : (guide?.quickLines ?? [])
            .filter((each) => each.kind === kind)
            .map((each) => ({ kind, text: each.text }));
  return {
    ...optional({ lookingFor: guide?.lookingFor }),
    lines: QUICK_GUIDE_LINE_KINDS.flatMap(linesOf),
    path: guidePath(model, decision),
  };
}

/**
 * Whether a Purchase has Guides: a looking-for line, Quick Guide lines of the AI's, or a Full
 * Guide saved.
 */
export function hasGuides(guide: GuideRow | undefined): boolean {
  return (
    guide !== undefined &&
    (guide.lookingFor !== null || guide.quickLines.length > 0 || guide.fullMarkdown !== null)
  );
}

/** Whether a Purchase's Full Guide is out of date: a Requirement changed after it was written. */
export function outOfDate(guide: GuideRow | undefined): boolean {
  return guide?.writtenAt != null && guide.requirementsChangedAt !== null;
}

/** Where a phone reaches a Quick Guide: the public origin when hosted, else the LAN listener. */
export interface PhoneOrigins {
  publicOrigin?: string;
  lanUrl?: string;
}

/** A Purchase's saved Guides, the Full Guide's Markdown only with `includeFullGuide`. */
export function toGuides(
  guide: GuideRow | undefined,
  { includeFullGuide = false, ...phone }: { includeFullGuide?: boolean } & PhoneOrigins = {},
): Guides | undefined {
  if (!guide) return undefined;
  const written = guide.fullMarkdown !== null && guide.writtenAt !== null;
  // By the guide's unguessable token, which opens its page without a login, hosted or on the LAN.
  const phoneOrigin = phone.publicOrigin ?? phone.lanUrl;
  return {
    quickLines: guide.quickLines,
    ...optional({
      lookingFor: guide.lookingFor,
      fullGuide: written
        ? {
            writtenAt: guide.writtenAt as string,
            ...optional({ requirementsChangedAt: guide.requirementsChangedAt }),
            outOfDate: outOfDate(guide),
            ...optional({ markdown: includeFullGuide ? guide.fullMarkdown : undefined }),
          }
        : undefined,
      phoneUrl: phoneOrigin && `${phoneOrigin}/guide/${guide.lanToken}`,
    }),
  };
}

/** A Purchase's Listings, in the order they were recorded, each checked against its Requirements. */
export function toListings(model: DecisionModel, decision: DecisionRow): Listing[] {
  const requirements = activeRequirements(model, decision);
  return model.listings
    .filter((each) => each.decisionId === decision.id)
    .map((listing) => toListing(model, listing, requirements));
}

/** One Listing, checked against `requirements`: the Purchase's, not Archived, by position. */
export function toListing(
  model: DecisionModel,
  listing: ListingRow,
  requirements: RequirementRow[],
): Listing {
  const checks: ListingCheck[] = requirements.map((requirement) => {
    const check = model.listingChecks.find(
      (each) => each.listingId === listing.id && each.requirementId === requirement.id,
    );
    return {
      requirement: requirement.position,
      text: requirement.text,
      strength: requirement.strength,
      result: check?.result ?? "unknown",
      ...optional({ note: check?.note, unchecked: check ? undefined : true }),
    };
  });
  const count = (result: CheckResult) => checks.filter((each) => each.result === result).length;
  return {
    slug: listing.slug,
    name: listing.name,
    ...optional({
      url: listing.url,
      price: listing.price,
      dimensions: listing.dimensions,
      rating: listing.rating,
      ratingNote: listing.ratingNote,
      photoUrl: listing.photoUrl,
      // Only when the platform holds the bytes: it is what get_listing_photo serves.
      photoVersion: listing.photoPath === null ? null : listing.photoVersion,
      held: held(listing),
    }),
    recordedAt: listing.recordedAt,
    checks,
    counts: { pass: count("pass"), fail: count("fail"), unknown: count("unknown") },
    failedMusts: checks
      .filter((each) => each.strength === "must" && each.result === "fail")
      .map((each) => each.requirement),
  };
}

/** A Listing's hold, when it has one. Its three columns are always set and cleared together. */
function held(listing: ListingRow): Held | undefined {
  if (listing.heldReason === null || listing.heldAt === null) return undefined;
  return {
    reason: listing.heldReason,
    ...optional({ note: listing.heldNote }),
    at: listing.heldAt,
  };
}

/**
 * The best Rating among `listings` that a user could actually buy today: must-failers and Held
 * ones are left out, so the Shopping page never headlines something unbuyable with no fail
 * marker beside it to say so. Undefined when none of them qualifies.
 */
export function bestRating(listings: Listing[]): number | undefined {
  const ratings = listings
    .filter((each) => each.failedMusts.length === 0 && each.held === undefined)
    .map((each) => each.rating)
    .filter((rating): rating is number => rating !== undefined);
  return ratings.length > 0 ? Math.max(...ratings) : undefined;
}

/** The Deviations recorded when a Purchase was Fulfilled. */
export function toDeviations(model: DecisionModel, decision: DecisionRow): Deviation[] {
  return model.deviations
    .filter((each) => each.decisionId === decision.id)
    .map((deviation) => {
      const requirement = model.requirements.find((each) => each.id === deviation.requirementId);
      return {
        slug: deviation.slug,
        requirement: requirement?.position ?? 0,
        requirementText: requirement?.text ?? "?",
        strength: requirement?.strength ?? "must",
        text: deviation.text,
        reason: deviation.reason ?? undefined,
        recordedAt: deviation.recordedAt,
      };
    });
}
