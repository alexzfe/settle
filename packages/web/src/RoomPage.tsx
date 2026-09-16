import type {
  Door,
  Feature,
  FeatureKind,
  NamedRef,
  RoomDetail,
  SurfacePart,
  Wall,
  Window,
  WindowKind,
} from "@idh/core";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import type { DecisionSummary, Surface } from "./api";
import { DecisionLine } from "./DecisionsPage";
import { compass, type Measure, sentence, wallName, wallNameOf, words } from "./format";
import { ItemList } from "./ItemsPage";
import { useRoom } from "./queries";
import { Swatch } from "./Swatch";
import { ArchivedNote, dimensions, Fact, Length, lightText, Parts } from "./Values";

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

/** Everything on one Room's Room Sheet, read-only. Changes come through the Agent. */
export function RoomPage() {
  const { home = "", room = "" } = useParams();
  const sheet = useRoom(home, room);
  if (sheet.isPending) return <p>Loading…</p>;
  if (sheet.isError) return <p className={styles.error}>{sheet.error.message}</p>;
  return <RoomSheet room={sheet.data.room} decisions={sheet.data.decisions} />;
}

function RoomSheet({ room, decisions }: { room: RoomDetail; decisions: DecisionSummary[] }) {
  const walls = room.walls.toSorted((a, b) => a.position - b.position);
  const wallSlugs = new Set(walls.map((wall) => wall.slug));
  const roofWindows = room.windows.filter((window) => window.wall === "roof");
  const offWall = <T extends { wall?: string }>(records: T[]) =>
    records.filter((record) => record.wall !== "roof" && !wallSlugs.has(record.wall ?? ""));
  const windowsOffWall = offWall(room.windows);
  const doorsOffWall = offWall(room.doors);
  return (
    <>
      <h1>{room.name}</h1>
      {room.archivedAt && (
        <p>
          <ArchivedNote at={room.archivedAt} reason={room.archivedReason} />
        </p>
      )}
      <dl className={styles.facts}>
        <Fact term="Level">
          {room.level.name} (Level {room.level.storey})
        </Fact>
        <Fact term="Functions">{room.functions.map(words).join(", ")}</Fact>
        <Fact term="Outdoor">{room.outdoor && "Yes"}</Fact>
        <Fact term="Ceiling height">
          {room.ceilingHeight && <Length value={room.ceilingHeight} />}
        </Fact>
        <Fact term="Times of use">{room.timesOfUse.join(", ")}</Fact>
        <Fact term="Daylight">{daylightText(room)}</Fact>
      </dl>

      <h2>Walls</h2>
      {walls.length === 0 ? (
        <p>No Walls recorded.</p>
      ) : (
        walls.map((wall) => (
          <WallSection
            key={wall.slug}
            wall={wall}
            windows={room.windows.filter((window) => window.wall === wall.slug)}
            doors={room.doors.filter((door) => door.wall === wall.slug)}
          />
        ))
      )}
      {roofWindows.length > 0 && (
        <section>
          <h3>In the roof</h3>
          <OpeningList windows={roofWindows} doors={[]} />
        </section>
      )}
      {windowsOffWall.length + doorsOffWall.length > 0 && (
        <section>
          <h3>On no recorded Wall</h3>
          <OpeningList windows={windowsOffWall} doors={doorsOffWall} />
        </section>
      )}

      <h2>Surfaces</h2>
      <Surfaces surfaces={room.surfaces} walls={walls} />

      <h2>Features</h2>
      {room.features.length === 0 ? (
        <p>No Features recorded.</p>
      ) : (
        <ul>
          {room.features.map((feature) => (
            <li key={feature.slug}>
              <FeatureLine feature={feature} />
            </li>
          ))}
        </ul>
      )}

      <h2>Lights</h2>
      {room.lights.length === 0 ? (
        <p>No lights recorded, so how the Room is lit is unknown.</p>
      ) : (
        <ul>
          {room.lights.map((source) => (
            <li key={`${source.source}:${source.slug}`}>
              {source.name} ({source.source === "item" ? "Item" : "Feature"})
              {lightText(source.light) && `: ${lightText(source.light)}`}
            </li>
          ))}
        </ul>
      )}

      <h2>Items</h2>
      {room.items.length === 0 ? <p>No Items in this Room.</p> : <ItemList items={room.items} />}

      <h2>Gaps</h2>
      {room.gaps.length === 0 ? (
        <p>None: everything advice needs is recorded.</p>
      ) : (
        <ul>
          {room.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      )}

      <h2>Decisions</h2>
      <RoomDecisions decisions={decisions} />
    </>
  );
}

/** The Room's open Decisions, as get_room gives them: Candidate, Leaning, and Locked not Fulfilled. */
function RoomDecisions({ decisions }: { decisions: DecisionSummary[] }) {
  const { home = "" } = useParams();
  if (decisions.length === 0) return <p>No open Decisions.</p>;
  return (
    <ul>
      {decisions.map((decision) => (
        <li key={decision.slug}>
          <DecisionLine home={home} decision={decision} />
        </li>
      ))}
    </ul>
  );
}

/**
 * Where the Room's daylight comes from: its Windows, and any glazed Door leading outside or onto
 * an outdoor Room, each with the direction its Wall faces. Mirrors core's daylightOpenings, since
 * the web takes only types from @idh/core.
 */
function daylightText(room: RoomDetail): string | undefined {
  const wallFacing = (slug: string | undefined) =>
    room.walls.find((wall) => wall.slug === slug)?.facing;
  const faces = (direction: string | undefined) =>
    direction ? ` facing ${compass(direction)}` : "";
  const parts = [
    ...room.windows.map((window) =>
      window.wall === "roof"
        ? `Skylight${faces(window.roofFacing)}`
        : `Window${faces(wallFacing(window.wall))}`,
    ),
    ...room.doors
      .filter((door) => door.glazed && (door.to === "outside" || door.to === "outdoor-room"))
      .map((door) => `Glazed door${faces(wallFacing(door.wall))}`),
  ];
  if (parts.length > 0) return parts.join(", ");
  return room.windowless ? "None recorded" : undefined;
}

function wallTitle(wall: Wall): string {
  return `${wallName(wall.position)}${wall.label ? ` (${wall.label})` : ""}`;
}

function WallSection({ wall, windows, doors }: { wall: Wall; windows: Window[]; doors: Door[] }) {
  return (
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
    <ul>
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
  if (shown.length === 0) return <p>No Surfaces recorded.</p>;
  return (
    <dl className={styles.facts}>
      {shown.map(({ term, surface }) => (
        <Fact key={surface.slug} term={term}>
          <SurfaceLine surface={surface} />
        </Fact>
      ))}
    </dl>
  );
}

function SurfaceLine({ surface }: { surface: Surface }) {
  return (
    <Parts>
      {surface.materials
        ?.map(({ material, where }) => (where ? `${material} (${where})` : material))
        .join(", ")}
      {surface.color && <Swatch color={surface.color} />}
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
