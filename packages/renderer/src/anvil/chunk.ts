import { Chunk } from "../../../core/src/world/index.js";

export interface ColumnTop {
  blockName: string;
  y: number;
  properties?: Readonly<Record<string, string>>;
  underwater?: { blockName: string; y: number; depth: number; properties?: Readonly<Record<string, string>> };
  ground?: { blockName: string; y: number; properties?: Readonly<Record<string, string>> };
}

export interface ChunkColumns {
  cx: number;
  cz: number;
  columns: (ColumnTop | null)[];
}

export function readChunkColumns(chunk: Chunk, cx = chunk.x, cz = chunk.z): ChunkColumns {
  const columns: (ColumnTop | null)[] = new Array(256).fill(null);

  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      const { surface, underwater, ground } = chunk.getSurfaceColumn(x, z);

      if (surface) columns[x + z * 16] = {
        blockName: surface.state.id,
        y: surface.y,
        properties: surface.state.properties,
        ...(underwater ? {
          underwater: {
            blockName: underwater.state.id,
            y: underwater.y,
            depth: underwater.depth,
            properties: underwater.state.properties,
          },
        } : {}),
        ...(ground ? {
          ground: {
            blockName: ground.state.id,
            y: ground.y,
            properties: ground.state.properties,
          },
        } : {}),
      };
    }
  }
  
  return { cx, cz, columns };
}