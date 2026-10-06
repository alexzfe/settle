// The change log read as a story: changes grouped by Session (and by day for the Web UI), each
// read as a sentence, with the raw rows kept behind a toggle for audit. SessionPage reads one
// Session's changes the same way.

import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import type { ChangeEntry, DecisionState, Session } from "./api";
import page from "./ChangeLogPage.module.css";
import { recordPath, STATE_LABEL } from "./decisions";
import {
  formatColor,
  formatLength,
  formatLogValue,
  formatTime,
  isProvenance,
  type Measure,
  PROVENANCE_LABEL,
  sentence,
  wallNameOf,
  words,
} from "./format";
import { formatPartialDate } from "./itemDates";
import { useChangeLog, useDecisions, useHome, useSessions } from "./queries";
import { shortDate } from "./ui/AgentWritten";
import { useDocumentTitle } from "./ui/documentTitle";
import { StateMark } from "./ui/StateMark";

/** How many changes get_change_log answers with by default: the newest ones. */
export const LOADED_CHANGES = 200;

/** How many changes a group shows before "+N more". */
const PREVIEW = 3;

// ─── Names and sentences ───────────────────────────────────────────────────────────────────

/** Names of records by "kind:slug", from the Home's Rooms and Decisions and from the log itself. */
export type RecordNames = ReadonlyMap<string, string>;

/**
 * Names for the records a log mentions: what the Home and its Decisions say now, else the name,
 * title, or label the log last gave the record (the log is newest first).
 */
export function recordNames(
  changes: readonly ChangeEntry[],
  rooms: readonly { slug: string; name: string }[] = [],
  decisions: readonly { slug: string; title: string }[] = [],
): Map<string, string> {
  const names = new Map<string, string>();
  for (const change of changes.toReversed()) {
    const value = change.new;
    const key = `${change.recordKind}:${change.record}`;
    if (change.field === undefined && typeof value === "object" && value !== null) {
      const { name, title } = value as Record<string, unknown>;
      const given = typeof name === "string" ? name : typeof title === "string" ? title : undefined;
      if (given) names.set(key, given);
    } else if ((change.field === "name" || change.field === "title") && typeof value === "string") {
      names.set(key, value);
    }
  }
  for (const room of rooms) names.set(`room:${room.slug}`, room.name);
  for (const decision of decisions) names.set(`decision:${decision.slug}`, decision.title);
  return names;
}

/** A Skill's slug as its name: "home-intake" is "Home Intake". */
export function skillName(skill: string): string {
  return words(skill)
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** A Session's name from its Skills: "Color Session", "Design Direction and Home Intake Session". */
export function sessionName(session: Pick<Session, "skills"> | undefined): string {
  const skills = session?.skills.map(skillName) ?? [];
  if (skills.length === 0) return "Session";
  return `${skills.join(" and ")} Session`;
}

/**
 * Who a record belongs to and which part it is: the Room a Wall, Surface, Window, Door, or
 * Feature is in, then the part ("Wall 5"); the record itself otherwise.
 */
export function recordLabel(
  change: Pick<ChangeEntry, "recordKind" | "record">,
  names: RecordNames,
  rooms: readonly { slug: string }[] = [],
): { name: string; part?: string } {
  const { recordKind: kind, record } = change;
  const named = (key: string, slug: string) => names.get(key) ?? sentence(slug);
  switch (kind) {
    case "wall":
    case "surface": {
      const [room = record, ...rest] = record.split("/");
      const part =
        kind === "wall"
          ? wallNameOf(record)
          : rest.length === 2
            ? `${wallNameOf(`${room}/${rest[0]}`)} Surface`
            : `${sentence(rest[0] ?? "")} Surface`;
      return { name: named(`room:${room}`, room), part };
    }
    case "window":
    case "door":
    case "feature": {
      const [room] = rooms
        .map((each) => each.slug)
        .filter((each) => record.startsWith(`${each}-`))
        .toSorted((a, b) => b.length - a.length);
      const own = names.get(`${kind}:${record}`);
      if (room === undefined) return { name: own ?? sentence(record), part: sentence(kind) };
      return { name: named(`room:${room}`, room), part: own ?? sentence(kind) };
    }
    case "flag":
    case "conflict": {
      const [decision = record] = record.split("/");
      return { name: named(`decision:${decision}`, decision), part: sentence(kind) };
    }
    case "session":
      return { name: "Session" };
    default:
      return { name: named(`${kind}:${record}`, record) };
  }
}

function isMeasure(value: unknown): value is Measure {
  if (typeof value !== "object" || value === null) return false;
  const { mm, provenance } = value as Record<string, unknown>;
  return typeof mm === "number" && isProvenance(provenance);
}

function isColor(value: unknown): value is Parameters<typeof formatColor>[0] {
  if (typeof value !== "object" || value === null) return false;
  const { name, provenance } = value as Record<string, unknown>;
  return typeof name === "string" && isProvenance(provenance);
}

const DECISION_STATES = new Set<unknown>(["candidate", "leaning", "settled", "rejected"]);

/** Longest value a sentence quotes; longer ones read "updated". */
const SHORT = 48;

/** A value short enough to read inline, or undefined. */
function shortValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (isMeasure(value)) return formatLength(value);
  if (isColor(value)) return formatColor(value);
  const text = formatLogValue(value);
  return text.length <= SHORT ? text : undefined;
}

