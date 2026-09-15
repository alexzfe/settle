import type { ChangeEvent, RecordKind } from "@idh/core";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "./queries";

/**
 * The queries that show records of a kind, so a change to one refetches only those. Every write
 * also adds to the change log.
 */
export function queriesShowing(recordKind: string, home: string): QueryKey[] {
  const shown = showing(recordKind as RecordKind, home);
  return shown ? [...shown, queryKeys.changeLog(home)] : queriesOfHome(home);
}

// The Shopping section names each Purchase's Room, and its Measure-first lines read values of the
// Home, its Rooms and their parts, and its Items, so a change to any of them refetches it.
function showing(recordKind: RecordKind, home: string): QueryKey[] | undefined {
  switch (recordKind) {
    case "home":
      return [queryKeys.homes, queryKeys.home(home), queryKeys.shopping(home)];
    // The Home page lists Levels and Rooms; a Room page names its Level and the Rooms beyond it.
    // Blueprint pages name the Level they show.
    case "level":
      return [queryKeys.home(home), queryKeys.rooms(home), queryKeys.blueprints(home)];
    case "room":
      return [queryKeys.home(home), queryKeys.rooms(home), queryKeys.shopping(home)];
    // Parts of a Room show only on Room pages. A Door is on two, so every Room page refetches.
    case "wall":
    case "window":
    case "door":
    case "surface":
    case "feature":
      return [queryKeys.rooms(home), queryKeys.shopping(home)];
    // The Home page counts the Unplaced Items.
    case "item":
      return [
        queryKeys.items(home),
        queryKeys.rooms(home),
        queryKeys.home(home),
        queryKeys.shopping(home),
      ];
    case "constraint":
      return [queryKeys.constraints(home)];
    case "note":
      return [queryKeys.notes(home)];
    case "session":
      return [queryKeys.sessions(home)];
    // The Home page lists the Blueprints, and each page viewer reads the list.
    case "blueprint":
      return [queryKeys.home(home), queryKeys.blueprints(home)];
    // Every Decision query (the list, each Decision page with its Guides, Listings, and
    // Fulfilment, the Home page's flags and Conflicts), the Room pages, which list their Room's
    // Decisions, and the Shopping section. A state change may flag others, and a Decision's page
    // shows its Basis's states, so one change refetches them all.
    case "decision":
    case "flag":
    case "conflict":
      return [queryKeys.decisions(home), queryKeys.rooms(home), queryKeys.shopping(home)];
    default:
      return unmapped(recordKind);
  }
}

/**
 * A record kind core publishes that the switch above lacks fails to type-check here. At run time
 * a kind from a newer server gets undefined, and everything for the Home is refetched.
 */
function unmapped(_recordKind: never): undefined {
  return undefined;
}

function queriesOfHome(home: string): QueryKey[] {
  return [
    queryKeys.homes,
    queryKeys.home(home),
    queryKeys.sessions(home),
    queryKeys.rooms(home),
    queryKeys.items(home),
    queryKeys.constraints(home),
    queryKeys.notes(home),
    queryKeys.changeLog(home),
    queryKeys.blueprints(home),
    queryKeys.decisions(home),
    queryKeys.shopping(home),
  ];
}

/**
 * Keeps one Home's queries fresh while its pages are open: each change event invalidates the
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
