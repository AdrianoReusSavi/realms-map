import { AnvilRegion } from "../../../core/src/anvil/index.js";
import { Chunk } from "../../../core/src/world/index.js";

export interface ParsedChunk {
  cx: number;
  cz: number;
  root: Chunk;
}

export class RegionFile {
  private constructor(private readonly region: AnvilRegion) {}

  get regionX(): number { return this.region.x; }
  get regionZ(): number { return this.region.z; }

  static async open(path: string, regionX: number, regionZ: number): Promise<RegionFile> {
    return new RegionFile(await AnvilRegion.read(path, regionX, regionZ));
  }

  hasChunk(localX: number, localZ: number): boolean {
    return this.region.getChunkLocation(localX + localZ * 32) !== null;
  }

  async readChunk(localX: number, localZ: number): Promise<Chunk | null> {
    if (!Number.isInteger(localX) || localX < 0 || localX > 31 || !Number.isInteger(localZ) || localZ < 0 || localZ > 31) {
      throw new Error(`Invalid local chunk coordinates: (${localX}, ${localZ}).`);
    }
    
    return this.region.readChunkAt(this.regionX * 32 + localX, this.regionZ * 32 + localZ);
  }

  async *iterChunks(): AsyncIterableIterator<ParsedChunk> {
    for (let localZ = 0; localZ < 32; localZ++) {
      for (let localX = 0; localX < 32; localX++) {
        const chunk = await this.readChunk(localX, localZ);
        
        if (chunk) yield { cx: chunk.x, cz: chunk.z, root: chunk };
      }
    }
  }
}