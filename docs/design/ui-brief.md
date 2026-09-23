# Settle — UI implementation brief

Exported from Claude Design ("Settle UI v2", which covered the Decisions list, a Decision and
the Inventory, in light and dark). This brief is that export; no separate visual file was kept.
Mark reference: [`brand/HANDOFF.md`](brand/HANDOFF.md), with the SVGs in `brand/mark/` and
`brand/states/`. Token source of truth: `packages/web/src/tokens.css` (amended below).

Claude Design worked without the domain model, so some of this brief misreads the app. The
grilling that follows it corrects those readings; where the two disagree, the grilling wins.

---

## 1. What this app is, for design purposes

An issue tracker for furnishing decisions, plus an inventory of what is already in the home.
Not a design portfolio, not a moodboard. The Agent does the taste; the UI is the **record and
the queue**: what has been decided, what is still open, what is blocking, what we own.

Two consequences that drive everything below:

- **Decisions are the spine.** State (Candidate → Leaning → Settled, plus Rejected) is the most
  important attribute on the screen, so it gets the leftmost column, an icon, and grouping.
- **The UI is style-agnostic.** It must hold a warm Japandi home, a cool Scandi one, and a
  vibrant pop one without the chrome fighting the content. No design-system color may be
  chosen because it flatters the *current* home's palette.

---

## 2. Layout

**Persistent left sidebar, 216px**, `border-right: 1px solid var(--hair)`, sticky full height.
Contains: the brand mark + lowercase `settle` lockup, nav with counts, the state key, and a
theme switch + last-session stamp pinned to the bottom.

Replaces the old top tab bar. Rationale: chrome stays constant, so each page's *content*
carries the identity instead of every page reading as the same serif-title-plus-hairlines
template.

**Main column: `max-width: 1080px`, padding `28px 32px 64px`.** Not 90rem. The old
`--width-page: 90rem` made every page draw 1440px rules under ~800px of content, which reads
as broken rather than spacious. Kill `--width-page`; keep `--width-reading: 40rem` for prose.

**Everything below 1080px must reflow.** This is a fluid web app, not a fixed canvas:

- Table-ish rows are CSS grid with **`minmax(0, Nfr)` tracks**, never fixed px for content
  columns. A fixed track that fits at 1400px produces clipped text at 900px.
- The Decision detail is two columns (`minmax(0,1fr) 296px`) **above 1000px only**; below that
  it stacks, rail after content, sticky off. Never let the secondary rail equal the width of
  the primary content — that inverts the hierarchy the two-column layout exists to create.
- **Long text wraps; it does not ellipsise.** Decision titles, room names, item names and
  material strings use two-line clamp, not `white-space: nowrap; text-overflow: ellipsis`.
  A decision called "Warm lamps for the living room and bedroom" must read in full. Rows
  therefore use `align-items: start`.

---

## 3. The state spine — the one thing to get exactly right

The Settle mark *is* the status icon. One circle, `r=9` on a 24×24 grid; **fill level is the
only variable**. Use the `SettleIcon` component in `brand/HANDOFF.md` verbatim.

| State | Level | Chord | Colour |
|---|---|---|---|
| Candidate | 01 low | `M4.39 16.8A9 9 0 0 0 19.61 16.8Z` | `--color-ink` |
| Leaning | 02 half | `M3 12A9 9 0 0 0 21 12Z` | `--color-ink` |
| Settled | 03 full | solid disc | `--color-accent` |
| Rejected | drained ring | none | `--color-stone`, title struck through |

Rules, non-negotiable:

- **Ink = in progress, accent = terminal.** Only Settled is drawn in the accent.
- **The logo's own waterline (y=15.4) is never a status.** Chrome only — sidebar lockup,
  favicon, splash.
- **One form, one size, one position.** 17px, leading every row, in group headers, in the
  sidebar key, and as the state changer on the detail page. The current implementation's
  three different treatments for one concept (table column / left flag / lone pill) is the
  single biggest legibility loss in the old UI.
- Don't add a fifth shape. If a state is ever added, add a chord between existing levels
  (`halfWidth = sqrt(81 − (y − 12)²)`), keeping clear of 15.4.

**State change is a ladder, not two buttons.** The detail rail lists all four states with the
current one highlighted; clicking one moves the Decision there. "Reopen" / "Reject" buttons
with explanatory paragraphs underneath don't show where the Decision *is* in its life.

---

## 4. Decisions list

