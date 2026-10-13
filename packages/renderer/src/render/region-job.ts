import { deflateSync } from "node:zlib";
import { RegionFile } from "../anvil/region-reader.js";
import { readChunkColumns, type ColumnTop } from "../anvil/chunk.js";
import { TopDownStrategy } from "./top-down.js";
import { type RegionGrid, REGION_SIZE, regionCellIndex } from "./strategy.js";
import { BlockColorResolver, defaultResolver } from "../palette/color-resolver.js";
import type { RegionRef } from "../source.js";
import { encodeRegionBlocks, type EncodedRegionBlocks } from "./block-data.js";
import type { SurfaceProfile } from "../assets/block-textures.js";

export interface RegionJob {
  regions: RegionRef[];
  background: [number, number, number];
  profile?: SurfaceProfile;
}

export interface RegionResult extends EncodedRegionBlocks {
  buffer: Uint8Array;
}

export async function renderRegions(job: RegionJob, onRegion: (result: RegionResult) => void): Promise<void> {
  const seeThrough = new Set(job.profile?.seeThrough);
  const isSeeThrough = (id: string) => seeThrough.has(id);
  const strategy = new TopDownStrategy(job.background, job.profile?.coverage);
  const resolver = resolverFor(job.profile);

  for (const ref of job.regions) {
    const region = await RegionFile.open(ref.path, ref.regionX, ref.regionZ);
    const grid = await buildRegionGrid(region, isSeeThrough);
    const buffer = strategy.renderRegion(grid, resolver);
    const blockInfo = encodeRegionBlocks(grid);

    onRegion({ ...blockInfo, data: deflateSync(blockInfo.data), buffer });
  }
}

export function resolverFor(profile: SurfaceProfile | undefined): BlockColorResolver {
  if (!profile) return defaultResolver;

  const seeThrough = new Set(profile.seeThrough);
  const fromTextures = Object.entries(profile.colors).filter(([id]) => seeThrough.has(id) || !defaultResolver.has(id));

  return new BlockColorResolver(Object.fromEntries(fromTextures));
}

async function buildRegionGrid(region: RegionFile, isSeeThrough: (id: string) => boolean): Promise<RegionGrid> {
  const columns: (ColumnTop | null)[] = new Array(REGION_SIZE * REGION_SIZE).fill(null);

  for await (const chunk of region.iterChunks()) {
    const { cx, cz, columns: chunkCols } = readChunkColumns(chunk.root, chunk.cx, chunk.cz, isSeeThrough);
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