import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import styles from "./App.module.css";
import { type Item, photoUrl, type Room } from "./api";
import { itemPath } from "./decisions";
import { sentence, wallNameOf } from "./format";
import page from "./ItemsPage.module.css";
import { useHome, useItems } from "./queries";
import { Swatch } from "./Swatch";
import { buildPrompt } from "./ui/AskAgent";
import { EmptyState } from "./ui/EmptyState";
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

/** What a header stat shows: every Item, or those missing one kind of fact. */
export type ItemFilter = "no-dimensions" | "no-colors" | "unplaced";

const FILTERS: Record<ItemFilter, { label: string; test: (item: Item) => boolean }> = {
  "no-dimensions": {
    label: "No dimensions",
    test: (item) => !item.width && !item.depth && !item.height,
  },
  "no-colors": { label: "No colors", test: (item) => !item.colors?.length },
  unplaced: { label: "Unplaced", test: (item) => !item.room },
};

function isFilter(value: string | null): value is ItemFilter {
  return value !== null && Object.hasOwn(FILTERS, value);
}

/**
 * The header's counts, in plain words: every live Item, then those with no dimensions, no colors,
 * or no Room. A count of zero is left out, except the Items.
 */
export function itemStats(
  items: readonly Item[],
): { filter?: ItemFilter; label: string; count: number }[] {
  const live = items.filter((item) => !item.archivedAt);
  const missing = (Object.keys(FILTERS) as ItemFilter[]).map((filter) => ({
    filter,
    label: FILTERS[filter].label,
    count: live.filter(FILTERS[filter].test).length,
  }));
  return [
    { label: live.length === 1 ? "Item" : "Items", count: live.length },
    ...missing.filter((stat) => stat.count > 0),
  ];
}

