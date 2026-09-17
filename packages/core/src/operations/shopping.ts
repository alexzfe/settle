import { CoreError } from "../errors.js";
import {
  renderGuidePage,
  renderGuidesMarkdown,
  renderGuidesPage,
  renderShoppingListCsv,
  renderShoppingListPage,
} from "../exports.js";
import { optional } from "../optional.js";
import { defineOperation } from "../registry.js";
import { titled } from "../render.js";
import type { DecisionRow } from "../store.js";
import { type DecisionModel, loadDecisions, openFlags, sorted, toDetail } from "./decisions.js";
import { active } from "./lookup.js";
import { roomById } from "./model.js";
import {
  activeRequirements,
  guideOf,
  hasGuides,
  measureFirst,
  outOfDate,
} from "./purchase-views.js";
import { requirePurchase } from "./purchases.js";
import {
  type ExportResult,
  exportGuidesInput,
  exportShoppingListInput,
  type GetShoppingResult,
  getGuidePageInput,
  getShoppingInput,
  type ShoppingEntry,
} from "./schemas.js";
import { requireHome } from "./scope.js";

// The web's Shopping section and the files it offers (docs/poc-design.md#web-ui): the Shopping
// List and Considering, the two exports, and the Quick Guide's phone page, which the LAN listener
// serves by its token alone.

const HTML = "text/html; charset=utf-8";
const CSV = "text/csv; charset=utf-8";
const MARKDOWN = "text/markdown; charset=utf-8";

export const getShopping = defineOperation({
  name: "get_shopping",
  description:
    "The Shopping section: the Shopping List (Locked Purchases not yet Fulfilled) and " +
    "Considering (Candidate and Leaning ones), each with its Room, Requirement counts, whether " +
    "it has Guides and Listings, and its Measure-first lines.",
  input: getShoppingInput,
  readOnly: true,
  surface: "web",
  handler(context): GetShoppingResult {
    const model = loadDecisions(context.store, requireHome(context));
    const { shoppingList, considering } = shoppingGroups(model);
    return {
      shoppingList: shoppingList.map((row) => toEntry(model, row)),
      considering: considering.map((row) => toEntry(model, row)),
    };
  },
});

export const exportShoppingList = defineOperation({
  name: "export_shopping_list",
  description:
    "The Shopping List as a file: a printable HTML page (format html) or CSV (format csv), " +
    "each Locked Purchase not yet Fulfilled with its Room, Requirements, and Measure-first lines.",
  input: exportShoppingListInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ExportResult {
    const home = requireHome(context);
    const model = loadDecisions(context.store, home);
    const purchases = shoppingGroups(model).shoppingList.map((row) => toDetail(model, row));
    return input.format === "csv"
      ? {
          mimeType: CSV,
          fileName: `${home.slug}-shopping-list.csv`,
          text: renderShoppingListCsv(purchases),
        }
      : {
          mimeType: HTML,
          fileName: `${home.slug}-shopping-list.html`,
          text: renderShoppingListPage(home, purchases, context.now()),
        };
  },
});

export const exportGuides = defineOperation({
  name: "export_guides",
  description:
    "The Shopping Guides as a file: a printable HTML page (format html) or Markdown (format " +
    "markdown), each Purchase's Quick Guide then its Full Guide. One Purchase by its slug, or " +
    "every one with Guides on the Shopping List and under Considering when decision is left out.",
  input: exportGuidesInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ExportResult {
    const home = requireHome(context);
    const model = loadDecisions(context.store, home);
    let rows: DecisionRow[];
    if (input.decision !== undefined) {
      const decision = requirePurchase(model, input.decision, "Shopping Guides");
      if (decision.state === "rejected") {
        throw new CoreError(
          "illegal_transition",
          `${titled(decision)} is Rejected, and a Rejected Purchase has no Guides.`,
        );
      }
      rows = [decision];
    } else {
      const { shoppingList, considering } = shoppingGroups(model);
      rows = [...shoppingList, ...considering].filter((row) => hasGuides(guideOf(model, row)));
    }
    const purchases = rows.map((row) => toDetail(model, row, { includeFullGuide: true }));
    const name = `${input.decision === undefined ? home.slug : rows[0]?.slug}-shopping-guides`;
    return input.format === "markdown"
      ? { mimeType: MARKDOWN, fileName: `${name}.md`, text: renderGuidesMarkdown(home, purchases) }
      : {
          mimeType: HTML,
          fileName: `${name}.html`,
          text: renderGuidesPage(home, purchases, context.now()),
        };
  },
});

