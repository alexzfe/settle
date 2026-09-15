import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { Markdown } from "./Markdown";

afterEach(cleanup);

function html(markdown: string, level?: number): string {
  const { container, unmount } = render(
    <Markdown markdown={markdown} {...(level ? { level } : {})} />,
  );
  const shown = container.innerHTML;
  unmount();
  return shown;
}

it("turns headings into the levels below the one it sits under", () => {
  expect(html("# Size\n## Pile\n###### Deepest", 3)).toBe(
    "<h3>Size</h3><h4>Pile</h4><h6>Deepest</h6>",
  );
  expect(html("# Size ##")).toBe("<h1>Size</h1>");
});

it("joins a paragraph's lines, and a blank line starts the next", () => {
  expect(html("Wool stands up\nto claws.\n\nLinen does not.")).toBe(
    "<p>Wool stands up to claws.</p><p>Linen does not.</p>",
  );
});

it("renders lists, continuing an item on the line after it", () => {
  expect(html("- Wool\n- Jute,\n  hard-wearing\n\n1. Measure\n2) Buy")).toBe(
    "<ul><li>Wool</li><li>Jute, hard-wearing</li></ul><ol><li>Measure</li><li>Buy</li></ol>",
  );
  expect(html("* one\n+ two")).toBe("<ul><li>one</li><li>two</li></ul>");
});

it("renders quotes, rules, and code blocks, leaving the code as written", () => {
  expect(html("> Measure\n> twice\n\n---\n\n```\n**not bold** <b>\n- not a list\n```")).toBe(
    "<blockquote>Measure twice</blockquote><hr>" +
      "<pre><code>**not bold** &lt;b&gt;\n- not a list</code></pre>",
  );
});

it("renders strong, emphasis, and code inline, but not underscores inside a word", () => {
  expect(html("**at least** 2 m, *low* pile, __wool__ or _jute_, `LRV 62`, snake_case_name")).toBe(
    "<p><strong>at least</strong> 2 m, <em>low</em> pile, <strong>wool</strong> or " +
      "<em>jute</em>, <code>LRV 62</code>, snake_case_name</p>",
  );
  expect(html("**a *low* pile**")).toBe("<p><strong>a <em>low</em> pile</strong></p>");
});

it("links only to web pages and email addresses, and passes no HTML through", () => {
  expect(html("See [the care notes](https://example.com/care).")).toBe(
    '<p>See <a href="https://example.com/care" target="_blank" rel="noreferrer">' +
      "the care notes</a>.</p>",
  );
  expect(html("[click](javascript:alert(1)) <script>alert(1)</script>")).toBe(
    "<p>click) &lt;script&gt;alert(1)&lt;/script&gt;</p>",
  );
});
