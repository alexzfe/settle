import { keepPreviousData, QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { ApiError, call, type ListDecisionsInput } from "./api";

/**
 * Query keys, one family per record kind the pages show. A key without its last parts is the
 * prefix of the longer ones, so invalidating `rooms(home)` refreshes every Room page of the Home.
 */
export const queryKeys = {
  homes: ["homes"],
  home: (home: string) => ["home", home],
  sessions: (home: string) => ["sessions", home],
  rooms: (home: string) => ["room", home],
  room: (home: string, room: string) => ["room", home, room],
  items: (home: string) => ["items", home],
  /** The Item pages, each ending in its Item's slug. */
  itemPages: (home: string) => ["item", home],
  item: (home: string, item: string) => ["item", home, item],
  constraints: (home: string) => ["constraints", home],
  notes: (home: string) => ["notes", home],
  changeLog: (home: string) => ["change-log", home],
  blueprints: (home: string) => ["blueprints", home],
  /** The Decision lists, each ending in its filter, and the Decision pages, in the slug. */
  decisions: (home: string) => ["decisions", home],
  decision: (home: string, decision: string) => ["decisions", home, decision],
  /** A Purchase with its Full Guide in full, refreshed whenever its Decision page is. */
  fullGuide: (home: string, decision: string) => ["decisions", home, decision, "full-guide"],
  /** The Shopping section: the Purchases, with Measure-first lines from recorded values. */
  shopping: (home: string) => ["shopping", home],
  /** The find box's index: every findable record of the Home, fetched once and matched locally. */
  findIndex: (home: string) => ["find-index", home],
  /** The Account logged in, and its Logins. */
  account: ["account"],
  logins: ["account", "logins"],
  connections: ["account", "connections"],
  claudeConnect: ["claude-connect"],
  /** The Admin's lists: waiting invites, and every Account. */
  invites: ["admin", "invites"],
  accounts: ["admin", "accounts"],
} as const;

/** The Account logged in: its email, and whether it is the Admin. */
export function useAccount() {
  return useQuery({
    queryKey: queryKeys.account,
    queryFn: () => call("get_account", {}),
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export function useHomes() {
  return useQuery({ queryKey: queryKeys.homes, queryFn: () => call("list_homes", {}) });
}

export function useHome(home: string) {
  return useQuery({ queryKey: queryKeys.home(home), queryFn: () => call("get_home", { home }) });
}

/** The browser's IANA time zone, such as "America/Lima". */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Gives a Home made before time zones the browser's, once, when its owner opens it: core dates a
 * Photo or a purchase in the Home's day, and a Home with none is dated in the server's UTC one.
 */
export function useHomeTimeZone(home: string) {
  const queryClient = useQueryClient();
  const facts = useHome(home).data?.home;
  const missing = facts !== undefined && facts.timeZone === undefined;
  const sent = useRef(false);
  useEffect(() => {
    if (!missing || sent.current) return;
    sent.current = true;
    call("set_home_time_zone", { home, timeZone: browserTimeZone(), onlyIfNone: true })
      .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.home(home) }))
      .catch(() => {
        // Nothing to show: the Home keeps UTC's days, and the next visit tries again.
      });
  }, [home, missing, queryClient]);
}

export function useSessions(home: string) {
  return useQuery({
    queryKey: queryKeys.sessions(home),
    queryFn: () => call("list_sessions", { home }),
  });
}

export function useRoom(home: string, room: string) {
  return useQuery({
    queryKey: queryKeys.room(home, room),
    queryFn: () => call("get_room", { home, room }),
  });
}

// The lists with an Archived toggle keep showing the previous answer while the other one loads.

export function useItems(home: string, archived: boolean) {
  return useQuery({
    queryKey: [...queryKeys.items(home), { archived }],
    queryFn: () => call("list_items", { home, archived }),
    placeholderData: keepPreviousData,
  });
}

export function useItem(home: string, item: string) {
  return useQuery({
    queryKey: queryKeys.item(home, item),
    queryFn: () => call("get_item", { home, item }),
  });
}

export function useConstraints(home: string, archived: boolean) {
  return useQuery({
    queryKey: [...queryKeys.constraints(home), { archived }],
    queryFn: () => call("list_constraints", { home, archived }),
    placeholderData: keepPreviousData,
  });
}

export function useNotes(home: string) {
  return useQuery({ queryKey: queryKeys.notes(home), queryFn: () => call("list_notes", { home }) });
}

export function useChangeLog(home: string) {
  return useQuery({
    queryKey: queryKeys.changeLog(home),
    queryFn: () => call("get_change_log", { home }),
  });
}

export function useBlueprints(home: string) {
  return useQuery({
    queryKey: queryKeys.blueprints(home),
    queryFn: () => call("list_blueprints", { home }),
  });
}

export type DecisionFilter = Omit<ListDecisionsInput, "home">;

/** The Decisions matching `filter`, keeping the previous answer on screen while another loads. */
export function useDecisions(home: string, filter: DecisionFilter = {}) {
  return useQuery({
    queryKey: [...queryKeys.decisions(home), filter],
    queryFn: () => call("list_decisions", { home, ...filter }),
    placeholderData: keepPreviousData,
  });
}

export function useDecision(home: string, decision: string) {
  return useQuery({
    queryKey: queryKeys.decision(home, decision),
    queryFn: () => call("get_decision", { home, decision }),
  });
}

/** A Purchase with its Full Guide in full, fetched only once `enabled`: one tap away. */
export function useFullGuide(home: string, decision: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.fullGuide(home, decision),
    queryFn: () => call("get_decision", { home, decision, includeFullGuide: true }),
    enabled,
  });
}

export function useShopping(home: string) {
  return useQuery({
    queryKey: queryKeys.shopping(home),
    queryFn: () => call("get_shopping", { home }),
  });
}

/**
 * The find box's index, fetched once per Home and refetched only by live updates: the box matches
 * it in the browser on every keystroke, never asking the server while the user types.
 */
export function useFindIndex(home: string) {
  return useQuery({
    queryKey: queryKeys.findIndex(home),
    queryFn: () => call("find_index", { home }),
  });
}

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (failureCount, error) => failureCount < 3 && mayAnswerSoon(error) },
    },
  });
}

/** What a proxy answers while the server behind it restarts, as on every deploy. */
const RESTARTING = new Set([502, 503, 504]);

/**
 * Whether trying again may get an answer: a refusal will not change on retry, but a server that
 * is not answering yet, or is restarting behind the proxy, might.
 */
function mayAnswerSoon(error: Error): boolean {
  if (!(error instanceof ApiError)) return false;
  return error.code === "unreachable" || RESTARTING.has(error.status ?? 0);
}
