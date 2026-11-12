// Where Blueprint renders run. mupdf is synchronous, and the cost of one page has no bound a cap
// can check beforehand: a one-page PDF of 2 KB whose page draws a form that draws itself 16 times,
// nested seven deep, held Node's one thread for 51 s, and every Home's requests with it. So each
// render runs in a worker thread of its own with a time limit, and a worker that overruns is
// terminated. The worker's WebAssembly memory goes with it, so a big scan's few hundred MB is
// given back too.
import { Worker } from "node:worker_threads";
import { CoreError, type CoreErrorCode } from "../errors.js";
import type { PdfRenderer } from "../files.js";
import { type RenderJob, type RenderResult, runJob } from "./render-jobs.js";

export interface RenderRunner {
  run<J extends RenderJob>(job: J): Promise<RenderResult<J>>;
}

/**
 * A render stopped at the time limit. `page` is the page it was drawing, when it had started
 * one. The operation that asked turns it into a refusal of its own.
 */
export class RenderTimedOut extends Error {
  readonly page: number | undefined;

  constructor(page: number | undefined) {
    super("The render took too long");
    this.page = page;
  }
}

/**
 * The longest one render may take. A floor-plan page draws in about 35 ms and a 30-page set in
 * about a second, so this is far past any honest file while bounding how long a hostile one holds
 * a worker.
 */
export const RENDER_TIME_LIMIT_MS = 30_000;

/**
 * Renders at once: each worker holds its own mupdf, a big scan a few hundred MB of it, so more
 * wait their turn rather than each taking memory. The wait is not counted against the limit.
 */
const MAX_WORKERS = 2;

/** Runs each job on this thread: for a renderer a test gives, which can't be sent to a worker. */
export function inProcessRunner(renderer: PdfRenderer): RenderRunner {
  return {
    run: async (job) => runJob(renderer, job),
  };
}

/** Runs each job against mupdf in a worker thread of its own, terminated at `timeLimitMs`. */
export function workerRunner({
  timeLimitMs = RENDER_TIME_LIMIT_MS,
}: {
  timeLimitMs?: number;
} = {}): RenderRunner {
  let running = 0;
  const waiting: (() => void)[] = [];

  async function slot<T>(use: () => Promise<T>): Promise<T> {
    if (running >= MAX_WORKERS) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await use();
    } finally {
      running--;
      waiting.shift()?.();
    }
  }

  return {
    run: (job) => slot(() => inWorker(job, timeLimitMs)),
  };
}

type WorkerMessage =
  | { starting: number }
  | { result: unknown }
  | { error: { code?: CoreErrorCode; message: string } };

function inWorker<J extends RenderJob>(job: J, timeLimitMs: number): Promise<RenderResult<J>> {
  return new Promise((resolve, reject) => {
    const worker = startWorker();
    let page: number | undefined;
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
      void worker.terminate();
    };
    const timer = setTimeout(() => settle(() => reject(new RenderTimedOut(page))), timeLimitMs);
    worker.on("message", (message: WorkerMessage) => {
      if ("starting" in message) page = message.starting;
      else if ("result" in message) settle(() => resolve(message.result as RenderResult<J>));
      else {
        const { code, message: text } = message.error;
        settle(() => reject(code ? new CoreError(code, text) : new Error(text)));
      }
    });
    worker.on("error", (error) => settle(() => reject(error)));
    worker.on("exit", (code) =>
      settle(() => reject(new Error(`The render worker stopped (exit code ${code})`))),
    );
    worker.postMessage(job);
  });
}

/**
 * The worker for one job. Built, the worker is render-worker.js beside this file. From source
 * (the tests, and `pnpm dev`), it is render-worker.ts, which Node runs by stripping its types; a
 * resolve hook lets its imports, written with .js as tsc wants, find the .ts files.
 */
function startWorker(): Worker {
  const fromSource = import.meta.url.endsWith(".ts");
  const entry = new URL(`./render-worker.${fromSource ? "ts" : "js"}`, import.meta.url);
  if (!fromSource) return new Worker(entry);
  return new Worker(
    `
    const { registerHooks } = require("node:module");
    registerHooks({
      resolve(specifier, context, next) {
        try {
          return next(specifier, context);
        } catch (error) {
          if (!/^\\.\\.?\\//.test(specifier) || !specifier.endsWith(".js")) throw error;
          return next(specifier.slice(0, -3) + ".ts", context);
        }
      },
    });
    import(${JSON.stringify(entry.href)});
    `,
    { eval: true },
  );
}
