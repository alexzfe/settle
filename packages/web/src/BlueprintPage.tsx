import type { RoomDetail } from "@settle/core";
import { useQueries } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { blueprintPageUrl, call } from "./api";
import page from "./BlueprintPage.module.css";
import { pageCount, pagePath } from "./Blueprints";
import { levelTitle, type Measure, metres, sentence, wallName, wallNameOf, words } from "./format";
import { queryKeys, useBlueprints, useHome } from "./queries";
import { useDocumentTitle } from "./ui/documentTitle";
import { Fact } from "./Values";

/** The zoom levels the + and − buttons step through, as a share of the page's natural size. */
export const ZOOMS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3] as const;

/** A value recorded from a Blueprint page: what it measures, the text as printed, and the value. */
export interface PrintedValue {
  key: string;
  room: { slug: string; name: string };
  label: string;
  printed: string;
  value: Measure;
}

/**
 * The values of a Room recorded from one page of a Blueprint, in Room Sheet order: ceiling
 * height, Walls, Windows, Doors, Features, then Items.
 */
export function printedValues(room: RoomDetail, blueprint: string, onPage: number): PrintedValue[] {
  const found: PrintedValue[] = [];
  const look = (record: string, name: string, fields: Record<string, unknown>) => {
    for (const [field, value] of Object.entries(fields)) {
      if (!isMeasure(value)) continue;
      const { source } = value;
      if (!source || source.blueprint !== blueprint || source.page !== onPage) continue;
      found.push({
        key: `${record}:${field}`,
        room: { slug: room.slug, name: room.name },
        label: `${name} ${FIELD[field] ?? words(field)}`.trim(),
        printed: source.printed,
        value,
      });
    }
  };
  look(room.slug, "", { ceilingHeight: room.ceilingHeight });
  for (const wall of room.walls.toSorted((a, b) => a.position - b.position)) {
    look(wall.slug, wallName(wall.position), wall);
  }
  for (const window of room.windows) {
    const where = window.wall === "roof" ? "in the roof" : `in ${wallNameOf(window.wall)}`;
    look(window.slug, `Window ${where}`, window);
  }
  for (const door of room.doors) {
    // A Door's offset is along side A's Wall, so it is only shown from that Room.
    const { offset, ...fields } = door;
    look(door.slug, `Door${door.wall ? ` in ${wallNameOf(door.wall)}` : ""}`, {
      ...fields,
      ...(door.sideA && { offset }),
    });
  }
  for (const feature of room.features) {
    look(feature.slug, feature.description ?? sentence(feature.kind), feature);
  }
  for (const item of room.items) look(item.slug, item.name, item);
  return found;
}

const FIELD: Record<string, string> = {
  ceilingHeight: "Ceiling height",
  sillHeight: "sill",
  clearWidth: "clear width",
  offset: "from the Wall's start",
};

function isMeasure(value: unknown): value is Measure {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).mm === "number" &&
    typeof (value as Record<string, unknown>).provenance === "string"
  );
}

/** One page of a Blueprint, fitted to the width or zoomed, beside the values recorded from it. */
export function BlueprintPage() {
  const { home = "", blueprint: slug = "", page: number = "" } = useParams();
  const blueprints = useBlueprints(home);
  const blueprint = blueprints.data?.blueprints.find((each) => each.slug === slug);
  useDocumentTitle(blueprint && `${blueprint.label}, page ${number}`);
  if (blueprints.isPending) return <p>Loading…</p>;
  if (blueprints.isError) return <p className={styles.error}>{blueprints.error.message}</p>;
  if (!blueprint) return <p className={styles.error}>This Home has no Blueprint "{slug}".</p>;
  const shown = blueprint.pages.find((each) => String(each.page) === number);
  if (!shown) {
    return (
      <p className={styles.error}>
        {blueprint.label} has no page {number}: it has {pageCount(blueprint.pageCount)}.
      </p>
    );
  }
  const previous = blueprint.pages.find((each) => each.page === shown.page - 1);
  const next = blueprint.pages.find((each) => each.page === shown.page + 1);
  return (
    <>
      <h1>
        {blueprint.label}, page {shown.page} of {blueprint.pageCount}
      </h1>
      <dl className={styles.facts}>
        <Fact term="Level">{shown.level && levelTitle(shown.level)}</Fact>
        <Fact term="Size">
          {shown.width} × {shown.height} px
        </Fact>
        <Fact term="Text layer">
          {shown.hasText ? "Yes" : "None, so it is read from the image"}
        </Fact>
      </dl>
      <nav className={styles.nav} aria-label="Pages">
        {previous && (
          <Link to={pagePath(home, blueprint.slug, previous.page)}>
            Previous page ({previous.page})
          </Link>
        )}
        {next && (
          <Link to={pagePath(home, blueprint.slug, next.page)}>Next page ({next.page})</Link>
        )}
      </nav>
      <div className={page.layout}>
        <Viewer
          // Keyed by page, so each page opens fitted to the width.
          key={`${blueprint.slug}/${shown.page}`}
          src={blueprintPageUrl(home, blueprint.slug, shown.page)}
          width={shown.width}
          height={shown.height}
          alt={`Page ${shown.page} of ${blueprint.label}`}
        />
        <PrintedList home={home} blueprint={blueprint.slug} onPage={shown.page} />
      </div>
    </>
  );
}

