# Spike 5: fetching a Listing's product image from a plain Node process

**Date:** 2026-09-17. **Status:** done. **Answers:** whether the platform can fetch a Listing's photo itself, which would be the first outbound HTTP call `packages/core` ever makes — the pending question in the [Listing board handoff](../../handoff/listing-board.md#the-spike) ([build plan, slice 6](../../build-plan.md#slice-6-purchase-to-the-finish-line), `listings.photo_path`).

**Verdict: yes — 8 of 8 URLs returned usable image bytes at attempt level (a), with no request headers at all.** The 6-of-8 bar is met without even the browser `User-Agent` the criterion allowed. Nothing needed a `Referer`, a cookie, or a browser.

**Setup.**

- Node 26.8.1, global `fetch`, no dependencies. Redirects followed by hand (`redirect: "manual"`) so the chain is visible.
- Run from the user's own machine and network. Amazon served from the Fastly Lima POP (`x-served-by: cache-lim-…`), Falabella from Cloudflare `cf-ray … -EZE`.
- Three attempt levels per URL, stopping at the first that works:
  - **(a)** `fetch(url)`, no headers (Node still sends its own `accept: */*` and `accept-encoding`).
  - **(b)** only `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36`.
  - **(c)** that `User-Agent` plus `Referer: <the product page>`.
- "Usable" means all three of: status 200, a `content-type` of `image/*`, and a real image magic number in the first bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`). Bytes were then re-checked out of band with `file` and ImageMagick `identify`; all eight decode.
- 8 real products, home and furniture, found by fetching search and product pages (see *Finding the URLs*): a sofa, a rug, curtains, and a lamp from each retailer.
- Throwaway files, not kept: `…/scratchpad/spike5/` (`urls.json`, `measure.mjs`, the probe scripts, the 8 downloaded images, `out/results.json`).
- No repo code was touched. This file is the only change.

## What the code does today

For grounding, since the spike changes what this field should hold:

- `record_listing` takes an optional `photo` string and writes it straight into `listings.photo_path`
  (`packages/core/src/operations/purchases.ts:251,260`). Nothing fetches, validates, or copies anything.
- So `photo_path` today holds whatever string it was handed — in practice a remote URL, which is the
  opposite of its name.
- The Purchase Skill's record step never mentions the `photo` argument at all
  (`plugin/skills/purchase/SKILL.md:120` lists `name`, `url`, `price`, `dimensions`, `checks`), so real
  Listings are unlikely to carry a picture even as a link.
- `packages/core/src` contains no `fetch`, `undici`, `axios`, or `node:http` client call. An image fetch
  really would be the first one.

## Finding the URLs

Not the measurement, but the brief asked whether a product page can be fetched at all, since that is how
the Agent would read a Listing. **Every page fetch in this spike returned 200 with real HTML, bare or with
a `User-Agent`, and no captcha or consent page appeared.**

- **Falabella:** `https://www.falabella.com.pe/falabella-pe/search?Ntt=<term>` (redirects to a category
  URL), then the JSON-LD `ItemList` in the HTML, which pairs each product's `name`, `url`, and `image`.
  The 4 products then had their own pages fetched for `og:image`. 0.9–1.2 MB of HTML, 130 ms warm.
- **Amazon:** `https://www.amazon.com/s?k=<term>` for candidate ASINs, then `https://www.amazon.com/dp/<ASIN>`
  and the `"hiRes"` URL out of the ImageBlock payload, because there is no `og:image`. 1.7–3.4 MB of HTML,
  1.9–2.7 s.

The 8 URLs measured, for anyone rerunning this:

