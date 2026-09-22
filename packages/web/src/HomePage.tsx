// The Home's Overview answers "what should I do next?": the Flags strip when anything is open, the
// last Session's next step as the page's main element, the Leaning Decisions waiting on the user,
// and how much is on the Shopping List. A new Home gets the getting-started steps instead.

import { Link, useParams } from "react-router";
import { HomeFolderSetup } from "./AboutPage";
import styles from "./App.module.css";
import type { DecisionSummary, Home, Session } from "./api";
import { decisionPath } from "./decisions";
import { sentence } from "./format";
import page from "./HomePage.module.css";
import { useDecisions, useHome, useSessions, useShopping } from "./queries";
import { AgentWritten, shortDate } from "./ui/AgentWritten";
import { AskAgent, buildPrompt } from "./ui/AskAgent";
import { FlagsStrip } from "./ui/FlagsStrip";
import { Section } from "./ui/Section";
import { StateMark } from "./ui/StateMark";

/** A Skill's slug as its name: "home-intake" is "Home Intake". */
export function skillName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The Session closed most recently with a summary, if any. */
export function lastClosedSession(sessions: readonly Session[]): Session | undefined {
  const when = (session: Session) => Date.parse(session.closedAt ?? session.openedAt);
  return sessions
    .filter((session) => session.summary)
    .toSorted((a, b) => when(b) - when(a))
    .at(0);
}

/** The Leaning Decisions not Archived, oldest first: the longest wait leads. */
export function waitingOnYou(decisions: readonly DecisionSummary[]): DecisionSummary[] {
  return decisions
    .filter((decision) => decision.state === "leaning" && !decision.archivedAt)
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function counted(count: number, one: string): string {
  return `${count} ${one}${count === 1 ? "" : "s"}`;
}

export function HomePage() {
  const { home: slug = "" } = useParams();
  const home = useHome(slug);
  if (home.isPending) return <p>Loading…</p>;
  if (home.isError) return <p className={styles.error}>{home.error.message}</p>;
  const facts = home.data.home;
  return (
    <>
      <FlagsStrip home={slug} />
      <header className={page.title}>
        <h1>{facts.name}</h1>
        <p className={page.caption}>
          {[facts.city, facts.tenure && sentence(facts.tenure)].filter(Boolean).join(" · ")}
        </p>
      </header>
      <WhatNext home={facts} />
      <ShoppingLine home={slug} />
      <p className={page.footer}>
        <Link to={`/homes/${slug}/about`}>
          About this Home: facts, Constraints, Notes, Blueprints, Home Folder
        </Link>
      </p>
    </>
  );
}

/**
 * Next up and Waiting on you, or Getting started for a Home with no Decisions and no closed
 * Session. The Decisions are asked for as the Flags strip and the sidebar ask, so all share one
 * request.
 */
function WhatNext({ home }: { home: Home }) {
  const sessions = useSessions(home.slug);
  const decisions = useDecisions(home.slug, { archived: true });
  if (sessions.isPending || decisions.isPending) return <p>Loading…</p>;
  if (sessions.isError) return <p className={styles.error}>{sessions.error.message}</p>;
  if (decisions.isError) return <p className={styles.error}>{decisions.error.message}</p>;
  const last = lastClosedSession(sessions.data.sessions);
  const all = decisions.data.decisions;
  if (!last && all.length === 0) return <GettingStarted home={home} />;
  return (
    <>
      {last && <NextUp home={home.slug} session={last} />}
      <WaitingOnYou home={home.slug} decisions={waitingOnYou(all)} />
    </>
  );
}

/** The last Session's next step, big, with a prompt to carry it on; what is open; what changed. */
function NextUp({ home, session }: { home: string; session: Session }) {
  const summary = session.summary;
  if (!summary) return null;
  const skills = session.skills.map(skillName).join(", ");
  const source = `${skills} Session`.trim();
  const date = session.closedAt ?? session.openedAt;
  return (
    <section className={page.nextUp} aria-labelledby="next-up">
      <h2 id="next-up" className={`label ${page.nextLabel}`}>
        Next up
      </h2>
      <AgentWritten source={source} date={date}>
        <p className={page.next}>{summary.next}</p>
        <p className={page.open}>
          <span className={page.openLabel}>Still open:</span> {summary.open}
        </p>
      </AgentWritten>
      <AskAgent
        label="Continue"
        prompt={buildPrompt({
          text: `Let's pick up where the last Session left off. Next: ${summary.next}`,
        })}
      />
      <p className={`clamp ${page.changed}`}>
        <Link to={`/homes/${home}/sessions/${session.slug}`}>Last Session</Link> changed:{" "}
        {summary.changed} · <Link to={`/homes/${home}/log`}>Change log</Link>
      </p>
    </section>
  );
}

/** The Leaning Decisions as Decisions-list rows; nothing at all when there are none. */
function WaitingOnYou({ home, decisions }: { home: string; decisions: DecisionSummary[] }) {
  if (decisions.length === 0) return null;
  return (
    <Section
      title="Waiting on you"
      action={<span className={page.gloss}>Leaning: favoured, not committed yet</span>}
    >
      <ul className={page.rows}>
        {decisions.map((decision) => (
          <li key={decision.slug} className={page.row}>
            <StateMark state={decision.state} className={page.mark} />
            <Link to={decisionPath(home, decision.slug)} className={`clamp ${page.rowTitle}`}>
              {decision.title}
            </Link>
            <span className={`clamp ${page.rowRoom}`}>{decision.room?.name ?? "Whole home"}</span>
            <span className={page.rowSince} title="Open since">
              {shortDate(decision.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** "3 things to buy · Shopping", or nothing when the Shopping List is empty. */
function ShoppingLine({ home }: { home: string }) {
  const shopping = useShopping(home);
  const toBuy = shopping.data?.shoppingList.length ?? 0;
  if (toBuy === 0) return null;
  return (
    <p className={page.shoppingLine}>
      {counted(toBuy, "thing")} to buy · <Link to={`/homes/${home}/shopping`}>Shopping</Link>
    </p>
  );
}

/**
 * Three steps: set up the Home Folder, run claude there, and start Home Intake. The server keeps no
 * record of where the folder is, so the steps show until the Home has a Decision or a closed
 * Session.
 */
function GettingStarted({ home }: { home: Home }) {
  return (
    <Section title="Getting started">
      <ol className={page.checklist}>
        <li>
          <span className={page.check} aria-hidden>
            1
          </span>
          <div>
            <p className={page.step}>Set up the Home Folder</p>
            <HomeFolderSetup home={home} />
          </div>
        </li>
        <li>
          <span className={page.check} aria-hidden>
            2
          </span>
          <div>
            <p className={page.step}>
              Open a terminal there and run <code>claude</code>
            </p>
            <p className={styles.muted}>
              Every Session started in the Home Folder belongs to this Home.
            </p>
          </div>
        </li>
        <li>
          <span className={page.check} aria-hidden>
            3
          </span>
          <div>
            <p className={page.step}>Start with Home Intake</p>
            <p className={page.starter}>“Let's record my home; I'll upload the floor plan.”</p>
            <AskAgent
              prompt={buildPrompt({
                skill: "Home Intake",
                text: "Let's record my home; I'll upload the floor plan",
              })}
            />
          </div>
        </li>
      </ol>
    </Section>
  );
}
