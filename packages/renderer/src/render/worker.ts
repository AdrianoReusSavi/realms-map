import { parentPort } from "node:worker_threads";
import { renderRegions, type RegionJob } from "./region-job.js";

parentPort?.on("message", async (job: RegionJob) => {
  await renderRegions(job, (result) => {
    parentPort?.postMessage(result, [result.buffer.buffer as ArrayBuffer, result.data.buffer as ArrayBuffer]);
  });

  parentPort?.postMessage({ done: true });
});