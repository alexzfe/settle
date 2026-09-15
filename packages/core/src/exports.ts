import type { DecisionDetail, FullGuide, Listing, QuickGuideLine } from "./operations/schemas.js";
import { DECISION_STATE_LABELS as STATES } from "./render.js";

// The files the web serves as they are, rendered from stored data only (docs/poc-design.md#web-ui):
// the Shopping List as a printable page and CSV, the Shopping Guides as a printable page and
// Markdown, and the Quick Guide's phone page. Every page is static HTML with no JavaScript, and
// every stored text is escaped, the Full Guide's Markdown included.

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

/** The Shopping List as a printable page: each Purchase with a box to tick. */
export function renderShoppingListPage(home: ExportHome, purchases: DecisionDetail[]): string {
  const body = [
    "<header>",
    "<h1>Shopping List</h1>",
    `<p class="home">${escapeHtml(home.name)}</p>`,
    "</header>",
  ];
  if (purchases.length === 0) {
    body.push(
      "<p>Nothing is on the Shopping List yet: no Purchase is Locked and waiting to be bought.</p>",
    );
  }
  for (const purchase of purchases) {
    body.push(
      '<section class="purchase">',
      `<h2><span class="box"></span>${escapeHtml(purchase.title)}</h2>`,
      `<p class="meta">${escapeHtml(place(purchase))}</p>`,
      `<p>${escapeHtml(purchase.statement)}</p>`,
      ...measureFirstHtml(purchase),
      ...listHtml(3, "Must", requirementTexts(purchase, "must")),
      ...listHtml(3, "Prefer", requirementTexts(purchase, "prefer")),
      ...listHtml(3, "Listings", purchase.listings.map(listingText)),
      "</section>",
    );
  }
  return htmlPage(`Shopping List: ${home.name}`, PRINT_STYLE, body);
}

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
 * The Shopping Guides as Markdown: per Purchase its Quick Guide, then its Full Guide with its
 * headings moved under the Purchase's own.
 */
export function renderGuidesMarkdown(home: ExportHome, purchases: DecisionDetail[]): string {
  const out = [`# Shopping Guides: ${home.name}`];
  if (purchases.length === 0) out.push("", "_No Purchase has Guides yet._");
  for (const purchase of purchases) {
    out.push("", `## ${purchase.title}`, "", about(purchase), "", purchase.statement);
    const bought = boughtText(purchase);
    if (bought) out.push("", bought);
    out.push("", "### Quick Guide");
    const measure = linesOf(purchase, "measure-first");
    if (measure.length > 0) out.push("", ...measure.map((line) => `- **Measure first:** ${line}`));
    for (const [label, lines] of quickSections(purchase)) {
      out.push("", `**${label}**`, "", ...lines.map((line) => `- ${line}`));
    }
    if (measure.length === 0 && quickSections(purchase).length === 0) {
      out.push("", "_Nothing to check yet: it has no Requirements._");
    }
    out.push("", "### Full Guide", "");
    const full = purchase.guides?.fullGuide;
    if (full?.markdown === undefined) out.push("_No Full Guide written yet._");
    else out.push(`_${fullGuideState(full)}_`, "", demoteMarkdown(full.markdown, 4));
  }
  return `${out.join("\n")}\n`;
}

