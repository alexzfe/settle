import type {
  CompassPoint,
  Door,
  Feature,
  FeatureKind,
  Home,
  NamedRef,
  Obstruction,
  RoomDetail,
  SurfacePart,
  Wall,
  Window,
  WindowKind,
} from "@settle/core";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import type { DecisionSummary, Room, Surface } from "./api";
import { decisionPath, KIND_LABEL } from "./decisions";
import {
  compass,
  formatColor,
  type Measure,
  metres,
  sentence,
  wallName,
  wallNameOf,
  words,
} from "./format";
import { ItemList } from "./ItemsPage";
import { useHome, useRoom } from "./queries";
import page from "./RoomPage.module.css";
import { LrvBar } from "./Swatch";
import { AskAgent, buildPrompt } from "./ui/AskAgent";
import { Card } from "./ui/Card";
import { useDocumentTitle } from "./ui/documentTitle";
import { Section } from "./ui/Section";
import { FlagMark, FulfilledNote, StatePill } from "./ui/StatePill";
import { ArchivedNote, dimensions, Fact, Length, lightText, Parts, ProvenanceTag } from "./Values";

const SURFACE_PART: Record<SurfacePart, string> = {
  walls: "Walls",
  ceiling: "Ceiling",
  floor: "Floor",
  woodwork: "Woodwork",
};

const FEATURE_KIND: Record<FeatureKind, string> = {
  radiator: "Radiator or heater",
  fireplace: "Fireplace or chimney breast",
  "built-in-storage": "Built-in storage",
  "fitted-units": "Fitted units",
  "beam-or-column": "Beam or column",
  "light-point": "Light point or downlight",
  "tiling-or-panelling": "Tiling or panelling",
  other: "Other",
};

const WINDOW_KIND: Record<WindowKind, string> = {
  standard: "Window",
  bay: "Bay window",
  roof: "Roof window",
};

const OBSTRUCTION: Record<Obstruction, string> = {
  open: "Open",
  partly: "Partly blocked",
  heavily: "Heavily blocked",
};

/** The height a Wall is drawn at when the Room's ceiling height is not recorded, in millimetres. */
export const DEFAULT_CEILING_MM = 2500;

/** Everything on one Room's Room Sheet, read-only. Changes come through the Agent. */
export function RoomPage() {
  const { home = "", room = "" } = useParams();
  const sheet = useRoom(home, room);
  const homeRead = useHome(home);
  useDocumentTitle(sheet.data?.room.name);
  if (sheet.isPending) return <p>Loading…</p>;
  if (sheet.isError) return <p className={styles.error}>{sheet.error.message}</p>;
  return (
    <RoomSheet
      room={sheet.data.room}
      decisions={sheet.data.decisions}
      home={homeRead.data?.home}
      rooms={homeRead.data?.rooms ?? []}
    />
  );
}

