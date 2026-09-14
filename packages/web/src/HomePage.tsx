import type { PlannedStay } from "@idh/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import styles from "./App.module.css";
import { call, type Home, type Level, type Room } from "./api";
import { BlueprintList, BlueprintUploadForm } from "./Blueprints";
import { formatDate, formatTime, sentence } from "./format";
import { queryKeys, useConstraints, useHome, useNotes, useSessions } from "./queries";
import { ArchivedNote, Fact, Length } from "./Values";

const PLANNED_STAY: Record<PlannedStay, string> = {
  "under-1-year": "Under a year",
  "1-3-years": "1–3 years",
  "3-10-years": "3–10 years",
  indefinitely: "Indefinitely",
};

export function HomePage() {
  const { home: slug = "" } = useParams();
  const home = useHome(slug);
  if (home.isPending) return <p>Loading…</p>;
  if (home.isError) return <p className={styles.error}>{home.error.message}</p>;
  const { levels, rooms, unplacedItems } = home.data;
  return (
    <>
      <h1>{home.data.home.name}</h1>
      <HomeFacts home={home.data.home} />
      <h2>Levels and Rooms</h2>
      <RoomList home={slug} levels={levels} rooms={rooms} />
      <h2>Blueprints</h2>
      <BlueprintList home={slug} />
      <BlueprintUploadForm home={slug} />
      <h2>Items</h2>
      <p>
        <Link to={`/homes/${slug}/items`}>
          {unplacedItems} Unplaced {unplacedItems === 1 ? "Item" : "Items"}
        </Link>
      </p>
      <h2>Constraints</h2>
      <ConstraintList home={slug} />
      <h2>Notes</h2>
      <NoteList home={slug} />
      <h2>Home Folder</h2>
      <HomeFolderSetup home={home.data.home} />
      <h2>Sessions</h2>
      <SessionList home={slug} />
    </>
  );
}

/** The Home's facts that are recorded; the rest are left out. */
function HomeFacts({ home }: { home: Home }) {
  return (
    <dl className={styles.facts}>
      <Fact term="City">{home.city}</Fact>
      <Fact term="Country">{home.country}</Fact>
      <Fact term="Latitude">{home.latitude}°</Fact>
      <Fact term="Tenure">{home.tenure && sentence(home.tenure)}</Fact>
      <Fact term="Planned stay">{home.plannedStay && PLANNED_STAY[home.plannedStay]}</Fact>
      <Fact term="Building type">{home.buildingType && sentence(home.buildingType)}</Fact>
      <Fact term="Building era">{home.buildingEra}</Fact>
      <Fact term="Lift">{home.lift === undefined ? undefined : home.lift ? "Yes" : "None"}</Fact>
      <Fact term="Lift door width">
        {home.liftDoorWidth && <Length value={home.liftDoorWidth} />}
      </Fact>
      <Fact term="Lift car depth">{home.liftCarDepth && <Length value={home.liftCarDepth} />}</Fact>
      <Fact term="Narrowest access point">
        {(home.accessWidth || home.accessNote) && (
          <>
            {home.accessWidth && <Length value={home.accessWidth} />}
            {home.accessWidth && home.accessNote && ", "}
            {home.accessNote}
          </>
        )}
      </Fact>
    </dl>
  );
}

