import { join } from "node:path";
import { CoreError } from "../errors.js";
import type { FetchedImage, PhotoType } from "../images.js";
import { imageVersion, PHOTO_EXTENSIONS, uploadedImage } from "../images.js";
import { optional } from "../optional.js";
import { equal } from "../provenance.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { DECISION_KIND_LABELS as KINDS, listingLine, titled } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { DecisionRow, HomeRow, ListingRow, RequirementRow } from "../store.js";
import { randomToken } from "../token.js";
import { type DecisionModel, loadDecisions, requireDecision } from "./decisions.js";
import {
  activeRequirements,
  guideOf,
  measureFirst,
  outOfDate,
  toListing,
  toListings,
} from "./purchase-views.js";
import {
  type CheckResult,
  type DropListingResult,
  dropListingInput,
  type GetListingPhotoResult,
  getListingPhotoInput,
  type HoldInput,
  type HoldReason,
  holdListingInput,
  type ListingDimensions,
  type ListingResult,
  QUICK_LINE_KINDS,
  type QuickLine,
  type ReceiptResult,
  recordListingInput,
  saveGuidesInput,
  setListingPhotoInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { Writer } from "./writer.js";

// The Purchase operations of slice 6: the Shopping Guides, Listings, and the web's Shopping views
// and exports. A Purchase Decision carries plain-text Requirements, each a must or a prefer with a
// reason; the Guides and the Listing checks are built on them, and the AI does the checking.

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
    "link, price, size, and picture) checked against every Requirement, and returns a receipt " +
    "with its pass, fail, and unknown counts and any must it fails. Judge each Requirement from " +
    "what the listing says: pass, fail, or unknown when it doesn't say or can't be judged from " +
    "it, with a few words on what decided it. A new Listing needs a check for every Requirement " +
    "not Archived. Pass `listing` (its slug) to change one: the fields given replace what is " +
    "recorded, and the checks given replace those of their Requirements; it must then have a " +
    "check for every Requirement, those added since included. A rating on its own needs no " +
    "checks resent. Also give it a Rating: 1 to 5 whole stars for how good the product is, with " +
    "ratingNote, the one line that makes the stars arguable. A Rating is your judgement, not a " +
    "formula: place it on the same scale as the other Listings' ratings that get_decision shows " +
    "you, weigh the Requirements heaviest but not alone (quality, value, and taste count too), " +
    "and never lower it for a failed must — the checks carry that, and a 5-star product under a " +
    "failed must is the strongest sign the Requirement itself deserves a second look. A rating " +
    "without its ratingNote is refused. photoUrl links straight to the picture: the app fetches " +
    "and keeps the bytes, and when it can't it keeps the link and says so on the receipt. Tell " +
    "the user plainly which musts it fails. A Listing never changes the Purchase's state; a " +
    "Rejected or Fulfilled Purchase takes none. Needs the open Session's id as `session`.",
  input: recordListingInput,
  readOnly: false,
  surface: "agent",
  async handler(context, input): Promise<ReceiptResult> {
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    // store.transaction is synchronous, so the picture is fetched here, before the write, and
    // stored with the row inside it. The fetch is best-effort: a failure only costs the bytes.
    const photo = await fetchPhoto(context, home, input);
    let stored: StoredPhoto | undefined;
    try {
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
        requireRatingNote(listing, input);
        const write = storeListing(context, model, writer, decision, listing, input, photo?.image);
        const row = write.row;
        stored = write.stored;
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
        if (photo?.failure) {
          writer.line(
            `Listing for ${subject}`,
            `its picture could not be stored, so the link is kept: ${photo.failure}`,
          );
        }
        return writer.receipt();
      });
      return { receipt };
    } catch (error) {
      // The bytes were written inside the transaction that has just rolled back.
      if (stored) removePhoto(context, stored.photoPath);
      throw error;
    }
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

interface ListingInput {
  name?: string | undefined;
  url?: string | undefined;
  price?: string | undefined;
  dimensions?: ListingDimensions | undefined;
  photoUrl?: string | undefined;
  rating?: number | undefined;
  ratingNote?: string | undefined;
  held?: HoldInput | null | undefined;
}