```
https://m.media-amazon.com/images/I/91LQGinzKJL._AC_SL1500_.jpg      amazon.com/dp/B0F83QT8LZ
https://m.media-amazon.com/images/I/91cVoOcK-IL._AC_SL1500_.jpg      amazon.com/dp/B08CS2GMBD
https://m.media-amazon.com/images/I/71C5b3yaONL._AC_SL1500_.jpg      amazon.com/dp/B0CP39VYV5
https://m.media-amazon.com/images/I/71zreHoOzVL._AC_SL1500_.jpg      amazon.com/dp/B0BZXNSW5K
https://media.falabella.com.pe/falabellaPE/154911005_01/public       .../product/154908718/sofa-triple-kira-vintage
https://media.falabella.com.pe/sodimacPE/3503771_02/public           .../product/113311331/cortina-de-tela-camil-140x220cm-natural
https://media.falabella.com.pe/falabellaPE/144528454_01/public       .../product/144528453/Lampara-de-Pie-Silver-Led
https://media.falabella.com.pe/sodimacPE/3517594_402/public          .../product/113315417/alfombra-rectangular-beige-indy-border
```

## Results

One row per URL, at the attempt level that first succeeded.

| # | Product | Image host | Passed at | Status | Hops | `content-type` | Size | Pixels |
|---|---|---|---|---|---|---|---|---|
| A1 | Amazon, 4-seater fabric sofa | `m.media-amazon.com` | **(a) no headers** | 200 | 1 | `image/jpeg` | **397 KB** | 1500×1500 |
| A2 | Amazon, 5×7 floor mat / rug | `m.media-amazon.com` | **(a) no headers** | 200 | 1 | `image/jpeg` | 305 KB | 1267×1500 |
| A3 | Amazon, blackout curtains | `m.media-amazon.com` | **(a) no headers** | 200 | 1 | `image/jpeg` | 130 KB | 1500×1500 |
| A4 | Amazon, bedside table lamp | `m.media-amazon.com` | **(a) no headers** | 200 | 1 | `image/jpeg` | 145 KB | 1500×1500 |
| F1 | Falabella, Sofá triple Kira Vintage | `media.falabella.com.pe` | **(a) no headers** | 200 | 1 | `image/jpeg` | 68 KB | 768×768 |
| F2 | Falabella, Cortina de Tela Camil 140×220 | `media.falabella.com.pe` | **(a) no headers** | 200 | 1 | `image/jpeg` | 66 KB | 768×768 |
| F3 | Falabella, Lámpara de Pie Silver Led | `media.falabella.com.pe` | **(a) no headers** | 200 | 1 | `image/jpeg` | 13 KB | 768×768 |
| F4 | Falabella, Alfombra Indy Border 160×230 | `media.falabella.com.pe` | **(a) no headers** | 200 | 1 | `image/jpeg` | 128 KB | 768×768 |

- **Hops = 1 on every URL:** no redirect anywhere, so nothing was rewritten to a login, a consent wall, or a captcha.
- **No HTML behind a 200.** Every response was a real JPEG. The magic-number check never fired on HTML.
- A second pass ran **all three levels on all 8 URLs** instead of stopping early: **24 of 24 attempts returned 200**, and the body was **byte-identical at (a), (b), and (c)** for every URL. So a `User-Agent` neither helps nor hurts on these hosts, and a `Referer` changes nothing.
- Timings, cold cache: 76–696 ms per image (median about 110 ms). Warm: 8–115 ms. All 8 images, sequentially, in about 1.5 s.
- **Sizes, which the deferred re-encode decision wanted:** 13 KB to **397 KB**, total 1.3 MB for 8. The largest is A1 at 397 KB / 1500×1500. Both retailers resize on demand, so the size is a property of the URL variant, not of the product — see *Image sizes are a choice, not a given*.

## Amazon

- `m.media-amazon.com` behaves like a plain public CDN: Fastly, `cache-control: max-age=630720000, public` (20 years), `access-control-allow-origin: *`, no cookies, no auth, no signature or expiry in the URL.
- `access-control-allow-origin: *` means the **fallback of hotlinking in an `<img>` also works**, including a browser `fetch` from the web UI. Both options are open.
- A bogus image id returns a clean **`404 text/plain` "Not Found"**, 9 bytes. Never HTML with a 200.
- `HEAD` works and returns `content-length`, so size can be checked before downloading.
- **The risk on Amazon is not the CDN, it is the product page.** Amazon `/dp/<ASIN>` pages fetched fine here — 200, 1.7–3.4 MB of real HTML, 1.9–2.7 s, bare and with a `User-Agent`, no captcha text — but they carry **no `og:image` at all**. Getting the main photo means reading Amazon's own markup: `"hiRes"` in the ImageBlock JSON payload, or `data-a-dynamic-image` on `#landingImage`. That is scraping, and it will break on a page-template change without warning.
- Search result pages hand out **160×134 thumbnails** (`…_AC_SR160,134_CB…_QL70_.jpg`, about 12 KB). A URL captured from a search listing is not a usable product photo. The URL the Agent picks matters more than whether the fetch succeeds.