- **Grouped by state by default** (Leaning → Candidate → Settled → Rejected), with
  `by room` / `by kind` as regrouping pills. Each group header carries the mark at its level,
  the count, and a one-line gloss of what the state *means* ("half full — the Agent has a
  recommendation, waiting on you").
- Columns: `22px | minmax(0,2.2fr) title | minmax(0,0.9fr) kind | minmax(0,1.1fr) room | 68px open-since`.
  When grouped by room, the fourth column shows State instead.
- **Blockers are a second line under the title**, 11px, in `--color-attention` with a 4px dot:
  `needs a measurement`, `parked`, `4 listings`. On one line they compete with the title and
  both get truncated; the blocker copy is the whole point of the flag, so it must read in full.
- **One link per row.** The title. The room is plain `--color-ink-muted` text; the whole row
  is the click target. The old Items table put a link in every cell of every row, which is a
  wall of underlines and therefore no signal at all.

## 5. Notifications

**Flags, not states.** A Decision being Leaning is the system working correctly, not an
interruption — never notify on it. A Flag is *something this Decision needs that isn't
recorded* (a measurement, a constraint), and the count can reach zero.

Strip above the page title, `--color-attention-bg` ground with `--color-attention-edge` bottom
border, laid out as `grid-template-columns: minmax(0,1fr) auto` so the action keeps its own
track and stays on line one at any width. Copy names the blocked items and the missing thing:

> **2 Flags** Kitchen bin for now, Main bedroom bed frame can't move until a measurement is recorded. — *Clear them*

Attention gets **position**, never just tint: a 11px ochre pill is softer than the neutral
hairlines and disappears. And never give the null state the loudest block on the page
("Nothing needs you right now" as a full-width card was the old home page's most prominent
element).

## 6. Inventory

The inventory is a first-class object, not a leftover table.

- **Real filled swatches, 18px, `border-radius: 3px`, `1px solid var(--color-edge)`.** Never
  dashed empty placeholders. A dashed box where a colour should be is missing content dressed
  as design; if a colour is genuinely unrecorded, show a `--color-stone` edge with no fill and
  count it in the gaps stat.
- Grouped by room, with an `Unplaced` group carrying a `needs a room` flag.
- Dimensions right-aligned, `font-variant-numeric: tabular-nums`, `W × D × H` in metres.
- Header stats are **actionable counts**, including `Dimensions missing` — gaps become a number
  you can drive to zero, which is exactly the kind of thing the Agent can then chase.

---

## 7. Colour

Keep the existing warm neutrals — ground, card, ink, ink-muted, hairline. They are good and
they let the user's own colours carry the colour. Changes:

**Accent: olive `#5e6b4e` light / `#a3b18a` dark.** Confirmed. It does **one** job: the
terminal state (Settled) and the current nav item. It is *not* the link colour, not every
primary button, not the focus ring alone. When olive means five unrelated things, every
underlined link looks faintly Settled-coloured and Settled stops feeling settled.

**Dark mode is supported and first-class.** Both themes come from one token object — one
layout, one set of rules, dark accent derived from light, never a separately hand-tuned skin.

**`--color-edge` goes from 12% → 22% opacity and flips with the theme.** This is the token
that decides whether the app can host any style: a near-white item on paper and a near-black
one on ink both have to stay visible as objects.

**Add** `--color-hairline-soft` (light `#efebe4`, dark `#302c27`) for row dividers, so
in-table rules are lighter than section rules.

**Retire** `--color-glass` and `--color-banner-neutral` — they existed to tint wall diagrams
and room banners, both of which this direction drops.

**`--color-stone` is edges only, never text.** It measures 2.6:1 on card. Any value a user
reads uses `--color-ink-muted` (5.2:1) — that includes table column headers, group counts,
nav counts and "open since" values.

## 8. Type

Keep Newsreader + Inter. Restrict the serif:

- **Serif**: page titles, section headings, group headings, stat numbers, and the Agent's
  prose (the Agent's summary is the one place with a genuine reading measure — cap it at
  ~34em and set it at 17px).
- **Sans**: everything functional — rows, labels, values, buttons, nav.
- Small caps labels are 10.5px, `letter-spacing: 0.09em`, uppercase, `--color-ink-muted`.
- Serif on 20px utility labels ("Walls", "Lights", "Items") reads as a template default, not
  as editorial. Section headings only.

## 9. Things to remove

- The permanent `System / Light / Dark` segmented control in the header — one user, one
  laptop; it belongs in the sidebar footer or settings.
- The `• Live` indicator — a status light the user can't act on.
- The duplicate search (header icon **and** a full-width page field on Overview).
- The ghost pencil button floating in the corner of an otherwise empty Item page.
- Dashed placeholder rectangles standing in for wall and surface diagrams. Five identical
  dashed boxes with a measurement under each communicate less than the measurements alone.
- Italic `estimate` after nearly every value — used that often it stops being read. Mark
  estimates once per block, or with a single glyph.

## 10. Open, not yet decided

- **Rejected's icon.** Currently the empty ring in stone plus a struck title ("the water
  drained"). Alternative is a solid disc in stone. Pick one and lock it in the handoff.
- **Room page.** Not redesigned yet. It's the richest object in the app and currently reads
  at the same weight as the Items table; the wall diagrams in particular need to become
  either real drawings or plain measurements.
- **Overview.** Should become a queue (Flags, then what moved, then what's next), not a
  scrollable summary of everything.
