import { Fragment, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import type { Item, Room } from "./api";
import { sentence, wallNameOf } from "./format";
import page from "./ItemsPage.module.css";
import { useHome, useItems } from "./queries";
import { Swatch } from "./Swatch";
import { buildPrompt } from "./ui/AskAgent";
import { EmptyState } from "./ui/EmptyState";
import { ArchivedNote, dimensions, Fact, lightText, Parts } from "./Values";

export interface ItemGroup {
  /** Unique among the groups. */
  key: string;
  title: string;
  /** The Room's slug; absent for the Unplaced group. */
  room?: string;
  items: Item[];
}

/**
 * The Items by Room, in the Home's Room order, then any Room the Home no longer lists (an Archived
 * one), then the Unplaced ones. Rooms without Items are left out; each group is sorted by name.
 */
export function groupItems(items: readonly Item[], rooms: readonly Room[]): ItemGroup[] {
  const byRoom = new Map<string, ItemGroup>();
  const unplaced: Item[] = [];
  for (const item of items) {
    if (!item.room) {
      unplaced.push(item);
      continue;
    }
    const { slug, name } = item.room;
    const group = byRoom.get(slug) ?? { key: `room:${slug}`, title: name, room: slug, items: [] };
    group.items.push(item);
    byRoom.set(slug, group);
  }
  const listed = rooms.flatMap((room) => byRoom.get(room.slug) ?? []);
  const unlisted = [...byRoom.values()].filter((group) => !listed.includes(group));
  const groups = [...listed, ...unlisted];
  if (unplaced.length > 0) groups.push({ key: "unplaced", title: "Unplaced", items: unplaced });
  return groups.map((group) => ({
    ...group,
    items: group.items.toSorted((a, b) => a.name.localeCompare(b.name)),
  }));
}

export function ItemsPage() {
  const { home = "" } = useParams();
  const [archived, setArchived] = useState(false);
  const [unplacedOnly, setUnplacedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const items = useItems(home, archived);
  const homeRead = useHome(home);
  const error = items.error ?? homeRead.error;
  const query = search.trim().toLowerCase();
  return (
    <>
      <h1>Items</h1>
      <div className={page.filters}>
        <label className={page.search}>
          <span className={page.visuallyHidden}>Search by name</span>
          <input
            type="search"
            placeholder="Search by name"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={unplacedOnly}
            onChange={(event) => setUnplacedOnly(event.target.checked)}
          />{" "}
          Unplaced only
        </label>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />{" "}
          Include Archived
        </label>
      </div>
      {error ? (
        <p className={styles.error}>{error.message}</p>
      ) : !items.data || !homeRead.data ? (
        <p>Loading…</p>
      ) : items.data.items.length === 0 ? (
        <EmptyState
          text="No Items yet. Tell the Agent what you own, Room by Room."
          prompt={buildPrompt({
            skill: "Home Intake",
            text: "Let's record what I own, Room by Room",
          })}
        />
      ) : (
        <ItemTable
          home={home}
          items={groupItems(
            items.data.items.filter(
              (item) =>
                (archived || !item.archivedAt) &&
                (!unplacedOnly || !item.room) &&
                (!query || item.name.toLowerCase().includes(query)),
            ),
            homeRead.data.rooms,
          ).flatMap((group) => group.items)}
        />
      )}
    </>
  );
}

function ItemTable({ home, items }: { home: string; items: Item[] }) {
  const [open, setOpen] = useState<string>();
  if (items.length === 0) return <p className={styles.muted}>No Items match.</p>;
  return (
    <div className={styles.scroll}>
      <table className={`${styles.table} ${page.table}`}>
        <thead>
          <tr>
            <th>Item</th>
            <th>Room</th>
            <th>Dimensions W×D×H</th>
            <th>Color and material</th>
            <th>Condition</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const expanded = open === item.slug;
            return (
              <Fragment key={item.slug}>
                <tr className={item.archivedAt ? page.archived : undefined}>
                  <td>
                    <button
                      type="button"
                      className={page.expand}
                      aria-expanded={expanded}
                      onClick={() => setOpen(expanded ? undefined : item.slug)}
                    >
                      <span className={page.caret} aria-hidden>
                        {expanded ? "▾" : "▸"}
                      </span>
                      <span className={page.name}>{item.name}</span>
                      {item.quantity > 1 && <span className={page.quantity}>×{item.quantity}</span>}
                    </button>
                    <span className={page.category}>{sentence(item.category)}</span>
                  </td>
                  <td>
                    {item.room ? (
                      <Link to={`/homes/${home}/rooms/${item.room.slug}`}>{item.room.name}</Link>
                    ) : (
                      <span className={styles.muted}>Unplaced</span>
                    )}
                  </td>
                  <td className={page.numbers}>
                    {dimensions([
                      ["W", item.width],
                      ["D", item.depth],
                      ["H", item.height],
                    ])}
                  </td>
                  <td>
                    <Looks item={item} />
                  </td>
                  <td>{item.condition && sentence(item.condition)}</td>
                </tr>
                {expanded && (
                  <tr className={`${page.detailRow} ${item.archivedAt ? page.archived : ""}`}>
                    <td colSpan={5}>
                      <ItemDetails item={item} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** An Item's colors as swatches, then its materials. */
function Looks({ item }: { item: Item }) {
  return (
    <span className={page.looks}>
      {item.colors?.map((color, index) => (
        // Two colors may share a name, so the position keeps keys apart.
        <Swatch key={`${index}-${color.name}`} color={color} />
      ))}
      {item.materials && item.materials.length > 0 && (
        <span className={styles.muted}>{item.materials.join(", ")}</span>
      )}
    </span>
  );
}

/** What the table leaves out: place, brand, price, link, light, and when it was Archived. */
function ItemDetails({ item }: { item: Item }) {
  const place = [item.wall && wallNameOf(item.wall), item.positionNote].filter(Boolean).join(", ");
  const light = item.light && lightText(item.light);
  return (
    <dl className={`${styles.facts} ${page.details}`}>
      <Fact term="Where">{place}</Fact>
      <Fact term="Brand">{[item.brand, item.model].filter(Boolean).join(" ")}</Fact>
      <Fact term="Price">{item.price}</Fact>
      <Fact term="Link">{item.link && <a href={item.link}>product page</a>}</Fact>
      <Fact term="Light">{light}</Fact>
      <Fact term="Archived">
        {item.archivedAt && <ArchivedNote at={item.archivedAt} reason={item.archivedReason} />}
      </Fact>
    </dl>
  );
}

/** A Room's Items as a compact list: name and quantity, category, size, and colors. */
export function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className={page.list}>
      {items.map((item) => (
        <li key={item.slug}>
          <ItemLine item={item} />
        </li>
      ))}
    </ul>
  );
}

/** One Item with whatever is recorded about it. */
export function ItemLine({ item }: { item: Item }) {
  const place = [item.wall && wallNameOf(item.wall), item.positionNote].filter(Boolean).join(", ");
  const light = item.light && lightText(item.light);
  return (
    <Parts>
      <span>
        <strong>{item.name}</strong>
        {item.quantity > 1 && ` ×${item.quantity}`}{" "}
        <span className={styles.muted}>({sentence(item.category)})</span>
      </span>
      {place}
      {dimensions([
        ["W", item.width],
        ["D", item.depth],
        ["H", item.height],
      ])}
      {item.colors?.map((color, index) => (
        <Swatch key={`${index}-${color.name}`} color={color} />
      ))}
      {item.materials?.join(", ")}
      {item.condition}
      {[item.brand, item.model].filter(Boolean).join(" ")}
      {item.price}
      {item.link && <a href={item.link}>product page</a>}
      {light && `light: ${light}`}
      {item.archivedAt && <ArchivedNote at={item.archivedAt} reason={item.archivedReason} />}
    </Parts>
  );
}
