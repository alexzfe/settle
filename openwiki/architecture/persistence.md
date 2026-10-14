---
type: architecture
title: "Persistence: SQLite store, migrations and files"
description: How Settle stores everything in one node:sqlite database behind the store.ts seam, applies numbered SQL migrations at open, encodes Measurements with Provenance as column triples, enforces the Provenance rule, and keeps uploaded and rendered files under the data dir.
tags: [persistence, sqlite, migrations, provenance, files, data-dir, tokens]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-4c2ea33ce13a1c6775a614bf
    resource: repo://packages/core/migrations/0014_home_token.sql
  - id: openwiki-source-db34765ae3d656869538c268
    resource: repo://packages/core/src/files.ts
  - id: openwiki-source-51dbe3de0031014e7280057d
    resource: repo://packages/core/src/migrate.test.ts
  - id: openwiki-source-02f3f8c1a537c850b9749a22
    resource: repo://packages/core/src/migrate.ts
  - id: openwiki-source-bd8ec00508c1501556190e16
    resource: repo://packages/core/src/operations/blueprints.ts
  - id: openwiki-source-4798f0419079015afccc7c3e
    resource: repo://packages/core/src/operations/documents.ts
  - id: openwiki-source-ead251d3e4c0a9705092f18c
    resource: repo://packages/core/src/operations/photos.ts
  - id: openwiki-source-8479202a0de6976527a4deb3
    resource: repo://packages/core/src/provenance.ts
  - id: openwiki-source-9ca70db41836db6ae607e8d1
    resource: repo://packages/core/src/store.ts
  - id: openwiki-source-9a57160413f578596c90fa1d
    resource: repo://packages/core/src/token.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Persistence: SQLite store, migrations and files

## One database, one seam

All state lives in one SQLite database opened with Node's built-in `node:sqlite`
(`DatabaseSync`), at `<dataDir>/settle.sqlite` in the server or `:memory:` in tests.
`packages/core/src/store.ts` is **the store seam: every SQL statement core runs is in that file.**
Operations never write SQL; they call typed `Store` methods (`home(slug)`, `rooms(homeId)`,
`insert(table, row)`, `update(table, id, patch)`, `changes(homeId)`, …).

Conventions inside the store:

- Rows use camelCase keys for snake_case columns (`roomAId` ↔ `room_a_id`); `encode`/`decode`
  convert both ways, storing booleans as 0/1 and listed JSON fields as JSON text.
- A **Measurement** (a length with its Provenance) is one row key spread over three columns:
  `<field>_mm`, `<field>_prov`, `<field>_src`. Lengths are always stored in millimetres; the UI and
  Agent show metres and centimetres.
- Prepared statements are cached by SQL text.
- `transaction(fn)` runs `BEGIN IMMEDIATE … COMMIT`, rolling back if `fn` throws. `fn` must be
  synchronous, which is why core's write path does any slow I/O first
  ([Operation registry](operation-registry.md)).

## Migrations

`packages/core/src/migrate.ts` opens the database, turns on WAL and foreign keys, and applies every
file in `packages/core/migrations/` not yet recorded in the `migrations` table — **all pending
files in one transaction**, rolled back (and the database closed) on any failure. Files must be
named `NNNN_snake_case.sql`; a malformed name or two files sharing a number is an error.
`0000_init.sql` creates the `migrations` table itself. The migrations directory is resolved one
level up from both `src/` and `dist/`, so the same code works from sources and from a build (the
Docker image keeps this layout).

Migrations are forward-only data migrations as well as schema changes; for example `0013_settled`
renames every stored "Locked" state to "Settled", and `0014_home_token` gives every existing Home a
unique token. `migrate.test.ts` checks each such data migration against a database at the previous
version.

**Adding a table or column:** add the next-numbered `.sql` file, extend the row types and the
`Store` interface/implementation in `store.ts`, and add a migration test if existing rows must be
transformed.

## The Provenance rule

`packages/core/src/provenance.ts` encodes a rule the server enforces rather than trusting the
Skills to: a value is never replaced by one of weaker Provenance —
`measured > blueprint > listed > estimated` — unless the user says so. `weigh(existing, incoming,
sameValue, override)` returns:

- `set` — no existing value, or the incoming one is at least as strong (and different);
- `unchanged` — equal, or a weaker source repeating the same value (same mm, or same color name,
  brand and code ignoring case);
- `refused` — weaker and different, with no override;
- `overridden` — weaker and different, with the user's override reason (which is logged).

The `Writer` applies this to every length and color it patches (see
[Home model](../domain/home-model.md)).

## Files and the data dir

Core reaches the disk only through the `FileStore` port (`files.ts`; `nodeFileStore` in
production), with paths relative to `dataDir()`:

| Path | Contents |
| --- | --- |
| `uploads/<home>/<blueprint>.<ext>` | Uploaded Blueprint files |
| `rendered/<home>/<blueprint>/page-<n>.png` | Rendered Blueprint pages |
| `uploads/<home>/photos/…` | Room and Item Photos and thumbnails |
| `uploads/<home>/documents/<id>.<ext>` | Item Documents |

A failed upload removes what it wrote. The `PdfRenderer` port isolates mupdf to
`blueprints/mupdf.ts`; mupdf is AGPL, which is why Settle is AGPL-3.0-or-later, and the port is what
would let a permissive renderer replace it. See [Media](../domain/media.md).

## Tokens and slugs

`token.ts` makes 24-character tokens from an alphabet without look-alike characters (no 0/O, 1/l/I),
about 139 bits. They serve as each Home's bearer key for its Agent and each Quick Guide's phone-page
token. Records are addressed by kebab-case slugs from `slug.ts` (accents dropped, max 60 characters).

## Backups

Everything a Home is lives in the data dir: the SQLite file (with its WAL) plus `uploads/` and
`rendered/`. In the container that is one volume ([Self-hosting](../operations/hosting-and-security.md)).
