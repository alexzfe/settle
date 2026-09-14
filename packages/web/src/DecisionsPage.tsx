import { Link, useParams, useSearchParams } from "react-router";
import styles from "./App.module.css";
import type { DecisionSummary, Room } from "./api";
import {
  DECISION_KINDS,
  DECISION_STATES,
  decisionPath,
  KIND_LABEL,
  STATE_LABEL,
} from "./decisions";
import { type DecisionFilter, useDecisions, useHome } from "./queries";
import { Parts } from "./Values";

export interface DecisionGroup {
  /** Unique among the groups. */
  key: string;
  title: string;
  /** The Room's slug; absent for the Home-wide group. */
  room?: string;
  decisions: DecisionSummary[];
}

/**
 * The Home-wide Decisions, then each Room's in the Home's Room order, then those of any Room the
 * Home no longer lists (an Archived one). Rooms without Decisions are left out.
 */
export function groupDecisions(
  decisions: readonly DecisionSummary[],
  rooms: readonly Room[],
): DecisionGroup[] {
  const homeWide: DecisionSummary[] = [];
  const byRoom = new Map<string, DecisionGroup>();
  for (const decision of decisions) {
    if (!decision.room) {
      homeWide.push(decision);
      continue;
    }
    const { slug, name } = decision.room;
    const group = byRoom.get(slug) ?? {
      key: `room:${slug}`,
      title: name,
      room: slug,
      decisions: [],
    };
    group.decisions.push(decision);
    byRoom.set(slug, group);
  }
  const listed = rooms.flatMap((room) => byRoom.get(room.slug) ?? []);
  const unlisted = [...byRoom.values()].filter((group) => !listed.includes(group));
  const groups = [...listed, ...unlisted];
  if (homeWide.length > 0) {
    groups.unshift({ key: "home", title: "Home-wide", decisions: homeWide });
  }
  return groups;
}

/** A value from the query string when it is one of `values`. */
function oneOf<T extends string>(value: string | null, values: readonly T[]): T | undefined {
  return values.find((each) => each === value);
}

/** Every Decision of the Home by scope, filtered by state and kind through the query string. */
export function DecisionsPage() {
  const { home = "" } = useParams();
  const [search] = useSearchParams();
  const filter: DecisionFilter = {
    state: oneOf(search.get("state"), DECISION_STATES),
    kind: oneOf(search.get("kind"), DECISION_KINDS),
  };
  const decisions = useDecisions(home, filter);
  const rooms = useHome(home);
  const error = decisions.error ?? rooms.error;
  const filtered = filter.state !== undefined || filter.kind !== undefined;
  return (
    <>
      <h1>Decisions</h1>
      <FilterLinks
        name="state"
        title="State"
        options={DECISION_STATES.map((state) => [state, STATE_LABEL[state]])}
      />
      <FilterLinks
        name="kind"
        title="Kind"
        options={DECISION_KINDS.map((kind) => [kind, KIND_LABEL[kind]])}
      />
      {error ? (
        <p className={styles.error}>{error.message}</p>
      ) : !decisions.data || !rooms.data ? (
        <p>Loading…</p>
      ) : decisions.data.decisions.length === 0 ? (
        <p>
          {filtered
            ? "No Decisions match."
            : "No Decisions yet. Settle them with the Agent in this Home's Home Folder."}
        </p>
      ) : (
        groupDecisions(decisions.data.decisions, rooms.data.rooms).map((group) => (
          <section key={group.key}>
            <h2>
              {group.room ? (
                <Link to={`/homes/${home}/rooms/${group.room}`}>{group.title}</Link>
              ) : (
                group.title
              )}
            </h2>
            <ul>
              {group.decisions.map((decision) => (
                <li key={decision.slug}>
                  <DecisionLine home={home} decision={decision} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

/** Links that set one filter, keeping the other; the one in force is plain text. */
function FilterLinks({
  name,
  title,
  options,
}: {
  name: string;
  title: string;
  options: [value: string, label: string][];
}) {
  const [search] = useSearchParams();
  const current = search.get(name);
  const to = (value: string | undefined) => {
    const next = new URLSearchParams(search);
    if (value === undefined) next.delete(name);
    else next.set(name, value);
    const query = next.toString();
    return query ? `?${query}` : ".";
  };
  const all: [string | undefined, string][] = [[undefined, "All"], ...options];
  return (
    <nav className={styles.nav} aria-label={title}>
      {title}:
      {all.map(([value, label]) =>
        (value ?? null) === current ? (
          <strong key={label} aria-current="true">
            {label}
          </strong>
        ) : (
          <Link key={label} to={to(value)}>
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}

/** A Decision's title, kind, and state, with a marker when it is flagged or in Conflict. */
export function DecisionLine({ home, decision }: { home: string; decision: DecisionSummary }) {
  return (
    <Parts>
      <Link to={decisionPath(home, decision.slug)}>{decision.title}</Link>
      {KIND_LABEL[decision.kind]}
      {STATE_LABEL[decision.state]}
      {decision.fulfilledAt && "Fulfilled"}
      {decision.openFlags.length > 0 && <span className={styles.tag}>Flagged</span>}
      {decision.openConflicts.length > 0 && <span className={styles.tag}>Conflict</span>}
    </Parts>
  );
}