function RoomSheet({
  room,
  decisions,
  home,
  rooms,
}: {
  room: RoomDetail;
  decisions: DecisionSummary[];
  home: Home | undefined;
  rooms: Room[];
}) {
  const walls = room.walls.toSorted((a, b) => a.position - b.position);
  const wallSlugs = new Set(walls.map((wall) => wall.slug));
  const roofWindows = room.windows.filter((window) => window.wall === "roof");
  const offWall = <T extends { wall?: string }>(records: T[]) =>
    records.filter((record) => record.wall !== "roof" && !wallSlugs.has(record.wall ?? ""));
  const windowsOffWall = offWall(room.windows);
  const doorsOffWall = offWall(room.doors);
  return (
    <>
      <Banner room={room} walls={walls} />
      {room.archivedAt && (
        <p>
          <ArchivedNote at={room.archivedAt} reason={room.archivedReason} />
        </p>
      )}
      <dl className={`${styles.facts} ${page.roomFacts}`}>
        <Fact term="Outdoor">{room.outdoor && "Yes"}</Fact>
        <Fact term="Ceiling height">
          {room.ceilingHeight && <Length value={room.ceilingHeight} />}
        </Fact>
        <Fact term="Times of use">{room.timesOfUse.join(", ")}</Fact>
      </dl>

      <Section title="Walls" id="walls">
        {walls.length === 0 ? (
          <p className={styles.muted}>No Walls recorded.</p>
        ) : (
          <WallStrip room={room} walls={walls} />
        )}
        {roofWindows.length > 0 && (
          <section className={page.subsection}>
            <h3>In the roof</h3>
            <OpeningList windows={roofWindows} doors={[]} />
          </section>
        )}
        {windowsOffWall.length + doorsOffWall.length > 0 && (
          <section className={page.subsection}>
            <h3>On no recorded Wall</h3>
            <OpeningList windows={windowsOffWall} doors={doorsOffWall} />
          </section>
        )}
      </Section>

      <div className={page.pair}>
        <DaylightCard room={room} latitude={home?.latitude} />
        <GapsCard room={room} />
      </div>

      <Section title="Surfaces" id="surfaces">
        <Surfaces surfaces={room.surfaces} walls={walls} />
      </Section>

      <Section title="Features">
        {room.features.length === 0 ? (
          <p className={styles.muted}>No Features recorded.</p>
        ) : (
          <ul className={page.compact}>
            {room.features.map((feature) => (
              <li key={feature.slug}>
                <FeatureLine feature={feature} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Lights">
        {room.lights.length === 0 ? (
          <p className={styles.muted}>No lights recorded, so how the Room is lit is unknown.</p>
        ) : (
          <ul className={page.compact}>
            {room.lights.map((source) => (
              <li key={`${source.source}:${source.slug}`}>
                <strong>{source.name}</strong>{" "}
                <span className={styles.muted}>
                  ({source.source === "item" ? "Item" : "Feature"})
                </span>
                {lightText(source.light) && `: ${lightText(source.light)}`}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Items">
        {room.items.length === 0 ? (
          <p className={styles.muted}>No Items in this Room.</p>
        ) : (
          <ItemList items={room.items} />
        )}
      </Section>

      <Section title="Decisions">
        <RoomDecisions decisions={decisions} />
      </Section>

      <RoomNav room={room} rooms={rooms} />
    </>
  );
}

// ─── Header ────────────────────────────────────────────────────────────────────────────────

/** Whether dark ink reads on a hex ground (relative luminance above about the middle). */
export function isLightGround(hex: string): boolean {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) return true;
  const digits =
    match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(digits.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18;
}

/** The Room's walls color: the walls Surface's screen color, if recorded. */
function wallsColor(room: RoomDetail) {
  return room.surfaces.find((surface) => surface.part === "walls" && !surface.wall)?.color;
}

/**
 * The Room's size in the caption: "4.20 × ~3.60 m" for a four-Walled Room with its first two
 * lengths recorded; undefined otherwise, since other shapes have no simple width and depth.
 */
export function roomSize(walls: readonly Wall[]): string | undefined {
  if (walls.length !== 4) return undefined;
  const [first, second] = walls;
  if (!first?.length || !second?.length) return undefined;
  const mark = (value: Measure) => (value.provenance === "estimated" ? "~" : "");
  const bare = (value: Measure) => metres(value.mm).replace(" m", "");
  return `${mark(first.length)}${bare(first.length)} × ${mark(second.length)}${metres(second.length.mm)}`;
}

function Banner({ room, walls }: { room: RoomDetail; walls: Wall[] }) {
  const color = wallsColor(room);
  const ground = color?.hex;
  // With no screen color recorded, the banner takes a warm neutral that follows the theme.
  const tone =
    ground === undefined ? page.neutral : isLightGround(ground) ? page.onLight : page.onDark;
  const caption = [
    room.functions.length > 0 && sentence(room.functions.map(words).join(", ")),
    `${room.level.name} (Level ${room.level.storey})`,
    roomSize(walls),
  ].filter(Boolean);
  return (
    <header
      className={`${page.banner} ${tone}`}
      style={ground ? { backgroundColor: ground } : undefined}
    >
      <h1 className={page.roomName}>{room.name}</h1>
      <p className={page.caption}>{caption.join(" · ")}</p>
      {color && (
        <p className={page.bannerColor}>
          Walls: {formatColor(color)}
          {!color.hex && " (no screen color recorded)"}
        </p>
      )}
    </header>
  );
}

// ─── Walls ─────────────────────────────────────────────────────────────────────────────────

function wallTitle(wall: Wall): string {
  return `${wallName(wall.position)}${wall.label ? ` (${wall.label})` : ""}`;
}

/** One drawing per Wall in clockwise order; clicking one shows its facts below the strip. */
function WallStrip({ room, walls }: { room: RoomDetail; walls: Wall[] }) {
  const [open, setOpen] = useState<string>();
  const shown = walls.find((wall) => wall.slug === open);
  const ceiling = room.ceilingHeight?.mm ?? DEFAULT_CEILING_MM;
  const roomHex = wallsColor(room)?.hex;
  return (
    <>
      {!room.ceilingHeight && (
        <p className={page.note}>
          Ceiling height not recorded, so the Walls are drawn {metres(DEFAULT_CEILING_MM)} high.
        </p>
      )}
      <ul className={page.strip}>
        {walls.map((wall) => {
          const windows = room.windows.filter((window) => window.wall === wall.slug);
          const doors = room.doors.filter((door) => door.wall === wall.slug);
          return (
            <li key={wall.slug} className={page.wallCard}>
              <WallCard
                wall={wall}
                windows={windows}
                doors={doors}
                ceiling={ceiling}
                fill={wall.surface?.color?.hex ?? roomHex}
                expanded={open === wall.slug}
                onToggle={() => setOpen(open === wall.slug ? undefined : wall.slug)}
              />
            </li>
          );
        })}
      </ul>
      {shown && (
        <WallSection
          wall={shown}
          windows={room.windows.filter((window) => window.wall === shown.slug)}
          doors={room.doors.filter((door) => door.wall === shown.slug)}
        />
      )}
    </>
  );
}

/** Pixels per millimetre: every Wall of a Room is drawn to the same scale, its ceiling 72px high. */
const DRAWN_HEIGHT = 72;

interface Placed {
  slug: string;
  kind: "window" | "door" | "glazed door" | "doorway";
  offset: number;
  width: number;
  height: number;
  sill: number;
}

/**
 * Where a Window or Door is drawn, from its recorded offset, width, height, and (for a Window)
 * sill; undefined when any is missing. A Door's offset is along side A's Wall, so a Door seen
 * from side B is never placed.
 */
export function placeOpening(opening: { window: Window } | { door: Door }): Placed | undefined {
  if ("window" in opening) {
    const { slug, offset, width, height, sillHeight } = opening.window;
    if (!offset || !width || !height || !sillHeight) return undefined;
    return {
      slug,
      kind: "window",
      offset: offset.mm,
      width: width.mm,
      height: height.mm,
      sill: sillHeight.mm,
    };
  }
  const { slug, sideA, offset, clearWidth, height, glazed, noDoor } = opening.door;
  if (!sideA || !offset || !clearWidth || !height) return undefined;
  return {
    slug,
    kind: noDoor ? "doorway" : glazed ? "glazed door" : "door",
    offset: offset.mm,
    width: clearWidth.mm,
    height: height.mm,
    sill: 0,
  };
}

function openingName(opening: { window: Window } | { door: Door }): string {
  if ("window" in opening) return WINDOW_KIND[opening.window.kind ?? "standard"];
  const { door } = opening;
  return door.noDoor ? "Doorway" : door.glazed ? "Glazed door" : "Door";
}

function WallCard({
  wall,
  windows,
  doors,
  ceiling,
  fill,
  expanded,
  onToggle,
}: {
  wall: Wall;
  windows: Window[];
  doors: Door[];
  ceiling: number;
  fill: string | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const openings = [...windows.map((window) => ({ window })), ...doors.map((door) => ({ door }))];
  const placed = openings.flatMap((opening) => placeOpening(opening) ?? []);
  const unplaced = openings.filter((opening) => !placeOpening(opening));
  const scale = DRAWN_HEIGHT / ceiling;
  const lengthMm = wall.length?.mm ?? 3000;
  const width = Math.max(24, lengthMm * scale);
  const pad = 3;
  const dashed = !wall.length || wall.length.provenance === "estimated";
  const lengthLabel = wall.length
    ? `${wall.length.provenance === "estimated" ? "~" : ""}${metres(wall.length.mm)}`
    : "length ?";
  return (
    <>
      <button type="button" className={page.wallButton} aria-expanded={expanded} onClick={onToggle}>
        <span className={page.wallHead}>
          <span className={page.wallName}>{wallTitle(wall)}</span>
          <span
            className={page.facing}
            title={wall.facing ? `Faces ${compass(wall.facing)}` : "Facing not recorded"}
          >
            {wall.facing ? compass(wall.facing) : "?"}
          </span>
        </span>
        <svg
          className={page.elevation}
          width={width + pad * 2}
          height={DRAWN_HEIGHT + pad * 2}
          viewBox={`0 0 ${width + pad * 2} ${DRAWN_HEIGHT + pad * 2}`}
          role="img"
          aria-label={`${wallName(wall.position)} drawn to scale`}
        >
          <rect
            x={pad}
            y={pad}
            width={width}
            height={DRAWN_HEIGHT}
            className={page.wallShape}
            style={fill ? { fill } : undefined}
            strokeDasharray={dashed ? "5 3" : undefined}
          />
          {placed.map((opening) => (
            <rect
              key={opening.slug}
              x={pad + opening.offset * scale}
              y={pad + DRAWN_HEIGHT - (opening.sill + opening.height) * scale}
              width={opening.width * scale}
              height={opening.height * scale}
              className={page[opening.kind.replace(" ", "-")]}
            >
              <title>{sentence(opening.kind)}</title>
            </rect>
          ))}
        </svg>
        <span className={`${page.wallLength} ${dashed ? page.estimated : ""}`}>{lengthLabel}</span>
      </button>
      <p className={page.beyond}>Beyond: {beyond(wall.beyond) ?? "not recorded"}</p>
      {unplaced.length > 0 && (
        <ul className={page.unplaced}>
          {unplaced.map((opening) => {
            const slug = "window" in opening ? opening.window.slug : opening.door.slug;
            return <li key={slug}>{openingName(opening)} · position not recorded</li>;
          })}
        </ul>
      )}
    </>
  );
}

function WallSection({ wall, windows, doors }: { wall: Wall; windows: Window[]; doors: Door[] }) {
  return (
    <Card className={page.wallDetail}>
      <section>
        <h3>{wallTitle(wall)}</h3>
        <dl className={styles.facts}>
          <Fact term="Length">{wall.length && <Length value={wall.length} />}</Fact>
          <Fact term="Facing">{wall.facing && compass(wall.facing)}</Fact>
          <Fact term="Beyond">{beyond(wall.beyond)}</Fact>
          <Fact term="Obstruction">
            {wall.obstruction &&
              `${sentence(wall.obstruction)}${wall.deciduous ? ", deciduous trees" : ""}`}
          </Fact>
          <Fact term="Windows and Doors">
            {(windows.length > 0 || doors.length > 0) && (
              <OpeningList windows={windows} doors={doors} />
            )}
          </Fact>
        </dl>
      </section>
    </Card>
  );
}

/** What is beyond a Wall; undefined when unknown, so the fact is left out. */
function beyond({ kind, room }: Wall["beyond"]): ReactNode {
  if (kind === "outside") return "Outside";
  if (kind === "unknown" || !room) return undefined;
  return (
    <>
      <RoomLink room={room} />
      {room.outdoor && " (outdoor)"}
    </>
  );
}

function RoomLink({ room }: { room: NamedRef }) {
  const { home = "" } = useParams();
  return <Link to={`/homes/${home}/rooms/${room.slug}`}>{room.name}</Link>;
}

/**
 * Windows and Doors in the order they come along the Wall from its start corner. A Door's offset
 * is measured along the Wall of the Room it was first recorded in (side A), so it only places the
 * Door on that Room's page.
 */
function OpeningList({ windows, doors }: { windows: Window[]; doors: Door[] }) {
  const openings = [
    ...windows.map((window) => ({ slug: window.slug, offset: window.offset, window })),
    ...doors.map((door) => ({
      slug: door.slug,
      offset: door.sideA ? door.offset : undefined,
      door,
    })),
  ].toSorted((a, b) => (a.offset?.mm ?? Infinity) - (b.offset?.mm ?? Infinity));
  return (
    <ul className={page.compact}>
      {openings.map((opening) => (
        <li key={opening.slug}>
          {"window" in opening ? (
            <WindowLine window={opening.window} />
          ) : (
            <DoorLine door={opening.door} offset={opening.offset} />
          )}
        </li>
      ))}
    </ul>
  );
}

function WindowLine({ window }: { window: Window }) {
  return (
    <Parts>
      <strong>{WINDOW_KIND[window.kind ?? "standard"]}</strong>
      {window.roofFacing && `roof facing ${compass(window.roofFacing)}`}
      {dimensions([
        ["W", window.width],
        ["H", window.height],
      ])}
      {window.sillHeight && (
        <span>
          sill <Length value={window.sillHeight} />
        </span>
      )}
      {window.offset && <FromStart offset={window.offset} />}
      {window.glass && window.glass !== "clear" && `${window.glass} glass`}
    </Parts>
  );
}

function DoorLine({ door, offset }: { door: Door; offset: Measure | undefined }) {
  const kind = door.noDoor ? "Doorway" : door.glazed ? "Glazed door" : "Door";
  return (
    <Parts>
      <span>
        <strong>{kind}</strong> {otherSide(door)}
      </span>
      {dimensions([
        ["clear width", door.clearWidth],
        ["H", door.height],
      ])}
      {offset && <FromStart offset={offset} />}
    </Parts>
  );
}

function otherSide(door: Door): ReactNode {
  switch (door.to) {
    case "outside":
      return "to outside";
    case "unknown":
      return "to a side not yet recorded";
    case "room":
    case "outdoor-room":
      if (!door.otherRoom) return undefined;
      return (
        <>
          to <RoomLink room={door.otherRoom} />
          {door.otherWall && ` (its ${wallNameOf(door.otherWall)})`}
        </>
      );
  }
}

function FromStart({ offset }: { offset: Measure }) {
  return (
    <span>
      <Length value={offset} /> from the Wall's start
    </span>
  );
}

// ─── Daylight ──────────────────────────────────────────────────────────────────────────────

/** One way daylight reaches the Room, as core's daylightOpenings defines it. */
export interface Opening {
  slug: string;
  kind: "window" | "glazed door";
  roof?: boolean;
  facing?: CompassPoint;
  obstruction?: Obstruction;
  deciduous?: boolean;
}

/**
 * The Room's daylight openings: its Windows, and any glazed Door leading outside or onto an
 * outdoor Room, with their Wall's facing and obstruction (a skylight's own facing). Mirrors core's
 * daylightOpenings, since the web takes only types from @settle/core.
 */
export function daylightOpenings(room: RoomDetail): Opening[] {
  const walls = new Map(room.walls.map((wall) => [wall.slug, wall]));
  const fromWall = (slug: string | undefined) => {
    const wall = slug === undefined ? undefined : walls.get(slug);
    return {
      ...(wall?.facing && { facing: wall.facing }),
      ...(wall?.obstruction && { obstruction: wall.obstruction }),
      ...(wall?.deciduous && { deciduous: true }),
    };
  };
  return [
    ...room.windows.map(
      (window): Opening =>
        window.wall === "roof"
          ? {
              slug: window.slug,
              kind: "window",
              roof: true,
              ...(window.roofFacing && { facing: window.roofFacing }),
            }
          : { slug: window.slug, kind: "window", ...fromWall(window.wall) },
    ),
    ...room.doors
      .filter((door) => door.glazed && (door.to === "outside" || door.to === "outdoor-room"))
      .map((door): Opening => ({ slug: door.slug, kind: "glazed door", ...fromWall(door.wall) })),
  ];
}

const POINTS: readonly CompassPoint[] = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];

/**
 * What the Room's facing means for color and light, in one qualitative line. The sun side is
 * south in the northern hemisphere and north in the southern one.
 */
export function facingMeaning(facings: readonly CompassPoint[], latitude = 0): string {
  const distinct = [...new Set(facings)];
  if (distinct.length === 0) return "";
  const apart = distinct.some((a) => distinct.some((b) => stepsApart(a, b) > 1));
  if (apart) {
    return "Light from more than one side, so colors shift less through the day and the Room feels even.";
  }
  const [point] = distinct as [CompassPoint];
  const sunSide = latitude < 0 ? "n" : "s";
  const poleSide = latitude < 0 ? "s" : "n";
  const leans = (letter: string) => point.includes(letter);
  if (leans(sunSide)) {
    const when = leans("e") ? " in the morning" : leans("w") ? " in the afternoon" : "";
    return `Faces the sun${when}: bright, warm light, so colors read warmer and lighter, and cool colors hold up well.`;
  }
  if (leans(poleSide)) {
    return "Faces away from the sun: steady, cooler light, so colors read cooler and a little darker; warmer colors help.";
  }
  if (point === "e") {
    return "Faces east: bright, cooler morning light, then softer and bluer later, so warm colors keep it welcoming.";
  }
  return "Faces west: softer light in the morning and warm, golden light late in the day, so colors warm up in the evening.";
}

/** How many compass points apart two facings are, the short way round: 0 to 4. */
function stepsApart(a: CompassPoint, b: CompassPoint): number {
  const steps = Math.abs(POINTS.indexOf(a) - POINTS.indexOf(b));
  return Math.min(steps, 8 - steps);
}

function openingLabel(opening: Opening): string {
  if (opening.roof) return "Skylight";
  return opening.kind === "glazed door" ? "Glazed door" : "Window";
}

function obstructionText(opening: Opening): string | undefined {
  if (!opening.obstruction) return undefined;
  return `${OBSTRUCTION[opening.obstruction]}${opening.deciduous ? " (deciduous trees)" : ""}`;
}

function DaylightCard({ room, latitude }: { room: RoomDetail; latitude: number | undefined }) {
  const openings = daylightOpenings(room);
  const skylights = openings.filter((opening) => opening.roof);
  const onWalls = openings.filter((opening) => !opening.roof);
  const faced = onWalls.filter((opening) => opening.facing);
  const unfaced = onWalls.filter((opening) => !opening.facing);
  const meaning = facingMeaning(
    faced.flatMap((opening) => opening.facing ?? []),
    latitude,
  );
  return (
    <Card className={page.daylight}>
      <h2 className={page.cardTitle}>Daylight</h2>
      {openings.length === 0 ? (
        <p className={styles.muted}>
          {room.windowless
            ? "No daylight: the Room has no Windows, so its colors rely on the lights."
            : "No Windows recorded yet."}
        </p>
      ) : (
        <>
          {skylights.length > 0 && (
            <ul className={page.skylights}>
              {skylights.map((opening) => (
                <li key={opening.slug}>
                  <span aria-hidden>☼</span> Skylight
                  {opening.facing && ` facing ${compass(opening.facing)}`}
                </li>
              ))}
            </ul>
          )}
          {faced.length > 0 && <Compass openings={faced} />}
          <ul className={page.daylightList}>
            {faced.map((opening) => (
              <li key={opening.slug}>
                <span className={page.symbol} aria-hidden>
                  {opening.kind === "glazed door" ? "▮" : "▭"}
                </span>{" "}
                <Parts>
                  <span>
                    {openingLabel(opening)} facing {compass(opening.facing ?? "")}
                  </span>
                  {obstructionText(opening)}
                </Parts>
              </li>
            ))}
          </ul>
          {unfaced.length > 0 && (
            <p className={page.unfaced}>
              Facing not recorded: {unfaced.map(openingLabel).join(", ")}
            </p>
          )}
          {meaning && <p className={page.meaning}>{meaning}</p>}
        </>
      )}
    </Card>
  );
}

/** An eight-point compass with a mark at each facing that has a daylight opening. */
function Compass({ openings }: { openings: Opening[] }) {
  const size = 150;
  const center = size / 2;
  const radius = 46;
  const at = (point: CompassPoint, distance: number) => {
    const angle = (POINTS.indexOf(point) * Math.PI) / 4;
    return [center + Math.sin(angle) * distance, center - Math.cos(angle) * distance] as const;
  };
  const counts = new Map<CompassPoint, Opening[]>();
  for (const opening of openings) {
    if (!opening.facing) continue;
    counts.set(opening.facing, [...(counts.get(opening.facing) ?? []), opening]);
  }
  const label = [...counts]
    .map(([point, each]) => `${each.map(openingLabel).join(" and ")} facing ${compass(point)}`)
    .join(", ");
  return (
    <svg
      className={page.compass}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Compass: ${label}`}
    >
      <circle cx={center} cy={center} r={radius} className={page.compassRing} />
      {POINTS.map((point) => {
        const [x1, y1] = at(point, radius - 4);
        const [x2, y2] = at(point, radius + 4);
        const [tx, ty] = at(point, radius + 16);
        return (
          <g key={point}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className={page.compassTick} />
            <text
              x={tx}
              y={ty}
              className={point.length === 1 ? page.compassMain : page.compassMinor}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {point.toUpperCase()}
            </text>
          </g>
        );
      })}
      {[...counts].map(([point, each]) => {
        const [x, y] = at(point, radius - 16);
        const blocked = each.some((opening) => opening.obstruction === "heavily");
        return (
          <g key={point}>
            <line x1={center} y1={center} x2={x} y2={y} className={page.compassRay} />
            <circle cx={x} cy={y} r={7} className={blocked ? page.markBlocked : page.mark} />
            {each.length > 1 && (
              <text
                x={x}
                y={y}
                className={page.markCount}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {each.length}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Gaps ──────────────────────────────────────────────────────────────────────────────────

function GapsCard({ room }: { room: RoomDetail }) {
  const prompt = buildPrompt({
    skill: "Home Intake",
    text: `Let's fill the Gaps in ${room.name}: ${room.gaps.join(", ")}`,
    slug: room.slug,
  });
  return (
    <Card className={page.gaps}>
      <h2 className={page.cardTitle}>Gaps</h2>
      {room.gaps.length === 0 ? (
        <p className={page.noGaps}>
          <span aria-hidden>✓</span> None: everything advice needs is recorded.
        </p>
      ) : (
        <>
          <ul className={page.checklist}>
            {room.gaps.map((gap) => (
              <li key={gap}>{gap.charAt(0).toUpperCase() + gap.slice(1)}</li>
            ))}
          </ul>
          <AskAgent prompt={prompt} label="Fill the Gaps" />
        </>
      )}
    </Card>
  );
}

// ─── Surfaces, Features, Decisions ─────────────────────────────────────────────────────────

/** The Room's own Surfaces, then the whole-Wall exceptions. */
function Surfaces({ surfaces, walls }: { surfaces: Surface[]; walls: Wall[] }) {
  const shown = [
    ...surfaces
      .filter((surface) => surface.wall === undefined)
      .map((surface) => ({ term: SURFACE_PART[surface.part], surface })),
    ...walls.flatMap((wall) =>
      wall.surface ? [{ term: wallTitle(wall), surface: wall.surface }] : [],
    ),
  ];
  if (shown.length === 0) return <p className={styles.muted}>No Surfaces recorded.</p>;
  return (
    <ul className={page.surfaces}>
      {shown.map(({ term, surface }) => (
        <li key={surface.slug} className={page.surface}>
          <SurfaceFill surface={surface} />
          <div className={page.surfaceText}>
            <h3 className={page.surfaceName}>{term}</h3>
            <p className={page.surfaceLine}>
              <SurfaceLine surface={surface} />
            </p>
            {surface.color?.lrv !== undefined && <LrvBar lrv={surface.color.lrv} />}
          </div>
        </li>
      ))}
    </ul>
  );
}

function SurfaceFill({ surface }: { surface: Surface }) {
  const hex = surface.color?.hex;
  if (hex) {
    return (
      <span
        className={page.surfaceFill}
        style={{ backgroundColor: hex }}
        title={`Approximately ${hex}`}
        aria-hidden
      />
    );
  }
  return (
    <span
      className={`${page.surfaceFill} ${page.surfacePlaceholder}`}
      title={surface.color ? "No screen color recorded" : "No color recorded"}
      aria-hidden
    />
  );
}

function SurfaceLine({ surface }: { surface: Surface }) {
  const { color } = surface;
  return (
    <Parts>
      {color && (
        <span>
          {formatColor(color)}
          {color.provenance !== "measured" && (
            <>
              {" "}
              <ProvenanceTag provenance={color.provenance} />
            </>
          )}
        </span>
      )}
      {surface.materials
        ?.map(({ material, where }) => (where ? `${material} (${where})` : material))
        .join(", ")}
      {surface.finish && words(surface.finish)}
    </Parts>
  );
}

function FeatureLine({ feature }: { feature: Feature }) {
  const other = feature.kind === "other";
  const light = feature.light && lightText(feature.light);
  return (
    <Parts>
      <strong>
        {other && feature.description ? feature.description : FEATURE_KIND[feature.kind]}
      </strong>
      {!other && feature.description}
      {feature.wall && wallNameOf(feature.wall)}
      {feature.positionNote}
      {dimensions([
        ["W", feature.width],
        ["H", feature.height],
        ["D", feature.depth],
      ])}
      {light && `light: ${light}`}
      {feature.archivedAt && (
        <ArchivedNote at={feature.archivedAt} reason={feature.archivedReason} />
      )}
    </Parts>
  );
}

/** The Room's open Decisions, as get_room gives them: Candidate, Leaning, and Locked not Fulfilled. */
function RoomDecisions({ decisions }: { decisions: DecisionSummary[] }) {
  const { home = "" } = useParams();
  if (decisions.length === 0) return <p className={styles.muted}>No open Decisions.</p>;
  return (
    <ul className={page.decisions}>
      {decisions.map((decision) => (
        <li key={decision.slug}>
          <StatePill state={decision.state} />
          <Link to={decisionPath(home, decision.slug)}>{decision.title}</Link>
          <span className={styles.muted}>{KIND_LABEL[decision.kind]}</span>
          {decision.fulfilledAt && <FulfilledNote />}
          {decision.openFlags.length > 0 && <FlagMark />}
          {decision.openConflicts.length > 0 && <span className={styles.tag}>Conflict</span>}
        </li>
      ))}
    </ul>
  );
}

/** Links to the Rooms before and after this one, in the Home's Room order. */
function RoomNav({ room, rooms }: { room: RoomDetail; rooms: Room[] }) {
  const { home = "" } = useParams();
  const index = rooms.findIndex((each) => each.slug === room.slug);
  if (index === -1) return null;
  const previous = rooms[index - 1];
  const next = rooms[index + 1];
  if (!previous && !next) return null;
  return (
    <nav className={page.roomNav} aria-label="Rooms">
      {previous ? (
        <Link to={`/homes/${home}/rooms/${previous.slug}`} rel="prev">
          ← {previous.name}
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link to={`/homes/${home}/rooms/${next.slug}`} rel="next">
          {next.name} →
        </Link>
      )}
    </nav>
  );
}
