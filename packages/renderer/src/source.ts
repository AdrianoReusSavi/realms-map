import { readdir, access } from "node:fs/promises";
import { join } from "node:path";
import { NbtFile } from "../../core/src/nbt/index.js";

export type Dimension = "overworld" | "nether" | "end";

export interface WorldMeta {
  name: string;
  dimensions: Dimension[];
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
  const name = await readLevelName(worldPath);
  const dimensions = await detectDimensions(worldPath);

  return { name, dimensions };
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

async function readLevelName(worldPath: string): Promise<string> {
  try {
    const root = await NbtFile.read(join(worldPath, "level.dat"));
    const data = root.Data;

    if (typeof data !== "object" || data === null || ArrayBuffer.isView(data) || Array.isArray(data)) return worldPath;

    const name = (data as Record<string, unknown>).LevelName;

    return typeof name === "string" ? name : worldPath;
  } catch {
    return worldPath;
  }
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