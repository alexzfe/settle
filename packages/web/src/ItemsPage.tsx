import { useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import type { Item, Room } from "./api";
import { sentence, wallNameOf } from "./format";
import { useHome, useItems } from "./queries";
import { Swatch } from "./Swatch";
import { ArchivedNote, dimensions, lightText, Parts } from "./Values";

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
  const items = useItems(home, archived);
  const rooms = useHome(home);
  const error = items.error ?? rooms.error;
  return (
    <>
      <h1>Items</h1>
      <label>
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />{" "}
        Include Archived
      </label>
      {error ? (
        <p className={styles.error}>{error.message}</p>
      ) : !items.data || !rooms.data ? (
        <p>Loading…</p>
      ) : (
        <ItemGroups
          home={home}
          groups={groupItems(
            items.data.items.filter((item) => archived || !item.archivedAt),
            rooms.data.rooms,
          )}
        />
      )}
    </>
  );
}

function ItemGroups({ home, groups }: { home: string; groups: ItemGroup[] }) {
  if (groups.length === 0) {
    return <p>No Items yet. Tell the Agent what you own, Room by Room.</p>;
  }
  return groups.map((group) => (
    <section key={group.key}>
      <h2>
        {group.room ? (
          <Link to={`/homes/${home}/rooms/${group.room}`}>{group.title}</Link>
        ) : (
          group.title
        )}
      </h2>
      <ItemList items={group.items} />
    </section>
  ));
}

export function ItemList({ items }: { items: Item[] }) {
  return (
    <ul>
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
        {item.quantity > 1 && ` ×${item.quantity}`} ({sentence(item.category)})
      </span>
      {place}
      {dimensions([
        ["W", item.width],
        ["D", item.depth],
        ["H", item.height],
      ])}
      {item.colors?.map((color) => (
        <Swatch key={color.name} color={color} />
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
