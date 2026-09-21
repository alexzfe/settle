import { act, cleanup } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { useScrollToHash } from "./scrollToHash";
import { renderRoutes } from "./testSupport";

afterEach(() => {
  cleanup();
  // jsdom has no scrollIntoView; the test defines one.
  delete (Element.prototype as Partial<Element>).scrollIntoView;
});

/** A page whose #quick-guide section appears only once its data "arrives". */
function SlowPage() {
  useScrollToHash();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoaded(true), 10);
    return () => clearTimeout(timer);
  }, []);
  return loaded ? <section id="quick-guide">Quick Guide</section> : <p>Loading…</p>;
}

it("scrolls to the section a link's hash names once the page has rendered it", async () => {
  const scrolled: string[] = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  renderRoutes("/page#quick-guide", [{ path: "/page", element: <SlowPage /> }]);
  expect(scrolled).toEqual([]);
  await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
  expect(scrolled).toEqual(["quick-guide"]);
});
