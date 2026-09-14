import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useParams } from "react-router";
import styles from "./App.module.css";
import { call, type Home, type Level, type Room } from "./api";
import { useLiveUpdates } from "./liveUpdates";
import { queryKeys, useHome, useSessions } from "./queries";

export function HomePage() {
  const { slug = "" } = useParams();
  // Keyed by Home, so switching Homes starts every form and action result afresh.
  return <HomeView key={slug} slug={slug} />;
}

function HomeView({ slug }: { slug: string }) {
  useLiveUpdates(slug);
  const home = useHome(slug);
  if (home.isPending) return <p>Loading…</p>;
  if (home.isError) return <p className={styles.error}>{home.error.message}</p>;
  const { levels, rooms } = home.data;
  return (
    <>
      <h1>{home.data.home.name}</h1>
      <HomeFacts home={home.data.home} />
      <h2>Rooms</h2>
      <RoomList levels={levels} rooms={rooms} />
      <h2>Home Folder</h2>
      <HomeFolderSetup home={home.data.home} />
      <h2>Sessions</h2>
      <SessionList home={slug} />
    </>
  );
}

function HomeFacts({ home }: { home: Home }) {
  return (
    <dl className={styles.facts}>
      <dt>City</dt>
      <dd>{home.city}</dd>
      <dt>Country</dt>
      <dd>{home.country}</dd>
      <dt>Latitude</dt>
      <dd>{home.latitude}°</dd>
    </dl>
  );
}

function RoomList({ levels, rooms }: { levels: Level[]; rooms: Room[] }) {
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
                <li key={room.slug}>{room.name}</li>
              ))}
            </ul>
          )}
        </section>
      );
    });
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

function formatTime(at: string) {
  return new Date(at).toLocaleString();
}
