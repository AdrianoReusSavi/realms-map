import { parentPort } from "node:worker_threads";
import { deflateSync } from "node:zlib";
import { RegionFile } from "../anvil/region-reader.js";
import { readChunkColumns, type ColumnTop } from "../anvil/chunk.js";
import { TopDownStrategy } from "./top-down.js";
import { type RegionGrid, REGION_SIZE, regionCellIndex } from "./strategy.js";
import { defaultResolver } from "../palette/color-resolver.js";
import type { RegionRef } from "../source.js";
import { encodeRegionBlocks, type EncodedRegionBlocks } from "./block-data.js";

export interface WorkerRequest {
  regions: RegionRef[];
  background: [number, number, number];
}

export interface WorkerResult extends EncodedRegionBlocks {
  buffer: Uint8Array;
}

async function buildRegionGrid(region: RegionFile): Promise<RegionGrid> {
  const columns: (ColumnTop | null)[] = new Array(REGION_SIZE * REGION_SIZE).fill(null);
  
  for await (const chunk of region.iterChunks()) {
    const { cx, cz, columns: chunkCols } = readChunkColumns(chunk.root, chunk.cx, chunk.cz);
    const localX = cx - region.regionX * 32;
    const localZ = cz - region.regionZ * 32;

    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        columns[regionCellIndex(localX * 16 + x, localZ * 16 + z)] = chunkCols[x + z * 16];
      }
    }
  }

  return { regionX: region.regionX, regionZ: region.regionZ, columns };
}

async function processRegions(req: WorkerRequest): Promise<WorkerResult[]> {
  const strategy = new TopDownStrategy(req.background);
  const results: WorkerResult[] = [];
  
  for (const ref of req.regions) {
    const region = await RegionFile.open(ref.path, ref.regionX, ref.regionZ);
    const grid = await buildRegionGrid(region);
    const buffer = strategy.renderRegion(grid, defaultResolver);
    const blockInfo = encodeRegionBlocks(grid);
    
    results.push({ ...blockInfo, data: deflateSync(blockInfo.data), buffer });
  }
  
  return results;
}

parentPort?.on("message", async (req: WorkerRequest) => {
  const results = await processRegions(req);
  
  for (const r of results) {
    parentPort?.postMessage(r, [r.buffer.buffer as ArrayBuffer, r.data.buffer as ArrayBuffer]);
  }
  
  parentPort?.postMessage({ done: true });
});