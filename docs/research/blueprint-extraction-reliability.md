# Blueprint extraction reliability (researched 2026-09-13)

How reliably current vision models turn a Blueprint into Rooms: names, dimensions, windows and doors, north, and multiple floors. Each claim is tagged **[measured]** (a benchmark or a controlled test), **[vendor]** (official docs or a vendor's own claim), or **[anecdote]** (a small practitioner test). Sources are listed at the end.

**The main caveat:** no public floor-plan benchmark covers the newest models (Claude Opus 4.7+/5, and whatever came after Gemini 3 Pro and GPT-5.2). The best evidence is AECV-Bench, which tested Gemini 3 Pro, GPT-5.2 and Claude Opus 4.5 [5][6]. Newer models may do better, so re-test on the user's real Blueprint before trusting any threshold below.

## Verdict by field

| Field | What the evidence says | Reliability | Treat as |
|---|---|---|---|
| Room names / labels | Room-label F1 is 0.95–0.97 for Claude 3.7 Sonnet and GPT-4o on raster plans [7] **[measured]**. OCR-style questions on drawings reach ~0.95 for top models [5] **[measured]**. Room *counts* are weaker: exact match falls from 0.95 on simple plans to 0.61 on moderately complex ones (Claude 3.7) [7] | High for reading the text, medium for how the plan divides into Rooms | Auto-fill, then the user confirms the Room list |
| Dimensions from printed dimension strings | Reading text is the strongest skill [5]. No floor-plan benchmark scores *which* Room or wall a dimension belongs to. On mechanical drawings, dimension extraction scored ~80% for Gemini 2.5 Pro and ~40% for Claude Opus 4, from only 10 drawings [16] **[anecdote]** | Medium. Reading the numbers is fine; attaching them to the right Room or wall is the risk | Pre-fill with the exact text quoted; the user confirms each Room |
| Dimensions from a scale bar or pixel measurement | On real measuring instruments the best score is 30.3% (Gemini 2.5 Pro), with units read correctly >90% of the time [8] **[measured]**. Scale-bar distance estimation on maps: "error rates remain high across all models" even with step-by-step prompting [9] **[measured]** | Low | Never auto-fill. Show as an estimate at most, and ask the user to measure |
| Windows and doors | Exact-match counts on 120 plans: windows 0.34 / 0.27 / 0.16 and doors 0.39 / 0.28 / 0.16 for Gemini 3 Pro / GPT-5.2 / Claude Opus 4.5. Window MAPE is 20–37% [5] **[measured]**. Nobody has benchmarked which wall an opening is on or its offset. Claude's docs call localization "approximate" [1] **[vendor]** | Low | Proposals only; the user confirms each opening and its wall |
| Compass / north arrow | No benchmark found. The arrow is a rotated glyph, and both vendors warn about rotated images [1][3] **[vendor]**. Many marketing plans have no arrow at all | Unknown, probably low to medium | Always ask the user; show a read arrow only as a suggestion |
| Multi-page / multi-floor | The input limits are generous (table below). Reasoning across pages is untested: AECV-Bench lists multi-page cross-referencing as out of scope [5] | Page-by-page reading is fine; which floor each page shows is unverified | Extract per page; the user confirms which floor each page is |

Two findings shape all of the above:

- **Reading text works; reading drawing symbols doesn't.** Bedroom and toilet counts reach 0.76–0.91 because those Rooms are labelled, while door and window counts stay at 0.16–0.39 because they are drawn only as symbols. The authors conclude that models are "document assistants" without "robust drawing literacy" [5][6].
- **Trained floor-plan models output geometry, not dimensions.** CubiCasa5K's CNN reaches a test room mean IoU of 57.5% and an icon IoU of 55.7% [11]. FloorplanVLM (2026) reaches a room F1 of 82.5% and a door/window F1 of 73.3% [10] **[measured]**. Both output shapes in pixels, so they still need a scale to give real sizes. Running either would also mean the platform doing inference itself, which ADR 0001 rules out.

## Input limits and resolution

| | Images | PDF | Downscaling |
|---|---|---|---|
| Claude [1][2] | Up to 8000×8000 px and 10 MB each; above 20 images per request, each must be ≤2000 px | 600 pages and 32 MB per request; each page is sent as both extracted text and an image | Long edge capped at 2576 px (Claude 4.7+) or 1568 px (older models) |
| Gemini [4] | n/a | 50 MB, 1000 pages, 258 tokens per page; native text extracted free on Gemini 3 | Pages scaled to at most 3072 px; `media_resolution` setting on Gemini 3 |
| OpenAI [3] | 1,500 images per request | Not in the vision guide (Codex reads images only; see agent-client-support.md) | gpt-5.x: 2048 px at `high`, 6000 px at `original` |

A large architectural sheet shrunk to 2576 px loses small dimension text, and Claude's docs advise cropping so that text stays legible [1]. One practitioner tool for construction drawings gives Claude Opus 5 an overview image plus a 6×6 grid of tiles for each sheet, and also sends the PDF's vector text layer verbatim so that dimension strings arrive exact rather than via OCR [17] **[anecdote]**. Both steps are deterministic and need no LLM, so they fit ADR 0001.

## Failure modes

- **Invented Rooms and fixtures.** Gemini listed a "gym" and an "office" that aren't on the plan [15] **[anecdote]**. AECV-Bench found models "hallucinate fixtures, or miss instances in dense regions" [5].
- **Misread symbols.** Models misread door swings and mistake windows for other openings [5].
- **Misread scales.** Models "misinterpret pointer positions, confuse adjacent ticks, and mismatch values to scale markings", which produces confident answers that are close but wrong [8].
- **Mixed-up units.** No benchmark tests feet-and-inches against metric. Recognising the unit itself is >90% [8], so the likelier risk is a misread digit or a figure attached to the wrong Room. A deterministic check helps: when a plan prints both metric and imperial, convert one and compare them.
- **Open-plan spaces merged or split.** Room-count accuracy falls as layouts get more complex [7]. Whether an open-plan space is one Room or several is a modelling decision (see handoff/home-model.md), so extraction can't settle it and the user must decide.
- **Faulty reasoning even from a perfect Floor Plan.** When given clean JSON layouts, LLMs "often fail to respect physical constraints" [13] **[measured]**. A correct Floor Plan still needs deterministic fit checks when furniture is involved.

## By document type

- **UK estate-agent marketing plans (Rightmove style).** RICS launched *Measurement Matters* (2018) because agents' floor plans were inaccurate and inconsistent. It asks for wall-to-wall measurements taken by RICS-certified measurers [18]. Plans carry "not to scale / approximate" disclaimers. One floor-plan vendor claims a ±5% area tolerance for consumer compliance and a ±2% professional target [19] **[vendor]**. So: (a) even a perfect reading inherits the plan's own error, and (b) the drawing is not to scale, so measuring it by scale or pixels is invalid. Use only the printed figures, and don't assume they are wall lengths.
- **Architectural drawings.** These are to scale and have a title block (e.g. "1:50", or a scale-reading question answered as '1"=64'' [5]). Text reading is strong. The risks are how dense the sheet is, downscaling, and cross-references to other sheets that haven't been tested.
- **Hand-drawn sketches.** Sketch2BIM (10 unscaled sketches) needed several rounds of human feedback: walls started at ~83% and approached 100% only after correction, and every category ended with F1 >0.83 [12] **[measured, small sample]**. A sketch has no scale, so dimensions exist only where the user wrote them.
- **Photos only, no Blueprint.** Converting apartment photos into floor plans scores "at or below a random baseline" for most models [14] **[measured]**. Dimensions estimated from photos are the weakest source of all.

## Consequences for us

1. **Extract, then confirm.** Home Intake (whose procedure the Skill-set session owns) reads the Blueprint into a *draft* Floor Plan and gets the user's confirmation in stages:
   1. The Room list: names, and open-plan merges.
   2. The dimensions of each Room.
   3. Openings, confirmed on the image.
   4. North, always asked, never assumed.

   This matches how poc-design.md already treats Items proposed from photos.
2. **Auto-fill only what is read as text:** Room labels, printed dimension strings (quoted exactly), and the stated total area. Everything else is a proposal.
3. **Record the source on every value.** A Blueprint value needs a different marker from a user-measured one. There are two independent axes:
   - **Source**, one of four values:
     - `measured`: the user's tape measure.
     - `blueprint-printed`: read from a dimension string, and carries the document's own tolerance.
     - `blueprint-scaled`: derived from a scale bar or pixels.
     - `ai-estimated`: estimated from a photo.
   - **Confirmed**: whether the user has checked it.

   Keep the exact text the value was read from, and the page number, with the value.
4. **Tie it to Requirements.** A *must* Requirement that depends on a dimension that isn't `measured` (e.g. "fits the 2.1 m alcove") should prompt the user to measure before buying. This matters most for dimensions from agent plans.
5. **Pre-process deterministically on the platform side.** Render each PDF page, crop tiles, pull the vector text layer, parse units, and check that Room dimensions add up to the overall dimensions and the stated total area. None of this needs an LLM (ADR 0001).
6. **Before relying on this, run a small eval** on the user's own Blueprint plus two or three agent plans, using the current Agent model. The benchmarks above predate it.

## Sources

1. https://platform.claude.com/docs/en/build-with-claude/vision (limits, resizing, Limitations section)
2. https://platform.claude.com/docs/en/build-with-claude/pdf-support
3. https://developers.openai.com/api/docs/guides/images-vision
4. https://ai.google.dev/gemini-api/docs/document-processing
5. https://arxiv.org/abs/2601.04819 (AECV-Bench, 2026-01: counting on 120 floor plans, plus drawing QA)
6. https://www.aecfoundry.com/blog/can-ai-really-read-your-building-plans-aecv-bench-gets-a-major-upgrade (2026-09-12 summary)
7. https://arxiv.org/abs/2511.03478 (Lee & Sarvghad 2025: 75 CubiCasa plans, GPT-4o / Claude 3.7 / Llama 3.2)
8. https://arxiv.org/abs/2510.26865 (MeasureBench, CVPR 2026)
9. https://arxiv.org/abs/2512.03558 (CartoMapQA: scale-bar route length)
10. https://arxiv.org/abs/2602.06507 (FloorplanVLM / FPBench-2K)
11. https://arxiv.org/abs/1904.01920 (CubiCasa5K, Finnish marketing floor plans)
12. https://arxiv.org/abs/2510.20838 (Sketch2BIM)
13. https://arxiv.org/abs/2507.07644 (FloorplanQA, ICML 2026)
14. https://arxiv.org/abs/2509.25229 (Blueprint-Bench)
15. https://architectswhocode.com/can-ai-really-read-a-floor-plan/ (2026-04, one plan, three models)
16. https://www.businesswaretech.com/blog/benchmark-testing-ai-models-on-engineering-drawings (2025-07, 10 drawings)
17. https://github.com/Abe-Borg/drawing-analyzer (sheet tiling plus text layer)
18. https://www.buyassociationgroup.com/en-gb/news/new-rics-consumer-guide-promotes-accurate-floorplans-importance/ (coverage of RICS *Measurement Matters*; the RICS PDF itself couldn't be retrieved)
19. https://www.photoplan.co.uk/guides/how-accurate-are-floor-plans (vendor claim)
