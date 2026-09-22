// The Shopping section: the Shopping List (Settled Purchases not yet Fulfilled) and Considering
// (Candidate and Leaning ones), each row its Purchase's state, title, Room, Requirement counts, what
// to measure first, any Flag, and its Listings with the best Rating among the ones it could
// actually buy and that Listing's picture. The whole row leads to the Purchase, whose page puts the
// Quick Guide first once it is Settled. Below them, the exports the server renders from stored data.

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { guidesExportUrl, listingPhotoUrl, type ShoppingEntry, shoppingListExportUrl } from "./api";
import { decisionPath } from "./decisions";
import { isSafeLink } from "./Markdown";
import { useShopping } from "./queries";
import page from "./ShoppingPage.module.css";
import { useDocumentTitle } from "./ui/documentTitle";
import { EmptyState } from "./ui/EmptyState";
import { Section } from "./ui/Section";
import { StateMark } from "./ui/StateMark";

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
              none="Nothing to buy: no Settled Purchase is waiting to be Fulfilled."
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
      <Section title="Take it with you" id="downloads">
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
      </Section>
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
 * "3 Listings, best is 4 stars: Hay Plain rug": the line that says a Purchase is nearly decided.
 * The best Rating counts only Listings that fail no must and are not Held, so when none of them
 * qualifies this says the count alone rather than headline a Rating the user cannot act on.
 */
function listingsLine(entry: ShoppingEntry): string {
  if (entry.listings === 0) return "No Listings yet";
  const listings = counted(entry.listings, "Listing");
  if (entry.bestRating === undefined) return listings;
  const best = `${listings}, best is ${counted(entry.bestRating, "star")}`;
  return entry.bestListing ? `${best}: ${entry.bestListing.name}` : best;
}

/**
 * The best Listing's picture as a thumbnail, part of the row that leads to the Purchase: the stored
 * copy when there is one, else the link it came from, else nothing at all. A must-failer or a Held
 * Listing never gets here, since core only names one the user could buy today.
 */
function BestPicture({ home, entry }: { home: string; entry: ShoppingEntry }) {
  const best = entry.bestListing;
  const [broken, setBroken] = useState(false);
  const hotlink = best?.photoUrl && isSafeLink(best.photoUrl) ? best.photoUrl : undefined;
  const src =
    best?.photoVersion === undefined
      ? hotlink
      : listingPhotoUrl(home, best.slug, best.photoVersion);
  // A new address is a new picture, and deserves its own try even if the last one would not load.
  useEffect(() => setBroken(false), [src]);
  if (best === undefined || src === undefined || broken) return null;
  return (
    <span className={page.thumb}>
      <img src={src} alt={best.name} loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}

const MEASURE_FIRST = /^Measure first:\s*/i;

/**
 * A row: its state, its title (the one link, though the whole row is its target), what it is,
 * its Room, what it has so far, any Flag, what to measure first, and its best Listing's picture.
 */
function Entry({ home, entry }: { home: string; entry: ShoppingEntry }) {
  const { must, prefer } = entry.requirements;
  const measure = entry.measureFirst.map((line) => line.replace(MEASURE_FIRST, ""));
  return (
    <>
      <StateMark state={entry.state} className={page.mark} />
      <div className={page.head}>
        <p className={page.title}>
          <Link to={decisionPath(home, entry.slug)} className={`clamp ${page.link}`}>
            {entry.title}
          </Link>
        </p>
        <p className={`clamp ${page.statement}`}>{entry.statement}</p>
      </div>
      <span className={`clamp ${page.room}`}>{entry.room?.name ?? "Whole home"}</span>
      <div className={page.body}>
        <p className={page.so}>
          {must + prefer === 0
            ? "No Requirements yet"
            : `${counted(must, "must")}, ${counted(prefer, "prefer")}`}
          {" · "}
          {entry.hasGuides ? "Guides written" : "No Guides yet"}
          {entry.fullGuideOutOfDate && (
            <>
              {" · "}
              <strong className={styles.warning}>Full Guide out of date</strong>
            </>
          )}
          {" · "}
          {listingsLine(entry)}
        </p>
        {entry.openFlags > 0 && (
          <p className={page.flagged}>
            {entry.openFlags === 1 ? "Flagged" : `${entry.openFlags} Flags`}
          </p>
        )}
        {measure.length > 0 && (
          <div className={page.measure}>
            <p className="label">Measure first</p>
            <ul>
              {measure.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <BestPicture home={home} entry={entry} />
    </>
  );
}
