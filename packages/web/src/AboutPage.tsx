// About the Home: the reference page for its facts, Constraints, Notes, Blueprints (with upload),
// and Home Folder, in two columns on a wide screen.

import type { PlannedStay } from "@settle/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import about from "./AboutPage.module.css";
import styles from "./App.module.css";
import { call, type Home } from "./api";
import { BlueprintList, BlueprintUploadForm } from "./Blueprints";
import { formatDate, sentence } from "./format";
import { queryKeys, useConstraints, useHome, useNotes } from "./queries";
import { CopyButton } from "./ui/AskAgent";
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

/**
 * How to set up the Home Folder: a command to paste in a folder on any computer the user talks to
 * the Agent from, which fetches a script from the server that writes the folder's two files. The
 * server writes nothing itself, so the same steps work wherever it runs.
 */
export function HomeFolderSetup({ home }: { home: Home }) {
  const [shown, setShown] = useState(false);
  const setup = useQuery({
    queryKey: [...queryKeys.home(home.slug), "home-folder-setup"],
    queryFn: () => call("home_folder_setup", { home: home.slug }),
    enabled: shown,
  });

  if (!shown) {
    return (
      <>
        <p className={styles.muted}>
          A folder for this Home on each computer you talk to the Agent from.
        </p>
        <button type="button" onClick={() => setShown(true)}>
          Set up Home Folder
        </button>
      </>
    );
  }
  if (setup.isPending) return <p>Loading…</p>;
  if (setup.isError) {
    return (
      <p role="alert" className={styles.error}>
        {setup.error.message}
      </p>
    );
  }
  const { command, pluginInstall, files } = setup.data;
  return (
    <>
      <ol className={about.setupSteps}>
        <li>
          <p>
            Make a folder for this Home, e.g. <code>~/Homes/{home.slug}</code>, open a terminal in
            it, and paste this:
          </p>
          <pre>
            <code>{command}</code>
          </pre>
          <CopyButton text={command} label="Copy the command" />
        </li>
        <li>
          <p>Once on each computer, install the Settle plugin:</p>
          <pre>
            <code>{pluginInstall}</code>
          </pre>
          <CopyButton text={pluginInstall} label="Copy the install line" />
        </li>
        <li>
          <p>
            Then run <code>claude</code> in the folder.
          </p>
        </li>
      </ol>
      <details className={about.byHand}>
        <summary>Show the files</summary>
        <p className={styles.muted}>
          The command writes these two files in the folder. Write them by hand instead if you
          prefer.
        </p>
        {files.map((file) => (
          <figure key={file.path} className={about.file}>
            <figcaption>
              <code>{file.path}</code>
            </figcaption>
            <pre>
              <code>{file.content}</code>
            </pre>
          </figure>
        ))}
      </details>
    </>
  );
}
