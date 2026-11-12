// What a Blueprint render is asked to do, as plain data, so it can be posted to a worker thread
// (render-worker.ts) and run there against mupdf, or run in-process against a renderer a test
// gives. Nothing here imports mupdf.
import { CoreError } from "../errors.js";
import type { PdfRenderer, RenderedImage, TextLine } from "../files.js";
import type { BlueprintFileType, Quarter } from "../operations/schemas.js";

/** Every page of an upload, with its text layer, refusing a file of more than `maxPages`. */
export interface UploadJob {
  kind: "upload";
  bytes: Uint8Array;
  type: BlueprintFileType;
  fileName: string;
  longEdge: number;
  maxPages: number;
}

/** Some pages of a kept file, whole or one quarter of each. */
export interface PagesJob {
  kind: "pages";
  bytes: Uint8Array;
  type: BlueprintFileType;
  pages: number[];
  longEdge: number;
  crop?: Quarter;
}

export type RenderJob = UploadJob | PagesJob;

export interface UploadedPage {
  image: RenderedImage;
  textLines: TextLine[];
}

export type RenderResult<J extends RenderJob> = J extends UploadJob
  ? UploadedPage[]
  : RenderedImage[];

/**
 * Runs `job` against `renderer`, synchronously. `starting` hears each page number before it is
 * drawn, so a job stopped part way can say which page it was on.
 */
export function runJob<J extends RenderJob>(
  renderer: PdfRenderer,
  job: J,
  starting: (page: number) => void = () => {},
): RenderResult<J> {
  const doc = renderer.open(job.bytes, job.type);
  try {
    if (job.kind === "pages") {
      return job.pages.map((page) => {
        starting(page);
        return doc.renderPage(page, { longEdge: job.longEdge, crop: job.crop });
      }) as RenderResult<J>;
    }
    if (doc.pageCount > job.maxPages) {
      throw new CoreError(
        "validation",
        `${job.fileName} has ${doc.pageCount} pages, and a Blueprint can have at most ` +
          `${job.maxPages}. Upload the floor plans alone, or split the file into parts of ` +
          `${job.maxPages} pages or fewer.`,
      );
    }
    const pages: UploadedPage[] = [];
    for (let page = 1; page <= doc.pageCount; page++) {
      starting(page);
      pages.push(
        renderUploadPage(job.fileName, page, () => ({
          image: doc.renderPage(page, { longEdge: job.longEdge }),
          textLines: doc.textLines(page, job.longEdge),
        })),
      );
    }
    return pages as RenderResult<J>;
  } finally {
    doc.close();
  }
}

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