/**
 * Adds a Listing, or changes the fields given of one recorded; returns its row, and the picture
 * it wrote to disk, if any, so a rolled-back write can take the bytes away again.
 */
function storeListing(
  context: OperationContext,
  model: DecisionModel,
  writer: Writer,
  decision: DecisionRow,
  listing: ListingRow | undefined,
  input: ListingInput,
  image: FetchedImage | undefined,
): { row: ListingRow; stored: StoredPhoto | undefined } {
  const { store } = context;
  const at = context.now();
  const values = {
    name: input.name,
    url: input.url,
    price: input.price,
    dimensions: input.dimensions,
    photoUrl: input.photoUrl,
    rating: input.rating,
    ratingNote: input.ratingNote,
    ...heldValues(listing, input.held, at),
  };
  if (!listing) {
    const name = input.name as string;
    const slug = uniqueSlug(name, "listing", (taken) =>
      store.slugTaken("listings", taken, model.home.id),
    );
    const stored = image && storePhoto(context, model.home, slug, image);
    const row = store.insert("listings", {
      homeId: model.home.id,
      decisionId: decision.id,
      slug,
      name,
      url: values.url ?? null,
      price: values.price ?? null,
      dimensions: values.dimensions ?? null,
      photoUrl: values.photoUrl ?? null,
      photoPath: stored?.photoPath ?? null,
      photoType: stored?.photoType ?? null,
      photoVersion: stored?.photoVersion ?? null,
      rating: values.rating ?? null,
      ratingNote: values.ratingNote ?? null,
      heldReason: values.heldReason ?? null,
      heldNote: values.heldNote ?? null,
      heldAt: values.heldAt ?? null,
      recordedAt: at,
    });
    model.listings.push(row);
    writer.logged({
      recordKind: "decision",
      record: decision,
      field: `listing ${slug}`,
      new: optional({ ...values, ...optional({ photoStored: stored && true }) }),
    });
    return { row, stored };
  }
  const previous = listing.photoPath;
  const stored = image && storePhoto(context, model.home, listing.slug, image);
  const current = listing as unknown as Record<string, unknown>;
  const patch = Object.fromEntries(
    Object.entries({ ...values, ...stored }).filter(
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
  // A JPEG replaced by a WebP lands at another path: the copy it replaces goes.
  if (stored && previous && previous !== stored.photoPath) removePhoto(context, previous);
  return { row: listing, stored };
}

/**
 * The hold columns for a write. `at` is stamped by the platform, and only when the hold itself
 * changes, so re-holding for the same reason doesn't make an old hold look fresh.
 */
function heldValues(
  listing: ListingRow | undefined,
  held: HoldInput | null | undefined,
  at: string,
): { heldReason?: HoldReason | null; heldNote?: string | null; heldAt?: string | null } {
  if (held === undefined) return {};
  if (held === null) return { heldReason: null, heldNote: null, heldAt: null };
  const note = held.note ?? null;
  const same =
    listing?.heldReason === held.reason && listing.heldNote === note && listing.heldAt !== null;
  return { heldReason: held.reason, heldNote: note, ...(same ? {} : { heldAt: at }) };
}

/** A Listing may never end up with stars and no reason line: the reason is what makes them arguable. */
function requireRatingNote(listing: ListingRow | undefined, input: ListingInput): void {
  const rating = input.rating ?? listing?.rating ?? null;
  const note = input.ratingNote ?? listing?.ratingNote ?? null;
  if (rating !== null && note === null) {
    throw new CoreError(
      "validation",
      'A Rating needs its ratingNote: one line saying what the stars mean here ("Slub ' +
        'visible, but 40% over budget"). Nothing was recorded.',
    );
  }
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

// ─── The Listing's picture ──────────────────────────────────────────────────────────────────
//
// The bytes live beside the Blueprint uploads, under uploads/<home>/listings/. The platform
// fetches them itself when a Listing is recorded, best-effort, so the picture outlives the shop's
// listing and the Agent never spends its context passing image bytes. The user can paste or point
// at another picture from the board, because a shop's own photo is often the worst one of the
// product.

/** What the columns hold once a picture is stored. */
interface StoredPhoto {
  photoPath: string;
  photoType: PhotoType;
  photoVersion: string;
}

/** Writes the bytes and returns the columns naming them. Called inside the write. */
function storePhoto(
  context: OperationContext,
  home: HomeRow,
  slug: string,
  image: FetchedImage,
): StoredPhoto {
  const photoPath = join(
    "uploads",
    home.slug,
    "listings",
    `${slug}.${PHOTO_EXTENSIONS[image.type]}`,
  );
  context.files.writeBytes(join(context.dataDir(), photoPath), image.bytes);
  return { photoPath, photoType: image.type, photoVersion: imageVersion(image.bytes) };
}

function removePhoto(context: OperationContext, path: string | null): void {
  if (path) context.files.remove(join(context.dataDir(), path));
}

/**
 * The picture for a record_listing call, fetched before the write. Best-effort: any failure at
 * all comes back as `failure`, a line for the receipt, and the Listing is still recorded with its
 * photoUrl alone. Nothing is fetched when the URL is the one already stored and its bytes are
 * still there.
 */
async function fetchPhoto(
  context: OperationContext,
  home: HomeRow,
  input: { listing?: string | undefined; photoUrl?: string | undefined },
): Promise<{ image?: FetchedImage; failure?: string } | undefined> {
  const { photoUrl } = input;
  if (photoUrl === undefined) return undefined;
  const listing =
    input.listing === undefined
      ? undefined
      : context.store.list("listings", home.id).find((each) => each.slug === input.listing);
  if (listing && listing.photoUrl === photoUrl && listing.photoPath !== null) return undefined;
  try {
    return { image: await context.fetchImage(photoUrl) };
  } catch (error) {
    return { failure: error instanceof Error ? error.message : String(error) };
  }
}

// ─── The board's own writes ─────────────────────────────────────────────────────────────────
//
// The first web-callable writes Listings have ever had: until now they were written only by the
// Agent over MCP, and the shift is deliberate. Culling a Listing and noting that stock has run
// out are not changes to the Decision, so a Rejected or Fulfilled Purchase takes them too.

export const dropListing = defineOperation({
  name: "drop_listing",
  description:
    "Drops one Listing from its Purchase: the row, its checks, and its stored picture all go, " +
    "with one change-log entry and no reason asked for. Listings are meant to be culled, except " +
    "the one a Fulfilment names as bought, which is refused.",
  input: dropListingInput,
  readOnly: false,
  surface: "web",
  handler(context, input): DropListingResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const model = loadDecisions(context.store, home);
      const { listing, decision } = requireListing(model, input.listing);
      if (decision.fulfilment?.listing === listing.slug) {
        throw new CoreError(
          "referenced_cannot_delete",
          `${listing.name} is the Listing bought when ${titled(decision)} was Fulfilled: the ` +
            "Item it bought shows its picture, and the Fulfilment names it, so it can't be dropped.",
        );
      }
      const writer = new Writer(context, home, log, undefined);
      // listing_checks is the only foreign key into listings: a Deviation cites a Requirement.
      context.store.removeListingChecks(listing.id);
      context.store.removeListing(listing.id);
      removePhoto(context, listing.photoPath);
      writer.logged({
        recordKind: "decision",
        record: decision,
        field: `listing ${listing.slug}`,
        old: optional({
          name: listing.name,
          url: listing.url,
          price: listing.price,
          rating: listing.rating,
        }),
        new: null,
      });
      return { decision: decision.slug, listing: listing.slug };
    });
  },
});

