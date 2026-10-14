---
type: domain
title: Sessions, the opening and Agent-facing text
description: How Settle opens, joins and closes Sessions, what the opening sends each Skill, how render.ts shapes the tiered text the Agent reads — Home Overview, Room Sheets, receipts, find results — and how file snapshots pin that text in tests.
tags: [sessions, opening, render, room-sheet, receipts, context-tiers, snapshots, find]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-624431817de30f9a23204de5
    resource: repo://packages/core/src/operations/find-index.ts
  - id: openwiki-source-68cc8df9d9bdb378fb4998b9
    resource: repo://packages/core/src/operations/rooms.ts
  - id: openwiki-source-ac0e9828432f18e95263b384
    resource: repo://packages/core/src/operations/sessions.ts
  - id: openwiki-source-5c459d62ce7910fc6b3e528e
    resource: repo://packages/core/src/render.test.ts
  - id: openwiki-source-6d9140d0b556d3a02e7318de
    resource: repo://packages/core/src/render.ts
  - id: openwiki-source-a846f4612a090aa893ece0e5
    resource: repo://packages/web/src/find/match.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Sessions, the opening and Agent-facing text

Settle controls the Agent's context through what its tools return. Every Agent operation has a
`text(output)` renderer, mostly in `packages/core/src/render.ts`; the structured output is used only
by the web. Changing what the Agent sees means changing `render.ts` (and its snapshots).

## Sessions

A **Session** is one interview with the user (`operations/sessions.ts`). Settle keeps its record —
Skills used, what opening blocks were sent, and a closing summary — never the transcript.

- **`open_session`** without `session` creates one with a slug `<skill>-<4 chars>` (an alphabet
  without 0/o/1/l/i, so the Agent can't mistype it) and returns the Session id, the Home's name and
  the opening. It is registered as a write (it records a Session) but never changes the Home.
- With `session`, a later Skill **joins**: its name is added to the Session's Skills and only the
  opening blocks not yet sent are returned. `resend: true` returns the whole opening again, for
  after context compaction.
- **`close_session`** takes a three-part summary (`changed`, `open`, `next`), which the user reads
  in the app; no later Session reads it. A closed Session refuses every write (`session_closed`),
  telling the Agent to open a new one.

Every write requires the open Session's id as `session`; reads require a Session of this Home but
accept a closed one ([Operation registry](../architecture/operation-registry.md#callers-and-sessions)).

## The opening

`OPENING_BLOCKS` decides what each Skill gets:

| Skill | Blocks |
| --- | --- |
| `home-intake` | overview, flags |
| `design-direction`, `color`, `purchase` | overview, decisions, flags |

- **overview** — the Home Overview: the Home's facts and Levels, the Constraints, how many Items are
  Unplaced, the Blueprints, and one line per Room with its slug, Level, size, light, use, Item
  count and **Gaps**.
- **decisions** — the Home-wide Decisions in force: the Design Direction and Palette in full (or how
  many Candidates exist), then other Home-wide Settled Decisions one line each. Home Intake makes
  no design Decisions, so it doesn't get this block.
- **flags** — open Flags and Conflicts, one line each.

The view is built by `openingView` in `operations/decisions.ts` and rendered by `renderOpening`.

## Context tiers

The comment heading `render.ts` states the design: the Agent gets what the current work needs, in
full, and nothing it would have to ignore.

1. **At Session start:** the opening.
2. **When work first touches a Room:** its **Room Sheet** (`get_room_sheet`) — functions, ceiling
   height, times of use, Walls clockwise with lengths/facing/beyond, Windows, Doors, Surfaces,
   Features, lights, Items, open (non-Fulfilled) Decisions, Photos by id, and Gaps. The tool
   description tells the Agent to fetch it once and rely on later receipts, not to fetch every Room
   up front. `withSources` adds each Blueprint value's page and printed text.
3. **On request:** `find_items`, `find_decisions` (all states, including Rejected and Fulfilled),
   `get_decision` (one in full, optionally with the Full Guide), `search_notes`, `view_images`,
   `view_photos`.

The change log is never rendered for the Agent.

Shared rendering rules: leave out empty fields; mark Estimated values with `~` and Listed ones with
`*`; name records by name with their readable slug in brackets, never database ids — except Photos,
which have no name and go by `#<id>`.

## Receipts

Every Agent write returns a **receipt** (`renderReceipt`): one line per change, each refused part
with its reason and both values (from the Provenance rule), the Room's remaining Gaps where
relevant, and every Decision the write flagged. Receipts keep the Agent's picture current without
re-fetching Room Sheets, and the protocol tells Skills to say plainly what the receipt says changed.

## The web's find box

`find_index` (web-only, `operations/find-index.ts`) returns every findable record of a Home — Rooms,
Decisions, Items, Listings, Features — as a flat list with name, breadcrumb, path, tier, state and
last-changed time. The browser matches and ranks it on each keystroke
(`packages/web/src/find/match.ts`), matching only the record's own name, accent-insensitive.
It is deliberately web-only: the Agent has its own finders, and a fourth overlapping one would make
it pick wrong.

## Snapshot tests

`render.test.ts` drives real operations against the fixture Home and compares tool text with
`toMatchFileSnapshot` files in `packages/core/src/__snapshots__/` (`opening*.txt`,
`room-sheet-*.txt`, `receipt-*.txt`, `get_decision*.txt`, `find_*.txt`, `view_*.txt`, …). A
deliberate text change is accepted by updating the snapshots (`vitest -u`) and reviewing the diff
as a change to what the Agent reads.

Related: [Skills and plugin](../agent/skills-and-plugin.md), [Decisions](decisions.md).
