import { QueryClient, useQuery } from "@tanstack/react-query";
import { ApiError, call } from "./api";

export const queryKeys = {
  homes: ["homes"],
  home: (home: string) => ["home", home],
  sessions: (home: string) => ["sessions", home],
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
