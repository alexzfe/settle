// The Home page's Blueprints: the list of them, page by page, and the form that uploads one.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Link } from "react-router";
import styles from "./App.module.css";
import { type Blueprint, upload } from "./api";
import { levelTitle } from "./format";
import { queryKeys, useBlueprints } from "./queries";

/** The file types the server reads as a Blueprint. */
const BLUEPRINT_TYPES = ".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg";

/** The viewer's path for one page of a Blueprint. */
export function pagePath(home: string, blueprint: string, page: number): string {
  return `/homes/${home}/blueprints/${blueprint}/${page}`;
}

/** "1 page", "3 pages". */
export function pageCount(count: number): string {
  return `${count} ${count === 1 ? "page" : "pages"}`;
}

/** Every Blueprint of the Home, each page linking to its viewer and naming its Level. */
export function BlueprintList({ home }: { home: string }) {
  const blueprints = useBlueprints(home);
  if (blueprints.isPending) return <p>Loading…</p>;
  if (blueprints.isError) return <p className={styles.error}>{blueprints.error.message}</p>;
  if (blueprints.data.blueprints.length === 0) return <p>No Blueprints yet.</p>;
  return (
    <ul>
      {blueprints.data.blueprints.map((blueprint) => (
        <li key={blueprint.slug}>
          <strong>{blueprint.label}</strong>, {pageCount(blueprint.pageCount)}
          <ul>
            {blueprint.pages.map((page) => (
              <li key={page.page}>
                <Link to={pagePath(home, blueprint.slug, page.page)}>Page {page.page}</Link>
                {page.level && `: ${levelTitle(page.level)}`}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/**
 * Uploads a Blueprint onto the Home. The server renders its pages and refuses a file it can't
 * read; the Agent reads the pages afterwards, in a Home Intake Session.
 */
export function BlueprintUploadForm({ home }: { home: string }) {
  const queryClient = useQueryClient();
  // Kept from the input rather than read back from the form, which not every DOM fills in.
  const [file, setFile] = useState<File>();
  const send = useMutation({
    mutationFn: (form: FormData) => upload("upload_blueprint", form),
    onSuccess: () => {
      for (const queryKey of [queryKeys.blueprints(home), queryKeys.home(home)]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });

  function onChoose(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0]);
    send.reset();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const element = event.currentTarget;
    const label = String(new FormData(element).get("label") ?? "").trim();
    const form = new FormData();
    form.append("home", home);
    form.append("file", file);
    if (label) form.append("label", label);
    send.mutate(form, {
      onSuccess: () => {
        element.reset();
        setFile(undefined);
      },
    });
  }

  return (
    <>
      <form className={styles.form} onSubmit={onSubmit}>
        <label>
          Blueprint file (PDF, PNG, or JPEG){" "}
          <input type="file" name="file" accept={BLUEPRINT_TYPES} onChange={onChoose} />
        </label>
        <label>
          Label (optional) <input name="label" placeholder="estate agent plan" size={30} />
        </label>
        <button type="submit" disabled={!file || send.isPending}>
          {send.isPending ? "Uploading…" : "Upload Blueprint"}
        </button>
      </form>
      {send.isError && (
        <p role="alert" className={styles.error}>
          {send.error.message}
        </p>
      )}
      {send.isSuccess && <Uploaded blueprint={send.data.blueprint} />}
    </>
  );
}

function Uploaded({ blueprint }: { blueprint: Blueprint }) {
  return (
    <p role="status">
      Uploaded {blueprint.label}, {pageCount(blueprint.pageCount)}. Ask the Agent in this Home's
      Home Folder to read it.
    </p>
  );
}
