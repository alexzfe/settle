import type { ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import styles from "./App.module.css";
import type { DecisionKind, DecisionState, DecisionSummary, Room } from "./api";
import page from "./DecisionsPage.module.css";
import {
  DECISION_KINDS,
  decisionPath,
  flagSummary,
  GROUP_ORDER,
  KIND_LABEL,
  STATE_GLOSS,
  STATE_LABEL,
} from "./decisions";
import { useDecisions, useHome, useShopping } from "./queries";
import { SwatchSquare } from "./Swatch";
import { shortDate } from "./ui/AgentWritten";
import { buildPrompt } from "./ui/AskAgent";
import { useDocumentTitle } from "./ui/documentTitle";
import { EmptyState } from "./ui/EmptyState";
import { FlagsStrip } from "./ui/FlagsStrip";
import { ShowSwitch, useRememberedSwitch } from "./ui/ShowArchived";
import { StateMark } from "./ui/StateMark";

/** What a Home-wide Decision's room reads as. */
export const WHOLE_HOME = "Whole home";

export type Grouping = "state" | "room" | "kind";

const GROUPINGS: [Grouping, string][] = [
  ["state", "By state"],
  ["room", "By room"],
  ["kind", "By kind"],
];

export interface DecisionGroup {
  /** Unique among the groups. */
  key: string;
  title: string;
  /** The state, when grouped by state: its mark and gloss head the group. */
  state?: DecisionState;
  /** The Room's slug, when grouped by room; absent for the Home-wide group. */
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
    groups.unshift({ key: "home", title: WHOLE_HOME, decisions: homeWide });
  }
  return groups;
}

/** The Decisions by state, Leaning first, then Candidate, Settled, and Rejected; empty ones left out. */
export function groupByState(decisions: readonly DecisionSummary[]): DecisionGroup[] {
  return GROUP_ORDER.map((state) => ({
    key: `state:${state}`,
    title: STATE_LABEL[state],
    state,
    decisions: decisions.filter((decision) => decision.state === state),
  })).filter((group) => group.decisions.length > 0);
}

