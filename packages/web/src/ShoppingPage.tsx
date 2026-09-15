// The Shopping section: the Shopping List (Locked Purchases not yet Fulfilled) and Considering
// (Candidate and Leaning ones), each entry with its Room, its Measure-first lines, and what it has
// so far, linking to its Decision page, where its Quick Guide and Full Guide are; and the exports
// the server renders from stored data.

import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { guidesExportUrl, type ShoppingEntry, shoppingListExportUrl } from "./api";
import { decisionPath, STATE_LABEL } from "./decisions";
import { useShopping } from "./queries";
import { Parts } from "./Values";

export function ShoppingPage() {
  const { home = "" } = useParams();
  const shopping = useShopping(home);
  return (
    <>
      <h1>Shopping</h1>
      <nav className={styles.nav} aria-label="Downloads">
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
      {shopping.isError ? (
        <p className={styles.error}>{shopping.error.message}</p>
      ) : shopping.isPending ? (
        <p>Loading…</p>
      ) : (
        <>
          <h2>Shopping List</h2>
          <Entries
            home={home}
            entries={shopping.data.shoppingList}
            none="Nothing to buy: no Locked Purchase is waiting to be Fulfilled."
          />
          <h2>Considering</h2>
          <Entries
            home={home}
            entries={shopping.data.considering}
            none="Nothing under consideration."
          />
        </>
      )}
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
  if (entries.length === 0) return <p>{none}</p>;
  return (
    <ul className={styles.entries}>
      {entries.map((entry) => (
        <li key={entry.slug}>
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
 * Its title (linking to its Decision page), Room, state when not Locked, and any flag; its
 * statement; what it has so far; then its Measure-first lines, to do before buying.
 */
function Entry({ home, entry }: { home: string; entry: ShoppingEntry }) {
  const { must, prefer } = entry.requirements;
  return (
    <>
      <p>
        <Parts>
          <Link to={decisionPath(home, entry.slug)}>{entry.title}</Link>
          {entry.room ? (
            <Link to={`/homes/${home}/rooms/${entry.room.slug}`}>{entry.room.name}</Link>
          ) : (
            "Home-wide"
          )}
          {entry.state !== "locked" && STATE_LABEL[entry.state]}
          {entry.openFlags > 0 && <span className={styles.tag}>Flagged</span>}
        </Parts>
      </p>
      <p>{entry.statement}</p>
      <p className={styles.muted}>
        {must + prefer === 0
          ? "No Requirements yet"
          : `${counted(must, "must")}, ${counted(prefer, "prefer")}`}
        ; {entry.hasGuides ? "Guides written" : "no Guides yet"}
        {entry.fullGuideOutOfDate && (
          <>
            , <strong className={styles.warning}>Full Guide out of date</strong>
          </>
        )}
        ; {entry.listings === 0 ? "no Listings yet" : counted(entry.listings, "Listing")}
      </p>
      {entry.measureFirst.length > 0 && (
        <ul>
          {entry.measureFirst.map((line) => (
            <li key={line}>
              <strong>{line}</strong>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
