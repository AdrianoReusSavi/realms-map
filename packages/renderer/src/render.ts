import { Worker } from "node:worker_threads";
import { cpus } from "node:os";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { REGION_SIZE } from "./render/strategy.js";
import { buildTilePyramid, type WorldBounds, DEFAULT_TILE_SIZE } from "./render/tiles.js";
import { writeViewer } from "./render/viewer.js";
import { renderRegions, resolverFor, type RegionJob, type RegionResult } from "./render/region-job.js";
import { BlockTextures } from "./assets/block-textures.js";
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

    const textures = await loadBlockTextures(handle.meta.gameVersion);
    const profile = await textures?.profile();
    const resolver = resolverFor(profile);
    const seeThrough = new Set(profile?.seeThrough);
    const regionBuffers = await renderRegionsParallel({ regions, background: bgRgb, profile });

    await mkdir(join(opts.outputPath, "blocks"), { recursive: true });

    const viewerRegions = [];

    for (const { regionX, regionZ, buffer, data, palette } of regionBuffers) {
      copyRegionIntoWorld(buffer, worldImage, (regionX - minRX) * REGION_SIZE, (regionZ - minRZ) * REGION_SIZE, worldW);

      const dataPath = `blocks/r.${regionX}.${regionZ}.bin`;

      await writeFile(join(opts.outputPath, dataPath), data);
      viewerRegions.push({ regionX, regionZ, dataPath, palette });
    }

    const textureSamples = textures
      ? await textures.samples(
        regionBuffers.flatMap((region) => region.palette),
        (id) => seeThrough.has(id) ? undefined : resolver.resolve(id),
      )
      : new Map<string, Buffer>();

    if (textures) console.log(`Loaded ${textureSamples.size} block textures from Minecraft ${handle.meta.gameVersion}.`);

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
      resolver,
      coverage: profile?.coverage,
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

async function loadBlockTextures(gameVersion: string | undefined): Promise<BlockTextures | null> {
  if (!gameVersion) {
    warn("The world does not record its Minecraft version; rendering without textures.");
    return null;
  }

  try {
    return await BlockTextures.load(gameVersion);
  } catch (error) {
    warn(`Could not load Minecraft ${gameVersion} textures; rendering without them. ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function warn(message: string): void {
  console.warn(process.env.GITHUB_ACTIONS === "true" ? `::warning::${message}` : message);
}

async function renderRegionsParallel(job: RegionJob): Promise<RegionResult[]> {
  const { regions } = job;
  const workerCount = Math.min(cpus().length, regions.length, 8);
  const results: RegionResult[] = [];

  if (workerCount <= 1) {
    await renderRegions(job, (result) => results.push(result));
    return results;
  }

  const batches: RegionRef[][] = Array.from({ length: workerCount }, () => []);
  regions.forEach((r, i) => batches[i % workerCount].push(r));

  const workerUrl = new URL("./render/worker.js", import.meta.url);

  await Promise.all(
    batches.map(
      (batch) =>
        new Promise<void>((resolve, reject) => {
          const worker = new Worker(workerUrl);

          worker.on("message", (msg: RegionResult & { done?: boolean }) => {
            if (msg.done) {
              worker.terminate();
              resolve();
            } else {
              results.push({ regionX: msg.regionX, regionZ: msg.regionZ, buffer: msg.buffer, data: msg.data, palette: msg.palette });
            }
          });

          worker.on("error", reject);
          worker.postMessage({ ...job, regions: batch } satisfies RegionJob);
        }),
    ),
  );

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