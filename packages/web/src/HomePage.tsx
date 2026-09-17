// The Home's Overview, a status board: what needs the user, where the last Session left off, the
// Palette in force, the Rooms by Level, and the recent Sessions.

import { Link, useParams } from "react-router";
import { HomeFolderSetup } from "./AboutPage";
import styles from "./App.module.css";
import type { DecisionSummary, Home, Room, RoomDetail, Session } from "./api";
import { decisionPath, paletteInForce } from "./decisions";
import { openReviews, ReviewList } from "./Flags";
import { sentence } from "./format";
import page from "./HomePage.module.css";
import { useDecisions, useHome, useSessions } from "./queries";
import { count, RoomGrid, roomsWithGaps, useRoomDetails } from "./RoomTiles";
import { PaletteChips } from "./Swatch";
import { AgentWritten, shortDate } from "./ui/AgentWritten";
import { AskAgent, buildPrompt } from "./ui/AskAgent";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Section } from "./ui/Section";
import { StatePill } from "./ui/StatePill";

/** How many Sessions the Overview lists; the change log has the rest. */
const RECENT_SESSIONS = 5;

/** A Skill's slug as its name: "home-intake" is "Home Intake". */
export function skillName(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** The Sessions, newest first. */
function newestFirst(sessions: readonly Session[]): Session[] {
  return sessions.toSorted((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
}

/** The Design Direction in force: the Locked one, else the latest Leaning, else latest Candidate. */
export function designDirectionInForce(
  decisions: readonly DecisionSummary[],
): DecisionSummary | undefined {
  const directions = decisions.filter((decision) => decision.kind === "design-direction");
  return (
    directions.find((decision) => decision.state === "locked") ??
    directions.filter((decision) => decision.state === "leaning").at(-1) ??
    directions.filter((decision) => decision.state === "candidate").at(-1)
  );
}

export function HomePage() {
  const { home: slug = "" } = useParams();
  const home = useHome(slug);
  const rooms = home.data?.rooms ?? [];
  const details = useRoomDetails(slug, rooms);
  if (home.isPending) return <p>Loading…</p>;
  if (home.isError) return <p className={styles.error}>{home.error.message}</p>;
  const { levels, unplacedItems } = home.data;
  const facts = home.data.home;
  const folder = facts.homeFolderPath;
  return (
    <>
      <header className={page.title}>
        <h1>{facts.name}</h1>
        <p className={page.caption}>
          {[facts.city, facts.tenure && sentence(facts.tenure)].filter(Boolean).join(" · ")}
        </p>
      </header>
      <NeedsYou home={slug} rooms={rooms} details={details} homeFolderPath={folder} />
      <LeftOff home={facts} />
      <PaletteSection home={slug} homeFolderPath={folder} />
      <Section
        title="Rooms"
        action={
          <span className={page.roomsActions}>
            <Link to={`/homes/${slug}/items`}>{count(unplacedItems, "Unplaced Item")}</Link>
            <Link to={`/homes/${slug}/rooms`}>All Rooms →</Link>
          </span>
        }
      >
        <RoomGrid
          home={slug}
          levels={levels}
          rooms={rooms}
          details={details}
          homeFolderPath={folder}
        />
      </Section>
      <Section title="Recent Sessions" action={<Link to={`/homes/${slug}/log`}>Change log</Link>}>
        <SessionList home={slug} />
      </Section>
      <p className={page.footer}>
        <Link to={`/homes/${slug}/about`}>
          About this Home: facts, Constraints, Notes, Blueprints, Home Folder
        </Link>
      </p>
    </>
  );
}

/** The ochre band: open Flags and Conflicts as questions, and how many Rooms have Gaps. */
function NeedsYou({
  home,
  rooms,
  details,
  homeFolderPath,
}: {
  home: string;
  rooms: readonly Room[];
  details: Map<string, RoomDetail>;
  homeFolderPath: string | undefined;
}) {
  const decisions = useDecisions(home);
  if (decisions.isPending) return <p>Loading…</p>;
  if (decisions.isError) return <p className={styles.error}>{decisions.error.message}</p>;
  const reviews = openReviews(decisions.data.decisions);
  const withGaps = roomsWithGaps(rooms, details);
  if (reviews.length === 0 && withGaps.length === 0) {
    return (
      <section className={`${page.needs} ${page.calm}`} aria-label="Needs you">
        <p>Nothing needs you right now.</p>
      </section>
    );
  }
  return (
    <section className={page.needs} aria-labelledby="needs-you">
      <h2 id="needs-you" className={page.needsTitle}>
        Needs you
      </h2>
      {reviews.length > 0 && (
        <ReviewList home={home} reviews={reviews} homeFolderPath={homeFolderPath} />
      )}
      {withGaps.length > 0 && (
        <p className={page.gaps}>
          <Link to={`/homes/${home}/rooms`}>{count(withGaps.length, "Room")} with Gaps</Link>: facts
          advice still needs.{" "}
          <AskAgent
            label="Fill the Gaps"
            prompt={buildPrompt({
              skill: "Home Intake",
              text: `let's fill the Gaps in ${withGaps.map((room) => room.name).join(", ")}`,
            })}
            homeFolderPath={homeFolderPath}
          />
        </p>
      )}
    </section>
  );
}

/** The getting-started checklist while the Home lacks a Home Folder or a Session, then the card. */
function LeftOff({ home }: { home: Home }) {
  const sessions = useSessions(home.slug);
  const decisions = useDecisions(home.slug);
  if (sessions.isPending) return <p>Loading…</p>;
  if (sessions.isError) return <p className={styles.error}>{sessions.error.message}</p>;
  const all = newestFirst(sessions.data.sessions);
  const last = all.find((session) => session.summary);
  const direction = decisions.data && designDirectionInForce(decisions.data.decisions);
  return (
    <>
      {(!home.homeFolderPath || all.length === 0) && (
        <GettingStarted home={home} started={all.length > 0} />
      )}
      {last?.summary && (
        <Section title="Where we left off">
          <Card className={page.leftOff}>
            <p className={page.sessionLine}>
              <Link to={`/homes/${home.slug}/sessions/${last.slug}`}>
                {last.skills.map(skillName).join(", ") || "Session"}
              </Link>{" "}
              · {shortDate(last.closedAt ?? last.openedAt)}
            </p>
            <AgentWritten
              source={`${last.skills.map(skillName).join(", ")} Session`.trim()}
              date={last.closedAt ?? last.openedAt}
            >
              <dl className={page.summary}>
                <dt>Changed</dt>
                <dd>{last.summary.changed}</dd>
                <dt>Still open</dt>
                <dd>{last.summary.open}</dd>
              </dl>
            </AgentWritten>
            <p className={page.nextLabel}>Next</p>
            <ol className={page.nextSteps}>
              {decisions.data && direction?.state !== "locked" && (
                <li>
                  <span className={page.next}>Settle the Design Direction</span>
                  <AskAgent
                    prompt={buildPrompt({
                      skill: "Design Direction",
                      text: "let's settle the Design Direction for my home",
                      ...(direction ? { slug: direction.slug } : {}),
                    })}
                    homeFolderPath={home.homeFolderPath}
                  />
                </li>
              )}
              <li>
                <span className={page.next}>{last.summary.next}</span>
                <AskAgent
                  label="Continue"
                  prompt={buildPrompt({
                    text: `Let's pick up where the last Session left off. Next: ${last.summary.next}`,
                  })}
                  homeFolderPath={home.homeFolderPath}
                />
              </li>
            </ol>
          </Card>
        </Section>
      )}
    </>
  );
}

/** Three steps: set up the Home Folder, run claude there, and start Home Intake. */
function GettingStarted({ home, started }: { home: Home; started: boolean }) {
  const folder = home.homeFolderPath;
  return (
    <Section title="Getting started">
      <Card>
        <ol className={page.checklist}>
          <li className={folder ? page.done : undefined}>
            <span className={page.check} aria-hidden>
              {folder ? "✓" : "1"}
            </span>
            <div>
              <p className={page.step}>Set up the Home Folder</p>
              {folder ? (
                <p className={styles.muted}>
                  Set up at <code>{folder}</code>.
                </p>
              ) : (
                <HomeFolderSetup home={home} />
              )}
            </div>
          </li>
          <li className={started ? page.done : undefined}>
            <span className={page.check} aria-hidden>
              {started ? "✓" : "2"}
            </span>
            <div>
              <p className={page.step}>
                Open a terminal there and run <code>claude</code>
              </p>
              <p className={styles.muted}>
                Every Session started in {folder ? <code>{folder}</code> : "the Home Folder"}{" "}
                belongs to this Home.
              </p>
            </div>
          </li>
          <li className={started ? page.done : undefined}>
            <span className={page.check} aria-hidden>
              {started ? "✓" : "3"}
            </span>
            <div>
              <p className={page.step}>Start with Home Intake</p>
              <p className={page.starter}>“Let's record my home; I'll upload the floor plan.”</p>
              <AskAgent
                prompt={buildPrompt({
                  skill: "Home Intake",
                  text: "Let's record my home; I'll upload the floor plan",
                })}
                homeFolderPath={folder}
              />
            </div>
          </li>
        </ol>
      </Card>
    </Section>
  );
}

/** The Design Direction on one line, then the Palette in force as chips, linking to its Decision. */
function PaletteSection({
  home,
  homeFolderPath,
}: {
  home: string;
  homeFolderPath: string | undefined;
}) {
  const decisions = useDecisions(home);
  if (decisions.isPending) return <p>Loading…</p>;
  if (decisions.isError) return <p className={styles.error}>{decisions.error.message}</p>;
  const palette = paletteInForce(decisions.data.decisions);
  const direction = designDirectionInForce(decisions.data.decisions);
  return (
    <Section
      title="Palette"
      id="palette"
      action={
        palette && (
          <span className={page.paletteLine}>
            <Link to={decisionPath(home, palette.slug)}>{palette.title}</Link>
            <StatePill state={palette.state} />
          </span>
        )
      }
    >
      <p className={page.direction}>
        <span className={page.directionLabel}>Design Direction</span>{" "}
        {direction ? (
          <>
            <Link to={decisionPath(home, direction.slug)}>{direction.title}</Link>{" "}
            <StatePill state={direction.state} />
          </>
        ) : (
          <span className={styles.muted}>not settled yet</span>
        )}
      </p>
      {palette ? (
        <PaletteChips colors={palette.colors ?? []} />
      ) : (
        <EmptyState
          text="No Palette yet"
          prompt={buildPrompt({ skill: "Color", text: "let's choose my home's Palette" })}
          homeFolderPath={homeFolderPath}
        />
      )}
    </Section>
  );
}

function SessionList({ home }: { home: string }) {
  const sessions = useSessions(home);
  if (sessions.isPending) return <p>Loading…</p>;
  if (sessions.isError) return <p className={styles.error}>{sessions.error.message}</p>;
  if (sessions.data.sessions.length === 0) return <p className={styles.muted}>No Sessions yet.</p>;
  return (
    <ul className={page.sessions}>
      {newestFirst(sessions.data.sessions)
        .slice(0, RECENT_SESSIONS)
        .map((session) => (
          <li key={session.slug}>
            <Link to={`/homes/${home}/sessions/${session.slug}`}>
              {session.skills.map(skillName).join(", ") || "Session"}
            </Link>
            <span className={page.sessionDate}>{shortDate(session.openedAt)}</span>
            {!session.summary && <span className={page.unsummarised}>unsummarised</span>}
          </li>
        ))}
    </ul>
  );
}
