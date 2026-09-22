// The sidebar footer's line on the Agent: working now, a Session left open, or the last Session.
// The MCP endpoint is stateless, so "connected" is unknowable; the last tool call is the signal.

import { useEffect, useState } from "react";
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
 * One line, in priority order: the live connection's failure, with Reload; "● Agent working"
 * while a Session is open and the Agent called a tool in the last 5 minutes; "Session still open ·
 * Wrap up" once it has been idle 30 minutes; else the last Session's date, or nothing.
 */
export function AgentStatus({ home, live }: { home: string; live: LiveState }) {
  useMinuteTick();
  const sessions = useSessions(home);
  const lastCall = useLastAgentCall(home);
  if (live === "reconnecting" || live === "stopped") return <LivePill state={live} />;
  if (!sessions.data) return null;
  const newest = sessions.data.sessions.toSorted(
    (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt),
  )[0];
  if (!newest) return null;
  if (!newest.closedAt) {
    // Opening the Session was itself a call, and the one to go by after a server restart.
    const lastActive = Math.max(
      Date.parse(newest.openedAt),
      lastCall ? Date.parse(lastCall) : Number.NEGATIVE_INFINITY,
    );
    const idle = Date.now() - lastActive;
    if (idle < WORKING_MS) {
      return (
        <span className={styles.status} aria-live="polite">
          <span className={styles.dot} aria-hidden />
          Agent working · {sessionName(newest)}
        </span>
      );
    }
    if (idle >= IDLE_MS) {
      const prompt = buildPrompt({
        text: `wrap up the open ${sessionName(newest)} with a summary of what changed and what is still open`,
        slug: newest.slug,
      });
      return (
        <span className={styles.status}>
          {sessionName(newest)} still open · <AskAgent prompt={prompt} label="Wrap up" />
        </span>
      );
    }
  }
  return (
    <span className={styles.status} aria-live="polite">
      <Link to={`/homes/${home}/sessions/${newest.slug}`}>
        Last Session {shortDate(newest.closedAt ?? newest.openedAt)}
      </Link>
    </span>
  );
}
