import { Chunk } from "../../../core/src/world/index.js";

export interface ColumnTop {
  blockName: string;
  y: number;
  properties?: Readonly<Record<string, string>>;
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
      const top = chunk.getSurfaceBlock(x, z);

      if (top) columns[x + z * 16] = {
        blockName: top.state.id,
        y: top.y,
        properties: top.state.properties,
      };
    }
  }
  
  return { cx, cz, columns };
}