import type {
  DecisionDetail,
  Flag,
  FullGuide,
  Listing,
  QuickGuideLine,
} from "./operations/schemas.js";
import { QUICK_GUIDE_LINE_KINDS } from "./operations/schemas.js";
import { fieldLabel, QUICK_GUIDE_HEADINGS, DECISION_STATE_LABELS as STATES } from "./render.js";

// The files the web serves as they are, rendered from stored data only (docs/poc-design.md#web-ui):
// the Shopping List as a printable page and CSV, the Shopping Guides as a printable page and
// Markdown, and the Quick Guide's phone page. Every page is static HTML with no JavaScript, and
// every stored text is escaped, the Full Guide's Markdown included. The pages share the web app's
// "paper and ink" look, with its values copied into their own styles so each file stands alone.

/** The Home an export is for. */
export interface ExportHome {
  name: string;
  slug: string;
}

// ─── The Shopping List ──────────────────────────────────────────────────────────────────────

const CSV_HEADER = [
  "Purchase",
  "Slug",
  "Room",
  "Statement",
  "Must",
  "Prefer",
  "Measure first",
  "Listings",
  "Guides",
  "Open flags",
];

/** The Shopping List as CSV: a header, then one row per Purchase, each line ending in CRLF. */
export function renderShoppingListCsv(purchases: DecisionDetail[]): string {
  const rows = [
    CSV_HEADER,
    ...purchases.map((purchase) => [
      purchase.title,
      purchase.slug,
      place(purchase),
      purchase.statement,
      requirementTexts(purchase, "must").join("; "),
      requirementTexts(purchase, "prefer").join("; "),
      linesOf(purchase, "measure-first").join("; "),
      String(purchase.listings.length),
      hasGuides(purchase) ? "yes" : "no",
      String(purchase.openFlags.length),
    ]),
  ];
  return rows.map((row) => `${row.map(csvCell).join(",")}\r\n`).join("");
}

/**
 * One CSV cell, quoted when it holds a quote, comma, or line break. A cell a spreadsheet would
 * read as a formula gets a leading apostrophe, so opening the file never runs one.
 */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

/**
 * The Shopping List as a printable page: each Purchase with a box to tick, its state, its open
 * Flags, and its Measure first lines as instructions with room to write the measurement.
 */
export function renderShoppingListPage(
  home: ExportHome,
  purchases: DecisionDetail[],
  generatedAt: string,
): string {
  const body = [
    "<header>",
    `<p class="running">${escapeHtml(home.name)} · ${longDay(generatedAt)}</p>`,
    "<h1>Shopping List</h1>",
    "</header>",
  ];
  if (purchases.length === 0) {
    body.push(
      "<p>Nothing is on the Shopping List yet: no Purchase is Locked and waiting to be bought.</p>",
    );
  }
  for (const purchase of purchases) {
    body.push(
      `<section class="${purchaseClass(purchase)}">`,
      `<h2><span class="box"></span>${escapeHtml(purchase.title)}</h2>`,
      `<p class="meta">${stateHtml(purchase)} · ${escapeHtml(place(purchase))}</p>`,
      ...flagsHtml(purchase),
      `<p>${escapeHtml(purchase.statement)}</p>`,
      ...quickSections(purchase)
        .filter(({ kind }) => ON_THE_LIST.has(kind))
        .flatMap((section) => sectionHtml(3, purchase, section)),
      ...listHtml(3, "Listings", purchase.listings.map(listingText)),
      "</section>",
    );
  }
  body.push(FOOTER_HTML);
  return htmlPage(`Shopping List: ${home.name}`, PRINT_STYLE, body);
}

/** The Quick Guide sections the Shopping List carries: the rest are for the shop. */
const ON_THE_LIST: ReadonlySet<QuickGuideLine["kind"]> = new Set([
  "measure-first",
  "must",
  "prefer",
]);

/** One Listing: name, price, its pass, fail, and unknown counts, and any must it fails. */
function listingText(listing: Listing): string {
  const { pass, fail, unknown } = listing.counts;
  const fails = listing.checks.filter(
    (check) => check.strength === "must" && check.result === "fail",
  );
  return (
    `${listing.name}${listing.price ? `, ${listing.price}` : ""}: ` +
    `${pass} pass, ${fail} fail, ${unknown} unknown` +
    (fails.length > 0
      ? `; fails must ${fails.map((check) => `${check.requirement} (${check.text})`).join(", ")}`
      : "")
  );
}

