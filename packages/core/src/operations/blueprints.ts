import { basename, join } from "node:path";
import { CoreError } from "../errors.js";
import type { BlueprintDocument, RenderedImage } from "../files.js";
import { defineOperation, type OperationContext } from "../registry.js";
import { renderViewedPages } from "../render.js";
import { uniqueSlug } from "../slug.js";
import type { BlueprintPageRow, BlueprintRow } from "../store.js";
import { blueprintName, requireBlueprint, requirePage } from "./lookup.js";
import { toBlueprint, toBlueprintPage } from "./model.js";
import {
  type BlueprintFileType,
  type GetBlueprintPageResult,
  getBlueprintPageInput,
  type ListBlueprintsResult,
  listBlueprintsInput,
  PAGE_LONG_EDGE,
  type UploadBlueprintResult,
  uploadBlueprintInput,
  type ViewedPage,
  type ViewImagesResult,
  viewImagesInput,
} from "./schemas.js";
import { requireHome, requireSession } from "./scope.js";

/**
 * A page whose PNG is bigger than this goes to the Agent as a JPEG instead, which keeps six pages
 * far under the 16 MB limit on one tool result. That limit is Claude Code's streamable HTTP
 * transport, not tokens: a result over it fails as "session expired", however few tokens it is.
 */
export const JPEG_OVER_BYTES = 1024 * 1024;
const JPEG_QUALITY = 85;

const EXTENSIONS: Record<BlueprintFileType, string> = { pdf: "pdf", png: "png", jpeg: "jpg" };

export const uploadBlueprint = defineOperation({
  name: "upload_blueprint",
  description:
    "Adds a Blueprint to the Home from an uploaded PDF, PNG, or JPEG, sent as a multipart form. " +
    "Keeps a copy of the file in the data dir's uploads/, renders every page to a PNG 2000 px on " +
    "its long edge in rendered/, and stores each page's size and text layer. Refuses a file that " +
    "has no pages, or a page that can't be rendered, with no_pages, and any other kind of file, " +
    "HEIC included, with unsupported_file. An upload that fails leaves no file behind.",
  input: uploadBlueprintInput,
  readOnly: false,
  surface: "web",
  handler(context, input): UploadBlueprintResult {
    const { store, files } = context;
    const home = requireHome(context);
    const type = fileTypeOf(input.file, input.fileName);
    const doc = context.renderPdf.open(input.file, type);
    const label = input.label ?? stem(input.fileName);
    const slug = uniqueSlug(label, "blueprint", (taken) =>
      store.slugTaken("blueprints", taken, home.id),
    );
    // The slug is new, so its rendered/ folder and its upload belong to this upload alone: when a
    // page fails to render, a write fails, or the transaction does, both are removed again.
    const renderedDir = join("rendered", home.slug, slug);
    const filePath = join("uploads", home.slug, `${slug}.${EXTENSIONS[type]}`);
    const pages: Omit<BlueprintPageRow, "id" | "blueprintId">[] = [];
    try {
      for (let page = 1; page <= doc.pageCount; page++) {
        const { image, textLines } = renderUploadPage(input.fileName, page, () => ({
          image: doc.renderPage(page, { longEdge: PAGE_LONG_EDGE }),
          textLines: doc.textLines(page, PAGE_LONG_EDGE),
        }));
        const pngPath = join(renderedDir, `page-${page}.png`);
        files.writeBytes(join(context.dataDir(), pngPath), image.png);
        pages.push({
          homeId: home.id,
          page,
          levelId: null,
          pngPath,
          widthPx: image.width,
          heightPx: image.height,
          textLines,
        });
      }
      files.writeBytes(join(context.dataDir(), filePath), input.file);

      return context.write("web", (log) => {
        const blueprint = store.insert("blueprints", {
          homeId: home.id,
          slug,
          label,
          fileName: input.fileName,
          fileType: type,
          filePath,
          pageCount: pages.length,
          uploadedAt: context.now(),
        });
        log({
          home,
          recordKind: "blueprint",
          record: blueprint,
          new: { label, fileName: input.fileName, pageCount: pages.length },
        });
        const rows = pages.map((page) =>
          store.insert("blueprint_pages", { ...page, blueprintId: blueprint.id }),
        );
        return { blueprint: toBlueprint(store.levels(home.id), rows, blueprint) };
      });
    } catch (error) {
      files.remove(join(context.dataDir(), renderedDir));
      files.remove(join(context.dataDir(), filePath));
      throw error;
    } finally {
      doc.close();
    }
  },
});