/** A logged Photo's day, "14 Mar 2026", from its { takenOn, caption }. */
function photoDay(photo: unknown): string | undefined {
  if (typeof photo !== "object" || photo === null) return undefined;
  const { takenOn } = photo as Record<string, unknown>;
  return typeof takenOn === "string" ? formatPartialDate(takenOn) : undefined;
}

/** A logged Document, `receipt "IKEA receipt"`, from its { kind, name }. */
function documentLabel(document: unknown): string {
  if (typeof document !== "object" || document === null) return "document";
  const { kind, name } = document as Record<string, unknown>;
  const label = typeof kind === "string" ? kind : "document";
  return typeof name === "string" ? `${label} "${name}"` : label;
}

/** What happened, after the record's name: "length ~3.70 → 3.62 m (Measured)". */
export function changeText(change: ChangeEntry): ReactNode {
  const { field, old, new: next } = change;
  if (field === undefined) return change.recordKind === "session" ? "opened" : "added";
  if (field === "archivedAt") return next ? "Archived" : "brought back";
  if (field === "removed") return "removed";
  // A Photo is named by the day it was taken, never by its id.
  if (change.recordKind === "item" && field === "photo") {
    const photo = next ?? old;
    const day = photoDay(photo);
    return `photo ${next ? "added" : "deleted"}${day ? ` (${day})` : ""}`;
  }
  // A Document is named by its kind and name, never by its id.
  if (change.recordKind === "item" && field === "document") {
    if (!old) return `document added: ${documentLabel(next)}`;
    if (!next) return `document deleted: ${documentLabel(old)}`;
    return `document changed: ${documentLabel(old)} → ${documentLabel(next)}`;
  }
  if (change.recordKind === "session" && field === "closed_at") return "closed";
  if (change.recordKind === "session" && field === "summary") return "summary written";
  if (field === "state" && DECISION_STATES.has(old) && DECISION_STATES.has(next)) {
    return (
      <span className={page.stateChange}>
        <StateName state={old as DecisionState} /> <span>→</span>{" "}
        <StateName state={next as DecisionState} />
      </span>
    );
  }
  const label = words(field);
  if (isMeasure(old) && isMeasure(next)) {
    return `${label} ${formatLength(old).replace(/ m$/, "")} → ${formatLength(next)} (${PROVENANCE_LABEL[next.provenance]})`;
  }
  const before = shortValue(old);
  const after = shortValue(next);
  const provenance =
    isMeasure(next) || isColor(next) ? ` (${PROVENANCE_LABEL[next.provenance]})` : "";
  if (old === undefined || old === null) {
    return after === undefined ? `${label} added` : `${label} set to ${after}${provenance}`;
  }
  if (next === undefined || next === null) return `${label} cleared`;
  if (before !== undefined && after !== undefined) {
    return `${label} ${before || "none"} → ${after || "none"}${provenance}`;
  }
  return `${label} updated`;
}

/** A state in a sentence: its mark, then its name, which already says it to a screen reader. */
function StateName({ state }: { state: DecisionState }) {
  return (
    <span className={page.state}>
      <span aria-hidden>
        <StateMark state={state} />
      </span>
      {STATE_LABEL[state]}
    </span>
  );
}

/** The names a page needs to read changes as sentences, from reads it already makes. */
export function useNames(home: string, changes: readonly ChangeEntry[]) {
  const homeRead = useHome(home);
  const decisions = useDecisions(home);
  const rooms = homeRead.data?.rooms ?? [];
  return {
    rooms,
    names: recordNames(changes, rooms, decisions.data?.decisions),
  };
}

/** A record's name, linked to the page showing it when there is one, then its part. */
export function RecordHead({
  change,
  names,
  rooms,
}: {
  change: ChangeEntry;
  names: RecordNames;
  rooms: readonly { slug: string }[];
}) {
  const { home = "" } = useParams();
  const { name, part } = recordLabel(change, names, rooms);
  const to = recordPath(home, change.recordKind, change.record, rooms);
  return (
    <>
      <strong>{to ? <Link to={to}>{name}</Link> : name}</strong>
      {part && <> · {part}</>}
    </>
  );
}

/** One change as a sentence: "Living room · Wall 5 length ~3.70 → 3.62 m (Measured)". */
export function ChangeSentence({
  change,
  names,
  rooms,
  head = true,
}: {
  change: ChangeEntry;
  names: RecordNames;
  rooms: readonly { slug: string }[];
  /** False when a group heading already names the record. */
  head?: boolean;
}) {
  const quoted = change.field === "state" && change.recordKind === "decision";
  return (
    <>
      <span className={page.sentence}>
        {head && (
          <>
            <RecordHead change={change} names={names} rooms={rooms} />{" "}
          </>
        )}
        {changeText(change)}
      </span>
      {change.reason &&
        (quoted ? (
          <blockquote className={page.reason}>{change.reason}</blockquote>
        ) : (
          <span className={page.note}> · {change.reason}</span>
        ))}
    </>
  );
}

