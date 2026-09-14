/** The CONTEXT.md noun of a record, in snake case. */
export type RecordKind =
  | "home"
  | "level"
  | "room"
  | "wall"
  | "window"
  | "door"
  | "surface"
  | "feature"
  | "item"
  | "constraint"
  | "note"
  | "blueprint"
  | "session"
  | "decision"
  | "flag"
  | "conflict";

/** Published once per changed record after a write commits. */
export interface ChangeEvent {
  home: string;
  recordKind: RecordKind;
  recordSlug: string;
}

export type ChangeListener = (event: ChangeEvent) => void;

/** The in-process bus the server's /events stream listens on. */
export class EventBus {
  readonly #listeners = new Set<ChangeListener>();

  /** Calls `listener` for every change from now on; the returned function stops it. */
  subscribe(listener: ChangeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  publish(event: ChangeEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch (error) {
        // The write has committed; one broken listener must not stop the others hearing of it.
        console.error("A change listener failed:", error);
      }
    }
  }
}
