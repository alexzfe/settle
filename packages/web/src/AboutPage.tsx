// About the Home: the reference page for its facts, Constraints, Notes, Blueprints (with upload),
// and Home Folder, in two columns on a wide screen.

import type { PlannedStay } from "@idh/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router";
import about from "./AboutPage.module.css";
import styles from "./App.module.css";
import { call, type Home } from "./api";
import { BlueprintList, BlueprintUploadForm } from "./Blueprints";
import { formatDate, sentence } from "./format";
import { queryKeys, useConstraints, useHome, useNotes } from "./queries";
import { Card } from "./ui/Card";
import { Section } from "./ui/Section";
import { ArchivedNote, Fact, Length } from "./Values";

const PLANNED_STAY: Record<PlannedStay, string> = {
  "under-1-year": "Under a year",
  "1-3-years": "1–3 years",
  "3-10-years": "3–10 years",
  indefinitely: "Indefinitely",
};

/** The Home's About page. */
export function AboutPage() {
  const { home: slug = "" } = useParams();
  return (
    <>
      <p className={about.back}>
        <Link to={`/homes/${slug}`}>← Overview</Link>
      </p>
      <h1>About this Home</h1>
      <AboutColumns slug={slug} />
    </>
  );
}

/** The reference parts, once the Home is loaded. */
function AboutColumns({ slug }: { slug: string }) {
  const home = useHome(slug);
  if (home.isPending) return <p>Loading…</p>;
  if (home.isError) return <p className={styles.error}>{home.error.message}</p>;
  const { unplacedItems } = home.data;
  return (
    <div className={about.columns}>
      <div>
        <Section title="Home facts">
          <Card>
            <HomeFacts home={home.data.home} />
          </Card>
          <p className={styles.muted}>
            <Link to={`/homes/${slug}/items`}>
              {unplacedItems} Unplaced {unplacedItems === 1 ? "Item" : "Items"}
            </Link>
          </p>
        </Section>
        <Section title="Constraints">
          <ConstraintList home={slug} />
        </Section>
        <Section title="Notes">
          <NoteList home={slug} />
        </Section>
      </div>
      <div>
        <Section title="Home Folder" id="home-folder">
          <HomeFolderSetup home={home.data.home} />
        </Section>
        <Section title="Blueprints" id="blueprints">
          <BlueprintList home={slug} />
          <BlueprintUploadForm home={slug} />
        </Section>
      </div>
    </div>
  );
}

/** The Home's facts that are recorded; the rest are left out. */
function HomeFacts({ home }: { home: Home }) {
  return (
    <dl className={`${styles.facts} ${about.facts}`}>
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

function ConstraintList({ home }: { home: string }) {
  const [archived, setArchived] = useState(false);
  const constraints = useConstraints(home, archived);
  const shown = constraints.data?.constraints.filter((each) => archived || !each.archivedAt);
  return (
    <>
      {constraints.isError ? (
        <p className={styles.error}>{constraints.error.message}</p>
      ) : !shown ? (
        <p>Loading…</p>
      ) : shown.length === 0 ? (
        <p className={styles.muted}>No Constraints{archived ? "" : " in force"}.</p>
      ) : (
        <ul className={about.list}>
          {shown.map((constraint) => (
            <li
              key={constraint.slug}
              className={constraint.archivedAt ? about.archived : undefined}
            >
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
      <label className={about.toggle}>
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />{" "}
        Show archived Constraints
      </label>
    </>
  );
}

function NoteList({ home }: { home: string }) {
  const notes = useNotes(home);
  if (notes.isPending) return <p>Loading…</p>;
  if (notes.isError) return <p className={styles.error}>{notes.error.message}</p>;
  if (notes.data.notes.length === 0) return <p className={styles.muted}>No Notes.</p>;
  const newestFirst = notes.data.notes.toSorted(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  return (
    <ul className={about.list}>
      {newestFirst.map((note) => (
        <li key={note.slug}>
          {note.text} <span className={about.date}>{formatDate(note.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Sets up the Home Folder at a path, and says which files it wrote. */
export function HomeFolderSetup({ home }: { home: Home }) {
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
      <form className={`${styles.form} ${about.inline}`} onSubmit={onSubmit}>
        <label>
          Path{" "}
          <input
            name="path"
            defaultValue={home.homeFolderPath ?? `~/Homes/${home.slug}`}
            required
            size={32}
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
