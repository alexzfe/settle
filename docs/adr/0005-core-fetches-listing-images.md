# Core may fetch a remote image

Storing a Listing's product photo means its bytes have to come from somewhere, and `packages/core` had
never made an outbound HTTP call: it binds loopback, and the platform makes no model calls ([ADR
0001](0001-ai-runs-in-users-own-agent.md)). Fetching a retailer's image is therefore a genuine first,
recorded here so it reads as deliberate rather than as drift.

**The platform fetches the image itself** when a Listing is recorded, validates it, and stores the bytes
under the data dir beside Blueprint uploads.
[Spike 5](../research/spikes/5-listing-image-fetch.md) measured this at 8 of 8 on Amazon and Falabella
Peru — the user's own shop — with no request headers at all.

## Considered options

- **The Agent downloads the bytes and passes them** through `record_listing`. Rejected: base64 in an MCP
  argument spends the Agent's context on binary, once per Listing.
- **The user uploads every photo by hand.** Rejected as the only path — it puts a chore back on the user
  for each option, which is the chore the board exists to remove. Kept as an *additional* path, since
  retailer photos are often the worst image of the product.
- **Hotlink the URL and store nothing.** Rejected as the plan, kept as the fallback: the picture dies
  with the listing, but it costs nothing and is exactly today's behaviour.

## Consequences

- The fetch is best-effort and **must never fail the `record_listing` call**. It degrades to storing the
  source URL alone.
- Bytes are validated before storing — status, `content-type`, magic number, size cap of about 2 MB —
  and the image type is taken from the bytes, never from the URL's extension: Falabella's image URLs
  have no extension, and one path serves JPEG on one host and WebP on another.
- `listings.photo_path` finally holds a path; the source link moves to its own `photo_url`.
- If a retailer starts challenging server-side requests, the escape is the hotlink fallback and the
  paste box — not a browser inside the app.