// ─── The Shopping Guides ────────────────────────────────────────────────────────────────────

/**
 * The Shopping Guides as Markdown: per Purchase its Quick Guide, every section expanded under a
 * heading of its own, then its Full Guide with its headings moved under the Purchase's own.
 */
export function renderGuidesMarkdown(home: ExportHome, purchases: DecisionDetail[]): string {
  const out = [`# Shopping Guides: ${home.name}`];
  if (purchases.length === 0) out.push("", "_No Purchase has Guides yet._");
  for (const purchase of purchases) {
    out.push("", `## ${purchase.title}`, "", about(purchase), "", purchase.statement);
    const bought = boughtText(purchase);
    if (bought) out.push("", bought);
    out.push("", "### Quick Guide");
    const lookingFor = purchase.quickGuide?.lookingFor;
    if (lookingFor) out.push("", `**Looking for:** ${lookingFor}`);
    const sections = quickSections(purchase);
    for (const { kind, heading, lines } of sections) {
      const text = (line: string) =>
        kind === "measure-first" ? measureText(purchase, line, MARKDOWN_MEASURE) : line;
      out.push("", `#### ${heading}`, "", ...lines.map((line) => `- ${text(line)}`));
    }
    if (sections.length === 0) out.push("", "_Nothing to check yet: it has no Requirements._");
    out.push("", "### Full Guide", "");
    const full = purchase.guides?.fullGuide;
    if (full?.markdown === undefined) out.push("_No Full Guide written yet._");
    else out.push(`_${fullGuideState(full)}_`, "", demoteMarkdown(full.markdown, 4));
  }
  return `${out.join("\n")}\n`;
}

/**
 * The Shopping Guides as a printable page, each Purchase on a page of its own under a header
 * naming the Home, its Room, and the day: its Quick Guide with every section expanded, kept to one
 * page when it fits, the blanks to bring back to the Agent, then its Full Guide.
 */
export function renderGuidesPage(
  home: ExportHome,
  purchases: DecisionDetail[],
  generatedAt: string,
): string {
  const body = [
    "<header>",
    `<p class="running">${escapeHtml(home.name)} · ${longDay(generatedAt)}</p>`,
    "<h1>Shopping Guides</h1>",
    "</header>",
  ];
  if (purchases.length === 0) body.push("<p>No Purchase has Guides yet.</p>");
  for (const purchase of purchases) {
    body.push(
      `<article class="${purchaseClass(purchase)} guide">`,
      `<p class="running">${escapeHtml(home.name)} · ${escapeHtml(place(purchase))} · ` +
        `${longDay(generatedAt)}</p>`,
      `<h2>${escapeHtml(purchase.title)}</h2>`,
      `<p class="meta">${stateHtml(purchase)}</p>`,
      ...flagsHtml(purchase),
      `<p>${escapeHtml(purchase.statement)}</p>`,
    );
    const bought = boughtText(purchase);
    if (bought) body.push(`<p class="done">✓ ${escapeHtml(bought)}</p>`);
    body.push('<section class="quick">', "<h3>Quick Guide</h3>");
    const lookingFor = purchase.quickGuide?.lookingFor;
    if (lookingFor) body.push(`<p class="looking-for">${escapeHtml(lookingFor)}</p>`);
    const sections = quickSections(purchase);
    if (sections.length === 0) body.push(NOTHING_TO_CHECK);
    for (const section of sections) body.push(...sectionHtml(4, purchase, section));
    body.push("</section>");
    if (!bought) body.push(bringBackHtml(3));
    const full = purchase.guides?.fullGuide;
    body.push('<section class="full">', "<h3>Full Guide</h3>");
    if (full?.markdown === undefined) body.push("<p>No Full Guide written yet.</p>");
    else {
      body.push(
        `<p class="meta">${escapeHtml(fullGuideState(full))}</p>`,
        markdownToHtml(full.markdown, 4),
      );
    }
    body.push("</section>", "</article>");
  }
  body.push(FOOTER_HTML);
  return htmlPage(`Shopping Guides: ${home.name}`, PRINT_STYLE, body);
}

