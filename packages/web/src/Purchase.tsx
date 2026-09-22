// A Purchase Decision's own parts on its page: first its Quick Guide as core assembles it, in the
// phone page's order (the looking-for line, Measure first, Must, Avoid, then Prefer, In the shop,
// and Ask the seller), and how to take it shopping; then the Full Guide one tap away, marked when
// a Requirement changed after it was written; its Requirements under Must and Prefer, each with a
// short line linking to the record it comes from; the Listings checked against the Requirements, side by
// side; and, once Fulfilled, what was bought and how it differs from what was asked.

import { type ReactNode, useState } from "react";
import { Link } from "react-router";
import styles from "./App.module.css";
import type {
  DecisionDetail,
  Deviation,
  FullGuide,
  QuickGuideLine,
  Requirement,
  Room,
} from "./api";
import { guidesExportUrl } from "./api";
import { reasonPath, recordPath } from "./decisions";
import { formatDate, sentence, words } from "./format";
import { ListingComparison } from "./Listings";
import { headings, InlineMarkdown, Markdown } from "./Markdown";
import page from "./Purchase.module.css";
import { QrCode } from "./QrCode";
import { useFullGuide, useHome } from "./queries";
import { AgentWritten } from "./ui/AgentWritten";
import { Callout } from "./ui/Callout";
import { Card } from "./ui/Card";
import { Section } from "./ui/Section";
import { Fact } from "./Values";

const STRENGTH_ORDER: Record<Requirement["strength"], number> = { must: 0, prefer: 1 };

/** Musts before prefers, each group keeping its own order. */
function byStrength(a: Pick<Requirement, "strength">, b: Pick<Requirement, "strength">): number {
  return STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength];
}

/** A Full Guide with at least this many headings (more than 3) gets a table of contents. */
const CONTENTS_FROM = 4;

/**
 * The Quick Guide as core assembles it, and how to take it shopping. A Settled Purchase not yet
 * Fulfilled shows it above everything else (handoff Q22); the rest keep it in its usual place.
 */
export function QuickGuideSection({ home, decision }: { home: string; decision: DecisionDetail }) {
  const quickLines = decision.quickGuide?.lines ?? [];
  return (
    <Section title="Quick Guide" id="quick-guide">
      {quickLines.length > 0 ? (
        <QuickGuideBlocks
          lookingFor={decision.quickGuide?.lookingFor ?? decision.statement}
          lines={quickLines}
        />
      ) : (
        <p className={styles.muted}>None yet: the Agent writes the Guides in a Purchase Session.</p>
      )}
      {/* Core serves no phone page, export, or phone address for a Rejected Purchase. */}
      {quickLines.length > 0 &&
        (decision.state === "rejected" ? (
          <p className={styles.muted}>
            Rejected, so it has no Guides to open, print, or take shopping.
          </p>
        ) : (
          <TakeItShopping home={home} decision={decision} />
        ))}
    </Section>
  );
}

/** The Guides and the Requirements: what is read beside the Decision's side panel. */
export function PurchaseParts({
  home,
  decision,
  withQuickGuide,
}: {
  home: string;
  decision: DecisionDetail;
  /** False once the page has led with the Quick Guide. */
  withQuickGuide: boolean;
}) {
  // A Window, Door, or Feature is found in its Room through the Home's Rooms.
  const rooms = useHome(home).data?.rooms;
  const fullGuide = decision.guides?.fullGuide;
  const requirements = (
    <Section title="Requirements" id="requirements">
      <Requirements home={home} rooms={rooms} requirements={decision.requirements} />
    </Section>
  );
  const guides = (
    <>
      {withQuickGuide && <QuickGuideSection home={home} decision={decision} />}
      <Section title="Full Guide" id="full-guide">
        {fullGuide ? (
          <FullGuideSection home={home} decision={decision.slug} fullGuide={fullGuide} />
        ) : (
          <p className={styles.muted}>None yet.</p>
        )}
      </Section>
    </>
  );
  // Q22: a Settled, unfulfilled Purchase led with the Quick Guide, so the Guides stay on top. While
  // it is still being chosen, the Requirements are what you work with, and they come first.
  return withQuickGuide ? (
    <>
      {requirements}
      {guides}
    </>
  ) : (
    <>
      {guides}
      {requirements}
    </>
  );
}