/** The Decisions by kind, in the kinds' usual order; empty ones left out. */
export function groupByKind(decisions: readonly DecisionSummary[]): DecisionGroup[] {
  return DECISION_KINDS.map((kind: DecisionKind) => ({
    key: `kind:${kind}`,
    title: KIND_LABEL[kind],
    decisions: decisions.filter((decision) => decision.kind === kind),
  })).filter((group) => group.decisions.length > 0);
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

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** When a Decision was opened, short: "14 Sep" this year, "Sep 2025" before it. */
export function openSince(at: string, now: Date = new Date()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getFullYear() === now.getFullYear()) return shortDate(at) ?? "";
  return `${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
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
 * Every Decision of the Home as aligned rows, grouped by state (or by room, or by kind), with the
 * Flags strip above. The grouping, the flagged-only view (`?flagged=1`), and a title search live
 * in the query string.
 */
export function DecisionsPage() {
  const { home = "" } = useParams();
  const [search, setSearch] = useSearchParams();
  useDocumentTitle("Decisions");
  const grouping: Grouping =
    GROUPINGS.find(([each]) => each === search.get("group"))?.[0] ?? "state";
  const flagged = search.get("flagged") === "1";
  const query = search.get("q") ?? "";
  // Archived Decisions come too, in the one request the sidebar and the Flags strip share; the
  // switch below keeps them out of sight.
  const decisions = useDecisions(home, { archived: true });
  const homeQuery = useHome(home);
  // The Listing counts, from the Shopping List the sidebar already asks for.
  const shopping = useShopping(home);
  const listings = new Map(
    [...(shopping.data?.shoppingList ?? []), ...(shopping.data?.considering ?? [])].map((entry) => [
      entry.slug,
      entry.listings,
    ]),
  );
  const error = decisions.error ?? homeQuery.error;
  const [showOld, setShowOld] = useRememberedSwitch("settle.decisions.showRejectedArchived");
  const matched = decisions.data
    ? matchingTitle(decisions.data.decisions, query).filter(
        (decision) => !flagged || needsReview(decision),
      )
    : [];
  // The clutter rule: Rejected and Archived Decisions stay out of sight unless the switch is on.
  const old = matched.filter(
    (decision) => decision.archivedAt !== undefined || decision.state === "rejected",
  );
  const shown = showOld ? matched : matched.filter((decision) => !old.includes(decision));
  const groups =
    grouping === "room"
      ? groupDecisions(shown, homeQuery.data?.rooms ?? [])
      : grouping === "kind"
        ? groupByKind(shown)
        : groupByState(shown);
  return (
    <>
      <FlagsStrip home={home} />
      <h1>Decisions</h1>
      <div className={page.toolbar}>
        <nav className={page.pills} aria-label="Group">
          {GROUPINGS.map(([each, label]) => (
            <Link
              key={each}
              to={withParams(search, { group: each === "state" ? undefined : each })}
              className={each === grouping ? page.pillCurrent : page.pill}
              aria-current={each === grouping ? "true" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
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
        <ShowSwitch
          label="Show Rejected / Archived"
          count={old.length}
          on={showOld}
          onChange={setShowOld}
        />
      </div>
      {flagged && (
        <p className={page.flaggedNote}>
          Only Decisions with an open Flag or Conflict.{" "}
          <Link to={withParams(search, { flagged: undefined })}>Show all Decisions</Link>
        </p>
      )}
      {error ? (
        <p className={styles.error}>{error.message}</p>
      ) : !decisions.data || !homeQuery.data ? (
        <p>Loading…</p>
      ) : shown.length === 0 ? (
        flagged ? (
          <EmptyState text="Nothing is flagged." />
        ) : query || old.length > 0 ? (
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
          <div className={`${page.columns} label`} aria-hidden>
            <span />
            <span>Decision</span>
            <span className={page.kind}>Kind</span>
            <span className={page.room}>{grouping === "room" ? "State" : "Room"}</span>
            <span className={page.since}>Open since</span>
          </div>
          {groups.map((group) => (
            <section key={group.key} className={page.group} aria-label={group.title}>
              <GroupHeading home={home} group={group} />
              <ul className={page.rows}>
                {group.decisions.map((decision) => (
                  <li key={decision.slug}>
                    <DecisionRow
                      home={home}
                      decision={decision}
                      grouping={grouping}
                      listings={listings.get(decision.slug)}
                    />
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

/** A group's heading: by state, its mark, name, count, and what it means; else its name and count. */
function GroupHeading({ home, group }: { home: string; group: DecisionGroup }) {
  const count = <span className={page.count}>{group.decisions.length}</span>;
  if (group.state) {
    return (
      <h2 className={page.groupTitle}>
        <span aria-hidden>
          <StateMark state={group.state} />
        </span>
        <span>{group.title}</span>
        {count}
        <span className={page.gloss}>{STATE_GLOSS[group.state]}</span>
      </h2>
    );
  }
  return (
    <h2 className={page.groupTitle}>
      {group.room ? (
        <Link to={`/homes/${home}/rooms/${group.room}`}>{group.title}</Link>
      ) : (
        <span>{group.title}</span>
      )}
      {count}
    </h2>
  );
}

/**
 * One Decision in aligned columns: its mark, its title (with a Palette's colors as small swatches)
 * and a second line of what needs the user and a few neutral facts, its kind, its room (its state
 * when grouped by room), and when it was opened. The title is the one link; the whole row is its
 * click target.
 */
function DecisionRow({
  home,
  decision,
  grouping,
  listings,
}: {
  home: string;
  decision: DecisionSummary;
  grouping: Grouping;
  listings: number | undefined;
}) {
  const rejected = decision.state === "rejected";
  const faded = rejected || decision.archivedAt !== undefined;
  return (
    <div className={`${page.row} ${faded ? page.faded : ""} ${rejected ? page.rejected : ""}`}>
      <StateMark state={decision.state} className={page.mark} />
      <div className={page.titleCell}>
        <span className={page.titleLine}>
          <Link className={`${page.title} clamp`} to={decisionPath(home, decision.slug)}>
            {decision.title}
          </Link>
          {decision.colors && decision.colors.length > 0 && (
            <span className={page.swatches}>
              {decision.colors.map((color, index) => (
                // Two colors may share a name, so the position keeps keys apart.
                <SwatchSquare key={`${index}-${color.name}`} hex={color.hex} name={color.name} />
              ))}
            </span>
          )}
        </span>
        <SecondLine decision={decision} listings={listings} />
      </div>
      <span className={page.facts}>
        <span className={page.kind}>{KIND_LABEL[decision.kind]}</span>
        <span className={page.room}>
          {grouping === "room" ? STATE_LABEL[decision.state] : (decision.room?.name ?? WHOLE_HOME)}
        </span>
      </span>
      <span className={page.since}>{openSince(decision.createdAt)}</span>
    </div>
  );
}

/**
 * Under the title: its open Flags and Conflicts in the attention color, then neutral facts in
 * muted ink (a Purchase's Listing count, its Fulfilment, Archived). Nothing else goes here.
 */
function SecondLine({
  decision,
  listings,
}: {
  decision: DecisionSummary;
  listings: number | undefined;
}) {
  const [flag, ...moreFlags] = decision.openFlags;
  const conflicts = decision.openConflicts.length;
  const attention: ReactNode[] = [];
  if (flag) {
    attention.push(
      <span key="flag" className={page.attention}>
        Flagged: {flagSummary(flag)}
        {moreFlags.length > 0 && ` (and ${moreFlags.length} more)`}
      </span>,
    );
  }
  if (conflicts > 0) {
    attention.push(
      <span key="conflict" className={page.attention}>
        {conflicts === 1 ? "Conflict" : `${conflicts} Conflicts`}
      </span>,
    );
  }
  const fulfilled = decision.fulfilledAt && shortDate(decision.fulfilledAt);
  const neutral = [
    listings !== undefined && listings > 0 && `${listings} Listing${listings === 1 ? "" : "s"}`,
    fulfilled && `✓ Fulfilled ${fulfilled}`,
    decision.archivedAt && "Archived",
  ].filter(Boolean);
  if (attention.length === 0 && neutral.length === 0) return null;
  return (
    <span className={page.second}>
      {attention}
      {neutral.length > 0 && <span className={page.neutral}>{neutral.join(" · ")}</span>}
    </span>
  );
}
