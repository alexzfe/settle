// An Item's Documents on its page: the receipts, warranties, manuals and other papers the user
// kept with it, as PDFs or images. A list, not previews: one row each with its kind and name, a
// PDF opening in a new tab for the phone's own viewer, an image in the viewer dialog. The section
// shows only once there is one; before that "Add document" is the only trace. The Agent is told
// they exist but never reads them, and nothing else in the app shows them.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import type { PercentCrop } from "react-image-crop";
import styles from "./App.module.css";
import { call, type Document, type DocumentKind, documentUrl, upload } from "./api";
import sheet from "./ItemPage.module.css";
import { cropArea, isWhole, Refusal, ready } from "./ItemPhotos";
import { type PreparedImage, prepareDocumentImage } from "./photoPrep";
import { queryKeys } from "./queries";
import { Dialog } from "./ui/Dialog";
import { Section } from "./ui/Section";

export const KIND_LABEL: Record<DocumentKind, string> = {
  receipt: "Receipt",
  warranty: "Warranty",
  manual: "Manual",
  other: "Other",
};

const KINDS = Object.keys(KIND_LABEL) as DocumentKind[];

/** Core's cap on a Document's file, image or PDF; checked here too, before a long upload. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export const TOO_LARGE =
  "This file is over 50 MB, the most the app keeps for a Document. A longer manual can go in the Item's Manual link instead.";

/** A row's words: its kind, then its name when it has one: "Receipt · IKEA receipt". */
export function documentLabel(document: Pick<Document, "kind" | "name">): string {
  const kind = KIND_LABEL[document.kind];
  return document.name ? `${kind} · ${document.name}` : kind;
}

/** A file's size as a person reads it: "820 KB", "31.4 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The name "Choose file" starts with: the file's own, without its extension. */
export function nameFromFile(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

const isPdf = (file: Blob & { name?: string }) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name ?? "");