/** The Shopping Guides as a printable page, each Purchase on a page of its own. */
export function renderGuidesPage(home: ExportHome, purchases: DecisionDetail[]): string {
  const body = [
    "<header>",
    "<h1>Shopping Guides</h1>",
    `<p class="home">${escapeHtml(home.name)}</p>`,
    "</header>",
  ];
  if (purchases.length === 0) body.push("<p>No Purchase has Guides yet.</p>");
  for (const purchase of purchases) {
    body.push(
      '<article class="purchase guide">',
      `<h2>${escapeHtml(purchase.title)}</h2>`,
      `<p class="meta">${escapeHtml(about(purchase))}</p>`,
      `<p>${escapeHtml(purchase.statement)}</p>`,
    );
    const bought = boughtText(purchase);
    if (bought) body.push(`<p><strong>${escapeHtml(bought)}</strong></p>`);
    body.push("<h3>Quick Guide</h3>", ...measureFirstHtml(purchase));
    for (const [label, lines] of quickSections(purchase)) body.push(...listHtml(4, label, lines));
    if (linesOf(purchase, "measure-first").length === 0 && quickSections(purchase).length === 0) {
      body.push("<p>Nothing to check yet: it has no Requirements.</p>");
    }
    body.push("<h3>Full Guide</h3>");
    const full = purchase.guides?.fullGuide;
    if (full?.markdown === undefined) body.push("<p>No Full Guide written yet.</p>");
    else {
      body.push(
        `<p class="meta">${escapeHtml(fullGuideState(full))}</p>`,
        markdownToHtml(full.markdown, 4),
      );
    }
    body.push("</article>");
  }
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

/**
 * The Quick Guide on a phone in the shop: Measure first at the top, then the musts, the prefers,
 * and the AI's own lines, with the Full Guide folded away under one tap. No JavaScript.
 */
export function renderGuidePage(home: ExportHome, purchase: DecisionDetail): string {
  const body = [
    "<main>",
    `<p class="home">${escapeHtml(home.name)} · ${escapeHtml(place(purchase))}</p>`,
    `<h1>${escapeHtml(purchase.title)}</h1>`,
    `<p>${escapeHtml(purchase.statement)}</p>`,
  ];
  const bought = boughtText(purchase);
  if (bought) body.push(`<p class="done">${escapeHtml(bought)}</p>`);
  const measure = linesOf(purchase, "measure-first");
  if (measure.length > 0) {
    body.push('<section class="measure">', ...listHtml(2, "Measure first", measure), "</section>");
  }
  const sections = quickSections(purchase);
  for (const [label, lines] of sections) {
    body.push("<section>", ...listHtml(2, label, lines), "</section>");
  }
  if (measure.length === 0 && sections.length === 0) {
    body.push("<p>Nothing to check yet: this Purchase has no Requirements.</p>");
  }
  const full = purchase.guides?.fullGuide;
  if (full?.markdown !== undefined) {
    body.push("<details>", "<summary>Full Guide</summary>");
    if (full.outOfDate) {
      body.push('<p class="stale">Out of date: a Requirement changed after it was written.</p>');
    }
    body.push(markdownToHtml(full.markdown, 3), "</details>");
  }
  body.push("</main>");
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

/** The Quick Guide's sections after Measure first, those with lines only. */
function quickSections(purchase: DecisionDetail): [string, string[]][] {
  const sections: [string, string[]][] = [
    ["Must", linesOf(purchase, "must")],
    ["Prefer", linesOf(purchase, "prefer")],
    ["In the shop", linesOf(purchase, "line")],
  ];
  return sections.filter(([, lines]) => lines.length > 0);
}

function requirementTexts(purchase: DecisionDetail, strength: "must" | "prefer"): string[] {
  return purchase.requirements
    .filter((requirement) => requirement.strength === strength)
    .map((requirement) => requirement.text);
}

function hasGuides(purchase: DecisionDetail): boolean {
  const { guides } = purchase;
  return guides !== undefined && (guides.quickLines.length > 0 || guides.fullGuide !== undefined);
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

function measureFirstHtml(purchase: DecisionDetail): string[] {
  return linesOf(purchase, "measure-first").map(
    (line) => `<p class="measure"><strong>Measure first:</strong> ${escapeHtml(line)}</p>`,
  );
}

function listHtml(level: number, title: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [
    `<h${level}>${escapeHtml(title)}</h${level}>`,
    "<ul>",
    ...items.map((item) => `<li>${escapeHtml(item)}</li>`),
    "</ul>",
  ];
}

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

const PRINT_STYLE = `
body { font: 11pt/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1a1a1a;
  max-width: 46rem; margin: 2rem auto; padding: 0 1rem; }
h1 { font-size: 1.6rem; margin: 0; }
h2 { font-size: 1.25rem; margin: 0 0 0.2rem; }
h3, h4 { margin: 1rem 0 0.3rem; }
.home, .meta { color: #555; margin: 0.2rem 0 0; }
.purchase { border-top: 1px solid #ccc; margin-top: 1.5rem; padding-top: 1rem; break-inside: avoid; }
.box { display: inline-block; width: 0.8em; height: 0.8em; border: 1.5px solid #333;
  margin-right: 0.5em; vertical-align: -0.05em; }
.measure { background: #fff4d6; border-left: 4px solid #d99a00; padding: 0.3rem 0.6rem; }
ul { margin: 0.2rem 0; padding-left: 1.3rem; }
@media print {
  body { margin: 0; max-width: none; }
  a { color: inherit; }
  .guide { break-inside: auto; }
  .guide + .guide { break-before: page; border-top: none; }
}
`;

const PHONE_STYLE = `
:root { color-scheme: light dark; --ink: #1a1a1a; --muted: #5c5c5c; --paper: #fff;
  --mark: #fff4d6; --edge: #d99a00; }
@media (prefers-color-scheme: dark) {
  :root { --ink: #ececec; --muted: #a8a8a8; --paper: #141414; --mark: #3a2e0c; --edge: #e0a82e; }
}
body { margin: 0; background: var(--paper); color: var(--ink);
  font: 1.125rem/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
main { max-width: 38rem; margin: 0 auto; padding: 1rem 1.1rem 3rem; }
h1 { font-size: 1.6rem; line-height: 1.2; margin: 0.2rem 0 0.4rem; }
h2 { font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted);
  margin: 1.4rem 0 0.3rem; }
h3, h4, h5, h6 { font-size: 1.1rem; margin: 1.2rem 0 0.3rem; }
p { margin: 0.4rem 0; }
.home { color: var(--muted); font-size: 0.95rem; margin: 0; }
ul { margin: 0; padding-left: 1.3rem; }
li { margin: 0.4rem 0; }
.measure { background: var(--mark); border-left: 5px solid var(--edge); border-radius: 4px;
  padding: 0.1rem 0.9rem 0.5rem; margin-top: 1rem; }
.measure h2 { color: var(--ink); }
.done, .stale { font-weight: 600; }
details { margin-top: 2rem; border-top: 1px solid var(--muted); padding-top: 0.6rem; }
summary { font-weight: 600; padding: 0.5rem 0; }
a { color: inherit; }
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
