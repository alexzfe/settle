// The Rooms as tiles grouped by Level, shared by the Overview and the Rooms page: each tile shows
// the Room's wall color, functions, Gaps, open Decisions, and whether anything about it is flagged.

import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router";
import styles from "./App.module.css";
import { call, type DecisionSummary, type Level, type Room, type RoomDetail } from "./api";
import { sentence } from "./format";
import { queryKeys, useDecisions } from "./queries";
import page from "./RoomTiles.module.css";
import { buildPrompt } from "./ui/AskAgent";
import { EmptyState } from "./ui/EmptyState";
import { FlagMark } from "./ui/StatePill";

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

/** The Rooms whose loaded Room Sheet still has Gaps. */
export function roomsWithGaps(rooms: readonly Room[], details: Map<string, RoomDetail>): Room[] {
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
          <h3 className={page.levelTitle}>
            Level {level.storey}
            {level.name && <span className={page.levelName}> · {level.name}</span>}
          </h3>
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
      <div className={page.tileBody}>
        <p className={page.tileName}>
          <Link to={`/homes/${home}/rooms/${room.slug}`} className={page.tileLink}>
            {room.name}
          </Link>
          {roomFlagged(room.slug, decisions) && (
            <>
              {" "}
              <FlagMark />
            </>
          )}
        </p>
        {detail && (
          <p className={page.functions}>
            {sentence(detail.functions.join(", ")) || "No functions yet"}
            {detail.outdoor && <span className={page.outdoor}>Outdoor</span>}
          </p>
        )}
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
