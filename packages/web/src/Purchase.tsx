// A Purchase Decision's own parts on its page: its Requirements, musts first, each linking to the
// record it comes from; its Shopping Guides, the Quick Guide as core assembles it in one block and
// the Full Guide one tap away, marked when a Requirement changed after it was written; the
// Listings checked against the Requirements; and, once Fulfilled, what was bought and how it
// differs from what was asked.

import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import styles from "./App.module.css";
import type {
  DecisionDetail,
  Deviation,
  FullGuide,
  Listing,
  ListingCheck,
  QuickGuideLine,
  Requirement,
  Room,
} from "./api";
import { guidesExportUrl } from "./api";
import { reasonPath, recordPath } from "./decisions";
import { formatDate, metres, sentence, words } from "./format";
import { isSafeLink, Markdown } from "./Markdown";
import { QrCode } from "./QrCode";
import { useFullGuide, useHome } from "./queries";
import { Fact, Parts } from "./Values";

const STRENGTH_ORDER: Record<Requirement["strength"], number> = { must: 0, prefer: 1 };

/** Musts before prefers, each group keeping its own order. */
function byStrength(a: Pick<Requirement, "strength">, b: Pick<Requirement, "strength">): number {
  return STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength];
}

const RESULT_LABEL: Record<ListingCheck["result"], string> = {
  pass: "Pass",
  fail: "Fail",
  unknown: "Unknown",
};

export function PurchaseParts({ home, decision }: { home: string; decision: DecisionDetail }) {
  // A Window, Door, or Feature is found in its Room through the Home's Rooms.
  const rooms = useHome(home).data?.rooms;
  const quickLines = decision.quickGuide?.lines ?? [];
  const fullGuide = decision.guides?.fullGuide;
  return (
    <>
      <h2>Requirements</h2>
      <Requirements home={home} rooms={rooms} requirements={decision.requirements} />
      <h2>Quick Guide</h2>
      {quickLines.length > 0 ? (
        <QuickGuideBlock lines={quickLines} />
      ) : (
        <p>None yet: the Agent writes the Guides in a Purchase Session.</p>
      )}
      {quickLines.length > 0 && <GuidesElsewhere home={home} decision={decision} />}
      <h2>Full Guide</h2>
      {fullGuide ? (
        <FullGuideSection home={home} decision={decision.slug} fullGuide={fullGuide} />
      ) : (
        <p>None yet.</p>
      )}
      <h2>Listings</h2>
      {decision.listings.length === 0 ? (
        <p>None yet: the Agent checks a product you bring it against the Requirements.</p>
      ) : (
        decision.listings.map((listing) => <ListingSection key={listing.slug} listing={listing} />)
      )}
      {decision.fulfilledAt && <PurchaseFulfilment home={home} rooms={rooms} decision={decision} />}
    </>
  );
}

