import type { ChangeEvent, RecordKind } from "@settle/core";
import { type QueryKey, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, call } from "./api";
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
// Home, its Rooms and their parts, and its Items, so a change to any of them refetches it. The find
// box's index holds Rooms (named by their Level), Decisions with their Listings, Items, and
// Features, so a change to any of those refetches it: that is all that keeps the box fresh.
function showing(recordKind: RecordKind, home: string): QueryKey[] | undefined {
  switch (recordKind) {
    case "home":
      return [queryKeys.homes, queryKeys.home(home), queryKeys.shopping(home)];
    // The Home page lists Levels and Rooms; a Room page names its Level and the Rooms beyond it.
    // Blueprint pages name the Level they show.
    case "level":
      return [
        queryKeys.home(home),
        queryKeys.rooms(home),
        queryKeys.blueprints(home),
        queryKeys.findIndex(home),
      ];
    case "room":
      return [
        queryKeys.home(home),
        queryKeys.rooms(home),
        queryKeys.shopping(home),
        queryKeys.findIndex(home),
      ];
    // Parts of a Room show only on Room pages. A Door is on two, so every Room page refetches.
    case "wall":
    case "window":
    case "door":
    case "surface":
      return [queryKeys.rooms(home), queryKeys.shopping(home)];
    case "feature":
      return [queryKeys.rooms(home), queryKeys.shopping(home), queryKeys.findIndex(home)];
    // The Home page counts the Unplaced Items.
    case "item":
      return [
        queryKeys.items(home),
        queryKeys.itemPages(home),
        queryKeys.rooms(home),
        queryKeys.home(home),
        queryKeys.shopping(home),
        queryKeys.findIndex(home),
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
    // shows its Basis's states, so one change refetches them all. Listings and Guides are logged
    // as their Decision's changes, so the find index refetches on those too. An Item's page
    // shows the Decisions tied to it, the Requirements citing it, and its Listing's picture, all
    // logged as Decision changes, so every Item page refetches as well.
    case "decision":
    case "flag":
    case "conflict":
      return [
        queryKeys.decisions(home),
        queryKeys.itemPages(home),
        queryKeys.rooms(home),
        queryKeys.shopping(home),
        queryKeys.findIndex(home),
      ];
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
    queryKeys.itemPages(home),
    queryKeys.constraints(home),
    queryKeys.notes(home),
    queryKeys.changeLog(home),
    queryKeys.blueprints(home),
    queryKeys.decisions(home),
    queryKeys.shopping(home),
    queryKeys.findIndex(home),
  ];
}

/**
 * How the live connection stands: connecting at first, live once open, reconnecting while a
 * dropped connection is retried, and stopped when there is nothing left to retry for (the Home is
 * not found, or the Login ran out), so only a reload can help.
 */
export type LiveState = "connecting" | "live" | "reconnecting" | "stopped";

/** What an "agent" event carries: the time of the Agent's last MCP tool call for the Home. */
export interface AgentEvent {
  home: string;
  at: string;
}

/**
 * Where the last Agent call is kept: in the query cache, never fetched, only set by the events.
 * Kept out of queriesOfHome, so a refetch-everything leaves it be; the server resends it on
 * reconnect anyway.
 */
export const agentCallKey = (home: string): QueryKey => ["agent-call", home];

/**
 * When the Agent last made an MCP tool call for the Home, as an ISO timestamp, while
 * useLiveUpdates keeps the Home live; undefined when none since the server started.
 */
export function useLastAgentCall(home: string): string | undefined {
  return useQuery<string>({ queryKey: agentCallKey(home), queryFn: skipToken }).data;
}

// EventSource.CLOSED, spelled out so a stand-in EventSource without the constants still works.
const CLOSED = 2;

/** How long to wait before opening a new stream after the browser gave up on one: it doubles. */
const FIRST_RETRY_MS = 2000;
const LAST_RETRY_MS = 30_000;
/**
 * How many streams in a row may be refused while the Home itself answers before giving up: the
 * server is up, so the refusal is not a passing restart (a proxy that drops /events, say).
 */
const REFUSALS_WHILE_UP = 5;

/**
 * Keeps one Home's queries fresh while its pages are open: each change event invalidates the
 * queries showing that record kind, and after a dropped connection comes back everything for the
 * Home is refetched, since changes may have been missed. The browser retries a dropped stream on
 * its own, but gives up for good when a retry is refused (the 502 while the server restarts on a
 * deploy); then a new stream is opened after a wait that doubles from 2 to 30 seconds. It stops
 * when the Login has run out (the call answered 401 goes to the login page), when the Home is not
 * found, or when the stream is refused five times in a row while the Home answers. Each agent event is kept for useLastAgentCall. Returns how the connection stands.
 */
export function useLiveUpdates(home: string): LiveState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<LiveState>("connecting");
  useEffect(() => {
    const invalidate = (keys: QueryKey[]) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    };
    let events: EventSource | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let wait = FIRST_RETRY_MS;
    let dropped = false;
    let refusedWhileUp = 0;
    let ended = false;

    const connect = () => {
      const source = new EventSource(`/events?home=${encodeURIComponent(home)}`);
      events = source;
      source.addEventListener("change", (event: MessageEvent<string>) => {
        const change = JSON.parse(event.data) as ChangeEvent;
        invalidate(queriesShowing(change.recordKind, change.home));
      });
      source.addEventListener("agent", (event: MessageEvent<string>) => {
        const agent = JSON.parse(event.data) as AgentEvent;
        queryClient.setQueryData(agentCallKey(agent.home), agent.at);
      });
      source.addEventListener("error", () => {
        dropped = true;
        if (source.readyState !== CLOSED) {
          setState("reconnecting");
          return;
        }
        source.close();
        void giveUpOrRetry();
      });
      source.addEventListener("open", () => {
        setState("live");
        wait = FIRST_RETRY_MS;
        refusedWhileUp = 0;
        if (!dropped) return;
        dropped = false;
        invalidate(queriesOfHome(home));
      });
    };

    // The browser does not say why it gave up. An ordinary call does: a 401 (the Login ran out)
    // goes to the login page, and not_found means there is no such Home to follow.
    const giveUpOrRetry = async () => {
      setState("reconnecting");
      const stop = await call("get_home", { home }).then(
        () => ++refusedWhileUp >= REFUSALS_WHILE_UP,
        (error: unknown) =>
          error instanceof ApiError && (error.status === 401 || error.code === "not_found"),
      );
      if (ended) return;
      if (stop) {
        setState("stopped");
        return;
      }
      retry = setTimeout(connect, wait);
      wait = Math.min(wait * 2, LAST_RETRY_MS);
    };

    setState("connecting");
    connect();
    return () => {
      ended = true;
      clearTimeout(retry);
      events?.close();
    };
  }, [home, queryClient]);
  return state;
}
