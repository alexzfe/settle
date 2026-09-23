// A Purchase Decision's own parts on its page: its Requirements under Must and Prefer, each with a
// short line linking to the record it comes from; then Taking it shopping — the Agent's own Quick
// Guide lines (what to avoid on sight, what to try in the shop, what to ask the seller), the Full
// Guide one tap away, marked when a Requirement changed after it was written, and how to carry the
// Quick Guide; the Listings checked against the Requirements, side by side; and, once Fulfilled,
// what was bought and how it differs from what was asked.
//
// The page shows the Agent's lines alone, not the whole Quick Guide, because the Requirements are
// a few hundred pixels above it and core splices each one into the guide verbatim (shopLines,
// below). Every surface that renders the guide without the Requirements beside it — the phone
// page, the printable and Markdown exports, the Shopping List — still shows it whole.

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
import { buildPrompt } from "./ui/AskAgent";
import { Callout } from "./ui/Callout";
import { Card } from "./ui/Card";
import { EmptyState } from "./ui/EmptyState";
import { Section } from "./ui/Section";
import { Fact } from "./Values";

const STRENGTH_ORDER: Record<Requirement["strength"], number> = { must: 0, prefer: 1 };

/** Musts before prefers, each group keeping its own order. */
function byStrength(a: Pick<Requirement, "strength">, b: Pick<Requirement, "strength">): number {
  return STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength];
}

/** A Full Guide with at least this many headings (more than 3) gets a table of contents. */
const CONTENTS_FROM = 4;

/** The kinds of Quick Guide line the Agent writes itself, rather than core deriving them. */
const SHOP_LINE_KINDS = new Set<QuickGuideLine["kind"]>(["avoid", "test", "ask"]);

/**
 * The Agent's own Quick Guide lines: what the Requirements cannot say. The Decision page shows
 * only these, because the Requirements are already on the page (handoff Q12) and core splices each
 * one into the guide verbatim as a must or a prefer. Core's text renderer filters the same way,
 * for the same reason ("Quick Guide, besides the Requirements", render.ts); the two are kept apart
 * deliberately, since importing a value from core pulls its Node-only modules into this bundle.
 */
export function shopLines(lines: readonly QuickGuideLine[]): QuickGuideLine[] {
  return lines.filter((line) => SHOP_LINE_KINDS.has(line.kind));
}

/**
 * Taking it shopping: what the Requirements above cannot settle — what to reject on sight, what to
 * try with it in your hands, what to ask the seller — then the Full Guide, then where to read the
 * whole Quick Guide once you are out of the house.
 */