function RoomList({ home, levels, rooms }: { home: string; levels: Level[]; rooms: Room[] }) {
  if (rooms.length === 0) {
    return <p>No Rooms yet. Describe them to the Agent in this Home's Home Folder.</p>;
  }
  return levels
    .toSorted((a, b) => a.storey - b.storey)
    .map((level) => {
      const onLevel = rooms.filter((room) => room.level === level.slug);
      return (
        <section key={level.slug}>
          <h3>
            {level.name} (Level {level.storey})
          </h3>
          {onLevel.length === 0 ? (
            <p>No Rooms.</p>
          ) : (
            <ul>
              {onLevel.map((room) => (
                <li key={room.slug}>
                  <Link to={`/homes/${home}/rooms/${room.slug}`}>{room.name}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    });
}

function ConstraintList({ home }: { home: string }) {
  const [archived, setArchived] = useState(false);
  const constraints = useConstraints(home, archived);
  const shown = constraints.data?.constraints.filter((each) => archived || !each.archivedAt);
  return (
    <>
      <label>
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />{" "}
        Show archived Constraints
      </label>
      {constraints.isError ? (
        <p className={styles.error}>{constraints.error.message}</p>
      ) : !shown ? (
        <p>Loading…</p>
      ) : shown.length === 0 ? (
        <p>No Constraints{archived ? "" : " in force"}.</p>
      ) : (
        <ul>
          {shown.map((constraint) => (
            <li key={constraint.slug}>
              {constraint.text}
              {constraint.archivedAt && (
                <>
                  {" "}
                  <ArchivedNote at={constraint.archivedAt} reason={constraint.archivedReason} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function NoteList({ home }: { home: string }) {
  const notes = useNotes(home);
  if (notes.isPending) return <p>Loading…</p>;
  if (notes.isError) return <p className={styles.error}>{notes.error.message}</p>;
  if (notes.data.notes.length === 0) return <p>No Notes.</p>;
  const newestFirst = notes.data.notes.toSorted(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return (
    <ul>
      {newestFirst.map((note) => (
        <li key={note.slug}>
          {note.text} <span className={styles.muted}>{formatDate(note.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function HomeFolderSetup({ home }: { home: Home }) {
  const queryClient = useQueryClient();
  const setUp = useMutation({
    mutationFn: (path: string) => call("set_up_home_folder", { home: home.slug, path }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.home(home.slug) }),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUp.mutate(String(new FormData(event.currentTarget).get("path") ?? "").trim());
  }

  return (
    <>
      <p>
        {home.homeFolderPath ? (
          <>
            Set up at <code>{home.homeFolderPath}</code>.
          </>
        ) : (
          "Not set up yet."
        )}
      </p>
      <form className={styles.form} onSubmit={onSubmit}>
        <label>
          Path{" "}
          <input
            name="path"
            defaultValue={home.homeFolderPath ?? `~/Homes/${home.slug}`}
            required
            size={40}
          />
        </label>
        <button type="submit" disabled={setUp.isPending}>
          Set up Home Folder
        </button>
      </form>
      {setUp.isError && (
        <p role="alert" className={styles.error}>
          {setUp.error.message}
        </p>
      )}
      {setUp.isSuccess && (
        <>
          <p>
            Wrote these files in <code>{setUp.data.path}</code>:
          </p>
          <ul>
            {setUp.data.files.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
          <p>
            Open a terminal in that folder and run <code>claude</code>.
          </p>
        </>
      )}
    </>
  );
}

function SessionList({ home }: { home: string }) {
  const sessions = useSessions(home);
  if (sessions.isPending) return <p>Loading…</p>;
  if (sessions.isError) return <p className={styles.error}>{sessions.error.message}</p>;
  if (sessions.data.sessions.length === 0) return <p>No Sessions yet.</p>;
  const newestFirst = sessions.data.sessions.toSorted(
    (a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt),
  );
  return (
    <ul>
      {newestFirst.map((session) => (
        <li key={session.slug}>
          <p>
            <strong>{session.skills.join(", ")}</strong>, opened {formatTime(session.openedAt)}
            {session.closedAt ? `, closed ${formatTime(session.closedAt)}` : ", unsummarised"}
          </p>
          {session.summary && (
            <dl className={styles.facts}>
              <dt>Changed</dt>
              <dd>{session.summary.changed}</dd>
              <dt>Still open</dt>
              <dd>{session.summary.open}</dd>
              <dt>Next</dt>
              <dd>{session.summary.next}</dd>
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
