# Spike 3: PDF to PNG in-process

**Date:** 2026-09-13. **Status:** done. **Retires:** Blueprint conversion ([build plan, slice 0](../../build-plan.md#slice-0-scaffold-and-spikes)). Slice 3 renders each Blueprint PDF page to PNG on upload, on the platform side, with no LLM (ADR 0001).

**Verdict: use `mupdf` (npm, WebAssembly).** It installs with no native build and renders every fixture page correctly, including a `/Rotate 90` page and an image-only scan, 2–3× faster than `pdftoppm`. It returns the page's text layer with boxes in the same coordinates as the render, and it crops with the same call. **One thing to settle before any hosting: mupdf is AGPL-3.0** (see [Licence](#licence)). `pdftoppm` works too and stays the fallback.

**Setup.**

- Node 26.8.1, npm 11.19.0, Arch Linux on an Intel Core Ultra 5 238V (8 cores).
- `mupdf` 1.28.1, poppler 26.08.0 (`pdftoppm`, `pdftotext`, `pdfinfo`). Extra, beyond the brief: `pdfjs-dist` 6.3.289 with `@napi-rs/canvas` 1.0.9, measured because mupdf is AGPL.
- Two fixture PDFs, generated with `pdf-lib` 1.17.1, are in [fixtures/](fixtures/). Both are vector with a real text layer and a non-embedded Helvetica, as many CAD exports have:
  - `blueprint-a3.pdf` (8.6 KB) is one A3 landscape ground floor at 1:50. It has 8 Rooms, each with its name and a metric and an imperial dimension string at 7 pt (e.g. "3.62 m x 4.00 m", "11'11" x 13'1""), plus:
    - exterior dimension lines, including vertical ones and "12'6""
    - doors, windows, a tilted north arrow, a scale bar, and a title block
    - a **legibility ladder** in the top-left: distinct strings at 4, 5, 6, 7, 8 and 10 pt, which a reader can't guess from one another.
  - `blueprint-3-pages.pdf` (107 KB):
    - page 1: A4 portrait ground floor at 1:100, dimension text 4.5 pt
    - page 2: first floor, stored A4 portrait with `/Rotate 90`, so it displays landscape
    - page 3: a greyscale JPEG "scan" of the A3 plan at 100 dpi, skewed 0.8°, with no text layer.
- Every page was rendered with its long edge at 2000 px, as RGB PNG, 5 times in one process. The tables give the median, with the first run in brackets where it differs by more than 10 ms. `pdftoppm` times include the process spawn, which alone measured about 5 ms.
- Throwaway files are in `$TMPDIR/…/scratchpad/spikes/3/`: `make-fixtures.mjs`, `render-mupdf.mjs`, `render-pdftoppm.mjs`, `render-pdfjs.mjs`, `spike3.test.mjs`, and the rendered output.

## Install

| | mupdf | pdftoppm | pdfjs-dist + @napi-rs/canvas |
|---|---|---|---|
| Licence | AGPL-3.0-or-later | GPL (poppler), a separate program | Apache-2.0 + MIT |
| Install | npm, 1 package, 0 dependencies, about 1 s | system package; `poppler-utils` in a Debian image | npm, 3 packages, 3.1 s |
| Size on disk | 14 MB, of which 10.4 MB is the `.wasm` | system | 35 MB + 34 MB |
| Native code | **none**, and no install scripts (only `prepack`) | native binary | a prebuilt Skia `.node` for `linux-x64-gnu`. Nothing compiles, but each platform needs its own optional package (musl/Alpine, arm64) |
| Start-up | `import` 31 ms (WASM compile) | about 5 ms spawn per call | `import` 93 ms |

## Rendering

| Page | Size (px) | mupdf | pdftoppm | pdfjs | PNG mupdf / pdftoppm / pdfjs |
|---|---|---|---|---|---|
| A3 plan | 2000×1414 | **46 ms** (77) | 126 ms | 70 ms (111) | 99 / 95 / 114 KB |
| 3-page, p1 A4 portrait | 1414×2000 | **40 ms** | 104 ms | 62 ms (81) | 59 / 56 / 71 KB |
| 3-page, p2 `/Rotate 90` | 2000×1414 | **40 ms** | 106 ms | 59 ms | 59 / 56 / 66 KB |
| 3-page, p3 scan | 2000×1414 | **78 ms** | 171 ms | 162 ms (210) | 318 / 224 / 276 KB |
| A3 top-left quarter crop | 2000×1414 | **41 ms** | 109 ms | 65 ms | 70 / 68 / 85 KB |

- All three honoured `/Rotate`: page 2 came out landscape and the right way up.
- The crop is the top-left quarter of the page rendered at twice the whole-page scale, so it comes out 2000 px wide again.
- **Greyscale halves mupdf's PNGs**: A3 from 99 to 48 KB and the scan from 318 to 157 KB, with `ColorSpace.DeviceGray`. Keep RGB by default, because agent plans are often colour-coded.
- Every size is far under spike 4's 1 MB JPEG-fallback threshold and its 16 MB transport limit. A 2000×1414 page costs about 3,670 image tokens.

## Text layer

| | mupdf | pdftotext `-bbox-layout` | pdfjs |
|---|---|---|---|
| Unit | lines (51 on the A3), each with a box, font size, and writing direction | words (171 on the A3) in HTML | text runs (51 on the A3) |
| Time | **0.7–1.7 ms per page**, in process | 9–14 ms per document, including spawn, plus parsing its HTML | 3.5–10.9 ms per page |
| Coordinates | points, top-left origin, displayed orientation: **the same space as the render**, so a box maps to pixels by the render scale alone | points, top-left, displayed | PDF user space; the conversion wasn't exercised here |

Two mupdf lines from the A3, as the walker returns them:

```json
{ "text": "3.62 m x 4.00 m", "bbox": [147.5, 331.7, 197.7, 341.3], "size": 7, "dir": [1, 0] }
{ "text": "5'3\" x 29'6\"", "bbox": [436.7, 281.6, 444.2, 308.7], "size": 5.5, "dir": [0, -1] }
```

- The second line is vertical text (the Landing on the rotated page 2). `dir` says so, and the box is already in displayed orientation.
- The scanned page returns **0 lines**, so the platform can tell per page whether printed text is available exactly or only as pixels.

## Legibility

**Checked by eye, with the Read tool:** "3.62 m" is readable on every render from every tool. That includes the 4.5 pt version on the A4 page and the 100 dpi scan.

**Blind readers:** two fresh agents that never saw the ground truth, one per tool, transcribed every string with a confidence of SURE, UNSURE, or UNREADABLE.

- **No character was misread**, by either reader, on any image. Every bracketed guess was right.
- The readers differed only in confidence:

| Image | pdftoppm reader | mupdf reader |
|---|---|---|
| A3 whole page, ladder | 4, 5, 6 pt unsure; 7 pt and up sure | 4 pt unsure; 5 pt and up sure* |
| A3 whole page, Room dimensions (7 pt) | all sure except one vertical string | all sure* |
| A3 title-block notes (6 pt, 5 pt) | unsure | sure* |
| A4 page 1, dimensions at 4.5 pt | metric sure, most imperial unsure | all sure* |
| A3 top-left crop, ladder | 4 pt unsure on one digit; the rest sure | all sure, 4 pt included |
| Page 3, the scan | not given | Room dimensions all sure; ladder 4–6 pt unsure |

\* The mupdf reader saw the scan first, which shows the same plan and ladder, so its later reads were primed. The pdftoppm reader's first ladder was the A3 whole page, which is the fair baseline.

**Pixels side by side** (`out/compare/ladder-3-tools.png`, the ladder region magnified 4×): the three renders are nearly identical.

- mupdf's stems are slightly heavier.
- pdfjs substitutes its own sans font for the non-embedded Helvetica, so its glyphs differ a little.
- The mean luminance of the ladder region is 0.969 for mupdf, 0.969 for pdftoppm, and 0.985 for pdfjs, which is the lightest.

**What this means for slice 3:**

- Whole-page rendering at 2000 px keeps printed dimensions readable down to about 5 pt on an A3 sheet, which is 1.68 px per point, or about 8 px per em.
- 4 pt is marginal whole, and sure in the crop, so the planned `crop` quarter covers the gap.
- Real drawing text is usually larger: 2.5 mm lettering is about 10 pt. The risk is agent plans shrunk to fit a page, and faint scans.
- For vector PDFs the question mostly goes away: the text layer gives the printed strings exactly.

## Other findings

- **Bad input.**
  - Garbage bytes: `openDocument` throws `Error: no objects found`.
  - A truncated PDF is *repaired* into a document with **0 pages** and does not throw; `loadPage(0)` then throws `invalid page number: 1`. So `upload_blueprint` must reject `countPages() === 0` itself.
  - mupdf writes `format error` / `warning: repairing PDF document` to stderr unless `mupdf.setLog(...)` routes it.
  - `pdftoppm` exits 1 on both.
  - An encrypted PDF (`needsPassword()`) wasn't tested.
- **Memory.** Every mupdf object (Document, Page, Pixmap, DrawDevice, StructuredText) holds WASM memory until `.destroy()`, so wrap each one in `try/finally`. With that done, 40 extra A3 renders moved RSS from 132 to 135 MB.
- **It blocks the event loop** for the length of a render: 40–80 ms per page, so about 1 s for a 20-page set. That's fine for the single-user PoC on upload. Move it to a worker thread only if uploads get large.
- **Vitest.** mupdf's ESM module, with its top-level `await` of the WASM, loads under Vitest 5.0.0 with no configuration; the test passed in 199 ms. It is ESM-only, so it needs core to stay `"type": "module"`, as the scaffold has it. Its bundled types check cleanly with TypeScript 5.9.3 under the scaffold's settings (`NodeNext`, `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`), covering every call in the recommendation below.
- **Raster Blueprints through the same path.** `openDocument(bytes, "image/jpeg")` opens a JPEG as a one-page document and renders it to 2000 px in 79 ms. Slice 3 can therefore downscale image Blueprints with the same code. HEIC wasn't tried.
- **Rounding.** `page.toPixmap` rounds the pixel box outward: 2000×1415 for an A3 page whose exact height is 1414.3. The general region path rounds to nearest: 2000×1414. Pick one rule in the wrapper, so crop pixels map back to page points exactly.

## Recommendation for slice 3

**Library:** `mupdf`, a dependency of `packages/core`, behind the file-store seam that already owns "uploads and rendered Blueprint pages". Only this one module imports mupdf.

**The surface to wrap.** Everything is 1-based pages and page points in displayed orientation (after `/Rotate`), with a top-left origin, which is mupdf's own convention:

```ts
type Quarter = "top-left" | "top-right" | "bottom-left" | "bottom-right";
interface TextLine { text: string; bbox: [number, number, number, number]; size: number; dir: [number, number] }

interface BlueprintDocument {
  pageCount: number;                                   // 0 is refused at open
  pageSize(page: number): { width: number; height: number };
  renderPage(page: number, opts?: { longEdge?: number; crop?: Quarter }): { png: Uint8Array; width: number; height: number };
  textLines(page: number): TextLine[];                  // [] for a scanned page
  close(): void;                                        // destroys every WASM object
}
function openBlueprint(bytes: Uint8Array, mimeType: "application/pdf" | "image/jpeg" | "image/png"): BlueprintDocument;
```

**How to call mupdf.** This is the whole of it:

```ts
import * as mupdf from "mupdf";

const doc = mupdf.Document.openDocument(bytes, "application/pdf");
const count = doc.countPages();                         // reject 0
const page = doc.loadPage(n - 1);                       // 0-based
const [x0, y0, x1, y1] = page.getBounds();              // points, /Rotate applied

// Whole page, long edge 2000 px
const s = 2000 / Math.max(x1 - x0, y1 - y0);
const pix = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false, true);
const png = pix.asPNG();

// Crop: any region at 2000 px on its long edge (a quarter = 2× the page scale)
const r = [x0, y0, (x0 + x1) / 2, (y0 + y1) / 2];
const k = 2000 / Math.max(r[2] - r[0], r[3] - r[1]);
const cpix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, r.map((v) => Math.round(v * k)), false);
cpix.clear(255);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(k, k), cpix);
page.run(dev, mupdf.Matrix.identity);
dev.close();

// Text layer
const st = page.toStructuredText("preserve-whitespace");
st.walk({ beginLine(bbox, wmode, dir) {}, onChar(c, origin, font, size) {}, endLine() {} });

// Free WASM memory (try/finally in real code)
for (const o of [st, dev, cpix, pix, page, doc]) o.destroy();
```

**When to run it.**

- **On upload:** render every page whole at 2000 px, as the plan says, into `rendered/`, with `blueprint_pages.png_path`.
- **On demand:** crops. At about 40 ms each they're cheaper to render than to store four per page.

**Open for slice 3 to decide.** These are ideas, not decisions:

- Whether `view_images` also sends a page's text lines in its text block. [blueprint-extraction-reliability.md](../blueprint-extraction-reliability.md) recommends sending the vector text verbatim so dimension strings arrive exact.
- Whether a Blueprint-Provenance write can check that its `printed` text really occurs in that page's text layer, when the page has one. That would be a deterministic rule core could enforce.
- Either one needs the text layer stored, or extracted per call (about 1 ms). The v1 schema has no column for it yet.

**Fallback,** if the AGPL is unacceptable:

- `pdftoppm -png -scale-to 2000 -f N -l N -singlefile in.pdf out` for pages.
- `-scale-to 4000 -x 0 -y 0 -W 2000 -H <h/2>` for the top-left quarter.
- `pdftotext -bbox-layout` for words.
- `pdfinfo` for page count and rotation.

It was correct on every page and about 2.5× slower. pdfjs-dist with @napi-rs/canvas is the in-process, permissively licensed alternative, about 1.5× slower than mupdf. It must be given its `standard_fonts/` directory, and it swaps in its own font for non-embedded ones.

## Licence

- mupdf is AGPL-3.0-or-later, and Artifex sells a commercial licence.
- For a PoC the user runs on their own machine this changes nothing.
- If the platform is ever **hosted for other people**, the AGPL's network clause would require offering the server's complete source under the AGPL, unless a commercial licence is bought.
- If that's unacceptable, swap the one wrapped module for the `pdftoppm` or pdfjs fallback above.
- This is not legal advice; the user decides before any hosting.

## What a human should check by hand

- **The real Blueprint** in the slice 3 demo: whether its dimension text reads at 2000 px whole, and whether the crop is enough. The fixtures here are clean vector drawings and one clean scan.
- **The licence decision** above, before anything is hosted.
- **The Docker image**, when it exists: that mupdf's WASM loads in it (expected, not tested), and `poppler-utils` only if the fallback is ever used.
- **Untested inputs:** password-protected PDFs, very large sheets (A1/A0 at 2000 px gives about 1.2 px per point, so text needs the crop), CMYK or colour-heavy plans, and HEIC.
