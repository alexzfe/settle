import { Link, useParams, useSearchParams } from "react-router";
import styles from "./App.module.css";
import type { DecisionSummary, Room } from "./api";
import page from "./DecisionsPage.module.css";
import {
  DECISION_KINDS,
  DECISION_STATES,
  decisionPath,
  flagSummary,
  KIND_LABEL,
  STATE_LABEL,
} from "./decisions";
import { type DecisionFilter, useDecisions, useHome } from "./queries";
import { SwatchSquare } from "./Swatch";
import { buildPrompt } from "./ui/AskAgent";
import { useDocumentTitle } from "./ui/documentTitle";
import { EmptyState } from "./ui/EmptyState";
import { ShowSwitch, useRememberedSwitch } from "./ui/ShowArchived";
import { FlagMark, FulfilledNote, StatePill } from "./ui/StatePill";
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

/** Whether a Decision needs the user: an open flag or Conflict. */
export function needsReview(decision: DecisionSummary): boolean {
  return decision.openFlags.length + decision.openConflicts.length > 0;
}

/** The Decisions whose title holds every word of `search`, ignoring case. */
export function matchingTitle(
  decisions: readonly DecisionSummary[],
  search: string,
): DecisionSummary[] {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return decisions.filter((decision) => {
    const title = decision.title.toLowerCase();
    return words.every((word) => title.includes(word));
  });
}

/** A new query string from the current one, with `changes` set or (when undefined) removed. */
function withParams(search: URLSearchParams, changes: Record<string, string | undefined>): string {
  const next = new URLSearchParams(search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === undefined || value === "") next.delete(name);
    else next.set(name, value);
  }
  const query = next.toString();
  return query ? `?${query}` : ".";
}

/**
 * Every Decision of the Home by scope, as aligned rows. Views (All, Needs review, Leaning), the
 * state and kind filters, and a title search all live in the query string.
 */
