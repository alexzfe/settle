---
name: design-handoff
description: Write this repo's handoff doc once a design grilling has settled, and the per-track briefs that follow it. Use when a grilling or design discussion reaches a shared understanding, when asked to write up decisions for a later session, or when splitting settled work into parallel agent tracks.
---

# Design handoff

This repo's design work runs as **grilling → handoff doc → per-track briefs → slices**, and every step
after the first is done by a *fresh* session that never saw the conversation. These documents are the
only thing that crosses that gap. Write them as though the reader has no memory of the discussion,
because they do not.

**These documents live in a separate private repo, `settle-docs`, cloned at
`~/Projects/settle-docs`.** They left this repo when it was made public on 2026-09-27: they record
the author's own home and server, which a public repo must not. Every path below is relative to
that checkout, not to this one. If it is not there, clone `git@github.com:alexzfe/settle-docs.git`
first — never write a handoff into this repo.

Two worked examples, which are the real specification — read one before writing:

- `~/Projects/settle-docs/handoff/quick-guide-rework.md` and its briefs in
  `~/Projects/settle-docs/handoff/quick-guide-rework/`
- `~/Projects/settle-docs/handoff/quick-guide-split.md` and its briefs in
  `~/Projects/settle-docs/handoff/quick-guide-split/`

## The handoff doc

One file, `~/Projects/settle-docs/handoff/<topic>.md`. Sections, in order:

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

When the work splits across parallel agents, one brief per track in `~/Projects/settle-docs/handoff/<topic>/<track>.md`.
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
`~/Projects/settle-docs/running-agents.md` — follow it rather than improvising, and do
not restate it in the handoff. The user wants sub-agents on Opus (`--permission-mode auto --model
opus`), one prompt per Bash command, and waits armed in the background.

## Closing a handoff out

Do this as part of the wave that finishes the work, not later. Docs bloat here comes from waves that
built the thing and left their scaffolding behind: by 2026-09-23 the per-track briefs and completion
reports were 63% of the handoff folder, all of it describing work already on `main`.

- **Rewrite the Status line** to say **done and live**, with the date and the commit or tag. A shipped
  handoff that still opens "Status: settled" reads as unbuilt to anyone skimming.
- **Delete the per-track briefs and any completion reports** once the wave has merged and its checks
  pass. Their whole job was to brief one fresh agent; git keeps them. Delete the handoff's own
  orchestration and "Done when" sections with them, and remove the links.
- **Keep Why, The decisions, Vocabulary, Corrections, Deferred and Open.** That is the design memory
  and the only register of parked work — never delete a handoff outright because the build shipped.
- **Commit and push `settle-docs`.** It is a separate repo, so a handoff written there is not
  covered by this repo's commit and is one `rm -rf` from being lost until it is pushed.

## Done when

- Every decision the grilling reached is in the table, each with its why.
- A fresh agent could build the work from these files alone, without the transcript.
- Nothing in the doc describes code that does not exist — mark anything unbuilt as unbuilt.
- Nothing in this repo is committed unless the user asked. `settle-docs` is pushed, per above.
