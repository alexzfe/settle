// The sidebar footer's line on the Agent: working now, a Session left open, or the last Session.
// The MCP endpoint is stateless, so "connected" is unknowable; the last tool call is the signal.

import { type ReactNode, useEffect, useState } from "react";
import { Link } from "react-router";
import type { Session } from "../api";
import { skillName } from "../HomePage";
import { type LiveState, useLastAgentCall } from "../liveUpdates";
import { useSessions } from "../queries";
import styles from "./AgentStatus.module.css";
import { shortDate } from "./AgentWritten";
import { AskAgent, buildPrompt } from "./AskAgent";
import { LivePill } from "./LivePill";

const MINUTE_MS = 60_000;
/** A call this recent, with a Session open, means the Agent is working. */
export const WORKING_MS = 5 * MINUTE_MS;
/** No call for this long, with a Session open, means the Session was left open. */
export const IDLE_MS = 30 * MINUTE_MS;

/** "Color, Purchase Session", or "Session" when it named no Skill. */
function sessionName(session: Session): string {
  return `${session.skills.map(skillName).join(", ")} Session`.trim();
}

/** Re-renders once a minute, so states expire without new events. */
function useMinuteTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), MINUTE_MS);
    return () => clearInterval(timer);
  }, []);
}

/**
 * The footer's status region, with the last Session's link beside it. The region stays in the
 * page whatever it says, empty included, so a screen reader announces each change of text: a live
 * region inserted with its text already in it is not read out. Only the Agent's live states go in
 * it; the last Session is history, and announcing it on every Home load would be noise.
 */
export function AgentStatus({ home, live }: { home: string; live: LiveState }) {
  const line = useAgentLine(home, live);
  return (
    <>
      <div role="status" className={styles.region}>
        {line.live}
      </div>
      {line.last}
    </>
  );
}

/**
 * One line, in priority order: the live connection's failure, with Reload; "● Agent working"
 * while a Session is open and the Agent called a tool in the last 5 minutes; "Session still open ·
 * Wrap up" once it has been idle 30 minutes; else the last Session's date, or nothing. The first
 * three are `live`, for the status region; the last Session is `last`, shown outside it.
 */
function useAgentLine(home: string, live: LiveState): { live?: ReactNode; last?: ReactNode } {
  useMinuteTick();
  const sessions = useSessions(home);
  const lastCall = useLastAgentCall(home);
  if (live === "reconnecting" || live === "stopped") return { live: <LivePill state={live} /> };
  if (!sessions.data) return {};
  const newest = sessions.data.sessions.toSorted(
    (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt),
  )[0];
  if (!newest) return {};
  if (!newest.closedAt) {
    // Opening the Session was itself a call, and the one to go by after a server restart.
    const lastActive = Math.max(
      Date.parse(newest.openedAt),
      lastCall ? Date.parse(lastCall) : Number.NEGATIVE_INFINITY,
    );
    const idle = Date.now() - lastActive;
    if (idle < WORKING_MS) {
      return {
        live: (
          <span className={styles.status}>
            <span className={styles.dot} aria-hidden />
            Agent working · {sessionName(newest)}
          </span>
        ),
      };
    }
    if (idle >= IDLE_MS) {
      const prompt = buildPrompt({
        text: `wrap up the open ${sessionName(newest)} with a summary of what changed and what is still open`,
        slug: newest.slug,
      });
      return {
        live: (
          <span className={styles.status}>
            {sessionName(newest)} still open · <AskAgent prompt={prompt} label="Wrap up" />
          </span>
        ),
      };
    }
  }
  return {
    last: (
      <span className={styles.status}>
        <Link to={`/homes/${home}/sessions/${newest.slug}`}>
          Last Session {shortDate(newest.closedAt ?? newest.openedAt)}
        </Link>
      </span>
    ),
  };
}