/** One page of an upload, rendered; a page the renderer fails on refuses the upload with no_pages. */
function renderUploadPage<T>(fileName: string, page: number, render: () => T): T {
  try {
    return render();
  } catch (error) {
    if (error instanceof CoreError) throw error;
    const detail = error instanceof Error ? ` (${error.message})` : "";
    throw new CoreError(
      "no_pages",
      `Page ${page} of ${fileName} could not be rendered${detail}, so the Blueprint was not ` +
        "added. The file may be damaged: export or download it again, then upload the new copy.",
    );
  }
}

export const listBlueprints = defineOperation({
  name: "list_blueprints",
  description: "The Home's Blueprints, in the order they were uploaded, with their pages.",
  input: listBlueprintsInput,
  readOnly: true,
  surface: "web",
  handler(context): ListBlueprintsResult {
    const { store } = context;
    const home = requireHome(context);
    const levels = store.levels(home.id);
    const pages = store.list("blueprint_pages", home.id);
    return {
      blueprints: store
        .list("blueprints", home.id)
        .map((blueprint) => toBlueprint(levels, pages, blueprint)),
    };
  },
});

export const getBlueprintPage = defineOperation({
  name: "get_blueprint_page",
  description:
    "One page of a Blueprint as the PNG rendered on upload, served by GET " +
    "/api/get_blueprint_page?home=<slug>&blueprint=<slug>&page=<number>.",
  input: getBlueprintPageInput,
  readOnly: true,
  surface: "web",
  handler(context, input): GetBlueprintPageResult {
    const { store } = context;
    const home = requireHome(context);
    const blueprint = requireBlueprint(store.list("blueprints", home.id), input.blueprint);
    const page = requirePage(store.list("blueprint_pages", home.id), blueprint, input.page);
    return { mimeType: "image/png", data: pagePng(context, blueprint, page) };
  },
});

export const viewImages = defineOperation({
  name: "view_images",
  description:
    "Shows pages of one of this Home's Blueprints (the user's plans, uploaded in the app) as " +
    "images, so you can read them: first a text block naming the Blueprint and each page " +
    "returned, with the Level it shows when mapped and whether it has a text layer, then one " +
    "image per page, 2000 px on its long edge, in that order. The Home Overview lists the " +
    "Blueprints and their pages. At most 6 pages per call: ask for one Level's pages at a time, " +
    "and call again for more. When printed text is too small to read, ask for the page again " +
    "with `crop`: one quarter of it at twice the scale. Only text printed on the plan (Room " +
    "names, dimension strings, areas) is Blueprint Provenance: record such a length with " +
    "provenance blueprint and source { blueprint, page, printed }, `printed` exactly as printed " +
    "on the page (e.g. 12'6\" or 3.62). A length scaled off the drawing is estimated. Each page " +
    "stays in the conversation as an image, so fetch only the pages the work needs. Changes " +
    "nothing.",
  input: viewImagesInput,
  readOnly: true,
  surface: "agent",
  handler(context, input): ViewImagesResult {
    const { store } = context;
    const home = requireHome(context);
    requireSession(context, home, { open: false });
    const levels = store.levels(home.id);
    const pages = store.list("blueprint_pages", home.id);
    const blueprint = requireBlueprint(store.list("blueprints", home.id), input.blueprint);
    const rows = [...new Set(input.pages)].map((page) => requirePage(pages, blueprint, page));
    const { crop } = input;
    const images: RenderedImage[] = crop
      ? withDocument(context, blueprint, (doc) =>
          rows.map((row) => doc.renderPage(row.page, { longEdge: PAGE_LONG_EDGE, crop })),
        )
      : rows.map((row) => ({
          png: pagePng(context, blueprint, row),
          width: row.widthPx,
          height: row.heightPx,
        }));
    return {
      blueprint: toBlueprint(levels, pages, blueprint),
      pages: rows.map((row, index): ViewedPage => {
        const image = images[index] as RenderedImage;
        const jpeg = image.png.length > JPEG_OVER_BYTES;
        return {
          ...toBlueprintPage(levels, row),
          ...(crop ? { crop } : {}),
          width: image.width,
          height: image.height,
          mimeType: jpeg ? "image/jpeg" : "image/png",
          data: jpeg ? context.renderPdf.jpeg(image.png, JPEG_QUALITY) : image.png,
        };
      }),
    };
  },
  text: renderViewedPages,
  images: ({ pages }) => pages.map(({ data, mimeType }) => ({ data, mimeType })),
});