function TakingItShoppingSection({ home, decision }: { home: string; decision: DecisionDetail }) {
  const quickGuide = decision.quickGuide;
  const lines = shopLines(quickGuide?.lines ?? []);
  const fullGuide = decision.guides?.fullGuide;
  return (
    <Section title="Taking it shopping" id="taking-it-shopping">
      {/* Core's Find index still sends readers to #quick-guide (find-index.ts), and core is not
          this track's to change; the anchor keeps those links landing here. */}
      <span id="quick-guide" />
      {lines.length > 0 ? (
        <ShopLines lookingFor={quickGuide?.lookingFor} lines={lines} />
      ) : (
        <EmptyState
          /* Core assembles a Quick Guide for every Purchase, so what says whether the Agent has
             been here at all is the saved Guides, not the guide. */
          text={
            decision.guides
              ? "No shop notes yet: nothing recorded to avoid on sight, try in the shop, or ask the seller."
              : "None yet: the Agent writes the Guides in a Purchase Session."
          }
          prompt={buildPrompt({
            skill: "Purchase",
            text:
              `write the shop notes for "${decision.title}": what to avoid on sight, what to ` +
              "test in the shop, and what to ask the seller",
            slug: decision.slug,
          })}
        />
      )}
      <div className={page.fullGuideBlock} id="full-guide">
        <h3 className={page.guideTitle}>Full Guide</h3>
        {fullGuide ? (
          <FullGuideSection home={home} decision={decision.slug} fullGuide={fullGuide} />
        ) : (
          <p className={styles.muted}>None yet.</p>
        )}
      </div>
      {/* Core serves no phone page, export, or phone address for a Rejected Purchase. */}
      {quickGuide &&
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

/**
 * The Requirements and then Taking it shopping: what is read beside the Decision's side panel.
 * One order at every state — the Requirements are the record, and the shop lines are what you take
 * away from it.
 */
export function PurchaseParts({ home, decision }: { home: string; decision: DecisionDetail }) {
  // A Window, Door, or Feature is found in its Room through the Home's Rooms.
  const rooms = useHome(home).data?.rooms;
  return (
    <>
      <Section title="Requirements" id="requirements">
        <Requirements home={home} rooms={rooms} requirements={decision.requirements} />
      </Section>
      <TakingItShoppingSection home={home} decision={decision} />
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

/**
 * The heading over each kind of Quick Guide line, as the phone page and the exports have it. The
 * Decision page uses only Measure first and the Agent's three; the rest are kept so a kind added
 * or dropped in core fails this build.
 */
const QUICK_GUIDE_HEADINGS: Record<QuickGuideLine["kind"], string> = {
  "measure-first": "Measure first",
  must: "Must",
  prefer: "Prefer",
  avoid: "Avoid",
  test: "In the shop",
  ask: "Ask the seller",
};

/**
 * What to measure before leaving the house, as an important Callout: nothing else on the page has
 * to happen first, and a missed one means a wasted trip. It sits under the statement rather than
 * in Taking it shopping (handoff Q10, Q21), and appears exactly once, so this de-duplication
 * introduces no fresh duplicate. The phone page keeps its own Measure first section.
 */
export function MeasureFirst({ decision }: { decision: DecisionDetail }) {
  const lines = (decision.quickGuide?.lines ?? []).filter((line) => line.kind === "measure-first");
  if (lines.length === 0) return null;
  return (
    <div className={page.measureFirst}>
      <Callout tone="important" title={QUICK_GUIDE_HEADINGS["measure-first"]}>
        <ul className={page.guideList}>
          {lines.map((line) => (
            <li key={line.text}>
              <strong>{line.text.replace(MEASURE_FIRST, "")}</strong>
            </li>
          ))}
        </ul>
      </Callout>
    </div>
  );
}

/**
 * The Agent's own lines in core's order, under the looking-for line: what to avoid on sight, what
 * to try in the shop, and what to ask the seller. No section is quieter than another — they are
 * the whole of what this card says, and the Requirements above carry the rest. Numbers bold
 * throughout, so measurements stand out in a shop.
 */
function ShopLines({
  lookingFor,
  lines,
}: {
  lookingFor: string | undefined;
  lines: QuickGuideLine[];
}) {
  const groups = (["avoid", "test", "ask"] as const)
    .map((kind) => ({ kind, lines: lines.filter((line) => line.kind === kind) }))
    .filter((each) => each.lines.length > 0);
  return (
    <div className={page.quickGuide}>
      {lookingFor && (
        <p className={page.lookingFor}>
          <BoldNumbers text={lookingFor} />
        </p>
      )}
      <div className={page.guideBlock}>
        {groups.map(({ kind, lines: shown }) => (
          <div key={kind} className={page.guideGroup}>
            <h3 className={page.guideTitle}>{QUICK_GUIDE_HEADINGS[kind]}</h3>
            <ul className={page.guideList}>
              {shown.map((line) => (
                <li key={line.text}>
                  <BoldNumbers text={line.text} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Where to read the whole Quick Guide, in steps: open it on a phone (by the QR code of its phone
 * address, when the app has one), print it or download it, and know the phone page is live. Its
 * heading says where rather than what, since the section around it is already "Taking it shopping".
 */
function TakeItShopping({ home, decision }: { home: string; decision: DecisionDetail }) {
  const phoneUrl = decision.guides?.phoneUrl;
  return (
    <Card className={page.shopping}>
      <h3 className={page.shoppingTitle}>Where to read it</h3>
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
