// Every Room of the Home as a tile, grouped by Level, under a line counting the Rooms, the ones
// with Gaps, and the open Decisions about them.

import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { useDecisions, useHome } from "./queries";
import page from "./RoomsPage.module.css";
import { count, isOpen, RoomGrid, roomsWithGaps, useRoomDetails } from "./RoomTiles";
import { useDocumentTitle } from "./ui/documentTitle";

export function RoomsPage() {
  const { home: slug = "" } = useParams();
  const home = useHome(slug);
  const decisions = useDecisions(slug);
  const rooms = home.data?.rooms ?? [];
  const details = useRoomDetails(slug, rooms);
  useDocumentTitle("Rooms");
  if (home.isPending) return <p>Loading…</p>;
  if (home.isError) return <p className={styles.error}>{home.error.message}</p>;
  const { levels, unplacedItems } = home.data;
  const listed = new Set(rooms.map((room) => room.slug));
  const open = (decisions.data?.decisions ?? []).filter(
    (decision) => decision.room && listed.has(decision.room.slug) && isOpen(decision),
  ).length;
  const summary = [
    count(rooms.length, "Room"),
    `${roomsWithGaps(rooms, details).length} with Gaps`,
    ...(decisions.data ? [count(open, "open Decision")] : []),
  ];
  return (
    <>
      <header className={page.header}>
        <h1>Rooms</h1>
        <p className={page.summary}>
          {rooms.length > 0 && <span>{summary.join(" · ")}</span>}
          <Link to={`/homes/${slug}/items`}>{count(unplacedItems, "Unplaced Item")}</Link>
        </p>
      </header>
      <RoomGrid home={slug} levels={levels} rooms={rooms} details={details} />
    </>
  );
}