/** A page's rendered PNG. rendered/ is a cache: a missing page is rendered again and kept. */
function pagePng(
  context: OperationContext,
  blueprint: BlueprintRow,
  page: BlueprintPageRow,
): Uint8Array {
  const path = join(context.dataDir(), page.pngPath);
  const cached = context.files.readBytes(path);
  if (cached) return cached;
  const png = withDocument(
    context,
    blueprint,
    (doc) => doc.renderPage(page.page, { longEdge: PAGE_LONG_EDGE }).png,
  );
  context.files.writeBytes(path, png);
  return png;
}

/** Opens the Blueprint's uploaded file for `use`, and closes it again. */
function withDocument<T>(
  context: OperationContext,
  blueprint: BlueprintRow,
  use: (doc: BlueprintDocument) => T,
): T {
  const bytes = context.files.readBytes(join(context.dataDir(), blueprint.filePath));
  if (!bytes) {
    throw new CoreError(
      "not_found",
      `The file of ${blueprintName(blueprint)} is missing from the app's data folder ` +
        `(${blueprint.filePath}). Ask the user to upload it again in the app.`,
    );
  }
  const doc = context.renderPdf.open(bytes, blueprint.fileType);
  try {
    return use(doc);
  } finally {
    doc.close();
  }
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);

/** What a file is, from its first bytes rather than its name. */
function fileTypeOf(bytes: Uint8Array, fileName: string): BlueprintFileType {
  if (bytes.length === 0) {
    throw new CoreError("no_pages", `${fileName} is empty, so it has no pages to show.`);
  }
  if (startsWith(bytes, PNG_SIGNATURE)) return "png";
  if (startsWith(bytes, JPEG_SIGNATURE)) return "jpeg";
  // A PDF may have a few bytes of junk before its header.
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (head.includes("%PDF-")) return "pdf";
  const heif = head.slice(4, 8) === "ftyp" && HEIF_BRANDS.has(head.slice(8, 12));
  if (heif || /\.hei[cf]$/i.test(fileName)) {
    throw new CoreError(
      "unsupported_file",
      `${fileName} is a HEIC image, which the app can't read yet. Export it as a JPEG (most ` +
        "photo apps can), or upload the plan as a PDF.",
    );
  }
  throw new CoreError(
    "unsupported_file",
    `${fileName} is not a PDF, PNG, or JPEG, so it can't be a Blueprint. Save the plan as one ` +
      "of those, then upload it.",
  );
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The file's name without its folder or extension, as a label. */
function stem(fileName: string): string {
  const name = basename(fileName);
  return (name.replace(/\.[^.]+$/, "") || name).slice(0, 100);
}
