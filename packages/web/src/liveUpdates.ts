import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "./queries";

/** One committed write, as /events publishes it. recordKind is the snake_case CONTEXT.md noun. */
export interface ChangeEvent {
  home: string;
  recordKind: string;
  recordSlug: string;
}

/** The queries that show records of a kind, so a change to one refetches only those. */
export function queriesShowing(recordKind: string, home: string): QueryKey[] {
  switch (recordKind) {
    case "home":
      return [queryKeys.homes, queryKeys.home(home)];
    case "level":
    case "room":
      return [queryKeys.home(home)];
    case "session":
      return [queryKeys.sessions(home)];
    default:
      return queriesOfHome(home);
  }
}

function queriesOfHome(home: string): QueryKey[] {
  return [queryKeys.homes, queryKeys.home(home), queryKeys.sessions(home)];
}

/**
 * Keeps one Home's queries fresh while the page is open: each change event invalidates the
 * queries showing that record kind, and after a dropped connection comes back (the browser
 * retries on its own) everything for the Home is refetched, since changes may have been missed.
 */
export function useLiveUpdates(home: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const invalidate = (keys: QueryKey[]) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    };
    const events = new EventSource(`/events?home=${encodeURIComponent(home)}`);
    let dropped = false;
    events.addEventListener("change", (event: MessageEvent<string>) => {
      const change = JSON.parse(event.data) as ChangeEvent;
      invalidate(queriesShowing(change.recordKind, change.home));
    });
    events.addEventListener("error", () => {
      dropped = true;
    });
    events.addEventListener("open", () => {
      if (!dropped) return;
      dropped = false;
      invalidate(queriesOfHome(home));
    });
    return () => events.close();
  }, [home, queryClient]);
}
