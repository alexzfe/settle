// Markdown the Agent writes (the Full Guide), rendered without a library: headings, paragraphs,
// lists, quotes, code blocks, rules, and inline strong, emphasis, code, and links. Anything else
// reads as plain text. No HTML passes through: every part becomes a React element, and a link
// is kept only when it goes to a web page or an email address.

import { createElement, type ReactNode } from "react";

/** One block of a Markdown text, keyed by the line it starts on. */
export type Block = { line: number } & (
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: { line: number; text: string }[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string }
  | { kind: "rule" }
);

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;
const ITEM = /^\s*(?:([-*+])|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** The blocks of a Markdown text, in order. A line after a paragraph, item, or quote continues it. */
export function blocks(markdown: string): Block[] {
  const found: Block[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  // The paragraph, list, or quote the next line may continue.
  let open: Block | undefined;
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line] ?? "";
    if (FENCE.test(text)) {
      const start = line;
      const code: string[] = [];
      for (line++; line < lines.length && !FENCE.test(lines[line] ?? ""); line++) {
        code.push(lines[line] ?? "");
      }
      found.push({ line: start, kind: "code", text: code.join("\n") });
      open = undefined;
      continue;
    }
    if (text.trim() === "") {
      open = undefined;
      continue;
    }
    const heading = HEADING.exec(text);
    if (heading) {
      found.push({ line, kind: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      open = undefined;
      continue;
    }
    if (RULE.test(text)) {
      found.push({ line, kind: "rule" });
      open = undefined;
      continue;
    }
    const item = ITEM.exec(text);
    if (item) {
      const ordered = item[1] === undefined;
      const entry = { line, text: item[2] ?? "" };
      if (open?.kind === "list" && open.ordered === ordered) {
        open.items.push(entry);
      } else {
        open = { line, kind: "list", ordered, items: [entry] };
        found.push(open);
      }
      continue;
    }
    const quote = QUOTE.exec(text);
    if (quote) {
      if (open?.kind === "quote") {
        open.text = `${open.text} ${quote[1] ?? ""}`;
      } else {
        open = { line, kind: "quote", text: quote[1] ?? "" };
        found.push(open);
      }
      continue;
    }
    const words = text.trim();
    if (open?.kind === "paragraph" || open?.kind === "quote") {
      open.text = `${open.text} ${words}`;
    } else if (open?.kind === "list") {
      const last = open.items.at(-1);
      if (last) last.text = `${last.text} ${words}`;
    } else {
      open = { line, kind: "paragraph", text: words };
      found.push(open);
    }
  }
  return found;
}

// `code`, **strong** or __strong__, *emphasis* or _emphasis_ (not inside a word), [label](href).
const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|(?<![\p{L}\p{N}_])__(.+?)__(?![\p{L}\p{N}_])|\*(?!\s)(.+?)\*|(?<![\p{L}\p{N}_])_(?!\s)(.+?)_(?![\p{L}\p{N}_])|\[([^\]]+)\]\(([^)\s]+)\)/gu;

const SAFE_LINK = /^(?:https?:|mailto:)/i;

/** Whether a link goes to a web page or an email address, the only links the pages follow. */
export function isSafeLink(href: string): boolean {
  return SAFE_LINK.test(href);
}

/** A line's inline marks as elements, keyed by where each starts in the line. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > at) parts.push(text.slice(at, start));
    const [, code, asterisks, underscores, asterisk, underscore, label, href] = match;
    const strong = asterisks ?? underscores;
    const emphasis = asterisk ?? underscore;
    if (code !== undefined) {
      parts.push(<code key={start}>{code}</code>);
    } else if (strong !== undefined) {
      parts.push(<strong key={start}>{inline(strong)}</strong>);
    } else if (emphasis !== undefined) {
      parts.push(<em key={start}>{inline(emphasis)}</em>);
    } else if (label !== undefined && href !== undefined && SAFE_LINK.test(href)) {
      parts.push(
        <a key={start} href={href} target="_blank" rel="noreferrer">
          {inline(label)}
        </a>,
      );
    } else if (label !== undefined) {
      parts.push(...inline(label));
    }
    at = start + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/**
 * `markdown` as elements. Its # headings become h`level` (the level below the heading it sits
 * under on the page), ## the next level down, and so on to h6.
 */
export function Markdown({ markdown, level = 1 }: { markdown: string; level?: number }) {
  return blocks(markdown).map((block) => element(block, level));
}

function element(block: Block, level: number): ReactNode {
  const key = block.line;
  switch (block.kind) {
    case "heading":
      return createElement(`h${Math.min(6, level + block.level - 1)}`, { key }, inline(block.text));
    case "paragraph":
      return <p key={key}>{inline(block.text)}</p>;
    case "list": {
      const items = block.items.map((item) => <li key={item.line}>{inline(item.text)}</li>);
      return block.ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>;
    }
    case "quote":
      return <blockquote key={key}>{inline(block.text)}</blockquote>;
    case "code":
      return (
        <pre key={key}>
          <code>{block.text}</code>
        </pre>
      );
    case "rule":
      return <hr key={key} />;
  }
}
