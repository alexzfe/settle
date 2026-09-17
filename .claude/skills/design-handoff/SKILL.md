---
name: design-handoff
description: Write this repo's handoff doc once a design grilling has settled, and the per-track briefs that follow it. Use when a grilling or design discussion reaches a shared understanding, when asked to write up decisions for a later session, or when splitting settled work into parallel agent tracks.
---

# Design handoff

This repo's design work runs as **grilling → handoff doc → per-track briefs → slices**, and every step
after the first is done by a *fresh* session that never saw the conversation. These documents are the
only thing that crosses that gap. Write them as though the reader has no memory of the discussion,
because they do not.

Two worked examples, which are the real specification — read one before writing:

- [`docs/handoff/quick-guide-rework.md`](../../../docs/handoff/quick-guide-rework.md) and its briefs in
  `docs/handoff/quick-guide-rework/`
- [`docs/handoff/listing-board.md`](../../../docs/handoff/listing-board.md)

## The handoff doc

One file, `docs/handoff/<topic>.md`. Sections, in order:

1. **Status** — the date, that it was settled with the user in a grilling, the HEAD commit, and the
   branch. Say plainly if it is not to be built yet, and what it waits on.
2. **Why** — what prompted it, in the user's own words where they said something quotable, plus the
   facts found while exploring that shaped the outcome. Name files and line numbers.
3. **The decisions** — a table, grouped under subheadings when there are more than about eight rows.
   Three columns: the question number, what was settled, and **why**.
4. **Vocabulary** — any `CONTEXT.md` terms the work adds or changes, drafted in that file's format
   (term, one or two sentences, `_Avoid_:` line). Flag collisions with existing terms explicitly.
5. **Corrections** — anything the session found that is false in the docs today.
6. **Deferred** — what was raised and pushed out, with enough reasoning that it need not be re-derived.
7. **Open** — what is genuinely unsettled, and what only a human can do.

**The Why column is the point.** A decision recorded without its reasoning gets re-litigated the moment
it is inconvenient, and worse, gets "simplified" away by someone who cannot see what it was protecting.
Where a decision exists to prevent a specific failure, name that failure.

Record decisions in the user's terms, not a tidied-up version. Where they overruled a recommendation,
write what they chose and why — not the recommendation.

## Per-track briefs

When the work splits across parallel agents, one brief per track in `docs/handoff/<topic>/<track>.md`.
Each one:

- Points at the handoff doc first, then names **the files that track owns**. Tracks must not overlap.
- Says what to build as a numbered list, with the reasoning inlined where a step would otherwise look
  arbitrary.
- Carries a **Do not** section. This is where most of the value is: it is how a fresh agent avoids
  redoing a decision the grilling already settled.
- Ends with **Check** — the exact commands that must pass, and `Never commit.`
- Says what to report back.

Phase the briefs when one track's output is another's input: the blocking track runs alone, reports,
and the rest start from its report.

## Orchestration

Running the tracks is Herdr's job, and the procedure that works is written down in
[`docs/handoff/slice-6.md`](../../../docs/handoff/slice-6.md) under "How to run the agents with Herdr" —
follow it rather than improvising. The user wants sub-agents on Opus (`--permission-mode auto --model
opus`), one prompt per Bash command, and waits armed in the background.

## Done when

- Every decision the grilling reached is in the table, each with its why.
- A fresh agent could build the work from these files alone, without the transcript.
- Nothing in the doc describes code that does not exist — mark anything unbuilt as unbuilt.
- Nothing is committed unless the user asked.