function fullGuideState(full: FullGuide): string {
  return (
    `Written ${day(full.writtenAt)}.` +
    (full.outOfDate
      ? " Out of date: a Requirement changed after it was written" +
        (full.requirementsChangedAt ? `, on ${day(full.requirementsChangedAt)}.` : ".")
      : "")
  );
}

// ─── The phone page ─────────────────────────────────────────────────────────────────────────

/** The sections the phone page folds behind a tap: consulted once the musts are passed. */
const FOLDED: ReadonlySet<QuickGuideLine["kind"]> = new Set(["prefer", "test", "ask"]);

/**
 * The Quick Guide on a phone, big enough to read while holding a sample: the looking-for line,
 * then Measure first, the musts, and the avoids, always open, then Prefer, In the shop, Ask the
 * seller, and the Full Guide, each folded under one tap with its count. The tick boxes and the
 * blanks to bring back to the Agent are printed only: with no JavaScript, nothing here can be
 * ticked on screen.
 */
export function renderGuidePage(home: ExportHome, purchase: DecisionDetail): string {
  const body = [
    "<main>",
    "<header>",
    `<p class="home">${escapeHtml(home.name)} · ${escapeHtml(place(purchase))}</p>`,
    `<h1>${escapeHtml(purchase.title)}</h1>`,
    `<p class="looking-for">${escapeHtml(purchase.quickGuide?.lookingFor ?? purchase.statement)}</p>`,
    "</header>",
  ];
  const bought = boughtText(purchase);
  if (bought) body.push(`<p class="done">✓ ${escapeHtml(bought)}</p>`);
  const sections = quickSections(purchase);
  if (sections.length === 0) body.push(NOTHING_TO_CHECK);
  for (const section of sections.filter(({ kind }) => !FOLDED.has(kind))) {
    body.push(...sectionHtml(2, purchase, section));
  }
  const folds = sections.filter(({ kind }) => FOLDED.has(kind));
  const full = purchase.guides?.fullGuide;
  if (folds.length > 0 || full?.markdown !== undefined) body.push('<div class="folds">');
  for (const section of folds) {
    body.push(
      `<details class="${section.kind}">`,
      `<summary>${escapeHtml(section.heading)} (${section.lines.length})</summary>`,
      ...linesHtml(purchase, section),
      "</details>",
    );
  }
  if (full?.markdown !== undefined) {
    body.push('<details class="full">', "<summary>Full Guide</summary>");
    if (full.outOfDate) {
      body.push('<p class="stale">Out of date: a Requirement changed after it was written.</p>');
    }
    body.push(markdownToHtml(full.markdown, 3), "</details>");
  }
  if (folds.length > 0 || full?.markdown !== undefined) body.push("</div>");
  body.push("<footer>");
  if (!bought) body.push(bringBackHtml(2));
  body.push(FOOTER_HTML, "</footer>", "</main>");
  return htmlPage(`${purchase.title}: Quick Guide`, PHONE_STYLE, body);
}

// ─── Shared parts ───────────────────────────────────────────────────────────────────────────

/** A Purchase's Quick Guide lines of one kind; Measure first ones without their prefix. */
function linesOf(purchase: DecisionDetail, kind: QuickGuideLine["kind"]): string[] {
  return (purchase.quickGuide?.lines ?? [])
    .filter((line) => line.kind === kind)
    .map((line) =>
      kind === "measure-first" ? line.text.replace(/^Measure first: /, "") : line.text,
    );
}

interface QuickSection {
  kind: QuickGuideLine["kind"];
  heading: string;
  lines: string[];
}

/**
 * The Quick Guide's sections, those with lines only, in core's own order: Measure first, then what
 * a candidate passes or fails on (the musts and the avoids), then the tiebreakers and the checks
 * made with it in hand. Taken from QUICK_GUIDE_LINE_KINDS so the exports and the text form cannot
 * drift apart.
 */
function quickSections(purchase: DecisionDetail): QuickSection[] {
  return QUICK_GUIDE_LINE_KINDS.map((kind) => ({
    kind,
    heading: QUICK_GUIDE_HEADINGS[kind],
    lines: linesOf(purchase, kind),
  })).filter(({ lines }) => lines.length > 0);
}

