import type { RegionGrid } from "./strategy.js";

export interface EncodedRegionBlocks {
  regionX: number;
  regionZ: number;
  palette: string[];
  data: Uint8Array;
}

export function encodeRegionBlocks(grid: RegionGrid): EncodedRegionBlocks {
  const palette: string[] = [];
  const indices = new Map<string, number>();
  const data = new Uint8Array(grid.columns.length * 4);
  const view = new DataView(data.buffer);

  for (let i = 0; i < grid.columns.length; i++) {
    const column = grid.columns[i];
    
    if (!column) {
      view.setUint16(i * 4, 0, true);
      view.setInt16(i * 4 + 2, -32768, true);
      
      continue;
    }

    const blockInfo = column.properties && Object.keys(column.properties).length > 0
      ? `${column.blockName} ${JSON.stringify(column.properties)}`
      : column.blockName;
    
    let index = indices.get(blockInfo);
    
    if (index === undefined) {
      index = palette.length + 1;
      palette.push(blockInfo);
      indices.set(blockInfo, index);
    }
    
    view.setUint16(i * 4, index, true);
    view.setInt16(i * 4 + 2, column.y, true);
  }

  return { regionX: grid.regionX, regionZ: grid.regionZ, palette, data };
}