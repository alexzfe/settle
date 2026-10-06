import { join } from "node:path";
import { CoreError } from "../errors.js";
import {
  heicMessage,
  imageVersion,
  isHeif,
  isPdf,
  PHOTO_EXTENSIONS,
  sniffImageType,
} from "../images.js";
import { optional } from "../optional.js";
import { defineOperation, type OperationContext } from "../registry.js";
import type { DocumentRow, HomeRow, ItemRow } from "../store.js";
import { byKind } from "./model.js";
import { requireItem } from "./photos.js";
import {
  addDocumentInput,
  type DocumentsResult,
  type DocumentType,
  deleteDocumentInput,
  editDocumentInput,
  type GetDocumentResult,
  getDocumentInput,
  type ItemDocument,
} from "./schemas.js";
import { requireHome } from "./scope.js";

// Documents of an Item: the papers the user keeps with it, to prove the purchase (a receipt, a
// warranty, for a claim, a return, or insurance) or to read how to use the thing (a manual). Web
// writes only, like Photos: receipts come out of the user's inbox and wallet, not out of a chat.
// The Agent is told a Document exists, with its kind and name, in find_items; it never reads one.
//
// Core processes nothing: a PDF is stored as it came, and the browser has already shrunk an
// image, so each file is validated by its own bytes and kept under uploads/<home>/documents/.

/** The reason a write on the page carries: the user acting, as the Item page's pencil does. */
const WEB_EDIT = "edited by the user on the web";

/**
 * The most the app keeps for one Document, a PDF or an image alike. Manuals run 5-50 MB; some cap
 * must exist because the server holds the whole upload in memory.
 */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

/** The refusal of a file over the cap, which the server also answers with its 413. */
export const DOCUMENT_TOO_BIG =
  "That file is over 50 MB, the most the app keeps for a Document. A longer manual can go in " +
  "the Item's Manual link instead.";

const EXTENSIONS: Record<DocumentType, string> = { "application/pdf": "pdf", ...PHOTO_EXTENSIONS };

/** Uploaded Document bytes, validated by the bytes themselves: a PDF, JPEG, PNG, or WebP. */
export function uploadedDocument(file: Uint8Array): { bytes: Uint8Array; type: DocumentType } {
  if (file.length > MAX_DOCUMENT_BYTES) throw new CoreError("validation", DOCUMENT_TOO_BIG);
  const type = sniffImageType(file) ?? (isPdf(file) ? "application/pdf" : undefined);
  if (!type) {
    if (isHeif(file)) throw new CoreError("unsupported_file", heicMessage("That file"));
    throw new CoreError(
      "unsupported_file",
      "That file is not a PDF, JPEG, PNG, or WebP, whatever it is called. The app keeps " +
        "Documents as one of those.",
    );
  }
  return { bytes: file, type };
}

export const addDocument = defineOperation({
  name: "add_document",
  description:
    "Adds a Document to one Item, Archived ones too, as multipart/form-data: the file as `file` " +
    "(a PDF as it came, or a JPEG, PNG, or WebP), its `kind`, and an optional one-line `name`. " +
    "Answers the Item's Documents, by kind then oldest first.",
  input: addDocumentInput,
  readOnly: false,
  surface: "web",
  handler(context, input): DocumentsResult {
    const home = requireHome(context);
    const file = uploadedDocument(input.file);
    const name = input.name || null;
    const written: string[] = [];
    try {
      return context.write("web", (log) => {
        const item = requireItem(context, home, input.item);
        const row = context.store.insert("documents", {
          homeId: home.id,
          itemId: item.id,
          kind: input.kind,
          name,
          path: "",
          type: file.type,
          bytes: file.bytes.length,
          version: imageVersion(file.bytes),
          createdAt: context.now(),
        });
        // The file name is the row's id, so the path is filled in once there is one.
        const path = join("uploads", home.slug, "documents", `${row.id}.${EXTENSIONS[file.type]}`);
        written.push(path);
        context.files.writeBytes(join(context.dataDir(), path), file.bytes);
        context.store.update("documents", row.id, { path });
        log({
          home,
          recordKind: "item",
          record: item,
          field: "document",
          new: optional({ kind: input.kind, name }),
          reason: WEB_EDIT,
        });
        return { documents: documentsOf(context, home, item) };
      });
    } catch (error) {
      for (const path of written) context.files.remove(join(context.dataDir(), path));
      throw error;
    }
  },
});

