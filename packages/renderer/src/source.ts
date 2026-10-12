import { readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { NbtFile } from "../../core/src/nbt/index.js";

export type Dimension = "overworld" | "nether" | "end";

export interface WorldMeta {
  name: string;
  dimensions: Dimension[];
  gameVersion?: string;
}

export interface WorldHandle {
  worldPath: string;
  meta: WorldMeta;
}

export interface MapSource {
  readonly name: string;
  acquire(): Promise<WorldHandle>;
  release(): Promise<void>;
}

export interface RegionRef {
  regionX: number;
  regionZ: number;
  path: string;
}

function regionDirCandidates(worldPath: string, dimension: Dimension): string[] {
  const candidates: Record<Dimension, string[]> = {
    overworld: ["dimensions/minecraft/overworld/region", "region"],
    nether: ["dimensions/minecraft/the_nether/region", "DIM-1/region"],
    end: ["dimensions/minecraft/the_end/region", "DIM1/region"],
  };

  return candidates[dimension].map((rel) => join(worldPath, rel));
}

async function findRegionDir(worldPath: string, dimension: Dimension): Promise<string | null> {
  for (const candidate of regionDirCandidates(worldPath, dimension)) {
    try {
      await access(candidate);

      return candidate;
    } catch {}
  }

  return null;
}

export async function scanWorld(worldPath: string): Promise<WorldMeta> {
  const data = await readLevelData(worldPath);
  const name = data?.LevelName;
  const version = data?.Version;
  const dimensions = await detectDimensions(worldPath);
  const gameVersion = isCompound(version) && typeof version.Name === "string" ? version.Name : undefined;

  return { name: typeof name === "string" ? name : worldPath, dimensions, gameVersion };
}

export async function listRegionFiles(
  worldPath: string,
  dimension: Dimension,
): Promise<RegionRef[]> {
  const regionDir = await findRegionDir(worldPath, dimension);
  if (!regionDir) return [];

  let entries: string[];

  try {
    entries = await readdir(regionDir);
  } catch {
    return [];
  }

  const refs: RegionRef[] = [];

  for (const entry of entries) {
    const match = /^r\.(-?\d+)\.(-?\d+)\.mca$/.exec(entry);

    if (!match) continue;

    refs.push({
      regionX: parseInt(match[1], 10),
      regionZ: parseInt(match[2], 10),
      path: join(regionDir, entry),
    });
  }

  return refs;
}

async function readLevelData(worldPath: string): Promise<Record<string, unknown> | undefined> {
  try {
    const root = await NbtFile.read(join(worldPath, "level.dat"));
    const data = root.Data;

    if (!isCompound(data)) return undefined;
    return data;
  } catch {
    return undefined;
  }
}

function isCompound(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !ArrayBuffer.isView(value) && !Array.isArray(value);
}

async function detectDimensions(worldPath: string): Promise<Dimension[]> {
  const dims: Dimension[] = [];

  for (const dim of ["overworld", "nether", "end"] as Dimension[]) {
    if ((await findRegionDir(worldPath, dim)) !== null) {
      dims.push(dim);
    }
  }
  
  return dims;
}