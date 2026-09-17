// The browser tab's title, kept in step with the page: "Living room · House".

import { createContext, useContext, useEffect } from "react";

/** The shown Home's name, provided by the Home's layout; undefined outside a Home. */
export const HomeNameContext = createContext<string | undefined>(undefined);

/** The tab title for a page: its name, then the Home's, then the app's. */
export function documentTitle(...parts: (string | undefined)[]): string {
  return [...parts, "Interior Design Harness"].filter(Boolean).join(" · ");
}

/**
 * Sets the tab title to "<title> · <Home>" while the page is shown. The Home layout sets the
 * section's title first (in a layout effect), so a page calling this refines it.
 */
export function useDocumentTitle(title: string | undefined) {
  const home = useContext(HomeNameContext);
  useEffect(() => {
    if (title) document.title = documentTitle(title, home);
  }, [title, home]);
}
