---
type: domain
title: "Purchasing: Requirements, Listings and Shopping Guides"
description: How a Purchase Decision carries must/prefer Requirements traced to their reasons, how Listings are checked, rated and held, how the Quick Guide is assembled live from Requirements and the Agent's own lines, and how the Shopping List, exports and the Quick Guide phone page are produced.
tags: [purchasing, requirements, listings, rating, quick-guide, full-guide, shopping-list, exports]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-c9cb20cd8b5aa720d4ffa079
    resource: repo://packages/core/src/exports.ts
  - id: openwiki-source-26b354a9e58cb1f70bdce131
    resource: repo://packages/core/src/operations/purchase-views.ts
  - id: openwiki-source-f5094f9bdcb2c5751491e1ee
    resource: repo://packages/core/src/operations/purchases.ts
  - id: openwiki-source-c0ff016da4b58ef6dc549ece
    resource: repo://packages/core/src/operations/reasons.ts
  - id: openwiki-source-579136606efc6884894f6e11
    resource: repo://packages/core/src/operations/schemas.ts
  - id: openwiki-source-922b6065476f6586f71a84e4
    resource: repo://packages/core/src/operations/shopping.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Purchasing: Requirements, Listings and Shopping Guides

A **Purchase Decision** is a Decision of kind `purchase` (see [Decisions](decisions.md)); the
Purchase Skill drives it end to end. Code: `operations/purchases.ts` (writes),
`operations/purchase-views.ts` (assembled views), `operations/shopping.ts` (Shopping section,
exports, phone page) and `exports.ts` (file rendering).

## Requirements

Saved with `save_decision`, each Requirement has a position, text, a strength (`must` or
`prefer`) and a **reason** pointing at the record it comes from: a Decision, Constraint, Note, or
a part of the Home (`home`, `room`, `wall`, `window`, `door`, `feature`, `surface`, `item`),
optionally narrowed to one field (`operations/reasons.ts`, `REASON_FIELDS`). Reasons do real work:

- a Decision named by a reason joins the Purchase's Basis;
- a change to the pointed-at value raises a `value_changed` flag on the Purchase;
- a *must* resting on an Estimated or unrecorded length produces a **Measure first** line.

A Requirement resent without a position that matches an active one (text, strength and reason) is
left as it is. Removed Requirements are Archived.

## The Quick Guide and Full Guide

`save_guides` stores three things for a Purchase: `lookingFor` (the ~80-character top line),
`quickLines` (at most 8 of the Agent's own lines, each `avoid`, `test` or `ask`), and `fullGuide`
(Markdown to read ahead, explaining every *must*). Each replaces what was saved; omitted ones are
kept. A Rejected Purchase has no Guides.

**The Quick Guide is never stored whole.** `purchase-views.ts` assembles it on every read: the
looking-for line, Measure-first lines, the musts, the avoids, the prefers, then tests and asks. So
a changed Requirement shows in the Quick Guide immediately, and the Agent must not repeat
Requirements or Measure-first lines in its own lines. The Full Guide, by contrast, is stored text,
marked **out of date** when a Requirement changes after it was written.

## Listings

`record_listing` records a real product the user brings — name, link, price, dimensions, picture —
with a **check** (`pass`, `fail` or `unknown`, plus a few words) against every non-Archived
Requirement. A new Listing must check all of them; an update that changes checks must still cover
every Requirement, including ones added since. The receipt reports pass/fail/unknown counts and
any failed must.

- **Rating:** 1–5 whole stars with a required one-line `ratingNote`. It is the Agent's judgement of
  how good the product is, on the same scale as the Purchase's other Listings, and is **never
  lowered for a failed must** — the checks carry that.
- **Picture:** fetched best-effort from `photoUrl` before the write and stored as Settle's own copy
  ([Media](media.md#listing-pictures)).
- **Held** (web, `hold_listing`): kept for reference but not buyable now — `out-of-stock`,
  `discontinued`, `too-expensive-now` or `other`, with the date stamped by the platform. A Held
  Listing keeps its Rating and checks. Not a Flag.
- **Drop** (web, `drop_listing`): removes the Listing, its checks and picture with one change-log
  entry — except the Listing a Fulfilment names as bought, which is refused.
- A Listing never changes the Purchase's state; a Rejected or Fulfilled Purchase takes none.

When the Purchase is Fulfilled, the bought Listing's link, price and shop are copied onto the new
Item, tagged Listed.

## Shopping views and exports

- `get_shopping` (web): the **Shopping List** (Settled Purchases not yet Fulfilled) and
  **Considering** (Candidate and Leaning), each with its Room, Requirement counts, whether it has
  Guides and Listings, its best rating, and its Measure-first lines.
- `export_shopping_list`: printable HTML or CSV. `export_guides`: printable HTML or Markdown, each
  Quick Guide then its Full Guide, for one Purchase or all with Guides.
- `get_guide_page`: one Purchase's Quick Guide as a phone-readable page.

`exports.ts` renders these from stored data only — never by the AI at export time — as static HTML
**with no JavaScript**, escaping every stored text (the Full Guide's Markdown included), with the
web app's look copied in so each file stands alone. The server serves them at
`/api/export_shopping_list`, `/api/export_guides` and `/guide/…` ([HTTP server](../server/http-and-mcp.md)).

## The Quick Guide phone page

Each Purchase's page in the UI shows a QR code for its Quick Guide. The page is reachable two ways:

- `/guide/<decision>?home=<home>` — for the logged-in web UI;
- `/guide/<token>` — by the guide's unguessable token, needing **no login**, on the main listener
  or the LAN listener in LAN mode. Every miss reads the same, so a wrong token reveals nothing, and
  a Purchase Rejected since has no page.

See [Configuration, security and self-hosting](../operations/hosting-and-security.md) for LAN mode.

## Tests

`purchase-rules.test.ts` (Requirements, the Quick Guide, `save_guides`, the Full Guide),
`listing-rules.test.ts` (Rating, picture, paste box, Held, drop, Rejected/Fulfilled Purchases, best
rating), `shopping-rules.test.ts` (Shopping section, exports, phone page, LAN mode), with HTML/CSV/
Markdown snapshots in `packages/core/src/__snapshots__/`.
