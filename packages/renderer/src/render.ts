import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RegionFile } from "./anvil/region-reader.js";
import { readChunkColumns, type ColumnTop } from "./anvil/chunk.js";
import { TopDownStrategy } from "./render/top-down.js";
import { type RegionGrid, REGION_SIZE, regionCellIndex } from "./render/strategy.js";
import { buildTilePyramid, type WorldBounds, DEFAULT_TILE_SIZE } from "./render/tiles.js";
import { writeViewer } from "./render/viewer.js";
import { encodeRegionBlocks, type EncodedRegionBlocks } from "./render/block-data.js";
import { defaultResolver } from "./palette/color-resolver.js";
import { loadSurfaceTextureSamples } from "./render/texture-assets.js";
import {
  listRegionFiles,
  type MapSource,
  type Dimension,
  type RegionRef,
} from "./source.js";

export interface RenderOptions {
  outputPath: string;
  dimension?: Dimension;
  zoomIn?: number;
  background?: string;
  tileSize?: number;
  githubUrl?: string;
}

export interface RenderResult {
  tilesPath: string;
  minZoom: number;
  maxZoom: number;
  widthBlocks: number;
  heightBlocks: number;
}

export async function renderMap(
  source: MapSource,
  opts: RenderOptions,
): Promise<RenderResult> {
  const handle = await source.acquire();

  try {
    const dimension = opts.dimension ?? "overworld";
    const bgHex = opts.background ?? "#000000";
    const bgRgb = hexToRgb(bgHex);
    const regions = await listRegionFiles(handle.worldPath, dimension);

    if (regions.length === 0) {
      throw new Error(`No region files found for dimension ${dimension} in ${handle.worldPath}`);
    }

    const xs = regions.map((r) => r.regionX);
    const zs = regions.map((r) => r.regionZ);
    const minRX = Math.min(...xs);
    const maxRX = Math.max(...xs);
    const minRZ = Math.min(...zs);
    const maxRZ = Math.max(...zs);
    const worldW = (maxRX - minRX + 1) * REGION_SIZE;
    const worldH = (maxRZ - minRZ + 1) * REGION_SIZE;
    const worldImage = new Uint8Array(worldW * worldH * 4);

    for (let i = 0; i < worldW * worldH; i++) {
      worldImage[i * 4] = bgRgb[0];
      worldImage[i * 4 + 1] = bgRgb[1];
      worldImage[i * 4 + 2] = bgRgb[2];
      worldImage[i * 4 + 3] = 255;
    }

    const regionBuffers = await renderRegionsParallel(regions, bgRgb);

    await mkdir(join(opts.outputPath, "blocks"), { recursive: true });

    const viewerRegions = [];

    for (const { regionX, regionZ, buffer, data, palette } of regionBuffers) {
      copyRegionIntoWorld(buffer, worldImage, (regionX - minRX) * REGION_SIZE, (regionZ - minRZ) * REGION_SIZE, worldW);

      const dataPath = `blocks/r.${regionX}.${regionZ}.bin`;

      await writeFile(join(opts.outputPath, dataPath), data);
      viewerRegions.push({ regionX, regionZ, dataPath, palette });
    }

    const textureSamples = await loadSurfaceTextureSamples(
      handle.meta.gameVersion,
      regionBuffers.flatMap((region) => region.palette),
    );

    const bounds: WorldBounds = {
      minBlockX: minRX * REGION_SIZE,
      minBlockZ: minRZ * REGION_SIZE,
      widthBlocks: worldW,
      heightBlocks: worldH,
    };
    const pyramid = await buildTilePyramid(worldImage, bounds, opts.outputPath, {
      tileSize: opts.tileSize ?? DEFAULT_TILE_SIZE,
      background: bgRgb,
      regionBlocks: regionBuffers,
      textures: textureSamples,
    });

    await writeViewer({
      worldName: handle.meta.name,
      sourceName: source.name,
      widthBlocks: worldW,
      heightBlocks: worldH,
      minZoom: pyramid.minZoom,
      maxNativeZoom: pyramid.maxZoom,
      baseZoom: pyramid.baseZoom,
      zoomIn: opts.zoomIn ?? 4,
      tileSize: pyramid.tileSize,
      background: bgHex,
      outputPath: opts.outputPath,
      githubUrl: opts.githubUrl,
      minBlockX: bounds.minBlockX,
      minBlockZ: bounds.minBlockZ,
      regions: viewerRegions,
    });

    return {
      tilesPath: pyramid.tilesPath,
      minZoom: pyramid.minZoom,
      maxZoom: pyramid.maxZoom,
      widthBlocks: worldW,
      heightBlocks: worldH,
    };
  } finally {
    await source.release();
  }
}

interface RegionBuffer extends EncodedRegionBlocks {
  buffer: Uint8Array;
}

async function renderRegionsParallel(
  regions: RegionRef[],
  background: [number, number, number],
): Promise<RegionBuffer[]> {
  const workerCount = Math.min(cpus().length, regions.length, 8);

  if (workerCount <= 1 || regions.length <= 1) {
    return renderRegionsSequential(regions, background);
  }

  const batches: RegionRef[][] = Array.from({ length: workerCount }, () => []);
  regions.forEach((r, i) => batches[i % workerCount].push(r));

  const workerUrl = new URL("./render/worker.js", import.meta.url);
  const results: RegionBuffer[] = [];

  await Promise.all(
    batches.map(
      (batch) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(workerUrl);

          worker.on("message", (msg: RegionBuffer & { done?: boolean }) => {
            if (msg.done) {
              worker.terminate();
              resolve();
            } else {
              results.push({ regionX: msg.regionX, regionZ: msg.regionZ, buffer: msg.buffer, data: msg.data, palette: msg.palette });
            }
          });

          worker.on("error", reject);
          worker.postMessage({ regions: batch, background });
        }),
    ),
  );

  return results;
}

async function renderRegionsSequential(
  regions: RegionRef[],
  background: [number, number, number],
): Promise<RegionBuffer[]> {
  const strategy = new TopDownStrategy(background);
  const results: RegionBuffer[] = [];

  for (const ref of regions) {
    const region = await RegionFile.open(ref.path, ref.regionX, ref.regionZ);
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

    const grid: RegionGrid = { regionX: ref.regionX, regionZ: ref.regionZ, columns };
    const buffer = strategy.renderRegion(grid, defaultResolver);
    const blockInfo = encodeRegionBlocks(grid);

    results.push({ ...blockInfo, data: deflateSync(blockInfo.data), buffer });
  }

  return results;
}

function copyRegionIntoWorld(
  regionImage: Uint8Array,
  worldImage: Uint8Array,
  offX: number,
  offZ: number,
  worldW: number,
): void {
  for (let z = 0; z < REGION_SIZE; z++) {
    for (let x = 0; x < REGION_SIZE; x++) {
      const src = (z * REGION_SIZE + x) * 4;
      const dst = ((offZ + z) * worldW + (offX + x)) * 4;

      worldImage[dst] = regionImage[src];
      worldImage[dst + 1] = regionImage[src + 1];
      worldImage[dst + 2] = regionImage[src + 2];
      worldImage[dst + 3] = regionImage[src + 3];
    }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);

  if (!m) return [0, 0, 0];

  const n = parseInt(m[1], 16);

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}