/** The Listing board and any Fulfilment: below the side panel, so the board can take the width. */
export function PurchaseBoard({ home, decision }: { home: string; decision: DecisionDetail }) {
  const rooms = useHome(home).data?.rooms;
  // Musts first, both in the Requirements list and down the side of the board.
  const requirements = decision.requirements.toSorted(byStrength);
  return (
    <>
      <Section title="Listings" id="listings">
        {decision.listings.length === 0 ? (
          <p className={styles.muted}>
            None yet: the Agent checks a product you bring it against the Requirements.
          </p>
        ) : (
          <ListingComparison home={home} requirements={requirements} listings={decision.listings} />
        )}
      </Section>
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
  if (requirements.length === 0) return <p className={styles.muted}>None yet.</p>;
  // Under a heading per strength, so no row repeats it; positions are kept, never renumbered.
  return (["must", "prefer"] as const).map((strength) => {
    const shown = requirements.filter((requirement) => requirement.strength === strength);
    if (shown.length === 0) return null;
    return (
      <div key={strength} className={page.requirementGroup}>
        <h3 className={page.guideTitle}>{sentence(strength)}</h3>
        <ul className={`${page.requirements} ${page[`requirements-${strength}`]}`}>
          {shown.map((requirement) => (
            <li key={requirement.position}>
              <RequirementLine
                requirement={requirement}
                path={reasonPath(home, requirement.reason, rooms)}
              />
            </li>
          ))}
        </ul>
      </div>
    );
  });
}

/**
 * "under 85 cm tall", then a quiet line under it naming where it comes from ("Front door, clear
 * width") and linking to that record. A Note or a Constraint is named by its whole text, so the
 * line keeps what comes before its colon, and the full text shows on hover.
 */
function RequirementLine({
  requirement,
  path,
}: {
  requirement: Requirement;
  path: string | undefined;
}) {
  const { reason } = requirement;
  const full = `${reason.name}${reason.field ? `, ${words(reason.field)}` : ""}`;
  const label = `${shortName(reason.name)}${reason.field ? `, ${words(reason.field)}` : ""}`;
  return (
    <>
      <span className={page.requirementText}>{requirement.text}</span>
      {path ? (
        <Link className={page.reason} to={path} title={full}>
          {label}
        </Link>
      ) : (
        <span className={page.reason} title={full}>
          {label}
        </span>
      )}
    </>
  );
}

/** A name's lead-in before its colon, when it has a short one: "Living room window cover: it must…". */
function shortName(name: string): string {
  const colon = name.indexOf(":");
  return colon > 0 && colon <= 48 ? name.slice(0, colon) : name;
}

// A number with any unit or ×-joined numbers after it: "2.0 × 1.4 m", "85 cm", "£450", "~3.60 m".
const NUMBER =
  /[~£€$]?\d+(?:[.,]\d+)?(?:\s*[×x]\s*\d+(?:[.,]\d+)?)*(?:\s*(?:mm|cm|m²|m|kg|K|lm|W|%|kWh|cm²)(?![\p{L}]))?/gu;

/** A line with its numbers in bold, so measurements stand out in the shop. */
export function BoldNumbers({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(NUMBER)) {
    if (match.index > at) parts.push(text.slice(at, match.index));
    parts.push(<strong key={match.index}>{match[0]}</strong>);
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

const MEASURE_FIRST = /^Measure first:\s*/i;

/** The heading over each kind of Quick Guide line, as the phone page and the exports have it. */
const QUICK_GUIDE_HEADINGS: Record<QuickGuideLine["kind"], string> = {
  "measure-first": "Measure first",
  must: "Must",
  prefer: "Prefer",
  avoid: "Avoid",
  test: "In the shop",
  ask: "Ask the seller",
};

/**
 * The Quick Guide in core's order, all of it shown: the looking-for line (the statement until a
 * Session writes one), Measure first as an important Callout, the musts and the avoids, then the
 * prefers, the tests for the shop, and what to ask the seller, quieter. Numbers bold throughout.
 */
function QuickGuideBlocks({
  lookingFor,
  lines,
}: {
  lookingFor: string | undefined;
  lines: QuickGuideLine[];
}) {
  const of = (kind: QuickGuideLine["kind"]) => lines.filter((line) => line.kind === kind);
  const key = (line: QuickGuideLine) => `${line.kind}:${line.requirement ?? line.text}`;
  const measure = of("measure-first");
  const group = (kinds: QuickGuideLine["kind"][]) =>
    kinds.map((kind) => ({ kind, lines: of(kind) })).filter((each) => each.lines.length > 0);
  const firm = group(["must", "avoid"]);
  const soft = group(["prefer", "test", "ask"]);
  const blocks = (groups: typeof firm) =>
    groups.map(({ kind, lines: shown }) => (
      <div key={kind} className={page.guideGroup}>
        <h3 className={page.guideTitle}>{QUICK_GUIDE_HEADINGS[kind]}</h3>
        <ul className={`${page.guideList} ${page[`guide-${kind}`] ?? ""}`}>
          {shown.map((line) => (
            <li key={key(line)}>
              <BoldNumbers text={line.text} />
            </li>
          ))}
        </ul>
      </div>
    ));
  return (
    <div className={page.quickGuide}>
      {lookingFor && (
        <p className={page.lookingFor}>
          <BoldNumbers text={lookingFor} />
        </p>
      )}
      {measure.length > 0 && (
        <Callout tone="important" title={QUICK_GUIDE_HEADINGS["measure-first"]}>
          <ul className={page.guideList}>
            {measure.map((line) => (
              <li key={key(line)}>
                <strong>{line.text.replace(MEASURE_FIRST, "")}</strong>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {firm.length > 0 && <div className={page.guideBlock}>{blocks(firm)}</div>}
      {soft.length > 0 && (
        <div className={`${page.guideBlock} ${page.guideSoft}`}>{blocks(soft)}</div>
      )}
    </div>
  );
}

/**
 * How to take the Quick Guide shopping, in steps: open it on a phone (by the QR code of its phone
 * address, when the app has one), print it or download it, and know the phone page is live.
 */
function TakeItShopping({ home, decision }: { home: string; decision: DecisionDetail }) {
  const phoneUrl = decision.guides?.phoneUrl;
  return (
    <Card className={page.shopping}>
      <h3 className={page.shoppingTitle}>Take it shopping</h3>
      <nav aria-label="The Guides elsewhere">
        <ol className={page.steps}>
          <li>
            <span className={page.stepTitle}>Open it on your phone</span>
            <span className={page.stepNote}>
              {decision.quickGuide && (
                <a href={decision.quickGuide.path} target="_blank" rel="noreferrer">
                  Phone page
                </a>
              )}
              {phoneUrl ? (
                " or scan the code:"
              ) : (
                <>
                  {" "}
                  opens on this computer. Start the app with <code>SETTLE_LAN=1</code> for a code a
                  phone can scan.
                </>
              )}
            </span>
            {phoneUrl && (
              <figure className={page.qr}>
                <QrCode text={phoneUrl} />
                <figcaption>
                  Scan it with your phone to take the Quick Guide shopping:{" "}
                  <a href={phoneUrl}>{phoneUrl}</a>
                </figcaption>
              </figure>
            )}
          </li>
          {decision.guides && (
            <li>
              <span className={page.stepTitle}>Print it or download it</span>
              <span className={page.stepNote}>
                <a
                  href={guidesExportUrl(home, "html", decision.slug)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Printable Guides
                </a>{" "}
                ·{" "}
                <a href={guidesExportUrl(home, "markdown", decision.slug)} download>
                  Guides as Markdown
                </a>
              </span>
            </li>
          )}
          <li>
            <span className={page.stepTitle}>It stays current</span>
            <span className={page.stepNote}>
              The phone page is live: it changes when the Agent changes a Requirement. A screenshot
              won't.
            </span>
          </li>
        </ol>
      </nav>
    </Card>
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
  const anchors = `${decision}-guide`;
  const contents = markdown ? headings(markdown, anchors) : [];
  return (
    <>
      <p className={fullGuide.outOfDate ? `${page.written} ${page.outOfDate}` : page.written}>
        Written {formatDate(fullGuide.writtenAt)}.
        {fullGuide.outOfDate && (
          <>
            {" "}
            <strong className={styles.warning}>Out of date</strong>: a Requirement changed
            {changed && ` on ${formatDate(changed)}`} after it was written.
          </>
        )}
      </p>
      <button
        type="button"
        className="secondary"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
      >
        {shown ? "Hide the Full Guide" : "Show the Full Guide"}
      </button>
      {shown &&
        (full.isError ? (
          <p className={styles.error}>{full.error.message}</p>
        ) : full.isPending ? (
          <p>Loading…</p>
        ) : markdown ? (
          <AgentWritten source="Full Guide" date={fullGuide.writtenAt}>
            <div className={page.fullGuide}>
              {contents.length >= CONTENTS_FROM && (
                <nav className={page.contents} aria-label="Contents">
                  <p className={page.contentsTitle}>Contents</p>
                  <ol>
                    {contents.map((heading) => (
                      <li key={heading.id} className={page[`depth-${Math.min(heading.level, 3)}`]}>
                        <a href={`#${heading.id}`}>
                          <InlineMarkdown text={heading.text} />
                        </a>
                      </li>
                    ))}
                  </ol>
                </nav>
              )}
              <Markdown markdown={markdown} level={3} anchors={anchors} />
            </div>
          </AgentWritten>
        ) : (
          <p>The server sent no Full Guide.</p>
        ))}
    </>
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
      <Section title="Fulfilment" id="fulfilment">
        <dl className={styles.facts}>
          <Fact term="Bought">{done?.bought}</Fact>
          <Fact term="Item added">{record("item", done?.item)}</Fact>
          <Fact term="Item replaced (Archived)">{record("item", done?.replacedItem)}</Fact>
          <Fact term="Feature added">{record("feature", done?.feature)}</Fact>
          <Fact term="Feature replaced (Archived)">{record("feature", done?.replacedFeature)}</Fact>
        </dl>
      </Section>
      <Section title="Deviations" id="deviations">
        {decision.deviations.length === 0 ? (
          <p className={styles.muted}>None: what was bought meets every Requirement.</p>
        ) : (
          <ul className={page.deviations}>
            {decision.deviations.toSorted(byStrength).map((deviation) => (
              <li key={deviation.slug}>
                <DeviationLine deviation={deviation} />
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

/**
 * "Must: under 85 cm tall. Deviation: 92 cm tall (the only one in stock)", the reason in brackets
 * as the receipt has it; one from a must is marked, since it flags every Decision resting on this
 * one.
 */
function DeviationLine({ deviation }: { deviation: Deviation }) {
  const must = deviation.strength === "must";
  return (
    <>
      <strong className={must ? styles.warning : undefined}>{sentence(deviation.strength)}</strong>:{" "}
      {deviation.requirementText}. Deviation: {deviation.text}
      {deviation.reason && ` (${deviation.reason})`}
      {must && " (from a must, so every Decision resting on this one is flagged)"}
    </>
  );
}
