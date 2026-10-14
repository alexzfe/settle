---
type: domain
title: Blueprints, Photos, Documents and Listing pictures
description: How Settle accepts, validates, stores and serves files — Blueprints rendered with mupdf, Room and Item Photos prepared in the browser, Item Documents, and Listing pictures fetched from shops — and how the Agent sees them through view_images and view_photos.
tags: [media, blueprints, photos, documents, images, mupdf, uploads]
verified:
  - by: openwiki/0.7.2
    at: 2026-10-14T08:07:45.932Z
sources:
  - id: openwiki-source-98ce12ed51104d2daaf17a39
    resource: repo://packages/core/src/images.ts
  - id: openwiki-source-bd8ec00508c1501556190e16
    resource: repo://packages/core/src/operations/blueprints.ts
  - id: openwiki-source-4798f0419079015afccc7c3e
    resource: repo://packages/core/src/operations/documents.ts
  - id: openwiki-source-ead251d3e4c0a9705092f18c
    resource: repo://packages/core/src/operations/photos.ts
  - id: openwiki-source-f5094f9bdcb2c5751491e1ee
    resource: repo://packages/core/src/operations/purchases.ts
  - id: openwiki-source-579136606efc6884894f6e11
    resource: repo://packages/core/src/operations/schemas.ts
  - id: openwiki-source-025ac13d5542b75363993f74
    resource: repo://packages/server/src/api.ts
  - id: openwiki-source-0e5a45ba721f12cfea86c132
    resource: repo://packages/web/src/photoPrep.ts
generated: { by: "claude-code", at: "2026-10-14T08:07:45.932Z" }
---

# Blueprints, Photos, Documents and Listing pictures

Four kinds of file enter Settle. They share a few principles:

- **Files are validated by their own bytes, never by name or extension** (`sniffImageType`,
  `isPdf`, `isHeif` in `packages/core/src/images.ts`). HEIC is recognised and refused by name with
  advice to export a JPEG.
- **Uploads are web-only.** The Agent can see that Photos and Documents exist (ids, captions,
  kinds, names) but cannot add, change or delete them; the camera and the inbox are in the user's
  hand.
- Files live under the data dir via the `FileStore` port
  ([Persistence](../architecture/persistence.md#files-and-the-data-dir)); a failed upload removes
  what it wrote.
- The server's multipart routes in `packages/server/src/api.ts` turn forms into core input and
  serve bytes back; versioned URLs get `private, max-age=31536000, immutable`, unversioned ones
  `no-cache` (`imageVersion` is a sha256 prefix of the bytes).

## Blueprints

`upload_blueprint` (web, `operations/blueprints.ts`) accepts a PDF, PNG or JPEG. The `PdfRenderer`
port (mupdf in `blueprints/mupdf.ts`) opens it; every page is rendered to a PNG 2000 px on its long
edge (`PAGE_LONG_EDGE`) under `rendered/<home>/<blueprint>/page-<n>.png`, and its text layer
(lines with positions) is stored with its size. The original is kept under `uploads/<home>/`. A
file with no renderable pages is `no_pages`; any other type is `unsupported_file`. Rendering
happens *before* the write transaction; if anything fails, both folders are removed. Pages can be
mapped to a Level.

The Agent reads plans with `view_images`: at most 6 pages per call (`MAX_PAGES_PER_VIEW`), returned
as a text block naming each page followed by one image block each. A `crop` re-renders one quarter
of a page at twice the scale for small print. Its description carries the Provenance rule for
plans: only text *printed* on the plan is Blueprint Provenance (recorded with `source { blueprint,
page, printed }`); a length scaled off the drawing is Estimated.

## Photos

A Photo is of one Room (optionally naming a Wall) or one Item (`operations/photos.ts`), with a
taken-on date and optional caption. **Core has no image library for Photos.** The browser
(`packages/web/src/photoPrep.ts`) redraws each picture upright at 1600 px as a JPEG plus a 320 px
thumbnail, keeps only the EXIF date (redrawing drops metadata such as GPS), and applies any crop
first. Core validates both blobs (≤ 2 MB each, JPEG/PNG/WebP) and stores them under
`uploads/<home>/photos/`. A taken-on date later than tomorrow is refused.

The Agent sees Photos listed on the Room Sheet and in `find_items`, and looks at them with
`view_photos` (at most 4 per call) **only when the user asks or agrees**, since each image stays in
context for every later turn. The Session protocol and Skills repeat this rule; see
[Skills and plugin](../agent/skills-and-plugin.md).

## Documents

A Document belongs to one Item (`operations/documents.ts`): a receipt, warranty, manual or other
paper, as a PDF or image, with a kind and optional name. Core stores it as it came under
`uploads/<home>/documents/<id>.<ext>`; the browser shrinks images first (2400 px, finer quality,
no thumbnail). The cap is 50 MB (`MAX_DOCUMENT_BYTES`); the server answers 413 from the
`content-length` header before reading a larger form, because the whole form is held in memory.
**The Agent knows a Document exists, with its kind and name, but never reads it.**

## Listing pictures

A Listing's picture is the one outbound network call core makes (`images.ts`). When the Agent
calls `record_listing` with an image URL, core fetches it itself — rather than passing base64
through the Agent's context — with an honest `Settle/1.0` User-Agent, an 8 s timeout, and a 2 MB
cap enforced while streaming. It accepts the result only if status is 200, the content-type is
`image/*`, and the magic number is JPEG/PNG/WebP (bot walls arrive as HTML behind a 200). The
fetch is **best-effort**: a failure never fails `record_listing`, which keeps the link instead.
Only http(s) URLs are fetched, and the fetch happens before the write transaction.

From the web, `set_listing_photo` takes pasted bytes or a URL with the same validation, but reports
failures since the user is waiting. The stored copy is kept apart from the link it came from.
`ImageFetcher` is a port, so tests inject a fake and never reach the network.

## Tests

`blueprints.test.ts` and `blueprints/mupdf.test.ts` (fixture PDFs in `packages/core/fixture/`),
`photo-rules.test.ts`, `document-rules.test.ts`, `images.test.ts`, and on the web side
`photoPrep.test.ts`.

Related: [Purchasing](purchasing.md), [HTTP server](../server/http-and-mcp.md).
