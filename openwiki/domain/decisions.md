---
type: domain
title: Decisions, Basis, Flags and Fulfilment
description: How Settle models Decisions — kinds, scopes and the four states with their legal transitions — and how the Basis, automatic Design Direction and Palette entries, Flags, Conflicts, Fulfilment and Deviations keep later Decisions consistent with earlier ones.
tags: [decisions, basis, flags, conflicts, fulfilment, deviations, state-machine]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-eeb771e7dc54b031f67447de
    resource: repo://packages/core/src/basis-rules.test.ts
  - id: openwiki-source-4717ba0fddae205d113c43ea
    resource: repo://packages/core/src/operations/decisions.ts
  - id: openwiki-source-579136606efc6884894f6e11
    resource: repo://packages/core/src/operations/schemas.ts
  - id: openwiki-source-fa69e875054013c54edfaaa1
    resource: repo://packages/core/src/operations/value-changes.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Decisions, Basis, Flags and Fulfilment

Decisions are the heart of Settle: each design choice, purchase or piece of work is a Decision, and
later advice builds on the Settled ones. Almost all of this lives in
`packages/core/src/operations/decisions.ts`, with enums and tables in `operations/schemas.ts`. The
guiding principle (comment above `DECISION_KINDS`): **the server enforces every rule it can check
from the data, refusing with an actionable error, and leaves every judgment about what the user
meant to the Skills.**

## Kinds and scopes

A kind says what the platform *does* with a Decision, not what it is about (a fridge and a towel
are both `purchase`).

| Kind | Scope | One Settled at a time | Fulfilment changes |
| --- | --- | --- | --- |
| `design-direction` | Home | per Home | — |
| `palette` | Home | per Home | — |
| `room-direction` | Room | per Room | — |
| `room-use` | Room | per Room | the Room's functions |
| `room-color` | Room | — | a Surface's color and finish |
| `purchase` | either | — | Items/Features added or Archived |
| `other` | either | — | — |

Settling a second Design Direction, Palette, Room Direction or Room use while another is Settled
(and not Fulfilled) is refused; the user must Reopen or Reject the first.

## States and transitions

States: `candidate`, `leaning`, `settled`, `rejected`. A new Decision starts as Candidate.
`LEGAL_TRANSITIONS`:

- candidate → leaning, settled, rejected
- leaning → candidate, settled, rejected
- settled → leaning (a **Reopen**) or rejected
- rejected → candidate (a revival)

Any other move is `illegal_transition`. A Fulfilled Decision stays Settled for good and can only be
"kept". From a Session, `set_decision_state` requires a `reason` (`reason_required`) quoting the
user's permission where relevant; the web may omit it. Moving to the current state is a **keep**,
which clears the Decision's open flags. Every move is logged to the change log and to
`state_changes`.

`save_decision` creates or changes a Decision; it never changes state. A Settled or Rejected
Decision accepts only new Evidence until it is Reopened or revived. Without a `decision` slug, a
save matches an existing non-Rejected, non-Fulfilled Decision of the same kind, scope and title.

## Basis and Evidence

The **Basis** is the Decisions a Decision rests on. Two kinds of entry exist:

- **Given** entries, passed explicitly, plus any Decision a Requirement's reason names.
- **Automatic** entries: the Design Direction in force joins every Basis, and the Palette in force
  joins the Basis of every Decision that uses its colors (a Room color, or a Purchase whose
  Requirement points at it).

Automatic entries are **stored** when a Decision is created or starts using the Palette, and never
move silently (`basis-rules.test.ts`). Computing them from whatever is in force now would rewrite
history: a Room color chosen on Palette A would appear to rest on Palette B. Keeping or Reopening a
Decision flagged by its own automatic entry **re-bases** it on the one now in force.

**Evidence** is a Note, Session or Decision recorded as supporting or undermining a Decision. A Note
alone never changes a Decision's state (a rule the Skills and server instructions repeat).

## Flags

A **Flag** is raised by the platform on a Decision when something it rests on changed. Causes
(`FLAG_CAUSES`):

- `reopened` / `rejected` — a Decision in its Basis was Reopened or Rejected. `cascade` flags every
  active, open Decision whose *stored* Basis contains the changed one; duplicates for the same cause
  and source are not raised twice.
- `deviation` — a Decision in its Basis was Fulfilled with a Deviation from a *must* Requirement.
- `value_changed` — a recorded value a Requirement's reason points at changed
  (`operations/value-changes.ts`). A reason naming a field is flagged only by that field; one naming
  no field by any change to the record. Item register fields (bought on/from, price paid, warranty,
  serial number, manual) don't flag reasons that don't name them, so filling in a warranty date
  doesn't flag every Purchase citing the Item. Reason fields are listed per kind in
  `operations/reasons.ts`.

Flags never change the flagged Decision. The user clears one by keeping, Reopening or Rejecting it
— via `set_decision_state` from the Agent, or `resolve_flag` in the web UI. Reopen and Reject then
flag *their* dependents in turn.

## Conflicts

A **Conflict** is raised by the Agent (`flag_conflict`) when new information contradicts a Settled,
not-yet-Fulfilled Decision; for an open Decision the Agent adds undermining Evidence instead.
Raising it changes nothing else. Only the user resolves it (keep / reopen / reject), through
`set_decision_state` or the web's `resolve_conflict`.

## Fulfilment and Deviations

`record_fulfilment` marks a Settled Decision's action as done. **Fulfilled is not a state**: the
Decision stays Settled with `fulfilledAt` set, drops out of the opening and Room Sheets, and can
never be Reopened. It is refused while the Decision has an open flag or Conflict. It updates the
Home to match what was actually done:

- **Room use** — sets the Room's functions (or the ones the user actually chose).
- **Room color** — paints the named Surface with the color from the Palette **stored in its
  Basis**, Measured when it has brand and code, else Estimated; subject to the Provenance rule
  (stronger existing color → refused unless overridden).
- **Purchase** — records what was bought, any **Deviations** by Requirement position, adds the
  Item (taking the bought Listing's link, price and shop, tagged Listed) or Feature, and Archives
  what it replaces. A Deviation from a *must* flags dependents; from a *prefer*, nothing.

See [Purchasing](purchasing.md) for Requirements and Listings.

## Archive, never delete

Anything referenced — as Evidence, in a Basis, or by a Requirement's reason — is Archived rather
than deleted (`referenced_cannot_delete` otherwise).

## Tests

- `decision-rules.test.ts` — transitions table, Agent vs web state changes, Basis and Evidence, the
  flag cascade, clearing flags, Conflicts, content and scope by kind, Fulfilment, archiving.
- `basis-rules.test.ts` — stored automatic Basis, successive Design Directions and Palettes,
  re-basing.
- `fulfilment-rules.test.ts` — `value_changed` flags, `record_listing`, Purchase Fulfilment.
- `color-rules.test.ts` — Palette and Room color rules.

Related: [Home model](home-model.md), [Sessions and Agent-facing text](sessions-and-agent-text.md).