const NOTHING_TO_CHECK = "<p>Nothing to check yet: this Purchase has no Requirements.</p>";

/** One Quick Guide section under its heading. */
function sectionHtml(level: number, purchase: DecisionDetail, section: QuickSection): string[] {
  const name = section.kind === "measure-first" ? "measure" : section.kind;
  return [
    `<section class="block ${name}">`,
    `<h${level}>${escapeHtml(section.heading)}</h${level}>`,
    ...linesHtml(purchase, section),
    "</section>",
  ];
}

/**
 * A section's lines as a list: Measure first ones as instructions with a blank, musts and prefers
 * with a box to tick where the page is printed, and a must's numbers bold.
 */
function linesHtml(purchase: DecisionDetail, { kind, lines }: QuickSection): string[] {
  const list =
    kind === "measure-first"
      ? "measure-lines"
      : kind === "must" || kind === "prefer"
        ? "checks"
        : "lines";
  const text = (line: string) =>
    kind === "measure-first"
      ? measureText(purchase, line, HTML_MEASURE)
      : kind === "must"
        ? escapeHtml(line).replace(NUMBER, (figure) => `<strong class="num">${figure}</strong>`)
        : escapeHtml(line);
  return [`<ul class="${list}">`, ...lines.map((line) => `<li>${text(line)}</li>`), "</ul>"];
}

function requirementTexts(purchase: DecisionDetail, strength: "must" | "prefer"): string[] {
  return purchase.requirements
    .filter((requirement) => requirement.strength === strength)
    .map((requirement) => requirement.text);
}

function hasGuides(purchase: DecisionDetail): boolean {
  const { guides } = purchase;
  return (
    guides !== undefined &&
    (guides.lookingFor !== undefined ||
      guides.quickLines.length > 0 ||
      guides.fullGuide !== undefined)
  );
}

function place(purchase: DecisionDetail): string {
  return purchase.room?.name ?? "Home-wide";
}

/** "Living room, Locked". */
function about(purchase: DecisionDetail): string {
  return `${place(purchase)}, ${STATES[purchase.state]}`;
}

/** "Bought 2026-09-14: Oak bookcase, 85 cm wide", once Fulfilled. */
function boughtText(purchase: DecisionDetail): string | undefined {
  if (!purchase.fulfilledAt) return undefined;
  const bought = purchase.fulfilment?.bought;
  return `Bought ${day(purchase.fulfilledAt)}${bought ? `: ${bought}` : ""}`;
}

