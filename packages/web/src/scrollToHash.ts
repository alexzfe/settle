import { useEffect } from "react";
import { useLocation } from "react-router";

/** How long to wait for an anchored section to appear before giving up. */
const PATIENCE_MS = 5000;

/**
 * Scrolls to the element a link's #hash names once it is on the page. The browser does this only
 * on a full page load: a link inside the app lands on a page that is still fetching, so the
 * section it names (a Purchase's #quick-guide, say) appears a moment later.
 */
export function useScrollToHash(): void {
  const { hash, key } = useLocation();
  // key re-runs it for each navigation, even to the same hash.
  useEffect(() => {
    const id = decodeURIComponent(hash.slice(1));
    if (!id) return;
    const land = () => {
      const target = document.getElementById(id);
      if (!target) return false;
      target.scrollIntoView?.({ block: "start" });
      return true;
    };
    if (land()) return;
    const watch = new MutationObserver(() => {
      if (land()) stop();
    });
    const timer = setTimeout(() => stop(), PATIENCE_MS);
    const stop = () => {
      watch.disconnect();
      clearTimeout(timer);
    };
    watch.observe(document.body, { childList: true, subtree: true });
    return stop;
  }, [hash, key]);
}