export function ItemsPage() {
  const { home = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [archived, setArchived] = useState(false);
  const [search, setSearch] = useState("");
  const items = useItems(home, archived);
  const homeRead = useHome(home);
  const error = items.error ?? homeRead.error;
  const query = search.trim().toLowerCase();
  const shown = params.get("show");
  const filter = isFilter(shown) ? shown : undefined;
  const choose = (next: ItemFilter | undefined) =>
    setParams(next ? { show: next } : {}, { replace: true });
  return (
    <>
      <h1>Inventory</h1>
      {items.data && items.data.items.length > 0 && (
        <ul className={page.stats} aria-label="Show">
          {itemStats(items.data.items).map((stat) => {
            const pressed = stat.filter === filter;
            return (
              <li key={stat.label}>
                <button
                  type="button"
                  className={`${page.stat} ${stat.filter ? page.missing : ""}`}
                  aria-pressed={pressed}
                  onClick={() => choose(pressed ? undefined : stat.filter)}
                >
                  <span className={page.statCount}>{stat.count}</span> {stat.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
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
            checked={archived}
            onChange={(event) => setArchived(event.target.checked)}
          />{" "}
          Include Archived
        </label>
        {filter && (
          <button
            type="button"
            className={`secondary ${page.clear}`}
            onClick={() => choose(undefined)}
          >
            Showing {FILTERS[filter].label.toLowerCase()} · Show all
          </button>
        )}
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
        <Inventory
          home={home}
          groups={groupItems(
            items.data.items.filter(
              (item) =>
                (archived || !item.archivedAt) &&
                (!filter || FILTERS[filter].test(item)) &&
                (!query || item.name.toLowerCase().includes(query)),
            ),
            homeRead.data.rooms,
          )}
        />
      )}
    </>
  );
}

/** The Items grouped by Room, one row each; a row's name is its one link, and the whole row opens it. */
function Inventory({ home, groups }: { home: string; groups: ItemGroup[] }) {
  if (groups.length === 0) return <p className={styles.muted}>No Items match.</p>;
  return (
    <div className={page.inventory}>
      <div className={page.columns} aria-hidden>
        <span className="label">Item</span>
        <span className="label">Colors &amp; materials</span>
        <span className={`label ${page.size}`}>W × D × H</span>
      </div>
      {groups.map((group) => (
        <section key={group.key} className={page.group} aria-labelledby={`group-${group.key}`}>
          <h2 className={page.groupTitle} id={`group-${group.key}`}>
            {group.room ? (
              <Link to={`/homes/${home}/rooms/${group.room}`}>{group.title}</Link>
            ) : (
              group.title
            )}{" "}
            <span className={page.groupCount}>{group.items.length}</span>
            {!group.room && <span className={page.needsRoom}>needs a room</span>}
          </h2>
          <ul className={page.rows}>
            {group.items.map((item) => (
              <ItemRow key={item.slug} home={home} item={item} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * An Item's main Photo, small and square, when it has one; nothing at all when it has none. The
 * name sits beside it, so it says nothing more to a screen reader.
 */
function Thumb({ home, item, className }: { home: string; item: Item; className?: string }) {
  if (!item.photo) return null;
  return (
    <img
      className={className}
      src={photoUrl(home, item.slug, item.photo, "thumb")}
      alt=""
      loading="lazy"
    />
  );
}

/** One Item: its Photo, name, kind and condition; its colors and materials; its size in cm. */
function ItemRow({ home, item }: { home: string; item: Item }) {
  const navigate = useNavigate();
  const path = itemPath(home, item.slug);
  // The whole row opens the Item, except a click on its link (which opens it anyway) or one
  // that ends a text selection.
  const open = (event: React.MouseEvent) => {
    if ((event.target as Element).closest("a")) return;
    if (window.getSelection?.()?.toString()) return;
    navigate(path);
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the name's link is the keyboard's way in.
    <li className={item.archivedAt ? `${page.row} ${page.archived}` : page.row} onClick={open}>
      <span className={page.named}>
        <Thumb home={home} item={item} className={page.thumb} />
        <span className={page.what}>
          <Link className={`${page.name} clamp`} to={path}>
            {item.name}
          </Link>
          <span className={page.kind}>
            <Parts separator=" · ">
              {sentence(item.category)}
              {item.quantity > 1 && `×${item.quantity}`}
              {item.condition && sentence(item.condition)}
            </Parts>
            {item.archivedAt && (
              <>
                {" "}
                · <ArchivedNote at={item.archivedAt} />
              </>
            )}
          </span>
        </span>
      </span>
      <Looks item={item} />
      <span className={page.size}>
        {dimensions(
          [
            ["W", item.width],
            ["D", item.depth],
            ["H", item.height],
          ],
          "cm",
          { compact: true },
        )}
      </span>
    </li>
  );
}

/**
 * An Item's colors as swatches with their names, then its materials. A color with no screen color
 * recorded is an empty outline beside its name; an Item with no colors at all shows nothing, since
 * the header counts those.
 */
function Looks({ item }: { item: Item }) {
  const materials = item.materials?.join(", ");
  return (
    <span className={page.looks}>
      {item.colors && item.colors.length > 0 && (
        <span className={page.colors}>
          {item.colors.map((color, index) => (
            // Two colors may share a name, so the position keeps keys apart.
            <Swatch key={`${index}-${color.name}`} color={color} compact />
          ))}
        </span>
      )}
      {materials && <span className={`${page.materials} clamp`}>{materials}</span>}
    </span>
  );
}

/** A Room's Items as a compact list: name and quantity, category, size, and colors. */
export function ItemList({ home, items }: { home: string; items: Item[] }) {
  return (
    <ul className={page.list}>
      {items.map((item) => (
        <li key={item.slug}>
          <ItemLine home={home} item={item} />
        </li>
      ))}
    </ul>
  );
}

/**
 * One Item with whatever is recorded about it, its name linking to its page. Values take the list
 * form (only an Estimated one is marked, with "~"), and sizes are in cm, as everywhere for Items.
 */
export function ItemLine({ home, item }: { home: string; item: Item }) {
  const place = [item.wall && wallNameOf(item.wall), item.positionNote].filter(Boolean).join(", ");
  const light = item.light && lightText(item.light);
  return (
    <Parts>
      <span>
        <Thumb home={home} item={item} className={page.lineThumb} />
        <strong>
          <Link to={itemPath(home, item.slug)}>{item.name}</Link>
        </strong>
        {item.quantity > 1 && ` ×${item.quantity}`}{" "}
        <span className={styles.muted}>({sentence(item.category)})</span>
      </span>
      {place}
      {dimensions(
        [
          ["W", item.width],
          ["D", item.depth],
          ["H", item.height],
        ],
        "cm",
        { compact: true },
      )}
      {item.colors?.map((color, index) => (
        <Swatch key={`${index}-${color.name}`} color={color} compact />
      ))}
      {item.materials?.join(", ")}
      {item.condition}
      {[item.brand, item.model].filter(Boolean).join(" ")}
      {item.pricePaid}
      {item.link && <a href={item.link}>product page</a>}
      {light && `light: ${light}`}
      {item.archivedAt && <ArchivedNote at={item.archivedAt} reason={item.archivedReason} />}
    </Parts>
  );
}
