// A Purchase Decision's own parts on its page: its Requirements, musts first, each linking to the
// record it comes from, and its Shopping Guides: the Quick Guide as core assembles it, in one
// block, and the Full Guide one tap away, marked when a Requirement changed after it was written.

import { useState } from "react";
import { Link } from "react-router";
import styles from "./App.module.css";
import type { DecisionDetail, FullGuide, QuickGuideLine, Requirement } from "./api";
import { reasonPath } from "./decisions";
import { formatDate, sentence, words } from "./format";
import { Markdown } from "./Markdown";
import { useFullGuide, useHome } from "./queries";

const STRENGTH_ORDER: Record<Requirement["strength"], number> = { must: 0, prefer: 1 };

export function PurchaseParts({ home, decision }: { home: string; decision: DecisionDetail }) {
  const quickLines = decision.quickGuide?.lines ?? [];
  const fullGuide = decision.guides?.fullGuide;
  return (
    <>
      <h2>Requirements</h2>
      <Requirements home={home} requirements={decision.requirements} />
      <h2>Quick Guide</h2>
      {quickLines.length > 0 ? (
        <QuickGuideBlock lines={quickLines} />
      ) : (
        <p>None yet: the Agent writes the Guides in a Purchase Session.</p>
      )}
      <h2>Full Guide</h2>
      {fullGuide ? (
        <FullGuideSection home={home} decision={decision.slug} fullGuide={fullGuide} />
      ) : (
        <p>None yet.</p>
      )}
    </>
  );
}

/** The musts, then the prefers, each group in the Requirements' own order. */
function Requirements({ home, requirements }: { home: string; requirements: Requirement[] }) {
  // A Window, Door, or Feature is found in its Room through the Home's Rooms.
  const rooms = useHome(home).data?.rooms;
  if (requirements.length === 0) return <p>None yet.</p>;
  const ordered = requirements.toSorted(
    (a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength],
  );
  return (
    <ul>
      {ordered.map((requirement) => (
        <li key={requirement.position}>
          <RequirementLine
            requirement={requirement}
            path={reasonPath(home, requirement.reason, rooms)}
          />
        </li>
      ))}
    </ul>
  );
}

/** "Must: under 85 cm tall (Front door, clear width)", the reason linking to its record's page. */
function RequirementLine({
  requirement,
  path,
}: {
  requirement: Requirement;
  path: string | undefined;
}) {
  const { reason } = requirement;
  return (
    <>
      <strong>{sentence(requirement.strength)}</strong>: {requirement.text} (
      {path ? <Link to={path}>{reason.name}</Link> : reason.name}
      {reason.field && `, ${words(reason.field)}`})
    </>
  );
}

/**
 * The Quick Guide as one block, as it reads in the shop, in core's order: Measure-first lines in
 * bold, then the musts and the prefers, each saying which it is, then the AI's own lines.
 */
function QuickGuideBlock({ lines }: { lines: QuickGuideLine[] }) {
  return (
    <ul className={styles.guide}>
      {lines.map((line) => (
        <li key={`${line.kind}:${line.requirement ?? line.text}`}>
          {line.kind === "measure-first" ? (
            <strong>{line.text}</strong>
          ) : line.kind === "line" ? (
            line.text
          ) : (
            `${sentence(line.kind)}: ${line.text}`
          )}
        </li>
      ))}
    </ul>
  );
}

/** When the Full Guide was written and whether it is out of date, then the Guide on a tap. */
function FullGuideSection({
  home,
  decision,
  fullGuide,
}: {
  home: string;
  decision: string;
  fullGuide: FullGuide;
}) {
  const [shown, setShown] = useState(false);
  const full = useFullGuide(home, decision, shown);
  const markdown = full.data?.decision.guides?.fullGuide?.markdown;
  const changed = fullGuide.requirementsChangedAt;
  return (
    <>
      <p>
        Written {formatDate(fullGuide.writtenAt)}.
        {fullGuide.outOfDate && (
          <>
            {" "}
            <strong className={styles.warning}>Out of date</strong>: a Requirement changed
            {changed && ` on ${formatDate(changed)}`} after it was written.
          </>
        )}
      </p>
      <button type="button" aria-expanded={shown} onClick={() => setShown(!shown)}>
        {shown ? "Hide the Full Guide" : "Show the Full Guide"}
      </button>
      {shown &&
        (full.isError ? (
          <p className={styles.error}>{full.error.message}</p>
        ) : full.isPending ? (
          <p>Loading…</p>
        ) : markdown ? (
          <div className={styles.fullGuide}>
            <Markdown markdown={markdown} level={3} />
          </div>
        ) : (
          <p>The server sent no Full Guide.</p>
        ))}
    </>
  );
}