export const getGuidePage = defineOperation({
  name: "get_guide_page",
  description:
    "The Quick Guide of one Purchase as a phone-readable HTML page with no JavaScript: by home " +
    "and decision, as GET /guide/<decision slug>?home=<home slug> serves it, or by its LAN " +
    "token alone, as the LAN listener's /guide/<token> does. A Rejected Purchase has none.",
  input: getGuidePageInput,
  readOnly: true,
  surface: "web",
  handler(context, input): ExportResult {
    let found: { model: DecisionModel; decision: DecisionRow } | undefined;
    if (input.token !== undefined) {
      if (input.home !== undefined || input.decision !== undefined) {
        throw new CoreError(
          "validation",
          "Give the token alone, or the home and decision, not both.",
        );
      }
      found = byToken(context.store, input.token);
    } else {
      if (input.decision === undefined) {
        throw new CoreError(
          "validation",
          "Give decision (a Purchase's slug) and home, or a Quick Guide's token.",
        );
      }
      const model = loadDecisions(context.store, requireHome(context));
      const decision = requirePurchase(model, input.decision, "Quick Guides");
      if (decision.state === "rejected") {
        throw new CoreError(
          "not_found",
          `${titled(decision)} was Rejected, so it has no Quick Guide.`,
        );
      }
      found = { model, decision };
    }
    const { model, decision } = found;
    return {
      mimeType: HTML,
      fileName: `${decision.slug}-quick-guide.html`,
      text: renderGuidePage(
        model.home,
        toDetail(model, decision, { includeFullGuide: true }),
        context.now(),
      ),
    };
  },
});

/**
 * The Purchase whose Guides carry `token`, in whichever Home it is. Every miss reads the same, so
 * a phone learns nothing from a wrong token; a Purchase Rejected since has no page.
 */
function byToken(
  store: Parameters<typeof loadDecisions>[0],
  token: string,
): { model: DecisionModel; decision: DecisionRow } {
  const guide = store.guideByLanToken(token);
  const home = guide && store.homes().find((each) => each.id === guide.homeId);
  const model = home && loadDecisions(store, home);
  const decision = guide && model?.decisions.find((each) => each.id === guide.decisionId);
  if (!model || !decision || !active(decision) || decision.state === "rejected") {
    throw new CoreError("not_found", "There is no Quick Guide at this address.");
  }
  return { model, decision };
}

/**
 * The Purchases to shop for: Locked ones not yet Fulfilled on the Shopping List, Candidate and
 * Leaning ones under Considering, each Home-wide first and then by Room, in creation order.
 */
function shoppingGroups(model: DecisionModel): {
  shoppingList: DecisionRow[];
  considering: DecisionRow[];
} {
  const purchases = sorted(
    model,
    model.decisions.filter(
      (each) =>
        active(each) &&
        each.kind === "purchase" &&
        each.state !== "rejected" &&
        each.fulfilledAt === null,
    ),
  );
  return {
    shoppingList: purchases.filter((each) => each.state === "locked"),
    considering: purchases.filter((each) => each.state !== "locked"),
  };
}

function toEntry(model: DecisionModel, row: DecisionRow): ShoppingEntry {
  const requirements = activeRequirements(model, row);
  const guide = guideOf(model, row);
  const room = row.scopeRoomId === null ? undefined : roomById(model, row.scopeRoomId);
  const count = (strength: "must" | "prefer") =>
    requirements.filter((each) => each.strength === strength).length;
  return {
    slug: row.slug,
    title: row.title,
    statement: row.statement,
    state: row.state,
    ...optional({ room: room && { slug: room.slug, name: room.name } }),
    requirements: { must: count("must"), prefer: count("prefer") },
    hasGuides: hasGuides(guide),
    fullGuideOutOfDate: outOfDate(guide),
    listings: model.listings.filter((each) => each.decisionId === row.id).length,
    measureFirst: measureFirst(model, row),
    openFlags: openFlags(model, row).length,
  };
}
