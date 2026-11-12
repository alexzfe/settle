// The Rooms as tiles grouped by Level, shared by the Overview and the Rooms page: each tile shows
// the Room's wall color, functions, Gaps, open Decisions, and whether anything about it is flagged.

import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import styles from "./App.module.css";
import {
  call,
  type DecisionSummary,
  type Level,
  photoUrl,
  type Room,
  type RoomDetail,
} from "./api";
import { sentence } from "./format";
import { queryKeys, useDecisions } from "./queries";
import page from "./RoomTiles.module.css";
import { buildPrompt } from "./ui/AskAgent";
import { EmptyState } from "./ui/EmptyState";
import { FlagMark } from "./ui/StateMark";

/** "1 Gap", "3 Gaps". */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A Decision not yet settled: Candidate or Leaning. */
export function isOpen(decision: DecisionSummary): boolean {
  return decision.state === "candidate" || decision.state === "leaning";
}

/** A Room's Decisions not yet settled. */
function openDecisionsOf(room: string, decisions: readonly DecisionSummary[]): DecisionSummary[] {
  return decisions.filter((decision) => decision.room?.slug === room && isOpen(decision));
}

/** Whether any Decision about the Room has an open flag or Conflict. */
function roomFlagged(room: string, decisions: readonly DecisionSummary[]): boolean {
  return decisions.some(
    (decision) =>
      decision.room?.slug === room && decision.openFlags.length + decision.openConflicts.length > 0,
  );
}

/**
 * The Rooms whose Room Sheet still has Gaps, or undefined until every Room's sheet has loaded: a
 * sheet still loading, or one that failed, would be counted as having none.
 */
export function roomsWithGaps(
  rooms: readonly Room[],
  details: Map<string, RoomDetail>,
): Room[] | undefined {
  if (!rooms.every((room) => details.has(room.slug))) return undefined;
  return rooms.filter((room) => (details.get(room.slug)?.gaps.length ?? 0) > 0);
}

/** Each Room's Room Sheet, by slug, as far as loaded: for its Gaps, functions, and wall color. */
export function useRoomDetails(home: string, rooms: readonly Room[]): Map<string, RoomDetail> {
  const results = useQueries({
    queries: rooms.map((room) => ({
      queryKey: queryKeys.room(home, room.slug),
      queryFn: () => call("get_room", { home, room: room.slug }),
    })),
  });
  const details = new Map<string, RoomDetail>();
  results.forEach((result, index) => {
    const room = rooms[index];
    if (room && result.data) details.set(room.slug, result.data.room);
  });
  return details;
}

/** The Rooms as tiles, grouped by Level; Home Intake is offered while there are none. */
export function RoomGrid({
  home,
  levels,
  rooms,
  details,
}: {
  home: string;
  levels: Level[];
  rooms: Room[];
  details: Map<string, RoomDetail>;
}) {
  const decisions = useDecisions(home).data?.decisions ?? [];
  if (rooms.length === 0) {
    return (
      <EmptyState
        text="No Rooms yet"
        prompt={buildPrompt({
          skill: "Home Intake",
          text: "Let's record my home; I'll upload the floor plan",
        })}
      />
    );
  }
  return levels
    .toSorted((a, b) => a.storey - b.storey)
    .map((level) => {
      const onLevel = rooms.filter((room) => room.level === level.slug);
      return (
        <section key={level.slug} className={page.level}>
          {/* The level under the page's h1, so an h2, drawn at its own small size. */}
          <h2 className={page.levelTitle}>
            Level {level.storey}
            {level.name && <span className={page.levelName}> · {level.name}</span>}
          </h2>
          {onLevel.length === 0 ? (
            <p className={styles.muted}>No Rooms.</p>
          ) : (
            <ul className={page.tiles}>
              {onLevel.map((room) => (
                <RoomTile
                  key={room.slug}
                  home={home}
                  room={room}
                  detail={details.get(room.slug)}
                  decisions={decisions}
                />
              ))}
            </ul>
          )}
        </section>
      );
    });
}

/**
 * What the Room is used for, and Outdoor when it is. Left out when it would only say the name
 * again: a Kitchen used as a kitchen.
 */
function FunctionsLine({ name, detail }: { name: string; detail: RoomDetail }) {
  const functions = sentence(detail.functions.join(", "));
  const repeatsName = functions.toLowerCase() === name.trim().toLowerCase();
  if (repeatsName && !detail.outdoor) return null;
  return (
    <p className={page.functions}>
      {repeatsName ? null : functions || "No functions yet"}
      {detail.outdoor && <span className={page.outdoor}>Outdoor</span>}
    </p>
  );
}

function RoomTile({
  home,
  room,
  detail,
  decisions,
}: {
  home: string;
  room: Room;
  detail: RoomDetail | undefined;
  decisions: readonly DecisionSummary[];
}) {
  const wallColor = detail?.surfaces.find((surface) => surface.part === "walls")?.color;
  const open = openDecisionsOf(room.slug, decisions).length;
  const gaps = detail?.gaps.length ?? 0;
  return (
    <li className={page.tile}>
      {wallColor?.hex ? (
        <span
          className={page.strip}
          style={{ backgroundColor: wallColor.hex }}
          title={`Walls: ${wallColor.name}, approximately ${wallColor.hex}`}
        />
      ) : (
        <span className={`${page.strip} ${page.noStrip}`} />
      )}
      {/* A trial (room-photos Q13): the main Photo's thumbnail, only when the Room has one. */}
      {room.photo && (
        <img
          className={page.thumb}
          src={photoUrl(home, { room: room.slug }, room.photo, "thumb")}
          alt=""
          loading="lazy"
        />
      )}
      <div className={page.tileBody}>
        <p className={page.tileName}>
          <Link to={`/homes/${home}/rooms/${room.slug}`} className={`clamp ${page.tileLink}`}>
            {room.name}
          </Link>
          {roomFlagged(room.slug, decisions) && (
            <>
              {" "}
              <FlagMark />
            </>
          )}
        </p>
        {detail && <FunctionsLine name={room.name} detail={detail} />}
        <p className={page.counts}>
          {detail && (
            <span className={gaps > 0 ? page.hasGaps : undefined}>
              {gaps === 0 ? "No Gaps" : count(gaps, "Gap")}
            </span>
          )}
          {open > 0 && <span>{count(open, "open Decision")}</span>}
        </p>
      </div>
    </li>
  );
}
