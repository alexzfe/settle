// One Session: its Skills, when it ran, the summary the Agent wrote, and what it changed, grouped
// by record. The changes come from the change log (origin = the Session's slug).

import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import type { ChangeEntry, Session } from "./api";
import {
  ChangeSentence,
  LOADED_CHANGES,
  RawTable,
  RecordHead,
  type RecordNames,
  Reveal,
  sessionName,
  skillName,
  useNames,
} from "./ChangeLogPage";
import page from "./ChangeLogPage.module.css";
import { formatTime } from "./format";
import { useChangeLog, useHome, useSessions } from "./queries";
import { AgentWritten } from "./ui/AgentWritten";
import { AskAgent, buildPrompt } from "./ui/AskAgent";
import { useDocumentTitle } from "./ui/documentTitle";
import { Section } from "./ui/Section";

/** A Session's changes to other records, oldest first, grouped by record in order of first change. */
export function groupByRecord(changes: readonly ChangeEntry[]): ChangeEntry[][] {
  const groups = new Map<string, ChangeEntry[]>();
  for (const change of changes.toReversed()) {
    if (change.recordKind === "session") continue;
    const key = `${change.recordKind}:${change.record}`;
    groups.set(key, [...(groups.get(key) ?? []), change]);
  }
  return [...groups.values()];
}

/** A Session's page. */
export function SessionPage() {
  const { home = "", session: slug = "" } = useParams();
  const sessions = useSessions(home);
  const log = useChangeLog(home);
  const session = sessions.data?.sessions.find((each) => each.slug === slug);
  useDocumentTitle(session && sessionName(session));
  if (!session) {
    return (
      <>
        <h1>Session</h1>
        {sessions.isPending ? (
          <p>Loading…</p>
        ) : (
          <p className={styles.error}>
            {sessions.error?.message ?? `This Home has no Session "${slug}".`}
          </p>
        )}
      </>
    );
  }
  return (
    <>
      <SessionHeader home={home} session={session} />
      <Section title="Changes">
        {log.isPending ? (
          <p>Loading…</p>
        ) : log.isError ? (
          <p className={styles.error}>{log.error.message}</p>
        ) : (
          <SessionChanges
            home={home}
            all={log.data.changes}
            changes={log.data.changes.filter((change) => change.origin === slug)}
          />
        )}
      </Section>
      <p>
        <Link to={`/homes/${home}/log`}>← The whole change log</Link>
      </p>
    </>
  );
}

function SessionHeader({ home, session }: { home: string; session: Session }) {
  const homeRead = useHome(home);
  const folder = homeRead.data?.home.homeFolderPath;
  return (
    <header>
      <h1>{sessionName(session)}</h1>
      <p className={page.sessionMeta}>
        {session.skills.length > 0 && (
          <>
            {session.skills.length === 1 ? "Skill" : "Skills"}:{" "}
            {session.skills.map(skillName).join(", ")} ·{" "}
          </>
        )}
        {formatTime(session.openedAt)}
        {session.closedAt && <> – {formatTime(session.closedAt)}</>}
      </p>
      {session.summary ? (
        <AgentWritten source="Session summary" date={session.closedAt}>
          <dl className={page.summary}>
            <dt>Changed</dt>
            <dd>{session.summary.changed}</dd>
            <dt>Still open</dt>
            <dd>{session.summary.open}</dd>
            <dt>Next</dt>
            <dd>{session.summary.next}</dd>
          </dl>
        </AgentWritten>
      ) : (
        <p className={page.unsummarised}>In progress or left without a summary.</p>
      )}
      {session.summary && (
        <AskAgent
          label="Start the next Session"
          prompt={buildPrompt({
            text: `Let's carry on from the last Session: ${session.summary.next}`,
          })}
          homeFolderPath={folder}
        />
      )}
    </header>
  );
}

function SessionChanges({
  home,
  all,
  changes,
}: {
  home: string;
  all: ChangeEntry[];
  changes: ChangeEntry[];
}) {
  const { names, rooms } = useNames(home, all);
  const groups = groupByRecord(changes);
  const truncated = all.length >= LOADED_CHANGES;
  return (
    <>
      {truncated && (
        <p className={`${styles.muted} ${page.limit}`}>
          Only the newest {LOADED_CHANGES} changes are loaded, so older ones may be missing here.
        </p>
      )}
      {groups.length === 0 ? (
        <p className={styles.muted}>No changes to the Home's record.</p>
      ) : (
        <ul className={page.records}>
          {groups.map((group) => (
            <RecordGroup
              key={`${group[0]?.recordKind}:${group[0]?.record}`}
              group={group}
              names={names}
              rooms={rooms}
            />
          ))}
        </ul>
      )}
      {changes.length > 0 && (
        <Reveal label="Show every field">
          <RawTable changes={changes} />
        </Reveal>
      )}
    </>
  );
}

function RecordGroup({
  group,
  names,
  rooms,
}: {
  group: ChangeEntry[];
  names: RecordNames;
  rooms: readonly { slug: string }[];
}) {
  const [first] = group;
  if (!first) return null;
  if (group.length === 1) {
    return (
      <li className={page.record}>
        <ChangeSentence change={first} names={names} rooms={rooms} />
      </li>
    );
  }
  return (
    <li className={page.record}>
      <p className={page.recordHead}>
        <RecordHead change={first} names={names} rooms={rooms} />
      </p>
      <ul className={page.recordChanges}>
        {group.map((change, index) => (
          // Log rows have no id and hold no state, so their position is key enough.
          <li key={index}>
            <ChangeSentence change={change} names={names} rooms={rooms} head={false} />
          </li>
        ))}
      </ul>
    </li>
  );
}
