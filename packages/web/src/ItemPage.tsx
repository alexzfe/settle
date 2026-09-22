// One Item's page: its register (what it is, where it sits, when and where it was bought, how long
// the warranty runs), the Decisions tied to it, and the history of its record. Whatever is not
// recorded is left out entirely, not shown blank; the pencil opens a form with every field.

import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { type ChangeEntry, type Item, type ItemPage as ItemRecord, listingPhotoUrl } from "./api";
import { changeText, sessionName } from "./ChangeLogPage";
import page from "./DecisionPage.module.css";
import { decisionPath, itemPath } from "./decisions";
import {
  centimetres,
  isProvenance,
  type Measure,
  PROVENANCE_LABEL,
  sentence,
  wallNameOf,
  words,
} from "./format";
import { ItemEdit } from "./ItemEdit";
import sheet from "./ItemPage.module.css";
import { formatPartialDate, longDate, warrantyCountdown } from "./itemDates";
import { isSafeLink } from "./Markdown";
import { useItem } from "./queries";
import { Swatch } from "./Swatch";
import { shortDate } from "./ui/AgentWritten";
import { Callout } from "./ui/Callout";
import { Card } from "./ui/Card";
import { useDocumentTitle } from "./ui/documentTitle";
import { Section } from "./ui/Section";
import { FulfilledNote, StatePill } from "./ui/StatePill";
import { dimensions, Fact, ListedTag, lightText, Parts } from "./Values";

export function ItemPage() {
  const { home = "", item: slug = "" } = useParams();
  const read = useItem(home, slug);
  useDocumentTitle(read.data?.item.name);
  if (read.isPending) return <p>Loading…</p>;
  if (read.isError) return <p className={styles.error}>{read.error.message}</p>;
  return <ItemSheet home={home} record={read.data} />;
}

