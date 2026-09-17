// The Shopping section as a calm checklist: the Shopping List (Locked Purchases not yet Fulfilled)
// and Considering (Candidate and Leaning ones), each row with its Purchase Decision, Room, what to
// measure first, any flag, its Listings with the best Rating among the ones it could actually buy,
// and a link to its Quick Guide; and the exports the server renders from stored data.

import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { guidesExportUrl, type ShoppingEntry, shoppingListExportUrl } from "./api";
import { decisionPath } from "./decisions";
import { useShopping } from "./queries";
import page from "./ShoppingPage.module.css";
import { Card } from "./ui/Card";
import { useDocumentTitle } from "./ui/documentTitle";
import { EmptyState } from "./ui/EmptyState";
import { Section } from "./ui/Section";
import { FlagMark, StatePill } from "./ui/StatePill";

export function ShoppingPage() {
  const { home = "" } = useParams();
  const shopping = useShopping(home);
  useDocumentTitle("Shopping");
  return (
    <>
      <h1>Shopping</h1>
      {shopping.isError ? (
        <p className={styles.error}>{shopping.error.message}</p>
      ) : shopping.isPending ? (
        <p>Loading…</p>
      ) : (
        <>
          <Section title="Shopping List" id="shopping-list">
            <Entries
              home={home}
              entries={shopping.data.shoppingList}
              none="Nothing to buy: no Locked Purchase is waiting to be Fulfilled."
            />
          </Section>
          <Section title="Considering" id="considering">
            <Entries
              home={home}
              entries={shopping.data.considering}
              none="Nothing under consideration."
            />
          </Section>
        </>
      )}
      <Card className={page.downloads}>
        <h2 className={page.downloadsTitle}>Take it with you</h2>
        <nav className={page.downloadLinks} aria-label="Downloads">
          <a href={shoppingListExportUrl(home, "html")} target="_blank" rel="noreferrer">
            Printable Shopping List
          </a>
          <a href={shoppingListExportUrl(home, "csv")} download>
            Shopping List as CSV
          </a>
          <a href={guidesExportUrl(home, "html")} target="_blank" rel="noreferrer">
            Printable Shopping Guides
          </a>
          <a href={guidesExportUrl(home, "markdown")} download>
            Shopping Guides as Markdown
          </a>
        </nav>
        <p className={page.downloadsNote}>
          A saved copy won't update when the Agent changes a Guide.
        </p>
      </Card>
    </>
  );
}

function Entries({
  home,
  entries,
  none,
}: {
  home: string;
  entries: ShoppingEntry[];
  none: string;
}) {
  if (entries.length === 0) return <EmptyState text={none} />;
  return (
    <ul className={page.entries}>
      {entries.map((entry) => (
        <li key={entry.slug} className={page.entry}>
          <Entry home={home} entry={entry} />
        </li>
      ))}
    </ul>
  );
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * "3 Listings, best is 4 stars": the line that says a Purchase is nearly decided. The best Rating
 * counts only Listings that fail no must and are not Held, so when none of them qualifies this
 * says the count alone rather than headline a Rating the user cannot act on.
 */
function listingsLine(entry: ShoppingEntry): string {
  if (entry.listings === 0) return "No Listings yet";
  const listings = counted(entry.listings, "Listing");
  return entry.bestRating === undefined
    ? listings
    : `${listings}, best is ${counted(entry.bestRating, "star")}`;
}

const MEASURE_FIRST = /^Measure first:\s*/i;

/**
 * A checklist row: a quiet box, its title (linking to its Decision page) with its state when not
 * Locked and what it has so far, its Room, what to measure first (the phrase for one, a count
 * with the list for more), any flag, its Listings, and a link to its Quick Guide.
 */
function Entry({ home, entry }: { home: string; entry: ShoppingEntry }) {
  const { must, prefer } = entry.requirements;
  const measure = entry.measureFirst.map((line) => line.replace(MEASURE_FIRST, ""));
  return (
    <>
      <span className={page.box} aria-hidden />
      <div className={page.what}>
        <p className={page.title}>
          <Link to={decisionPath(home, entry.slug)}>{entry.title}</Link>
          {entry.state !== "locked" && <StatePill state={entry.state} />}
        </p>
        <p className={page.statement}>{entry.statement}</p>
        <p className={page.so}>
          {must + prefer === 0
            ? "No Requirements yet"
            : `${counted(must, "must")}, ${counted(prefer, "prefer")}`}
          ; {entry.hasGuides ? "Guides written" : "no Guides yet"}
          {entry.fullGuideOutOfDate && (
            <>
              , <strong className={styles.warning}>Full Guide out of date</strong>
            </>
          )}
        </p>
      </div>
      <span className={page.room}>
        {entry.room ? (
          <Link to={`/homes/${home}/rooms/${entry.room.slug}`}>{entry.room.name}</Link>
        ) : (
          "Home-wide"
        )}
      </span>
      <span className={page.measure}>
        {measure.length === 1 ? (
          <span className={page.measureLabel}>
            Measure first: <strong>{measure[0]}</strong>
          </span>
        ) : measure.length > 1 ? (
          <details>
            <summary className={page.measureLabel}>
              Measure first: <strong>{measure.length} things</strong>
            </summary>
            <ul>
              {measure.map((line) => (
                <li key={line}>
                  <strong>{line}</strong>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </span>
      <span className={page.flag}>
        {entry.openFlags > 0 && (
          <FlagMark>{entry.openFlags === 1 ? "Flagged" : `${entry.openFlags} flags`}</FlagMark>
        )}
      </span>
      <span className={page.listings}>{listingsLine(entry)}</span>
      <span className={page.guide}>
        {entry.hasGuides && (
          <Link to={`${decisionPath(home, entry.slug)}#quick-guide`}>Quick Guide</Link>
        )}
      </span>
    </>
  );
}