export const holdListing = defineOperation({
  name: "hold_listing",
  description:
    "Holds one Listing — good, but not buyable now — or releases it with held: null. The " +
    "platform stamps the date. A Held Listing keeps its Rating and its checks; nothing else " +
    "about it changes.",
  input: holdListingInput,
  readOnly: false,
  surface: "web",
  handler(context, input): ListingResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const model = loadDecisions(context.store, home);
      const { listing, decision } = requireListing(model, input.listing);
      const writer = new Writer(context, home, log, undefined);
      const values = heldValues(listing, input.held, context.now());
      const current = listing as unknown as Record<string, unknown>;
      const patch = Object.fromEntries(
        Object.entries(values).filter(
          ([key, value]) => value !== undefined && !equal(value, current[key] ?? null),
        ),
      );
      if (Object.keys(patch).length > 0) {
        context.store.update("listings", listing.id, patch);
        writer.logged({
          recordKind: "decision",
          record: decision,
          field: `listing ${listing.slug} held`,
          old: optional({ reason: listing.heldReason, note: listing.heldNote }),
          new: input.held === null ? null : optional({ ...input.held }),
        });
        Object.assign(listing, patch);
      }
      return {
        decision: decision.slug,
        listing: toListing(model, listing, activeRequirements(model, decision)),
      };
    });
  },
});