function ItemSheet({ home, record }: { home: string; record: ItemRecord }) {
  const { item, replaces = [], replacedBy, picture, decisions, history } = record;
  const [editing, setEditing] = useState(false);
  return (
    <article>
      <header className={`${page.header} ${sheet.header}`}>
        <div className={sheet.heading}>
          <p className={page.eyebrow}>
            {item.room ? (
              <Link to={`/homes/${home}/rooms/${item.room.slug}`}>{item.room.name}</Link>
            ) : (
              "Unplaced"
            )}{" "}
            › <Link to={`/homes/${home}/items`}>Items</Link>
          </p>
          <h1 className={page.title}>{item.name}</h1>
          <p className={sheet.kind}>
            <Parts separator=" · ">
              {sentence(item.category)}
              {item.quantity > 1 && `×${item.quantity}`}
              {item.condition && sentence(item.condition)}
            </Parts>
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            className={`secondary ${sheet.pencil}`}
            aria-label="Edit its facts"
            title="Edit its facts"
            onClick={() => setEditing(true)}
          >
            <span aria-hidden>✎</span>
          </button>
        )}
      </header>

      {item.archivedAt && (
        <Callout
          tone="important"
          title={
            <>
              Archived {longDate(item.archivedAt)}
              {replacedBy && (
                <>
                  {" "}
                  — replaced by <Link to={itemPath(home, replacedBy.slug)}>{replacedBy.name}</Link>
                </>
              )}
            </>
          }
        >
          {item.archivedReason && <p>{item.archivedReason}</p>}
        </Callout>
      )}
      {replaces.length > 0 && (
        <p className={sheet.replaces}>
          Replaces{" "}
          <Parts>
            {replaces.map((old) => (
              <Link key={old.slug} to={itemPath(home, old.slug)}>
                {old.name}
              </Link>
            ))}
          </Parts>
        </p>
      )}

      <div className={picture ? `${sheet.register} ${sheet.withPicture}` : sheet.register}>
        {picture && (
          <figure className={sheet.picture}>
            <img
              src={listingPhotoUrl(home, picture.listing, picture.photoVersion)}
              alt={item.name}
            />
            <figcaption>from the Listing</figcaption>
          </figure>
        )}
        {editing ? (
          <ItemEdit home={home} item={item} onDone={() => setEditing(false)} />
        ) : (
          <Card className={sheet.card}>
            <Register home={home} item={item} />
          </Card>
        )}
      </div>

      {decisions.length > 0 && (
        <Section title="Decisions">
          <ul className={sheet.relations}>
            {decisions.map((decision) => (
              <li key={`${decision.relation}:${decision.slug}`}>
                <RelationLine home={home} decision={decision} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {history.length > 0 && (
        <Section title="History">
          <ul className={sheet.history}>
            {history.map((entry) => (
              <li key={`${entry.at}:${entry.origin}`}>
                <HistoryLine home={home} item={item.slug} entry={entry} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </article>
  );
}

// ─── The register ─────────────────────────────────────────────────────────────────────────────

type Listed = NonNullable<Item["listed"]>[number];

/** A web address by its host: "https://www.drimer.pe/colchon" is "drimer.pe". */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A link out, by its host; plain text when it is not a web address. */
function WebAddress({ url }: { url: string }) {
  if (!isSafeLink(url)) return <>{url}</>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {hostOf(url)}
    </a>
  );
}

/** The facts recorded about an Item, each left out when it is not recorded. */
function Register({ home, item }: { home: string; item: Item }) {
  const listed = (field: Listed) =>
    item.listed?.includes(field) ? (
      <>
        {" "}
        <ListedTag />
      </>
    ) : null;
  const where = (item.room || item.wall || item.positionNote) && (
    <Parts separator=" · ">
      {item.room && <Link to={`/homes/${home}/rooms/${item.room.slug}`}>{item.room.name}</Link>}
      {item.wall && wallNameOf(item.wall)}
      {item.positionNote}
    </Parts>
  );
  const looks = (item.colors?.length || item.materials?.length) && (
    <span className={sheet.looks}>
      {item.colors?.map((color, index) => (
        // Two colors may share a name, so the position keeps keys apart.
        <Swatch key={`${index}-${color.name}`} color={color} />
      ))}
      {item.materials && item.materials.length > 0 && <span>{item.materials.join(", ")}</span>}
    </span>
  );
  const make = [item.brand, item.model].filter(Boolean).join(" · ");
  const makeTerm = item.brand && item.model ? "Brand · Model" : item.brand ? "Brand" : "Model";
  const when = item.boughtOn && formatPartialDate(item.boughtOn);
  const from = item.boughtFrom && (
    <>
      {when ? "from" : "From"} {item.boughtFrom}
      {listed("boughtFrom")}
    </>
  );
  const bought = (when || from || item.pricePaid) && (
    <Parts separator=" · ">
      {(when || from) && (
        <span>
          {when}
          {when && from && " "}
          {from}
        </span>
      )}
      {item.pricePaid && (
        <span>
          {item.pricePaid}
          {listed("pricePaid")}
        </span>
      )}
    </Parts>
  );
  const countdown = item.warrantyUntil && warrantyCountdown(item.warrantyUntil);
  const light = item.light && lightText(item.light);
  return (
    <dl className={`${styles.facts} ${sheet.facts}`}>
      <Fact term="Where">{where}</Fact>
      <Fact term="Size">
        {dimensions(
          [
            ["W", item.width],
            ["D", item.depth],
            ["H", item.height],
          ],
          "cm",
        )}
      </Fact>
      <Fact term="Colors & materials">{looks || undefined}</Fact>
      <Fact term={makeTerm}>{make}</Fact>
      <Fact term="Bought">{bought}</Fact>
      <Fact term="Warranty">
        {item.warrantyUntil && (
          <>
            until {formatPartialDate(item.warrantyUntil)}
            {countdown && <span className={styles.muted}> ({countdown})</span>}
          </>
        )}
      </Fact>
      <Fact term="Serial">{item.serialNumber}</Fact>
      <Fact term="Manual">{item.manualLink && <WebAddress url={item.manualLink} />}</Fact>
      <Fact term="Link">
        {item.link && (
          <>
            <WebAddress url={item.link} />
            {listed("link")}
          </>
        )}
      </Fact>
      <Fact term="Light">{light}</Fact>
    </dl>
  );
}

// ─── Decisions ────────────────────────────────────────────────────────────────────────────────

type Relation = ItemRecord["decisions"][number];

const RELATION_LABEL: Record<Relation["relation"], string> = {
  "relies-on": "relies on it",
  "bought-by": "bought by",
  "replaced-by": "replaced by",
};

/** "relies on it  Main bedroom bed frame ● Settled", with the Requirements citing the Item. */
function RelationLine({ home, decision }: { home: string; decision: Relation }) {
  return (
    <>
      <span className={sheet.relation}>{RELATION_LABEL[decision.relation]}</span>
      <span className={sheet.relationBody}>
        <span className={sheet.relationHead}>
          <Link to={decisionPath(home, decision.slug)}>{decision.title}</Link>{" "}
          <StatePill state={decision.state} />
          {decision.fulfilled && <FulfilledNote />}
          {decision.archived && <span className={styles.muted}>Archived</span>}
        </span>
        {decision.requirements && decision.requirements.length > 0 && (
          <ul className={sheet.requirements}>
            {decision.requirements.map((requirement) => (
              <li key={requirement.position}>
                <q>{requirement.text}</q>{" "}
                <span className={styles.muted}>({requirement.strength})</span>
              </li>
            ))}
          </ul>
        )}
      </span>
    </>
  );
}

// ─── History ──────────────────────────────────────────────────────────────────────────────────

type HistoryEntry = ItemRecord["history"][number];
type Change = HistoryEntry["changes"][number];

/** How a field is named in a history line; the three sizes read as one "size". */
const FIELD_LABEL: Record<string, string> = {
  width: "size",
  depth: "size",
  height: "size",
  colors: "colors",
  positionNote: "position",
  boughtOn: "bought on",
  boughtFrom: "bought from",
  pricePaid: "price paid",
  warrantyUntil: "warranty",
  serialNumber: "serial",
  manualLink: "manual",
};

const SIZES = new Set(["width", "depth", "height"]);

function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? words(field);
}

const empty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

/**
 * One change event in a few words: "added"; "archived: worn out"; "renamed; size, materials,
 * model, link set"; "size changed"; "serial cleared".
 */
export function historySummary(changes: readonly Change[]): string {
  if (changes.some((change) => change.field === undefined)) return "added";
  const archived = changes.find((change) => change.field === "archivedAt");
  if (archived) {
    const given = changes.find((change) => change.field === "archivedReason")?.new;
    const reason = archived.reason ?? (typeof given === "string" ? given : undefined);
    return archived.new ? `archived${reason ? `: ${reason}` : ""}` : "brought back";
  }
  const parts: string[] = [];
  if (changes.some((change) => change.field === "name")) parts.push("renamed");
  // How each field changed: "set", "changed", "cleared", or for a length whose number stayed,
  // "now Measured"; in order of first mention.
  const by = new Map<string, string[]>();
  for (const { field, old, new: next } of changes) {
    if (field === undefined || field === "name" || field === "archivedReason") continue;
    const how =
      isMeasure(old) && isMeasure(next) && old.mm === next.mm
        ? `now ${PROVENANCE_LABEL[next.provenance]}`
        : empty(old)
          ? "set"
          : empty(next)
            ? "cleared"
            : "changed";
    const labels = by.get(how) ?? [];
    const label = fieldLabel(field);
    if (!labels.includes(label)) labels.push(label);
    by.set(how, labels);
  }
  for (const [how, labels] of by) parts.push(`${labels.join(", ")} ${how}`);
  return parts.join("; ") || "changed";
}

function isMeasure(value: unknown): value is Measure {
  if (typeof value !== "object" || value === null) return false;
  const { mm, provenance } = value as Record<string, unknown>;
  return typeof mm === "number" && isProvenance(provenance);
}

/** One change exactly: "width ~153 cm (Estimated) → 153 cm (Measured)", or as the log reads it. */
function exactChange(item: string, entry: HistoryEntry, change: Change): ReactNode {
  const { field, old, new: next } = change;
  if (field && SIZES.has(field) && (isMeasure(old) || isMeasure(next))) {
    const text = (value: unknown) =>
      isMeasure(value)
        ? `${centimetres(value.mm)} (${PROVENANCE_LABEL[value.provenance]})`
        : "none";
    return `${words(field)} ${text(old)} → ${text(next)}`;
  }
  const logged: ChangeEntry = {
    at: entry.at,
    origin: entry.origin,
    recordKind: "item",
    record: item,
    ...change,
  };
  return changeText(logged);
}

/** "18 Sep · Purchase Session: renamed; size set ▸", expanding to each change's old → new. */
function HistoryLine({ home, item, entry }: { home: string; item: string; entry: HistoryEntry }) {
  const [open, setOpen] = useState(false);
  const who =
    entry.origin === "web" ? (
      "Edited here"
    ) : (
      <Link to={`/homes/${home}/sessions/${entry.origin}`}>
        {sessionName({ skills: entry.skills ?? [] })}
      </Link>
    );
  const summary = historySummary(entry.changes);
  // A creation or archiving says all there is to say; anything else opens to the exact values.
  const detailed = summary !== "added";
  return (
    <>
      <p className={sheet.historyLine}>
        <span className={sheet.historyDate}>{shortDate(entry.at)}</span>
        <span>
          {who}: {summary}
        </span>
        {detailed && (
          <button
            type="button"
            className={`secondary ${sheet.expand}`}
            aria-expanded={open}
            aria-label={open ? "Hide the exact changes" : "Show the exact changes"}
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden>{open ? "▾" : "▸"}</span>
          </button>
        )}
      </p>
      {open && (
        <ul className={sheet.exact}>
          {entry.changes.map((change, index) => (
            // Changes have no id and hold no state, so their position is key enough.
            <li key={index}>
              {exactChange(item, entry, change)}
              {change.reason && <span className={styles.muted}> · {change.reason}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
