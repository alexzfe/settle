import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { headings, Markdown } from "./Markdown";

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

it("renders GitHub alerts as Callouts, their lines as Markdown of their own", () => {
  const { container } = render(
    <Markdown
      markdown={"> [!TIP]\n> Measure **twice**.\n> - once\n\n> [!caution]\n> Viscose sheds."}
    />,
  );
  const callouts = [...container.querySelectorAll("aside")];
  expect(callouts.map((aside) => aside.firstElementChild?.textContent)).toEqual(["Tip", "Caution"]);
  expect(callouts[0]?.querySelector("strong")?.textContent).toBe("twice");
  expect(callouts[0]?.querySelector("li")?.textContent).toBe("once");
  expect(callouts[1]?.querySelector("p:last-child")?.textContent).toBe("Viscose sheds.");
  // A plain quote stays a quote, and a marker later in a quote is only text.
  expect(html("> Measure\n> [!TIP]")).toBe("<blockquote>Measure [!TIP]</blockquote>");
});

it("gives headings unique anchors when asked, for a table of contents", () => {
  expect(headings("# Size & access\n## Pile\n# Size & access", "guide")).toEqual([
    { level: 1, text: "Size & access", id: "guide-size-access" },
    { level: 2, text: "Pile", id: "guide-pile" },
    { level: 1, text: "Size & access", id: "guide-size-access-2" },
  ]);
  const { container } = render(<Markdown markdown={"# Size\n## Pile"} level={3} anchors="g" />);
  expect(container.innerHTML).toBe('<h3 id="g-size">Size</h3><h4 id="g-pile">Pile</h4>');
});