const day = (timestamp: string) => timestamp.slice(0, 10);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Sep 2026". */
function longDay(timestamp: string): string {
  const [year, month, date] = day(timestamp).split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

const SYMBOLS: Record<DecisionDetail["state"], string> = {
  candidate: "○",
  leaning: "◐",
  locked: "●",
  rejected: "✕",
};

const considering = (purchase: DecisionDetail) =>
  purchase.state === "candidate" || purchase.state === "leaning";

function purchaseClass(purchase: DecisionDetail): string {
  return `purchase${considering(purchase) ? " considering" : ""}`;
}

/** "● Locked", or "◐ Leaning · Considering: not committed to yet". */
function stateHtml(purchase: DecisionDetail): string {
  const state = `<span class="state ${purchase.state}">${SYMBOLS[purchase.state]} ${STATES[purchase.state]}</span>`;
  return considering(purchase)
    ? `${state} · <span class="tag">Considering: not committed to yet</span>`
    : state;
}

const FLAG_CAUSES: Record<Flag["cause"], string> = {
  reopened: "was reopened",
  rejected: "was rejected",
  deviation: "was Fulfilled with a Deviation from a must Requirement",
  value_changed: "changed",
};

/** A Purchase's open Flags: "⚑ Flagged 14 Sep 2026: Warm clay was reopened. Review it." */
function flagsHtml(purchase: DecisionDetail): string[] {
  if (purchase.openFlags.length === 0) return [];
  return [
    '<ul class="flags">',
    ...purchase.openFlags.map((flag) => {
      const cause =
        flag.cause === "value_changed" && flag.source.field
          ? `${fieldLabel(flag.source.field)} changed`
          : FLAG_CAUSES[flag.cause];
      return (
        `<li>⚑ Flagged ${longDay(flag.raisedAt)}: ${escapeHtml(flag.source.name)} ${escapeHtml(cause)}. ` +
        "Review it before buying.</li>"
      );
    }),
    "</ul>",
  ];
}

/** How a Measure first instruction marks its recorded figure and its blank. */
interface MeasureFormat {
  text: (text: string) => string;
  figure: (figure: string) => string;
  blank: string;
}

const HTML_MEASURE: MeasureFormat = {
  text: escapeHtml,
  figure: (figure) => `<span class="num">${figure}</span>`,
  blank: '<span class="blank"></span>',
};

const MARKDOWN_MEASURE: MeasureFormat = {
  text: (text) => text,
  figure: (figure) => `**${figure}**`,
  blank: "____",
};

/**
 * A Measure first line as an instruction with a blank for the measurement:
 * "living-room/wall-5 length (~3.70 m)" becomes
 * "Living room · Wall 5 · length. Recorded ~370 cm (estimate). Measured: ____ cm".
 */
function measureText(purchase: DecisionDetail, line: string, format: MeasureFormat): string {
  const blank = `Measured: ${format.blank} cm`;
  const parsed = /^(.*?) \((?:(~?)(\d+(?:\.\d+)?) m|(not recorded))\)$/.exec(line);
  if (!parsed?.[1]) return `${format.text(line)}. ${blank}`;
  const [, what, tilde, metres] = parsed;
  const recorded =
    metres === undefined
      ? "Not recorded yet."
      : `Recorded ${format.figure(`${tilde}${Math.round(Number(metres) * 100)} cm`)}` +
        `${tilde ? " (estimate)" : ""}.`;
  return `${format.text(measurePlace(purchase, what))}. ${recorded} ${blank}`;
}

/** "living-room/wall-5 length" as "Living room · Wall 5 · length"; a Home's field alone, capitalised. */
function measurePlace(purchase: DecisionDetail, what: string): string {
  const named = /^(.+?) \(([^()\s]+)\) (.+)$/.exec(what);
  if (named?.[1] && named[3]) return `${named[1]} · ${named[3]}`;
  const slugged = /^(\S*[-/]\S*) (.+)$/.exec(what);
  if (!slugged?.[1] || !slugged[2]) return capitalise(what);
  const parts = slugged[1]
    .split("/")
    .map((part) =>
      part === purchase.room?.slug ? purchase.room.name : capitalise(part.replaceAll("-", " ")),
    );
  return [...parts, slugged[2]].join(" · ");
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Numbers with their units, as a must's bold figures: "2.0 × 1.4 m", "£450", "85 cm". */
const NUMBER =
  /(?:[£€$]\s?)?\d+(?:[.,]\d+)?(?:\s?[×x]\s?\d+(?:[.,]\d+)?)*(?:\s?(?:mm|cm|m²|m|kg|kW|W|K|lm|%)(?!\w))?/g;

function listHtml(level: number, title: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [
    `<h${level}>${escapeHtml(title)}</h${level}>`,
    "<ul>",
    ...items.map((item) => `<li>${escapeHtml(item)}</li>`),
    "</ul>",
  ];
}

/** The blanks to fill in at the shop and hand back to the Agent. */
function bringBackHtml(level: number): string {
  const blank = (label: string) =>
    `<p class="fill"><span>${label}</span> <span class="blank wide"></span></p>`;
  return [
    '<section class="bring-back">',
    `<h${level}>Bring back to the Agent</h${level}>`,
    blank("Found or bought"),
    blank("Link or model"),
    blank("Dimensions"),
    blank("What differs from the Requirements"),
    "</section>",
  ].join("\n");
}

/** The last line of every page: each is assembled from the Requirements when it is asked for. */
const FOOTER_HTML =
  '<p class="live">This page is live: it changes when the Agent changes a Requirement. ' +
  "A screenshot won't.</p>";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function htmlPage(title: string, style: string, body: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${style}</style>`,
    "</head>",
    "<body>",
    ...body,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// The styles copy the web app's tokens (packages/web/src/tokens.css): paper #f6f3ee, card
// #fbfaf7, ink #2a2724, muted ink #6b655d, hairline #e3ded6, olive accent #5e6b4e, attention
// #f3e6c4 on #8a6414, a serif for headings and a sans for text. Newsreader and Inter are named
// first but not bundled, so a file opened offline falls back to Georgia and the system sans.
// Section names are kept out of the styles, so a page's text is the only place they appear.

const PRINT_STYLE = `
:root { color-scheme: light; --paper: #f6f3ee; --card: #fbfaf7; --ink: #2a2724; --muted: #6b655d;
  --hairline: #e3ded6; --accent: #5e6b4e; --mark: #f3e6c4; --mark-ink: #8a6414; }
body { font: 10.5pt/1.5 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-variant-numeric: tabular-nums; background: var(--paper); color: var(--ink);
  max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
h1, h2, h3 { font-family: "Newsreader", Georgia, "Times New Roman", serif; font-weight: 500;
  line-height: 1.2; letter-spacing: -0.01em; }
h1 { font-size: 2rem; margin: 0.25rem 0 0; }
h2 { font-size: 1.5rem; margin: 0 0 0.25rem; }
h3 { font-size: 1.2rem; margin: 1.25rem 0 0.5rem; }
h4 { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted); margin: 1rem 0 0.25rem; }
h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
p { margin: 0.25rem 0 0.5rem; }
a { color: var(--accent); text-underline-offset: 0.18em; }
.running, .meta, .live { color: var(--muted); font-size: 0.85rem; margin: 0; }
.purchase { background: var(--card); border: 1px solid var(--hairline); border-radius: 6px;
  margin-top: 1.5rem; padding: 1rem 1.25rem; break-inside: avoid; }
.purchase > .running { margin-bottom: 0.5rem; }
.considering { border-style: dashed; border-color: var(--muted); }
.state { font-weight: 600; color: var(--ink); }
.state.leaning, .tag { color: var(--mark-ink); }
.state.locked { color: var(--accent); }
.tag { font-weight: 600; }
.box { display: inline-block; width: 0.8em; height: 0.8em; border: 1.5px solid var(--ink);
  border-radius: 2px; margin-right: 0.5em; vertical-align: -0.02em; }
ul { margin: 0.25rem 0; padding-left: 1.3rem; }
li { margin: 0.2rem 0; break-inside: avoid; }
ul.checks, ul.flags, ul.measure-lines, ul.lines { list-style: none; padding-left: 0; }
ul.checks li { position: relative; padding-left: 1.6em; }
ul.checks li::before { content: ""; position: absolute; left: 0; top: 0.3em; width: 0.85em;
  height: 0.85em; border: 1.5px solid var(--ink); border-radius: 2px; }
ul.flags li { background: var(--mark); color: var(--mark-ink); border-left: 3px solid var(--mark-ink);
  border-radius: 4px; padding: 0.2rem 0.6rem; font-weight: 600; }
.block { margin-top: 0.75rem; }
.block.measure { background: var(--mark); border-left: 4px solid var(--mark-ink);
  border-radius: 6px; padding: 0.25rem 0.9rem 0.5rem; }
.block.measure h4, .block.measure h3 { color: var(--mark-ink); }
ul.measure-lines li { padding-bottom: 0.6rem; }
.blank { display: inline-block; min-width: 5em; border-bottom: 1px solid var(--ink);
  vertical-align: baseline; height: 1em; }
.blank.wide { min-width: 0; flex: 1; }
.num { font-variant-numeric: tabular-nums; }
.done { font-weight: 600; color: var(--accent); }
.bring-back { border: 1px solid var(--hairline); border-radius: 6px; margin-top: 1rem;
  padding: 0.25rem 1rem 0.75rem; break-inside: avoid; }
.fill { display: flex; gap: 0.5rem; align-items: baseline; margin: 0.9rem 0 0; }
.fill > span:first-child { white-space: nowrap; color: var(--muted); }
.full { margin-top: 1rem; }
.looking-for { font-weight: 600; }
header + .live, .live:last-child { margin-top: 1.5rem; }
@media print {
  @page { margin: 16mm 14mm; }
  body { background: none; margin: 0; max-width: none; padding: 0; font-size: 10.5pt; }
  a { color: inherit; }
  .purchase { background: none; border: none; border-top: 1px solid #999; border-radius: 0;
    padding: 0.75rem 0 0; }
  .considering { border-top: 2px dashed #555; }
  .block.measure, ul.flags li { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .block.measure { border-left-color: #333; }
  ul.flags li { border-left-color: #333; }
  .guide { break-inside: auto; border-top: none; padding-top: 0; }
  .guide + .guide { break-before: page; }
  .quick { break-inside: avoid; }
  .full { break-before: auto; }
}
`;

const PHONE_STYLE = `
:root { color-scheme: light dark; --ink: #2a2724; --muted: #6b655d; --paper: #f6f3ee;
  --card: #fbfaf7; --hairline: #e3ded6; --accent: #5e6b4e; --mark: #f3e6c4; --mark-ink: #8a6414; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #ece6dc; --muted: #aaa196; --paper: #1d1b18; --card: #26231f; --hairline: #3a352f;
    --accent: #aab894; --mark: #3a2f1a; --mark-ink: #e3b95c; }
}
body { margin: 0; background: var(--paper); color: var(--ink);
  font: 1.125rem/1.45 "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-variant-numeric: tabular-nums;
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
main { max-width: 38rem; margin: 0 auto; padding: 1rem 1.1rem 3rem; }
h1, h3, h4, h5, h6 { font-family: "Newsreader", Georgia, "Times New Roman", serif; font-weight: 500;
  line-height: 1.2; }
h1 { font-size: 2rem; margin: 0.25rem 0 0.35rem; letter-spacing: -0.01em; }
h2 { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
  color: var(--muted); margin: 0 0 0.35rem; }
h3, h4, h5, h6 { font-size: 1.3rem; margin: 1.2rem 0 0.3rem; }
p { margin: 0.4rem 0; }
a { color: var(--accent); text-underline-offset: 0.18em; }
.home { color: var(--muted); font-size: 0.95rem; margin: 0; }
.looking-for { margin: 0; }
ul { margin: 0; padding-left: 1.3rem; }
li { margin: 0.5rem 0; }
ul.checks, ul.measure-lines, ul.lines { list-style: none; padding-left: 0; }
ul.checks li, ul.lines li { margin: 0.3rem 0; }
.block { margin-top: 1.4rem; }
.block.measure { background: var(--mark); border-left: 5px solid var(--mark-ink); border-radius: 6px;
  padding: 0.7rem 1rem 0.6rem; }
.block.measure h2 { color: var(--mark-ink); }
ul.measure-lines li + li { margin-top: 0.9rem; }
.block.must li { font-size: 1.2rem; font-weight: 500; }
.num { font-weight: 700; }
.blank { display: inline-block; min-width: 4em; border-bottom: 1.5px solid currentColor;
  height: 1em; vertical-align: baseline; }
.done { font-weight: 600; color: var(--accent); }
.stale { font-weight: 600; color: var(--mark-ink); }
.folds { margin-top: 1.6rem; border-top: 1px solid var(--hairline); }
details { border-bottom: 1px solid var(--hairline); }
summary { font-family: "Newsreader", Georgia, serif; font-size: 1.25rem; padding: 0.6rem 0;
  cursor: pointer; }
details[open] > summary { margin-bottom: 0.2rem; }
details > ul { margin-bottom: 0.8rem; }
details.prefer > ul { color: var(--muted); }
footer { margin-top: 1.6rem; }
.bring-back { display: none; }
.live { color: var(--muted); font-size: 0.9rem; margin: 0; }
@media print {
  :root { color-scheme: light; --ink: #2a2724; --muted: #555; --paper: #fff; --card: #fff;
    --hairline: #999; --mark: #f3e6c4; --mark-ink: #333; }
  body { font-size: 11pt; }
  main { max-width: none; padding: 0; }
  h2 { break-after: avoid; }
  .block, .bring-back, li { break-inside: avoid; }
  .block.measure { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ul.checks li { position: relative; padding-left: 1.7em; }
  ul.checks li::before { content: ""; position: absolute; left: 0; top: 0.3em; width: 0.9em;
    height: 0.9em; border: 2px solid var(--muted); border-radius: 3px; }
  details::details-content { content-visibility: visible; display: block; }
  summary { list-style: none; }
  details.prefer > ul { color: var(--ink); }
  .bring-back { display: block; border: 1px dashed var(--muted); border-radius: 6px;
    padding: 0.9rem 1rem 1rem; margin-bottom: 1rem; }
  .fill { display: flex; gap: 0.5rem; align-items: baseline; margin: 0.9rem 0 0; }
  .fill > span:first-child { white-space: nowrap; color: var(--muted); font-size: 1rem; }
  .blank.wide { min-width: 0; flex: 1; }
}
`;

// ─── Markdown ───────────────────────────────────────────────────────────────────────────────

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * How far to move a guide's headings so the topmost becomes level `top`: the Full Guide goes
 * under a Purchase's own heading. Never moves them up.
 */
function headingShift(lines: string[], top: number): number {
  let fenced = false;
  let highest = 7;
  for (const line of lines) {
    if (FENCE.test(line)) fenced = !fenced;
    const heading = fenced ? null : HEADING.exec(line);
    if (heading?.[1]) highest = Math.min(highest, heading[1].length);
  }
  return highest === 7 ? 0 : Math.max(0, top - highest);
}

/** Markdown with its headings moved down so the topmost is level `top`, at most 6. */
export function demoteMarkdown(markdown: string, top: number): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const shift = headingShift(lines, top);
  let fenced = false;
  return lines
    .map((line) => {
      if (FENCE.test(line)) fenced = !fenced;
      const heading = fenced ? null : HEADING.exec(line);
      if (!heading?.[1]) return line;
      return `${"#".repeat(Math.min(6, heading[1].length + shift))} ${heading[2] ?? ""}`;
    })
    .join("\n");
}

/**
 * The Full Guide's Markdown as HTML, its headings moved so the topmost is level `top`. Covers what
 * a guide uses: headings, paragraphs, lists (an indented or unmarked line continues an item),
 * quotes, rules, code, bold, italics, and links to web pages. Everything else stays text, and all
 * text is escaped, so no HTML in the guide reaches the page.
 */
export function markdownToHtml(markdown: string, top = 1): string {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const shift = headingShift(lines, top);
  const out: string[] = [];
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${inline(paragraph.join(" "))}</p>`);
    if (quote.length > 0) out.push(`<blockquote><p>${inline(quote.join(" "))}</p></blockquote>`);
    if (list) {
      out.push(
        `<${list.tag}>`,
        ...list.items.map((item) => `<li>${inline(item)}</li>`),
        `</${list.tag}>`,
      );
    }
    paragraph = [];
    quote = [];
    list = undefined;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line)?.[1];
    if (fence) {
      flush();
      const code: string[] = [];
      for (index++; index < lines.length && !lines[index]?.trimStart().startsWith(fence); index++) {
        code.push(lines[index] ?? "");
      }
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      flush();
      const level = Math.min(6, heading[1].length + shift);
      out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push("<hr>");
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = bullet ? null : /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const tag = bullet ? "ul" : "ol";
      if (paragraph.length > 0 || quote.length > 0 || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push(item[1] ?? "");
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      if (paragraph.length > 0 || list) flush();
      quote.push(quoted[1] ?? "");
      continue;
    }
    if (list) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else if (quote.length > 0) {
      quote.push(line.trim());
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return out.join("\n");
}

// Stands in for a finished piece of HTML while the rest of the line is escaped.
const HELD = "";

/** One line of Markdown text as HTML: code, links to web pages, bold, and italics. */
function inline(text: string): string {
  const held: string[] = [];
  const hold = (html: string) => `${HELD}${held.push(html) - 1}${HELD}`;
  let out = text.replaceAll(HELD, "");
  out = out.replace(/`([^`]+)`/g, (_, code: string) => hold(`<code>${escapeHtml(code)}</code>`));
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) => alt);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, url: string) =>
    /^(https?:|mailto:)/i.test(url)
      ? hold(`<a href="${escapeHtml(url)}">${emphasis(escapeHtml(label))}</a>`)
      : label,
  );
  return emphasis(escapeHtml(out)).replace(
    new RegExp(`${HELD}(\\d+)${HELD}`, "g"),
    (_, at: string) => held[Number(at)] ?? "",
  );
}

function emphasis(html: string): string {
  return html
    .replace(/\*\*(?=\S)(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(?=\S)(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(?=\S)([^*]+?)\*/g, "<em>$1</em>")
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, "$1<em>$2</em>");
}