/** Every field of the given changes, as the store keeps them. */
export function RawTable({ changes }: { changes: readonly ChangeEntry[] }) {
  return (
    <div className={styles.scroll}>
      <table className={`${styles.table} ${page.raw}`}>
        <thead>
          <tr>
            <th>Time</th>
            <th>Origin</th>
            <th>Record</th>
            <th>Field</th>
            <th>Old</th>
            <th>New</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, index) => (
            // Log rows have no id and hold no state, so their position is key enough.
            <tr key={index}>
              <td>{formatTime(change.at)}</td>
              <td>{change.origin === "web" ? "Web UI" : <code>{change.origin}</code>}</td>
              <td>
                {sentence(change.recordKind)} <code>{change.record}</code>
              </td>
              <td>{change.field ? words(change.field) : <em>created</em>}</td>
              <td>{formatLogValue(change.old)}</td>
              <td>{formatLogValue(change.new)}</td>
              <td>{change.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A toggle revealing its children: "Show every field". */
export function Reveal({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={page.reveal}>
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide every field" : label}
      </button>
      {open && children}
    </div>
  );
}

// ─── The page ──────────────────────────────────────────────────────────────────────────────

export interface ChangeGroup {
  key: string;
  /** The Session's slug; absent for Web UI changes. */
  session?: string;
  /** For Web UI changes: the local day, as its first change's timestamp. */
  day?: string;
  changes: ChangeEntry[];
}

function localDay(at: string): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * The log in groups, newest first, as it arrives: one per Session, and one per day for the Web
 * UI's changes. A group's changes keep the log's order.
 */
export function groupChanges(changes: readonly ChangeEntry[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const change of changes) {
    const web = change.origin === "web";
    const key = web ? `web:${localDay(change.at)}` : `session:${change.origin}`;
    const group =
      groups.get(key) ??
      (web ? { key, day: change.at, changes: [] } : { key, session: change.origin, changes: [] });
    group.changes.push(change);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Every change to the Home's record, grouped by Session, newest first. Undo comes later. */
export function ChangeLogPage() {
  const { home = "" } = useParams();
  useDocumentTitle("Change log");
  const log = useChangeLog(home);
  const changes = log.data?.changes ?? [];
  const { names, rooms } = useNames(home, changes);
  const sessions = useSessions(home);
  return (
    <>
      <h1>Change log</h1>
      {log.isPending ? (
        <p>Loading…</p>
      ) : log.isError ? (
        <p className={styles.error}>{log.error.message}</p>
      ) : changes.length === 0 ? (
        <p>No changes yet.</p>
      ) : (
        <>
          <p className={`${styles.muted} ${page.limit}`}>
            Only the newest {LOADED_CHANGES} changes are loaded.
          </p>
          <ol className={page.timeline} aria-label="Changes by Session">
            {groupChanges(changes).map((group) => (
              <TimelineGroup
                key={group.key}
                home={home}
                group={group}
                session={sessions.data?.sessions.find((each) => each.slug === group.session)}
                names={names}
                rooms={rooms}
              />
            ))}
          </ol>
          <Reveal label="Show every field">
            <RawTable changes={changes} />
          </Reveal>
        </>
      )}
    </>
  );
}

function TimelineGroup({
  home,
  group,
  session,
  names,
  rooms,
}: {
  home: string;
  group: ChangeGroup;
  session: Session | undefined;
  names: RecordNames;
  rooms: readonly { slug: string }[];
}) {
  const [all, setAll] = useState(false);
  const newest = group.changes[0]?.at ?? "";
  const shown = all ? group.changes : group.changes.slice(0, PREVIEW);
  const more = group.changes.length - shown.length;
  return (
    <li className={page.group}>
      <div className={page.groupHead}>
        <h2 className={page.groupTitle}>
          {group.session ? (
            <Link to={`/homes/${home}/sessions/${group.session}`}>{sessionName(session)}</Link>
          ) : (
            "Web UI"
          )}
        </h2>
        <span className={page.groupMeta}>
          {shortDate(newest)} · {group.changes.length}{" "}
          {group.changes.length === 1 ? "change" : "changes"}
          {group.session && session && !session.summary && " · no summary"}
        </span>
      </div>
      <ul className={page.sentences}>
        {shown.map((change, index) => (
          // Log rows have no id and hold no state, so their position is key enough.
          <li key={index}>
            <ChangeSentence change={change} names={names} rooms={rooms} />
          </li>
        ))}
      </ul>
      {more > 0 &&
        (group.session ? (
          <Link className={page.more} to={`/homes/${home}/sessions/${group.session}`}>
            +{more} more
          </Link>
        ) : (
          <button type="button" className={`secondary ${page.more}`} onClick={() => setAll(true)}>
            +{more} more
          </button>
        ))}
    </li>
  );
}
