// A worker thread's entry: takes one render job by message, runs it against mupdf, posts each page
// number as it starts it, then the result or the refusal. The runner (render-runner.ts) starts one
// worker per job and terminates it when it overruns, so no file can hold the server's own thread.
//
// The job arrives by message, not workerData, so that it runs in a message handler rather than in
// this module's top-level evaluation: Node 26 aborts the whole process (V8 "Check failed:
// !is_null()") when a worker is terminated while its ES module is still evaluating.
import { parentPort } from "node:worker_threads";
import { CoreError } from "../errors.js";
import { mupdfRenderer } from "./mupdf.js";
import { type RenderJob, runJob } from "./render-jobs.js";

const port = parentPort;
if (!port) throw new Error("render-worker runs only as a worker thread");

port.once("message", (job: RenderJob) => {
  try {
    const result = runJob(mupdfRenderer, job, (page) => port.postMessage({ starting: page }));
    port.postMessage({ result });
  } catch (error) {
    port.postMessage({
      error: {
        code: error instanceof CoreError ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  port.close();
});
