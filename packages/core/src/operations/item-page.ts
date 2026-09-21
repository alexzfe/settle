import { defineOperation } from "../registry.js";
import { named } from "../render.js";
import type { ChangeRow, DecisionRow, ItemRow, ListingRow, RequirementRow } from "../store.js";
import { requireItem, untagListed } from "./items.js";
import { loadHome, toItem } from "./model.js";
import {
  editItemInput,
  getItemInput,
  type ItemDecision,
  type ItemHistoryEntry,
  type ItemPage,
  type ReceiptResult,
} from "./schemas.js";
import { requireHome } from "./scope.js";
import { Writer } from "./writer.js";

// The Item page (docs/handoff/item-page.md): an Item's register, the Decisions tied to it, and the
// history of its record; and its pencil, the first web write to an Item. Neither is an Agent tool:
// the Agent reads Items through find_items and writes them through save_items.

/** The reason an edit on the page carries: the pencil is the user saying so (Q18). */
const WEB_EDIT = "edited by the user on the web";

export const getItem = defineOperation({
  name: "get_item",
  description:
    "An Item's page, Archived ones too: the Item, the Items it replaced or that replaced it, the " +
    "Listing picture of the Purchase that bought it, the Decisions tied to it, and its history, " +
    "one entry per change event, newest first.",
  input: getItemInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ItemPage {
    const home = requireHome(context);
    const model = loadHome(context.store, home);
    const item = requireItem(model, input.item);
    const decisions = context.store.list("decisions", home.id);
    const boughtBy = decisions.find((each) => each.fulfilment?.item === item.slug);
    const replacedBy = model.items.find((each) => each.id === item.replacedByItemId);
    const replaces = model.items.filter((each) => each.replacedByItemId === item.id);
    const picture = boughtBy && listingPicture(context.store.list("listings", home.id), boughtBy);
    return {
      item: toItem(model, item),
      ...(replaces.length > 0 ? { replaces: replaces.map(ref) } : {}),
      ...(replacedBy ? { replacedBy: ref(replacedBy) } : {}),
      ...(picture ? { picture } : {}),
      decisions: [
        ...reliesOn(context.store.list("requirements", home.id), decisions, item),
        ...(boughtBy ? [related("bought-by", boughtBy)] : []),
        ...decisions
          .filter((each) => each.fulfilment?.replacedItem === item.slug)
          .map((each) => related("replaced-by", each)),
      ],
      history: history(
        context.store.recordChanges(home.id, "item", item.id),
        new Map(context.store.sessions(home.id).map((session) => [session.slug, session.skills])),
      ),
    };
  },
});

export const editItem = defineOperation({
  name: "edit_item",
  description:
    "The Item page's pencil: changes the given fields of one Item (null clears one), whatever " +
    "Provenance a value replaces, since the user typed it. The same write as the Agent's: logged " +
    "from the web, and flagging the Purchases resting on a changed value. Name, category, " +
    "quantity, Room, Wall, and archiving are left to a Session.",
  input: editItemInput,
  readOnly: false,
  surface: "web",
  handler(context, input): ReceiptResult {
    const home = requireHome(context);
    const receipt = context.write("web", (log) => {
      const model = loadHome(context.store, home);
      const item = requireItem(model, input.item);
      const writer = new Writer(context, home, log, WEB_EDIT);
      // No colors is an empty list, as save_items stores them.
      const { colors, ...fields } = input.fields;
      const values = colors === undefined ? fields : { ...fields, colors: colors ?? [] };
      const subject = named(item);
      const changes = writer.patch("items", "item", item, subject, values);
      untagListed(context, item, changes);
      writer.line(subject, undefined, changes);
      return writer.receipt();
    });
    return { receipt };
  },
});

const ref = (item: ItemRow) => ({ slug: item.slug, name: item.name });

function related(relation: ItemDecision["relation"], decision: DecisionRow): ItemDecision {
  return {
    relation,
    slug: decision.slug,
    title: decision.title,
    state: decision.state,
    fulfilled: decision.fulfilledAt !== null,
    archived: decision.archivedAt !== null,
  };
}

/** The Decisions with a Requirement, not Archived, whose reason is this Item, with those Requirements. */
function reliesOn(
  requirements: RequirementRow[],
  decisions: DecisionRow[],
  item: ItemRow,
): ItemDecision[] {
  const citing = requirements.filter(
    (each) => each.reasonKind === "item" && each.reasonId === item.id && each.archivedAt === null,
  );
  return decisions
    .filter((decision) => citing.some((each) => each.decisionId === decision.id))
    .map((decision) => ({
      ...related("relies-on", decision),
      requirements: citing
        .filter((each) => each.decisionId === decision.id)
        .sort((a, b) => a.position - b.position)
        .map((each) => ({
          position: each.position,
          text: each.text,
          strength: each.strength,
          ...(each.reasonField === null ? {} : { field: each.reasonField }),
        })),
    }));
}

/** The picture of the Listing a Purchase was Fulfilled with, when the platform holds its bytes. */
function listingPicture(listings: ListingRow[], decision: DecisionRow): ItemPage["picture"] {
  const listing = listings.find(
    (each) => each.decisionId === decision.id && each.slug === decision.fulfilment?.listing,
  );
  if (!listing?.photoPath || !listing.photoVersion) return undefined;
  return { listing: listing.slug, photoVersion: listing.photoVersion };
}

/** One entry per change event, a moment and an origin, newest first. */
function history(changes: ChangeRow[], skills: Map<string, string[]>): ItemHistoryEntry[] {
  const entries = new Map<string, ItemHistoryEntry>();
  for (const change of changes) {
    const key = `${change.at} ${change.origin}`;
    let entry = entries.get(key);
    if (!entry) {
      const sessionSkills = change.origin === "web" ? undefined : skills.get(change.origin);
      entry = {
        at: change.at,
        origin: change.origin,
        ...(sessionSkills ? { skills: sessionSkills } : {}),
        changes: [],
      };
      entries.set(key, entry);
    }
    entry.changes.push({
      ...(change.field === null ? {} : { field: change.field }),
      ...(change.old === undefined ? {} : { old: change.old }),
      ...(change.new === undefined ? {} : { new: change.new }),
      ...(change.reason === null ? {} : { reason: change.reason }),
    });
  }
  return [...entries.values()].reverse();
}
