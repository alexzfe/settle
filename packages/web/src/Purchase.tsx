// A Purchase Decision's own parts on its page: first its Quick Guide as core assembles it, in three
// blocks (Measure first, Must, Prefer and In the shop), and how to take it shopping; then the Full
// Guide one tap away, marked when a Requirement changed after it was written; its Requirements,
// musts first, each with a chip linking to the record it comes from; the Listings checked against
// the Requirements, side by side; and, once Fulfilled, what was bought and how it differs from
// what was asked.

import { type ReactNode, useEffect, useState } from "react";
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
import { headings, InlineMarkdown, isSafeLink, Markdown } from "./Markdown";
import page from "./Purchase.module.css";
import { QrCode } from "./QrCode";
import { useFullGuide, useHome } from "./queries";
import { AgentWritten } from "./ui/AgentWritten";
import { Callout } from "./ui/Callout";
import { Card } from "./ui/Card";
import { Section } from "./ui/Section";
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

const RESULT_SYMBOL: Record<ListingCheck["result"], string> = {
  pass: "✓",
  fail: "✕",
  unknown: "?",
};

/** A Full Guide with at least this many headings (more than 3) gets a table of contents. */
const CONTENTS_FROM = 4;

export function PurchaseParts({ home, decision }: { home: string; decision: DecisionDetail }) {
  // A Window, Door, or Feature is found in its Room through the Home's Rooms.
  const rooms = useHome(home).data?.rooms;
  const quickLines = decision.quickGuide?.lines ?? [];
  const fullGuide = decision.guides?.fullGuide;
  return (
    <>
      <Section title="Quick Guide" id="quick-guide">
        {quickLines.length > 0 ? (
          <QuickGuideBlocks lines={quickLines} />
        ) : (
          <p className={styles.muted}>
            None yet: the Agent writes the Guides in a Purchase Session.
          </p>
        )}
        {/* Core serves no phone page, export, or LAN page for a Rejected Purchase. */}
        {quickLines.length > 0 &&
          (decision.state === "rejected" ? (
            <p className={styles.muted}>
              Rejected, so it has no Guides to open, print, or take shopping.
            </p>
          ) : (
            <TakeItShopping home={home} decision={decision} />
          ))}
      </Section>
      <Section title="Full Guide" id="full-guide">
        {fullGuide ? (
          <FullGuideSection home={home} decision={decision.slug} fullGuide={fullGuide} />
        ) : (
          <p className={styles.muted}>None yet.</p>
        )}
      </Section>
      <Section title="Requirements" id="requirements">
        <Requirements home={home} rooms={rooms} requirements={decision.requirements} />
      </Section>
      <Section title="Listings" id="listings">
        {decision.listings.length === 0 ? (
          <p className={styles.muted}>
            None yet: the Agent checks a product you bring it against the Requirements.
          </p>
        ) : (
          <ListingComparison requirements={decision.requirements} listings={decision.listings} />
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
  return (
    <ul className={page.requirements}>
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

/** "Must · under 85 cm tall · [Front door, clear width]", the reason chip linking to its record. */
function RequirementLine({
  requirement,
  path,
}: {
  requirement: Requirement;
  path: string | undefined;
}) {
  const { reason } = requirement;
  const chip = (
    <>
      {reason.name}
      {reason.field && `, ${words(reason.field)}`}
    </>
  );
  return (
    <>
      <span className={`${page.strength} ${page[requirement.strength]}`}>
        {sentence(requirement.strength)}
      </span>
      <span className={page.requirementText}>{requirement.text}</span>
      {path ? (
        <Link className={page.reason} to={path} title="Where it comes from">
          {chip}
        </Link>
      ) : (
        <span className={page.reason} title="Where it comes from">
          {chip}
        </span>
      )}
    </>
  );
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
 * The Quick Guide in three blocks, in core's order: Measure first (an important Callout), the
 * musts with their numbers bold, then the prefers and the AI's own lines for the shop.
 */
function QuickGuideBlocks({ lines }: { lines: QuickGuideLine[] }) {
  const of = (kind: QuickGuideLine["kind"]) => lines.filter((line) => line.kind === kind);
  const key = (line: QuickGuideLine) => `${line.kind}:${line.requirement ?? line.text}`;
  const measure = of("measure-first");
  const musts = of("must");
  const prefers = of("prefer");
  const shop = of("line");
  return (
    <div className={page.quickGuide}>
      {measure.length > 0 && (
        <Callout tone="important" title="Measure first">
          <ul className={page.guideList}>
            {measure.map((line) => (
              <li key={key(line)}>
                <strong>{line.text.replace(MEASURE_FIRST, "")}</strong>
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {musts.length > 0 && (
        <div className={page.guideBlock}>
          <h3 className={page.guideTitle}>Must</h3>
          <ul className={page.guideList}>
            {musts.map((line) => (
              <li key={key(line)}>
                <BoldNumbers text={line.text} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {(prefers.length > 0 || shop.length > 0) && (
        <div className={`${page.guideBlock} ${page.guideSoft}`}>
          {prefers.length > 0 && (
            <>
              <h3 className={page.guideTitle}>Prefer</h3>
              <ul className={page.guideList}>
                {prefers.map((line) => (
                  <li key={key(line)}>{line.text}</li>
                ))}
              </ul>
            </>
          )}
          {shop.length > 0 && (
            <>
              <h3 className={page.guideTitle}>In the shop</h3>
              <ul className={page.guideList}>
                {shop.map((line) => (
                  <li key={key(line)}>{line.text}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * How to take the Quick Guide shopping, in steps: open it on a phone (in LAN mode, by the QR code
 * of its address on the user's network), save a copy, and know the copy will not update.
 */
function TakeItShopping({ home, decision }: { home: string; decision: DecisionDetail }) {
  const lanUrl = decision.guides?.lanUrl;
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
              {lanUrl ? (
                " or scan the code:"
              ) : (
                <>
                  {" "}
                  opens on this computer. Start the app with <code>IDH_LAN=1</code> for a code a
                  phone can scan.
                </>
              )}
            </span>
            {lanUrl && (
              <figure className={page.qr}>
                <QrCode text={lanUrl} />
                <figcaption>
                  Scan it with a phone on this network to take the Quick Guide shopping:{" "}
                  <a href={lanUrl}>{lanUrl}</a>
                </figcaption>
              </figure>
            )}
          </li>
          {decision.guides && (
            <li>
              <span className={page.stepTitle}>Save a copy</span>
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
            <span className={page.stepTitle}>It won't update</span>
            <span className={page.stepNote}>
              A saved copy keeps the Guides as they are now. If a Requirement changes, save it
              again.
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

/** The check a Listing has for a Requirement, by position; unknown when it has none. */
function checkFor(listing: Listing, requirement: Requirement): ListingCheck {
  return (
    listing.checks.find((check) => check.requirement === requirement.position) ?? {
      requirement: requirement.position,
      text: requirement.text,
      strength: requirement.strength,
      result: "unknown",
    }
  );
}

/**
 * What leads a Listing: the musts it fails, else the musts not checked, else that it meets every
 * must. Undefined when there are no musts. No overall score: the user weighs the rest.
 */
export function listingVerdict(
  listing: Listing,
  requirements: readonly Requirement[],
): { tone: "fail" | "unknown" | "pass"; text: string } | undefined {
  const musts = requirements.filter((requirement) => requirement.strength === "must");
  if (musts.length === 0) return undefined;
  const checks = musts.map((must) => checkFor(listing, must));
  const failed = checks.filter(
    (check) => check.result === "fail" || listing.failedMusts.includes(check.requirement),
  );
  if (failed.length > 0) {
    const noun = failed.length === 1 ? "a must" : `${failed.length} musts`;
    return { tone: "fail", text: `Fails ${noun}: ${failed.map((c) => c.text).join("; ")}` };
  }
  const unknown = checks.filter((check) => check.result === "unknown" || check.unchecked);
  if (unknown.length > 0) {
    return { tone: "unknown", text: `Must not checked: ${unknown.map((c) => c.text).join("; ")}` };
  }
  return { tone: "pass", text: "Meets every must" };
}

/** Whether the screen is at least `width` wide; wide when the browser cannot say. */
function useWide(width: string): boolean {
  const query = `(min-width: ${width})`;
  const media = () =>
    typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
  const [wide, setWide] = useState(() => media()?.matches ?? true);
  useEffect(() => {
    const list = typeof window.matchMedia === "function" ? window.matchMedia(query) : undefined;
    if (!list) return undefined;
    const update = () => setWide(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return wide;
}

/**
 * The Listings side by side: a matrix with the Listings across the top and the Requirements down
 * the side, musts first, a failed must marked strongly; on a phone, one card per Listing.
 */
function ListingComparison({
  requirements,
  listings,
}: {
  requirements: Requirement[];
  listings: Listing[];
}) {
  const wide = useWide("48rem");
  const rows = requirements.toSorted(byStrength);
  if (!wide) {
    return (
      <ul className={page.listingCards}>
        {listings.map((listing) => (
          <li key={listing.slug}>
            <ListingCard listing={listing} requirements={rows} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div className={`${styles.scroll} ${page.matrixWrap}`}>
      <table className={page.matrix}>
        <thead>
          <tr>
            <th scope="col" className={page.corner}>
              Requirement
            </th>
            {listings.map((listing) => (
              <th
                key={listing.slug}
                scope="col"
                className={listing.failedMusts.length > 0 ? page.failedListing : undefined}
              >
                <ListingHead listing={listing} requirements={rows} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((requirement) => (
            <tr key={requirement.position}>
              <th scope="row" className={page.rowHead}>
                <span className={`${page.strength} ${page[requirement.strength]}`}>
                  {sentence(requirement.strength)}
                </span>{" "}
                {requirement.text}
              </th>
              {listings.map((listing) => (
                <CheckCell
                  key={listing.slug}
                  check={checkFor(listing, requirement)}
                  failedMust={listing.failedMusts.includes(requirement.position)}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A Listing's name (linked to its page), price, size, photo, when it was recorded, and verdict. */
function ListingHead({
  listing,
  requirements,
}: {
  listing: Listing;
  requirements: readonly Requirement[];
}) {
  const verdict = listingVerdict(listing, requirements);
  return (
    <div className={page.listingHead}>
      <span className={page.listingName}>
        <WebLink href={listing.url}>{listing.name}</WebLink>
      </span>
      <span className={listing.price ? page.price : `${page.price} ${page.noPrice}`}>
        {listing.price ?? "Price not recorded"}
      </span>
      <span className={page.listingMeta}>
        <Parts>
          {listingSize(listing.dimensions)}
          {listing.photo && isSafeLink(listing.photo) && (
            <WebLink href={listing.photo}>photo</WebLink>
          )}
          {`recorded ${formatDate(listing.recordedAt)}`}
        </Parts>
      </span>
      {verdict && (
        <span className={`${page.verdict} ${page[`verdict-${verdict.tone}`]}`}>
          {verdict.tone === "fail" ? <strong>{verdict.text}</strong> : verdict.text}
        </span>
      )}
    </div>
  );
}

function resultOf(check: ListingCheck): { label: string; result: ListingCheck["result"] } {
  return check.unchecked
    ? { label: "Unknown: added after it was checked", result: "unknown" }
    : { label: RESULT_LABEL[check.result], result: check.result };
}

function CheckCell({ check, failedMust }: { check: ListingCheck; failedMust: boolean }) {
  const { label, result } = resultOf(check);
  return (
    <td className={`${page.cell} ${page[result]} ${failedMust ? page.failedMust : ""}`}>
      <span className={page.result}>
        <span aria-hidden>{RESULT_SYMBOL[result]}</span>{" "}
        {failedMust ? <strong>{label}</strong> : label}
      </span>
      {check.note && <span className={page.note}>{check.note}</span>}
    </td>
  );
}

/** A Listing on a phone: led by its verdict, then each Requirement's result, musts first. */
function ListingCard({
  listing,
  requirements,
}: {
  listing: Listing;
  requirements: readonly Requirement[];
}) {
  return (
    <Card className={listing.failedMusts.length > 0 ? page.failedCard : undefined}>
      <ListingHead listing={listing} requirements={requirements} />
      <ul className={page.cardChecks}>
        {requirements.map((requirement) => {
          const check = checkFor(listing, requirement);
          const failedMust = listing.failedMusts.includes(requirement.position);
          const { label, result } = resultOf(check);
          return (
            <li
              key={requirement.position}
              className={`${page[result]} ${failedMust ? page.failedMust : ""}`}
            >
              <span className={page.result}>
                <span aria-hidden>{RESULT_SYMBOL[result]}</span>{" "}
                {failedMust ? <strong>{label}</strong> : label}
              </span>
              <span>
                {sentence(requirement.strength)}: {requirement.text}
                {check.note && <span className={page.note}> · {check.note}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
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
