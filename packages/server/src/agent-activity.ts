/**
 * When the Agent last called a tool, per Home. The MCP endpoint is stateless, so whether an Agent
 * is connected is unknowable; the last tool call is the truthful signal. Kept in memory only: a
 * restart forgets it.
 */

/** The last tool call the Agent made for a Home. `at` is an ISO timestamp. */
export interface AgentCall {
  at: string;
  tool: string;
}

/** What `/events` sends as an `agent` event. */
export interface AgentEvent {
  home: string;
  at: string;
}

export class AgentActivity {
  readonly #last = new Map<string, AgentCall>();
  readonly #listeners = new Set<(event: AgentEvent) => void>();

  readonly #now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  /** Notes a tool call for the Home and tells every listener. */
  record(home: string, tool: string): void {
    const at = this.#now().toISOString();
    this.#last.set(home, { at, tool });
    for (const listener of this.#listeners) listener({ home, at });
  }

  /** The Home's last tool call since the server started, if any. */
  last(home: string): AgentCall | undefined {
    return this.#last.get(home);
  }

  /** Calls `listener` on each recorded call, until the returned function is called. */
  subscribe(listener: (event: AgentEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
