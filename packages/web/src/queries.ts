import { keepPreviousData, QueryClient, useQuery } from "@tanstack/react-query";
import { ApiError, call } from "./api";

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
  constraints: (home: string) => ["constraints", home],
  notes: (home: string) => ["notes", home],
  changeLog: (home: string) => ["change-log", home],
} as const;

export function useHomes() {
  return useQuery({ queryKey: queryKeys.homes, queryFn: () => call("list_homes", {}) });
}

export function useHome(home: string) {
  return useQuery({ queryKey: queryKeys.home(home), queryFn: () => call("get_home", { home }) });
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

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      // A refusal will not change on retry; only a server that is not answering yet might.
      queries: {
        retry: (failureCount, error) =>
          error instanceof ApiError && error.code === "unreachable" && failureCount < 3,
      },
    },
  });
}