/** After any Document write: the Item's page, which holds them and its history, and the log. */
function useDocumentWrite<Input>(
  home: string,
  item: string,
  write: (input: Input) => Promise<unknown>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () => {
      for (const queryKey of [queryKeys.item(home, item), queryKeys.changeLog(home)]) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

/** The Documents section when there are any, and "Add document" under it either way. */
export function ItemDocuments({
  home,
  item,
  documents,
}: {
  home: string;
  item: string;
  documents: Document[];
}) {
  const [open, setOpen] = useState<number>();
  const shown = documents.find((document) => document.id === open);
  return (
    <>
      {documents.length > 0 && (
        <Section title="Documents">
          <ul className={sheet.documents}>
            {documents.map((document) => (
              <li key={document.id}>
                <DocumentRow
                  home={home}
                  item={item}
                  document={document}
                  onOpen={() => setOpen(document.id)}
                />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <AddDocument home={home} item={item} />
      {shown && (
        <DocumentViewer
          home={home}
          item={item}
          document={shown}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

/** One Document: a link or a button that opens it, and its pencil; or, edited, its form. */
function DocumentRow({
  home,
  item,
  document,
  onOpen,
}: {
  home: string;
  item: string;
  document: Document;
  onOpen: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const label = documentLabel(document);
  if (editing) {
    return (
      <DocumentEdit home={home} item={item} document={document} onDone={() => setEditing(false)} />
    );
  }
  const pdf = document.type === "application/pdf";
  const content = (
    <>
      <DocumentIcon pdf={pdf} />
      <span className={sheet.documentLabel}>{label}</span>
    </>
  );
  return (
    <div className={sheet.documentRow}>
      {pdf ? (
        <a
          className={sheet.documentOpen}
          href={documentUrl(home, item, document)}
          target="_blank"
          rel="noopener"
        >
          {content}
        </a>
      ) : (
        <button type="button" className={sheet.documentOpen} onClick={onOpen}>
          {content}
        </button>
      )}
      <button
        type="button"
        className={`secondary ${sheet.pencil}`}
        aria-label={`Edit ${label}`}
        title="Edit its kind and name"
        onClick={() => setEditing(true)}
      >
        <span aria-hidden>✎</span>
      </button>
    </div>
  );
}

/** A page with a folded corner for a PDF; a framed picture for an image. */
function DocumentIcon({ pdf }: { pdf: boolean }) {
  return (
    <svg
      className={sheet.documentIcon}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {pdf ? (
        <>
          <path d="M6 3h8l4 4v14H6z" />
          <path d="M14 3v4h4M9 12h6M9 15.5h6M9 19h4" />
        </>
      ) : (
        <>
          <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17.5l5-4.5 4 3.5 3-2.5 4 3.5" />
        </>
      )}
    </svg>
  );
}

/** An image Document full size, with its kind and name. */
function DocumentViewer({
  home,
  item,
  document,
  onClose,
}: {
  home: string;
  item: string;
  document: Document;
  onClose: () => void;
}) {
  const label = documentLabel(document);
  return (
    <Dialog label={label} onClose={onClose} className={sheet.viewerDialog}>
      <div className={sheet.viewer}>
        <div className={sheet.viewerBar}>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <img className={sheet.viewerImage} src={documentUrl(home, item, document)} alt={label} />
        <div className={sheet.viewerDetails}>
          <p>{label}</p>
        </div>
      </div>
    </Dialog>
  );
}

/** The kind and name, the way they are set when adding: a choice, and one optional line. */
function KindAndName({
  id,
  kind,
  name,
  onKind,
  onName,
}: {
  id: string;
  kind: DocumentKind;
  name: string;
  onKind: (kind: DocumentKind) => void;
  onName: (name: string) => void;
}) {
  return (
    <>
      <label htmlFor={`${id}-kind`}>Kind</label>
      <select
        id={`${id}-kind`}
        value={kind}
        onChange={(event) => onKind(event.target.value as DocumentKind)}
      >
        {KINDS.map((each) => (
          <option key={each} value={each}>
            {KIND_LABEL[each]}
          </option>
        ))}
      </select>
      <label htmlFor={`${id}-name`}>Name (optional)</label>
      <input
        id={`${id}-name`}
        value={name}
        placeholder="IKEA receipt"
        onChange={(event) => onName(event.target.value)}
      />
    </>
  );
}

/** The pencil's form: kind and name, Save and Cancel, and delete, asked once in the page. */
function DocumentEdit({
  home,
  item,
  document,
  onDone,
}: {
  home: string;
  item: string;
  document: Document;
  onDone: () => void;
}) {
  const [kind, setKind] = useState(document.kind);
  const [name, setName] = useState(document.name ?? "");
  const [armed, setArmed] = useState(false);
  const id = useId();
  const save = useDocumentWrite(
    home,
    item,
    (change: { kind?: DocumentKind; name?: string | null }) =>
      call("edit_document", { home, item, document: document.id, ...change }),
  );
  const remove = useDocumentWrite(home, item, () =>
    call("delete_document", { home, item, document: document.id }),
  );
  const busy = save.isPending || remove.isPending;
  return (
    <form
      className={sheet.addForm}
      aria-label={`Edit ${documentLabel(document)}`}
      onSubmit={(event) => {
        event.preventDefault();
        const typed = name.trim();
        const change = {
          ...(kind !== document.kind ? { kind } : {}),
          ...(typed !== (document.name ?? "") ? { name: typed === "" ? null : typed } : {}),
        };
        if (Object.keys(change).length === 0) {
          onDone();
          return;
        }
        save.mutate(change, { onSuccess: onDone });
      }}
    >
      <KindAndName id={id} kind={kind} name={name} onKind={setKind} onName={setName} />
      <div className={styles.actions}>
        <button type="submit" disabled={busy}>
          Save
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={onDone}>
          Cancel
        </button>
        {!armed && (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setArmed(true)}
          >
            Delete
          </button>
        )}
      </div>
      <Refusal of={save} />
      {armed && (
        <div className={sheet.deleteConfirm}>
          <span className={sheet.deleteWarning}>Deletes this document for good.</span>
          <div className={styles.actions}>
            <button type="button" disabled={busy} onClick={() => remove.mutate(undefined)}>
              Delete it
            </button>
            <button type="button" className="secondary" onClick={() => setArmed(false)}>
              Keep it
            </button>
          </div>
          <Refusal of={remove} />
        </div>
      )}
    </form>
  );
}

/** An image made ready to send, and its preview when the browser could decode it. */
interface Ready {
  prepared: PreparedImage;
  preview?: string;
}

type Adding =
  | { step: "choosing" }
  | { step: "preparing" }
  | {
      step: "ready";
      picked: File;
      /** A PDF goes as it is: no preview, no crop. */
      pdf: boolean;
      /** The whole file, kept so the crop can be reopened from it. */
      whole: Ready;
      /** The image cut to the box last drawn, in percent of the whole, when one was. */
      cropped?: Ready & { crop: PercentCrop };
    }
  | { step: "failed"; message: string };

const PhotoCrop = lazy(() => import("./PhotoCrop"));

/**
 * "Add document" offers "Take photo", straight to a phone's camera for a paper receipt, and
 * "Choose file", for a PDF from the inbox or an image already on the phone. An image is shrunk
 * here and may be cropped; a PDF goes as it was picked. Then its kind, preset to Receipt, and
 * its name, which starts as the file's own for a chosen file and empty for a camera shot.
 */
export function AddDocument({ home, item }: { home: string; item: string }) {
  const camera = useRef<HTMLInputElement>(null);
  const chooser = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState<Adding>();
  const [cropping, setCropping] = useState<"open" | "cutting">();
  const [kind, setKind] = useState<DocumentKind>("receipt");
  const [name, setName] = useState("");
  const id = useId();
  const save = useDocumentWrite(home, item, (form: FormData) => upload("add_document", form));
  const whole = adding?.step === "ready" ? adding.whole.preview : undefined;
  const cut = adding?.step === "ready" ? adding.cropped?.preview : undefined;
  useEffect(() => {
    if (whole) return () => URL.revokeObjectURL(whole);
  }, [whole]);
  useEffect(() => {
    if (cut) return () => URL.revokeObjectURL(cut);
  }, [cut]);

  const close = () => {
    setAdding(undefined);
    setCropping(undefined);
    setKind("receipt");
    setName("");
    save.reset();
  };

  async function onChoose(event: ChangeEvent<HTMLInputElement>, from: "camera" | "chooser") {
    const picked = event.target.files?.[0];
    // Cleared, so choosing the same file again still counts as a choice.
    event.target.value = "";
    if (!picked) return;
    setName(from === "chooser" ? nameFromFile(picked.name) : "");
    const pdf = isPdf(picked);
    if (pdf) {
      if (picked.size > MAX_DOCUMENT_BYTES) {
        setAdding({ step: "failed", message: TOO_LARGE });
        return;
      }
      setAdding({ step: "ready", picked, pdf, whole: { prepared: { file: picked } } });
      return;
    }
    setAdding({ step: "preparing" });
    try {
      const prepared = await prepareDocumentImage(picked);
      if (prepared.file.size > MAX_DOCUMENT_BYTES) {
        setAdding({ step: "failed", message: TOO_LARGE });
        return;
      }
      setAdding({ step: "ready", picked, pdf, whole: ready(picked, prepared) });
    } catch (error) {
      fail(error);
    }
  }

  /** The whole image cut to the box drawn over it; a box around all of it is no crop. */
  async function onCropped(
    picked: File,
    size: { width: number; height: number },
    crop: PercentCrop,
  ) {
    if (isWhole(crop)) {
      setAdding((current) =>
        current?.step === "ready" ? { ...current, cropped: undefined } : current,
      );
      setCropping(undefined);
      return;
    }
    setCropping("cutting");
    try {
      const prepared = await prepareDocumentImage(picked, cropArea(crop, size));
      setAdding((current) =>
        current?.step === "ready"
          ? { ...current, cropped: { ...ready(picked, prepared), crop } }
          : current,
      );
    } catch (error) {
      fail(error);
    }
    setCropping(undefined);
  }

  function fail(error: unknown) {
    setAdding({
      step: "failed",
      message: error instanceof Error ? error.message : "The file could not be read.",
    });
  }

  function send(picked: File, file: Blob) {
    const form = new FormData();
    form.set("home", home);
    form.set("item", item);
    form.set("kind", kind);
    form.set("file", file, file === picked ? picked.name : "document.jpg");
    if (name.trim()) form.set("name", name.trim());
    save.mutate(form, { onSuccess: close });
  }

  const shown = adding?.step === "ready" ? (adding.cropped ?? adding.whole) : undefined;
  const sending = shown?.prepared.file;
  return (
    <div className={sheet.addPhoto}>
      {adding === undefined && (
        <div className={styles.actions}>
          <button
            type="button"
            className="secondary"
            onClick={() => setAdding({ step: "choosing" })}
          >
            Add document
          </button>
        </div>
      )}
      {(adding?.step === "choosing" || adding?.step === "failed") && (
        <div className={styles.actions}>
          <button type="button" className="secondary" onClick={() => camera.current?.click()}>
            Take photo
          </button>
          <button type="button" className="secondary" onClick={() => chooser.current?.click()}>
            Choose file
          </button>
          <button type="button" className="secondary" onClick={close}>
            Cancel
          </button>
        </div>
      )}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className={sheet.chooser}
        onChange={(event) => void onChoose(event, "camera")}
        aria-label="Document from the camera"
        tabIndex={-1}
      />
      <input
        ref={chooser}
        type="file"
        accept="application/pdf,image/*"
        className={sheet.chooser}
        onChange={(event) => void onChoose(event, "chooser")}
        aria-label="Document file"
        tabIndex={-1}
      />
      {adding?.step === "preparing" && (
        <p role="status" className={styles.muted}>
          Preparing the image…
        </p>
      )}
      {adding?.step === "failed" && (
        <p role="alert" className={styles.error}>
          {adding.message}
        </p>
      )}
      {adding?.step === "ready" && cropping === "open" && adding.whole.preview && (
        <Suspense
          fallback={
            <p role="status" className={styles.muted}>
              Opening the crop…
            </p>
          }
        >
          <PhotoCrop
            src={adding.whole.preview}
            {...(adding.cropped ? { initial: adding.cropped.crop } : {})}
            onDone={(crop) => {
              const { size } = adding.whole.prepared;
              if (size) void onCropped(adding.picked, size, crop);
            }}
            onCancel={() => setCropping(undefined)}
          />
        </Suspense>
      )}
      {adding?.step === "ready" && shown && sending && cropping !== "open" && (
        <form
          className={sheet.addForm}
          aria-label="Add a document"
          onSubmit={(event) => {
            event.preventDefault();
            send(adding.picked, sending);
          }}
        >
          {shown.preview ? (
            <img className={sheet.preview} src={shown.preview} alt="Ready to add" />
          ) : (
            <p className={styles.muted}>
              {adding.picked.name} · {fileSize(adding.picked.size)}
            </p>
          )}
          {/* A PDF, or an image that could not be decoded, goes as it is: nothing to cut. */}
          {adding.whole.preview && (
            <div className={styles.actions}>
              <button
                type="button"
                className="secondary"
                disabled={cropping === "cutting" || save.isPending}
                onClick={() => setCropping("open")}
              >
                Crop
              </button>
            </div>
          )}
          {cropping === "cutting" && (
            <p role="status" className={styles.muted}>
              Cropping the image…
            </p>
          )}
          <KindAndName id={id} kind={kind} name={name} onKind={setKind} onName={setName} />
          <div className={styles.actions}>
            <button type="submit" disabled={save.isPending || cropping === "cutting"}>
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={save.isPending || cropping === "cutting"}
              onClick={close}
            >
              Cancel
            </button>
          </div>
          {save.isPending && (
            <div role="status" className={sheet.sending}>
              <progress aria-label="Sending the document" />
              <span className={styles.muted}>Sending {fileSize(sending.size)}…</span>
            </div>
          )}
          <Refusal of={save} />
        </form>
      )}
    </div>
  );
}
