// Test doubles for the pages: a fake web API behind fetch, a fake EventSource, and a renderer.

import { QueryClientProvider } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import { createMemoryRouter, type RouteObject, RouterProvider } from "react-router";
import { vi } from "vitest";
import { routes as appRoutes } from "./App";
import type { OperationName, Operations, UploadName, Uploads } from "./api";
import { createQueryClient } from "./queries";

export type ApiHandlers = {
  [Op in OperationName]?: (input: Operations[Op]["input"]) => Operations[Op]["output"] | Response;
} & {
  [Op in UploadName]?: (form: FormData) => Uploads[Op] | Response;
};

/**
 * Answers POST /api/<op> from the handlers, passing each the parsed JSON input or, for an upload,
 * the form; an operation without one gets a 404 error.
 */
export function stubApi(handlers: ApiHandlers) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const operation = url.replace(/^\/api\//, "");
    const handler = handlers[operation as OperationName | UploadName] as
      | ((input: unknown) => unknown)
      | undefined;
    if (!handler) {
      const error = { code: "not_found", message: `No stub for ${operation}.` };
      return Response.json({ error }, { status: 404 });
    }
    const body = init?.body;
    const answer = handler(body instanceof FormData ? body : JSON.parse(String(body)));
    return answer instanceof Response ? answer : Response.json(answer);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

/** The inputs the stubbed fetch received for one operation, in order. */
export function inputsTo(fetch: ReturnType<typeof stubApi>, operation: OperationName): unknown[] {
  return fetch.mock.calls
    .filter(([url]) => url === `/api/${operation}`)
    .map(([, init]) => JSON.parse(String(init?.body)));
}

export function renderRoutes(
  path: string,
  routes: RouteObject[] = appRoutes,
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, ...view };
}

type Listener = (event: MessageEvent<string>) => void;

/** Stands in for the browser's EventSource; a test calls emit to deliver a server event. */
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  /** 0 connecting, 1 open, 2 closed: a test sets 2 before emitting "error" when the browser gives up. */
  readyState = 0;
  readonly #listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  /** The one connection a test expects to be open. */
  static open(): FakeEventSource {
    const open = FakeEventSource.instances.filter((source) => !source.closed);
    if (open.length !== 1) throw new Error(`Expected one open EventSource, found ${open.length}.`);
    return open[0] as FakeEventSource;
  }

  addEventListener(type: string, listener: Listener) {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data?: unknown) {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}