function Requirements({
  home,
  rooms,
  requirements,
}: {
  home: string;
  rooms: Room[] | undefined;
  requirements: Requirement[];
}) {
  if (requirements.length === 0) return <p>None yet.</p>;
  return (
    <ul>
      {requirements.toSorted(byStrength).map((requirement) => (
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

/**
 * The Quick Guide's phone page and the Guides' printable page and Markdown; in LAN mode, the
 * phone page's address on the user's network as a QR code, to take the Quick Guide shopping.
 */
function GuidesElsewhere({ home, decision }: { home: string; decision: DecisionDetail }) {
  const lanUrl = decision.guides?.lanUrl;
  return (
    <>
      <nav className={styles.nav} aria-label="The Guides elsewhere">
        {decision.quickGuide && (
          <a href={decision.quickGuide.path} target="_blank" rel="noreferrer">
            Phone page
          </a>
        )}
        {decision.guides && (
          <>
            <a href={guidesExportUrl(home, "html", decision.slug)} target="_blank" rel="noreferrer">
              Printable Guides
            </a>
            <a href={guidesExportUrl(home, "markdown", decision.slug)} download>
              Guides as Markdown
            </a>
          </>
        )}
      </nav>
      {lanUrl && (
        <figure className={styles.qr}>
          <QrCode text={lanUrl} />
          <figcaption>
            Scan it with a phone on this network to take the Quick Guide shopping:{" "}
            <a href={lanUrl}>{lanUrl}</a>
          </figcaption>
        </figure>
      )}
    </>
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

/** A link to a page elsewhere, opened in a new tab; plain text without a web address. */
function WebLink({ href, children }: { href: string | undefined; children: ReactNode }) {
  if (!href || !isSafeLink(href)) return children;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/** A Listing's size as it states it, "W 2.00 m × D 3.00 m"; undefined when it states none. */
function listingSize(dimensions: Listing["dimensions"]): string | undefined {
  const stated = (
    [
      ["W", dimensions?.width],
      ["D", dimensions?.depth],
      ["H", dimensions?.height],
    ] as const
  ).flatMap(([label, mm]) => (mm === undefined ? [] : [`${label} ${metres(mm)}`]));
  return stated.length === 0 ? undefined : stated.join(" × ");
}

/**
 * A product checked against the Requirements: what it is, its counts and any must it fails, then
 * its result for each Requirement, musts first, a failed must in bold.
 */
function ListingSection({ listing }: { listing: Listing }) {
  const { counts, failedMusts } = listing;
  const failed = listing.checks.filter((check) => failedMusts.includes(check.requirement));
  return (
    <section>
      <h3>
        <WebLink href={listing.url}>{listing.name}</WebLink>
      </h3>
      <p>
        <Parts>
          {listing.price}
          {listingSize(listing.dimensions)}
          {listing.photo && isSafeLink(listing.photo) && (
            <WebLink href={listing.photo}>photo</WebLink>
          )}
          {`recorded ${formatDate(listing.recordedAt)}`}
        </Parts>
      </p>
      <p>
        {counts.pass} pass, {counts.fail} fail, {counts.unknown} unknown.
        {failed.length > 0 && (
          <>
            {" "}
            <strong className={styles.warning}>
              Fails {failed.length === 1 ? "a must" : `${failed.length} musts`}:{" "}
              {failed.map((check) => check.text).join("; ")}.
            </strong>
          </>
        )}
      </p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Result</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {listing.checks.toSorted(byStrength).map((check) => (
              <CheckRow
                key={check.requirement}
                check={check}
                failedMust={failedMusts.includes(check.requirement)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckRow({ check, failedMust }: { check: ListingCheck; failedMust: boolean }) {
  const result = check.unchecked
    ? "Unknown: added after it was checked"
    : RESULT_LABEL[check.result];
  return (
    <tr>
      <td>
        {sentence(check.strength)}: {check.text}
      </td>
      <td>{failedMust ? <strong className={styles.warning}>{result}</strong> : result}</td>
      <td>{check.note}</td>
    </tr>
  );
}

/** What was bought and the changes it made to the Home, then how it differs from what was asked. */
function PurchaseFulfilment({
  home,
  rooms,
  decision,
}: {
  home: string;
  rooms: Room[] | undefined;
  decision: DecisionDetail;
}) {
  const done = decision.fulfilment;
  const record = (kind: string, slug: string | undefined): ReactNode => {
    if (!slug) return undefined;
    const path = recordPath(home, kind, slug, rooms);
    return path ? <Link to={path}>{slug}</Link> : slug;
  };
  return (
    <>
      <h2>Fulfilment</h2>
      <dl className={styles.facts}>
        <Fact term="Bought">{done?.bought}</Fact>
        <Fact term="Item added">{record("item", done?.item)}</Fact>
        <Fact term="Item replaced (Archived)">{record("item", done?.replacedItem)}</Fact>
        <Fact term="Feature added">{record("feature", done?.feature)}</Fact>
        <Fact term="Feature replaced (Archived)">{record("feature", done?.replacedFeature)}</Fact>
      </dl>
      <h2>Deviations</h2>
      {decision.deviations.length === 0 ? (
        <p>None: what was bought meets every Requirement.</p>
      ) : (
        <ul>
          {decision.deviations.toSorted(byStrength).map((deviation) => (
            <li key={deviation.slug}>
              <DeviationLine deviation={deviation} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * "Must: under 85 cm tall. Deviation: 92 cm tall"; one from a must is marked, since it flags every
 * Decision resting on this one.
 */
function DeviationLine({ deviation }: { deviation: Deviation }) {
  const must = deviation.strength === "must";
  return (
    <>
      <strong className={must ? styles.warning : undefined}>{sentence(deviation.strength)}</strong>:{" "}
      {deviation.requirementText}. Deviation: {deviation.text}
      {deviation.reason && <> Reason: {deviation.reason}</>}
      {must && " (from a must, so every Decision resting on this one is flagged)"}
    </>
  );
}
