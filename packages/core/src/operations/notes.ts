import { defineOperation } from "../registry.js";
import { renderNotes } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { NoteRow } from "../store.js";
import { active } from "./lookup.js";
import { toNote } from "./model.js";
import {
  type ListNotesResult,
  listNotesInput,
  type ReceiptResult,
  type SearchNotesResult,
  saveNoteInput,
  searchNotesInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";
import { Writer } from "./writer.js";

export const saveNote = defineOperation({
  name: "save_note",
  description:
    "Records one Note and returns a receipt. A Note is a free-form fact about the Home or the " +
    'people living in it that fits no other record: "the cat scratches fabric furniture", "we ' +
    'might get a dog", "the landlord is relaxed about small nails". It is background context: ' +
    "it can support a Decision but never changes one on its own, and it is not in the Home " +
    "Overview (search_notes finds it). A fact the user wants every Skill to obey is a " +
    "Constraint instead, added with set_constraints once the user agrees. Needs the open " +
    "Session's id as `session`.",
  input: saveNoteInput,
  readOnly: false,
  surface: "agent",
  handler(context, input): ReceiptResult {
    const { store } = context;
    const home = requireHome(context);
    const session = requireSession(context, home, { open: true });
    const receipt = context.write(session.slug, (log) => {
      const writer = new Writer(context, home, log, undefined);
      const slug = uniqueSlug(input.text, "note", (taken) =>
        store.slugTaken("notes", taken, home.id),
      );
      writer.create(
        "notes",
        "note",
        { homeId: home.id, slug, text: input.text, createdAt: context.now(), archivedAt: null },
        { text: input.text },
      );
      writer.line(`Note (${slug})`, `saved: ${input.text}`);
      return writer.receipt();
    });
    return { receipt };
  },
  text: ({ receipt }) => receipt,
});

export const searchNotes = defineOperation({
  name: "search_notes",
  description:
    "Finds the Notes about this Home that contain any of the words in `query`, those matching " +
    "the most words first, one line each with the day it was written. Without a query it lists " +
    "every Note, newest first. Notes are background context: they can support a Decision but " +
    "never change one on their own. Changes nothing.",
  input: searchNotesInput,
  readOnly: true,
  surface: "agent",
  handler(context, input): SearchNotesResult {
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    const notes = newestFirst(context.store.list("notes", home.id));
    const words = input.query === undefined ? [] : tokens(input.query);
    if (words.length === 0) return { notes: notes.map(toNote) };
    const scored = notes
      .map((note) => {
        const text = new Set(tokens(note.text));
        return { note, score: words.filter((word) => text.has(word)).length };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    return { notes: scored.map(({ note }) => toNote(note)) };
  },
  text: ({ notes }) => renderNotes(notes),
});

export const listNotes = defineOperation({
  name: "list_notes",
  description: "The Home's Notes, newest first.",
  input: listNotesInput,
  readOnly: true,
  surface: "web",
  handler(context): ListNotesResult {
    const home = requireHome(context);
    return { notes: newestFirst(context.store.list("notes", home.id)).map(toNote) };
  },
});

function newestFirst(notes: NoteRow[]): NoteRow[] {
  return notes.filter(active).sort((a, b) => b.id - a.id);
}

/** Lowercase words without accents, so "Café" finds "cafe". */
function tokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1);
}