## Falabella — the one that matters

This is where the user actually shops, and it is the easier of the two.

- Product images are on **`media.falabella.com.pe`**, behind Cloudflare, served by **imagor** (an image-transform server; the `x-imagor-cache-key` response header names the transform applied).
- **Two hosts serve the same paths.** The search JSON-LD gives `media.falabella.com.pe/…`; the product page's `og:image` gives `media.falabella.com/…` (no `.pe`). Both return 200 for the same path.
- Paths have **no file extension and no token**: `https://media.falabella.com.pe/falabellaPE/154911005_01/public`. `/public` is a named transform — the cache key shows it as `1366x768-jpeg-80-fit-in`, so the long edge is capped at 768 and quality is 80. `cache-control` is 7 days, `etag` present, no expiry or signature.
- Both `falabellaPE/…` and `sodimacPE/…` prefixes appear in Falabella Peru results (Sodimac shares the media host). Both fetched identically.
- A bogus id **or a bogus transform name** returns `404` with `{"message":"not found","status":404}` in `text/plain`. Honest, and easy to detect.
- **A `__cf_bm` cookie is set** on every image response (Cloudflare bot management), but is never *required*: level (a) works without it, repeatedly.
- **Watch out: the format varies by host, and `Accept` is ignored.** `sodimacPE/3503771_02/public` returned `image/jpeg`, 66 KB, from `media.falabella.com.pe` and `image/webp`, 31 KB, from `media.falabella.com` — five requests each, consistent per host, and unchanged by sending `Accept: image/jpeg`. The format is baked into whichever imagor cache entry the edge holds. **Sniff the magic number; never infer the type from the URL** (there is no extension) **or assume JPEG.**
- Falabella's **listing pages are readable without a browser**, which is how the Agent would read a Listing: `https://www.falabella.com.pe/falabella-pe/search?Ntt=<term>` returns 200 (redirecting to a category URL) with JSON-LD `ItemList` entries carrying `"name"`, `"url"`, and `"image"` — product name, page URL, and image URL in one fetch, no headers needed. Product pages likewise return 200 with a usable `og:image`.
  - **Extraction came back empty once, on a 200, and would not reproduce.** Two search terms (`alfombra`, `mesa de comedor`) yielded zero products on their first attempt while the others yielded 56 each. Re-requested 8 times apiece afterwards, and again from cold processes, both returned 55–56 products every time, so the cause was not found. Take it only as this: **a 200 with real HTML does not guarantee the products are in it**, and "no products found" must be distinguished from "nothing parsed", or a Listing search silently returns nothing.
  - `og:image` on a product page is the page's own default variant, not necessarily the one the search listing showed: F1 gave `154908719_01` from the page and `154911005_01` from the search. Both resolve to the same product, different photo.

## Image sizes are a choice, not a given

Relevant to the deferred thumbnail decision: the pixel size comes from the URL variant, and both retailers will resize on demand.