export const editDocument = defineOperation({
  name: "edit_document",
  description:
    "Changes one Document's kind, its name, or both; a name of null or an empty string clears " +
    "it. Its file stays as it is. Answers the Item's Documents, by kind then oldest first.",
  input: editDocumentInput,
  readOnly: false,
  surface: "web",
  handler(context, input): DocumentsResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const item = requireItem(context, home, input.item);
      const document = requireDocument(context, home, item, input.document);
      const kind = input.kind ?? document.kind;
      const name = input.name === undefined ? document.name : input.name || null;
      if (kind !== document.kind || name !== document.name) {
        context.store.update("documents", document.id, { kind, name });
        log({
          home,
          recordKind: "item",
          record: item,
          field: "document",
          old: optional({ kind: document.kind, name: document.name }),
          new: optional({ kind, name }),
          reason: WEB_EDIT,
        });
      }
      return { documents: documentsOf(context, home, item) };
    });
  },
});

export const deleteDocument = defineOperation({
  name: "delete_document",
  description:
    "Deletes one Document outright, its row and its file: nothing refers to a Document. " +
    "Answers the Item's Documents that remain, by kind then oldest first.",
  input: deleteDocumentInput,
  readOnly: false,
  surface: "web",
  handler(context, input): DocumentsResult {
    const home = requireHome(context);
    return context.write("web", (log) => {
      const item = requireItem(context, home, input.item);
      const document = requireDocument(context, home, item, input.document);
      context.store.removeDocument(document.id);
      log({
        home,
        recordKind: "item",
        record: item,
        field: "document",
        old: optional({ kind: document.kind, name: document.name }),
        new: null,
        reason: WEB_EDIT,
      });
      // Last, so a failure above leaves the file with the row the rollback keeps.
      context.files.remove(join(context.dataDir(), document.path));
      return { documents: documentsOf(context, home, item) };
    });
  },
});

export const getDocument = defineOperation({
  name: "get_document",
  description:
    "One Document's stored bytes, with its type and the file name to offer, served by " +
    "GET /api/get_document?home=<slug>&item=<slug>&document=<id>&v=<version>.",
  input: getDocumentInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetDocumentResult {
    const home = requireHome(context);
    const item = requireItem(context, home, input.item);
    const document = requireDocument(context, home, item, input.document);
    const bytes = context.files.readBytes(join(context.dataDir(), document.path));
    if (!bytes) {
      throw new CoreError(
        "not_found",
        `The file of a Document of ${item.name} is missing from the app's data folder ` +
          `(${document.path}).`,
      );
    }
    return { mimeType: document.type, fileName: fileName(document), data: bytes };
  },
});

/** A Document as the web sees it. */
export function toDocument(row: DocumentRow): ItemDocument {
  return {
    id: row.id,
    kind: row.kind,
    ...optional({ name: row.name }),
    type: row.type,
    bytes: row.bytes,
    version: row.version,
  };
}

/**
 * `<name or kind>.<ext>`, for content-disposition's quoted filename: accents dropped to their
 * letters, then anything not printable ASCII, a quote, a backslash, or a slash taken out.
 */
function fileName(document: DocumentRow): string {
  const name = (document.name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7e]|["\\/]/g, "")
    .trim();
  return `${name || document.kind}.${EXTENSIONS[document.type]}`;
}

function documentsOf(context: OperationContext, home: HomeRow, item: ItemRow): ItemDocument[] {
  return byKind(
    context.store.list("documents", home.id).filter((each) => each.itemId === item.id),
  ).map(toDocument);
}

function requireDocument(
  context: OperationContext,
  home: HomeRow,
  item: ItemRow,
  id: number,
): DocumentRow {
  const document = context.store
    .list("documents", home.id)
    .find((each) => each.id === id && each.itemId === item.id);
  if (!document) throw new CoreError("not_found", `${item.name} has no Document ${id}.`);
  return document;
}