export function DecisionsPage() {
  const { home = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  useDocumentTitle("Decisions");
  const filter: DecisionFilter = {
    state: oneOf(search.get("state"), DECISION_STATES),
    kind: oneOf(search.get("kind"), DECISION_KINDS),
  };
  const review = search.get("view") === "review";
  const query = search.get("q") ?? "";
  // Archived Decisions come only when asked for; the switch below keeps them out of sight.
  const decisions = useDecisions(home, { ...filter, archived: true });
  const homeQuery = useHome(home);
  const error = decisions.error ?? homeQuery.error;
  const filtered = filter.state !== undefined || filter.kind !== undefined || review || query;
  const [showOld, setShowOld] = useRememberedSwitch("settle.decisions.showRejectedArchived");
  const matched = decisions.data
    ? matchingTitle(decisions.data.decisions, query).filter(
        (decision) => !review || needsReview(decision),
      )
    : [];
  // The clutter rule: Rejected and Archived Decisions stay out of sight unless the switch is on.
  // Filtering on the Rejected state asks for the Rejected ones, so only the Archived stay hidden.
  const old = matched.filter(
    (decision) =>
      decision.archivedAt !== undefined ||
      (decision.state === "rejected" && filter.state !== "rejected"),
  );
  const shown = showOld ? matched : matched.filter((decision) => !old.includes(decision));
  return (
    <>
      <h1>Decisions</h1>
      <div className={page.toolbar}>
        <Views />
        <label className={page.search}>
          <span className={page.searchLabel}>Search titles</span>
          <input
            type="search"
            value={query}
            placeholder="Search titles"
            onChange={(event) => {
              const next = new URLSearchParams(search);
              if (event.target.value) next.set("q", event.target.value);
              else next.delete("q");
              setSearch(next, { replace: true });
            }}
          />
        </label>
      </div>
      <div className={page.filters}>
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
        <ShowSwitch
          label="Show Rejected / Archived"
          count={old.length}
          on={showOld}
          onChange={setShowOld}
        />
      </div>
      {error ? (
        <p className={styles.error}>{error.message}</p>
      ) : !decisions.data || !homeQuery.data ? (
        <p>Loading…</p>
      ) : shown.length === 0 ? (
        filtered || old.length > 0 ? (
          <EmptyState text="No Decisions match." />
        ) : (
          <EmptyState
            text="No Decisions yet. Settle them with the Agent in this Home's Home Folder."
            prompt={buildPrompt({
              skill: "Design Direction",
              text: "help me settle the direction for my home",
            })}
          />
        )
      ) : (
        <div className={page.list}>
          <div className={page.columns} aria-hidden>
            <span>Decision</span>
            <span>Kind</span>
            <span>State</span>
            <span>Review</span>
          </div>
          {groupDecisions(shown, homeQuery.data.rooms).map((group) => (
            <section key={group.key} className={page.group}>
              <h2 className={page.groupTitle}>
                {group.room ? (
                  <Link to={`/homes/${home}/rooms/${group.room}`}>{group.title}</Link>
                ) : (
                  group.title
                )}
              </h2>
              <ul className={page.rows}>
                {group.decisions.map((decision) => (
                  <li key={decision.slug}>
                    <DecisionRow home={home} decision={decision} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

type View = "all" | "review" | "leaning";

/**
 * Segmented buttons for the common views: All clears the view and the state filter, Needs review
 * shows the flagged and Conflicted Decisions, and Leaning is the Leaning state filter.
 */
function Views() {
  const [search] = useSearchParams();
  // Another state filter in force is none of the views.
  const current: View | undefined =
    search.get("view") === "review"
      ? "review"
      : search.get("state") === "leaning"
        ? "leaning"
        : search.get("state") === null
          ? "all"
          : undefined;
  const views: [View, string, string][] = [
    ["all", "All", withParams(search, { view: undefined, state: undefined })],
    ["review", "Needs review", withParams(search, { view: "review", state: undefined })],
    ["leaning", "Leaning", withParams(search, { view: undefined, state: "leaning" })],
  ];
  return (
    <nav className={page.views} aria-label="Views">
      {views.map(([view, label, to]) => (
        <Link
          key={view}
          to={to}
          className={view === current ? page.viewCurrent : page.view}
          aria-current={view === current ? "true" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
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
  const all: [string | undefined, string][] = [[undefined, "All"], ...options];
  return (
    <nav className={page.filter} aria-label={title}>
      <span className={page.filterTitle}>{title}</span>
      {all.map(([value, label]) =>
        (value ?? null) === current ? (
          <strong key={label} aria-current="true" className={page.filterCurrent}>
            {label}
          </strong>
        ) : (
          <Link key={label} to={withParams(search, { [name]: value })}>
            {label}
          </Link>
        ),
      )}
    </nav>
  );
}

/**
 * One Decision in aligned columns: its title (with a Palette's colors as small swatches), kind,
 * state with any Fulfilment, and what needs review: each open flag's cause, and any Conflict.
 */
function DecisionRow({ home, decision }: { home: string; decision: DecisionSummary }) {
  const [flag, ...moreFlags] = decision.openFlags;
  const [conflict, ...moreConflicts] = decision.openConflicts;
  const faded = decision.state === "rejected" || decision.archivedAt !== undefined;
  return (
    <div className={`${page.row} ${faded ? page.rejected : ""}`}>
      <span className={page.title}>
        <Link to={decisionPath(home, decision.slug)}>{decision.title}</Link>
        {decision.colors && decision.colors.length > 0 && (
          <span className={page.swatches}>
            {decision.colors.map((color, index) => (
              // Two colors may share a name, so the position keeps keys apart.
              <SwatchSquare key={`${index}-${color.name}`} hex={color.hex} />
            ))}
          </span>
        )}
      </span>
      <span className={page.kind}>{KIND_LABEL[decision.kind]}</span>
      <span className={page.state}>
        <StatePill state={decision.state} />
        {decision.fulfilledAt && <FulfilledNote />}
        {decision.archivedAt && <span className={styles.tag}>Archived</span>}
      </span>
      <span className={page.review}>
        {flag && (
          <FlagMark>
            {flagSummary(flag)}
            {moreFlags.length > 0 && ` (and ${moreFlags.length} more)`}
          </FlagMark>
        )}
        {conflict && (
          <span className={page.conflict}>
            Conflict: {conflict.description}
            {moreConflicts.length > 0 && ` (and ${moreConflicts.length} more)`}
          </span>
        )}
      </span>
    </div>
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