| Variant | Result |
|---|---|
| Amazon `…._AC_SL1500_.jpg` (the page's hiRes) | 130–397 KB, long edge 1500 |
| Amazon, no suffix at all (the original) | 131–**624 KB**, 1500×1500 to 2000×2368 |
| Amazon `…._AC_SX679_.jpg` | 32–101 KB, long edge 679 |
| Amazon `…._AC_SR160,134_…` (search thumbnails) | about 12 KB, 160×134 |
| Falabella `/public` | 13–128 KB, long edge 768 |
| Falabella `/w=1500,h=1500,fit=pad` | 33–**400 KB**, 1500×1500 |
| Falabella `/original` | **404** — not a valid transform name |

So dimensions are **predictable, not wild**, as long as the app picks the variant rather than storing whatever URL it was handed. The worst case measured across every variant tried is **624 KB** (an Amazon original at 2000×2368).

## What would bite in production

- **No rate limiting observed, at this volume.** 40 requests to each host, in 4 unthrottled waves of 10: **40 of 40 were 200** on both, in 494 ms (Amazon) and 953 ms (Falabella), median 114 / 212 ms, no `Retry-After` and no 429. A Listing photo is one request per Listing, so real use is far below this. It is not proof that a bulk backfill would pass.
- **Cloudflare sits in front of Falabella.** Nothing challenged here, but a bot-management challenge would arrive as HTML with a 403 or 503, not as a network error. Validating bytes rather than just the status is what keeps that from being stored as a photo.
- **Egress was the user's own network.** Both CDNs served from a nearby POP. A datacenter IP may be judged differently. The plan is a server on the user's tailnet, which keeps the same egress, so this only matters if the app moves off it.
- **No expiring tokens or signatures on either host**, so a stored URL stays fetchable. But Amazon's size suffix is not part of the image's identity: a stored `…_AC_SR160,134_…` URL is a permanent 12 KB thumbnail, not a broken link, and nothing about the response says so.
- **HTML behind a 200 never happened here**, but it is exactly what a future bot wall looks like, and the magic-number check is one line.
- **The Amazon product page is the brittle part**, not the fetch: no `og:image`, so the photo URL only comes out of Amazon's internal markup.
- **A page fetch can succeed and still yield nothing.** It happened twice on Falabella searches and never reproduced (above). Whatever reads a listing page needs an explicit "parsed nothing" path, distinct from an error and from a genuine no-results.

## Recommendation

- **Let the platform fetch the image.** It works with no headers, in about 110 ms, with no redirects, on both retailers, and it is the only way `photo_path` holds something that survives the URL changing. Send a browser `User-Agent` anyway: it cost nothing measurable and is the polite default.
- **Validate before storing**, in this order: status 200 → `content-type` starts with `image/` → magic number is JPEG, PNG, or WebP → size within a cap. Store the sniffed type; ignore the URL's extension, because Falabella's URLs have none and the same path serves both JPEG and WebP.
- **Cap the download** at about 2 MB and set a short timeout. Nothing here came near 624 KB, so a cap that size only ever catches something unexpected.
- **Do not re-encode thumbnails yet.** The largest real photo was 397 KB and the whole set of 8 was 1.3 MB. At 768–1500 px these are already display-ready. Revisit if a Home accumulates hundreds of Listings.
- **Prefer the retailer's own resize** over re-encoding: Falabella `/w=1200,h=1200,fit=pad`, Amazon `._AC_SL1200_.jpg`. Both are one URL edit, no image library in `packages/core`.
- **Keep the fallback anyway**, for the retailer this spike did not test and for the paste case: hotlinking the URL in an `<img>` works too (Amazon sends `access-control-allow-origin: *`), and a paste-image box covers a Listing the Agent cannot fetch. The fetch should degrade to storing the URL alone, never fail the `record_listing` call.
- **Separate the source URL from the stored copy.** The fetch only means anything if `photo_path` holds a
  path; today it holds the URL it was given. Keep both, and have the Purchase Skill actually pass the
  image URL — it does not mention the argument today.
- **Treat reading the product *page* as the real risk in slice 6's Purchase flow.** Falabella is fine — JSON-LD, no headers, `og:image`. Amazon needs markup scraping and has no `og:image`, so the Agent should be able to take a photo URL the user gives it rather than only deriving one.

## What a human should check by hand

- One Falabella product the user actually wants, followed end to end from the Agent to a stored photo, rather than from a search listing.
- Whether a fetch still passes from the tailnet server once it exists, if that box's egress differs from this machine's.
- Whether Amazon's `/dp/` pages stay fetchable over weeks. Four pages on one afternoon is not a sample; Amazon is the surface most likely to start challenging.
- A retailer outside these two, when one comes up. Everything here says these two CDNs are open; it says nothing about the third.
