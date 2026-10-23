---
type: domain
title: The Home model
description: The structured record of a Home in Settle — Levels, Rooms with Walls, Windows, Doors, Features and Surfaces, the Item Inventory, Constraints and Notes — plus the Provenance rule, Gaps, daylight openings and city latitude, and the operations that read and write them.
tags: [home, rooms, walls, items, inventory, constraints, notes, gaps, provenance, daylight]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-ba08e18a2b502690324700a2
    resource: repo://packages/core/src/cities.ts
  - id: openwiki-source-a473273234f140d913962a1d
    resource: repo://packages/core/src/daylight.ts
  - id: openwiki-source-85c9070bd471773fb498b3ab
    resource: repo://packages/core/src/gaps.ts
  - id: openwiki-source-96ac4a076ed8b90bc5455648
    resource: repo://packages/core/src/home-model-rules.test.ts
  - id: openwiki-source-545b5a823d8e5a9358700099
    resource: repo://packages/core/src/operations.test.ts
  - id: openwiki-source-113c0f18100970ad1c89d662
    resource: repo://packages/core/src/operations/constraints.ts
  - id: openwiki-source-63715b931eec4be6b4114480
    resource: repo://packages/core/src/operations/item-page.ts
  - id: openwiki-source-c7fed7e7e478ef0a8a8b859b
    resource: repo://packages/core/src/operations/items.ts
  - id: openwiki-source-68cc8df9d9bdb378fb4998b9
    resource: repo://packages/core/src/operations/rooms.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# The Home model

A **Home** is the unit everything belongs to; the Agent only ever sees one (the Active Home named
by its MCP URL). Exact definitions of every noun are in `CONTEXT.md`; this page covers how the
code models and enforces them. The in-memory model of one Home is loaded by `loadHome` in
`packages/core/src/operations/model.ts`, which converts store rows into the shapes operations and
renderers use (e.g. `roomDetail`, `overviewView`).

## Structure

```
Home ── Levels (storey 0 = ground) ── Rooms
                                       ├─ Walls (clockwise, <room>/wall-<n>; length, facing, beyond)
                                       ├─ Windows (in a Wall, or the roof)
                                       ├─ Doors (shared by the two Rooms they join; may be glazed)
                                       ├─ Features (parts of the building that stay)
                                       └─ Surfaces (walls, ceiling, floor, woodwork; color + finish)
Home ── Items (Inventory; in a Room or Unplaced) ── Photos, Documents
Home ── Constraints, Notes, Blueprints, Sessions, Decisions
```

- `create_home` (web) looks up the city's latitude in the bundled GeoNames `cities15000.tsv`
  (`cities.ts`; ISO code or English country name, accent- and case-insensitive, most populous city
  wins, rounded to 0.1°), accepts a given latitude when the city is absent, refuses otherwise with
  `city_not_found`, creates a token, and adds the Ground Level.
- `save_home` (Agent) records the Home's facts (tenure, planned stay, building type and era, lift…)
  and Levels; a Level with a Room on it can't be removed.
- `save_room` (Agent, `operations/rooms.ts`) records one Room with all its parts in one call.
  Without a `room` slug, a Room of the same name is updated, never duplicated. Walls are numbered
  clockwise from 1; Windows, Doors and Features name their Wall by position. Naming `otherRoom` on
  a Door updates the existing Door between the two Rooms; a second Door between them needs
  `newDoor`. Parts given with `archive: true` are Archived.
- `save_items` / `find_items` (Agent) and `list_items`, `get_item`, `edit_item` (web) manage Items.
  Identical pieces are one Item with a quantity. An Item with no Room is **Unplaced**. The
  **register** (bought on/from, price paid, warranty, serial number, manual link) is recorded when
  the user mentions it, never asked for. `edit_item` is the Item page's pencil: it writes whatever
  Provenance a value replaces (the user typed it), but leaves name, category, quantity, Room and
  archiving to a Session.
- `set_constraints` adds/removes Constraints in batches and requires a `reason` quoting the user's
  permission for a removal; `save_note`/`search_notes` handle Notes. A Constraint binds every Skill
  as strictly as a Settled Decision; a Note is soft background.

Slugs never change on rename (Rooms, Walls, Levels, Items), so references stay valid.

## Rules enforced by the server

- **Provenance.** Every length (whole millimetres) and color carries Provenance — measured,
  blueprint, listed (Items only: maker's figures), estimated — and a weaker value never replaces a
  stronger one without `overrideProvenance` quoting the user. The rest of the write still saves and
  the receipt lists the refused part with both values; a write with nothing else in it is refused
  whole. Details in [Persistence](../architecture/persistence.md#the-provenance-rule).
- **Archive, never delete.** Removing a Constraint, Room or Item Archives it. A Room still holding
  Items can't be archived (the refusal names them). Doors to an archived Room keep working.
- **Home scoping.** Every write from a Session of another Home is refused and writes nothing, and a
  reference to another Home's records is "not found".

## Gaps

`roomGaps` (`gaps.ts`) lists what advice still needs for a Room, deliberately short because each
Gap appears in the Home Overview and Skills ask only for what's missing. For an indoor Room, in
order: wall lengths (naming unmeasured Walls), ceiling height, Windows or "windowless", facing of
Walls with daylight openings, times of use, and each of the four Surfaces. An outdoor Room is
checked only for times of use and a floor Surface. The `save_room` receipt ends with the Room's
remaining Gaps.

## Daylight

`daylightOpenings` (`daylight.ts`) lists how daylight reaches a Room: Windows (including skylights,
which carry their own facing) then glazed Doors leading outside or onto an outdoor Room. Glazed
Doors between indoor Rooms (borrowed light) are deliberately excluded. Facing and obstruction feed
Color advice and the Gaps check.

## Changes flow onward

Any change to a value a Purchase Requirement's reason points at raises a `value_changed` flag on
that Purchase ([Decisions](decisions.md#flags)). Fulfilling a Room use, Room color or Purchase
Decision changes the Home record itself.

## Tests

- `home-model-rules.test.ts` — the Provenance rule, archiving, Door identity, Home scoping, slug
  stability, Gaps.
- `item-register-rules.test.ts` — the Item register and `edit_item`.
- `operations.test.ts` — `create_home` city lookup, `save_room` Levels and same-name updates.

Related: [Media](media.md) for Photos, Documents and Blueprints.