function Viewer({
  src,
  width,
  height,
  alt,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
}) {
  // "fit" fills the viewer's width; a number is a share of the page's natural size.
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const frame = useRef<HTMLDivElement>(null);
  const current = () => (zoom === "fit" ? (frame.current?.clientWidth ?? width) / width : zoom);
  const step = (direction: 1 | -1) => {
    const at = current();
    const nextZoom =
      direction === 1
        ? ZOOMS.find((each) => each > at + 0.001)
        : ZOOMS.toReversed().find((each) => each < at - 0.001);
    if (nextZoom !== undefined) setZoom(nextZoom);
  };
  return (
    <div className={page.viewerColumn}>
      <div className={page.toolbar} role="toolbar" aria-label="Zoom">
        <button
          type="button"
          className="secondary"
          aria-pressed={zoom === "fit"}
          onClick={() => setZoom("fit")}
        >
          Fit to width
        </button>
        <button
          type="button"
          className="secondary"
          aria-pressed={zoom === 1}
          onClick={() => setZoom(1)}
        >
          Actual size
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom out"
          disabled={zoom !== "fit" && zoom <= ZOOMS[0]}
          onClick={() => step(-1)}
        >
          −
        </button>
        <button
          type="button"
          className="secondary"
          aria-label="Zoom in"
          disabled={zoom !== "fit" && zoom >= (ZOOMS.at(-1) ?? 1)}
          onClick={() => step(1)}
        >
          +
        </button>
        <span className={page.zoomLevel} aria-live="polite">
          {zoom === "fit" ? "Fitted" : `${Math.round(zoom * 100)}%`}
        </span>
      </div>
      <div ref={frame} className={`${styles.viewer} ${page.frame}`}>
        <img
          src={src}
          width={width}
          height={height}
          alt={alt}
          className={zoom === "fit" ? page.fit : page.zoomed}
          style={zoom === "fit" ? undefined : { width: width * zoom, height: height * zoom }}
        />
      </div>
    </div>
  );
}

/** The values recorded from this page, read from every Room of the Home. */
function PrintedList({
  home,
  blueprint,
  onPage,
}: {
  home: string;
  blueprint: string;
  onPage: number;
}) {
  const rooms = useHome(home).data?.rooms ?? [];
  const sheets = useQueries({
    queries: rooms.map((room) => ({
      queryKey: queryKeys.room(home, room.slug),
      queryFn: () => call("get_room", { home, room: room.slug }),
    })),
  });
  const values = sheets.flatMap((sheet) =>
    sheet.data ? printedValues(sheet.data.room, blueprint, onPage) : [],
  );
  const loading = sheets.some((sheet) => sheet.isPending);
  return (
    <aside className={page.printed} aria-labelledby="printed-title">
      <h2 id="printed-title" className={page.printedTitle}>
        Recorded from this page
      </h2>
      {values.length === 0 ? (
        <p className={styles.muted}>
          {loading ? "Loading…" : "No recorded measurement names this page yet."}
        </p>
      ) : (
        <ul className={page.printedList}>
          {values.map((value) => (
            <li key={value.key}>
              <Link to={`/homes/${home}/rooms/${value.room.slug}`}>{value.room.name}</Link>
              {value.label && <> · {value.label}</>}
              <span className={page.printedValue}>
                <q className={page.printedText}>{value.printed}</q> → {metres(value.value.mm)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