export const setListingPhoto = defineOperation({
  name: "set_listing_photo",
  description:
    "Sets one Listing's picture from the board, as multipart/form-data: the bytes the user " +
    "pasted or chose as `file`, or an image `url` for the app to fetch, one or the other. The " +
    "same validation as the automatic fetch, but unlike it a failure is reported, since the " +
    "user is waiting on it. Any picture already stored is replaced.",
  input: setListingPhotoInput,
  readOnly: false,
  surface: "web",
  async handler(context, input): Promise<ListingResult> {
    const home = requireHome(context);
    const image =
      input.file === undefined
        ? await context.fetchImage(input.url as string)
        : uploadedImage(input.file);
    let stored: StoredPhoto | undefined;
    try {
      return context.write("web", (log) => {
        const model = loadDecisions(context.store, home);
        const { listing, decision } = requireListing(model, input.listing);
        const writer = new Writer(context, home, log, undefined);
        const previous = listing.photoPath;
        stored = storePhoto(context, home, listing.slug, image);
        const patch = { ...stored, ...(input.url === undefined ? {} : { photoUrl: input.url }) };
        context.store.update("listings", listing.id, patch);
        writer.logged({
          recordKind: "decision",
          record: decision,
          field: `listing ${listing.slug} photo`,
          old: optional({ photoUrl: listing.photoUrl, photoVersion: listing.photoVersion }),
          new: { photoVersion: stored.photoVersion, ...optional({ photoUrl: input.url }) },
        });
        Object.assign(listing, patch);
        if (previous && previous !== stored.photoPath) removePhoto(context, previous);
        return {
          decision: decision.slug,
          listing: toListing(model, listing, activeRequirements(model, decision)),
        };
      });
    } catch (error) {
      if (stored) removePhoto(context, stored.photoPath);
      throw error;
    }
  },
});

export const getListingPhoto = defineOperation({
  name: "get_listing_photo",
  description:
    "One Listing's stored picture, with the type sniffed from its bytes, served by GET " +
    "/api/get_listing_photo?home=<slug>&listing=<slug>&v=<photoVersion>.",
  input: getListingPhotoInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetListingPhotoResult {
    const home = requireHome(context);
    const model = loadDecisions(context.store, home);
    const { listing } = requireListing(model, input.listing);
    const bytes =
      listing.photoPath && context.files.readBytes(join(context.dataDir(), listing.photoPath));
    if (!listing.photoType || !bytes) {
      throw new CoreError(
        "not_found",
        `The app holds no picture for the Listing "${listing.slug}"` +
          (listing.photoUrl ? `; it has only the link ${listing.photoUrl}.` : "."),
      );
    }
    return { mimeType: listing.photoType, data: bytes };
  },
});

/** A Listing of the Home by slug, with the Purchase it belongs to. Slugs are unique per Home. */
function requireListing(
  model: DecisionModel,
  slug: string,
): { listing: ListingRow; decision: DecisionRow } {
  const listing = model.listings.find((each) => each.slug === slug);
  if (!listing) {
    throw new CoreError("not_found", `This Home has no Listing "${slug}".`);
  }
  const decision = model.decisions.find((each) => each.id === listing.decisionId);
  if (!decision) throw new Error(`Listing ${slug} belongs to no Decision`);
  return { listing, decision };
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
      lanToken: randomToken(context.random),
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
