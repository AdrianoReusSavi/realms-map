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
  const data = new Uint8Array(grid.columns.length * 12);
  const view = new DataView(data.buffer);

  for (let i = 0; i < grid.columns.length; i++) {
    const column = grid.columns[i];
    
    if (!column) {
      view.setUint16(i * 12, 0, true);
      view.setInt16(i * 12 + 2, -32768, true);
      view.setUint16(i * 12 + 4, 0, true);
      view.setInt16(i * 12 + 6, -32768, true);
      view.setUint16(i * 12 + 8, 0, true);
      view.setInt16(i * 12 + 10, -32768, true);
      
      continue;
    }

    const blockInfo = column.properties && Object.keys(column.properties).length > 0
      ? `${column.blockName} ${JSON.stringify(column.properties)}`
      : column.blockName;
    
    const index = paletteIndex(blockInfo, palette, indices);
    view.setUint16(i * 12, index, true);
    view.setInt16(i * 12 + 2, column.y, true);

    if (column.underwater) {
      const floorInfo = column.underwater.properties && Object.keys(column.underwater.properties).length > 0
        ? `${column.underwater.blockName} ${JSON.stringify(column.underwater.properties)}`
        : column.underwater.blockName;
      const floorIndex = paletteIndex(floorInfo, palette, indices);
      view.setUint16(i * 12 + 4, floorIndex, true);
      view.setInt16(i * 12 + 6, column.underwater.y, true);
    } else {
      view.setUint16(i * 12 + 4, 0, true);
      view.setInt16(i * 12 + 6, -32768, true);
    }

    if (column.ground) {
      const groundInfo = column.ground.properties && Object.keys(column.ground.properties).length > 0
        ? `${column.ground.blockName} ${JSON.stringify(column.ground.properties)}`
        : column.ground.blockName;
      const groundIndex = paletteIndex(groundInfo, palette, indices);
      view.setUint16(i * 12 + 8, groundIndex, true);
      view.setInt16(i * 12 + 10, column.ground.y, true);
    } else {
      view.setUint16(i * 12 + 8, 0, true);
      view.setInt16(i * 12 + 10, -32768, true);
    }
  }

  return { regionX: grid.regionX, regionZ: grid.regionZ, palette, data };
}

function paletteIndex(blockInfo: string, palette: string[], indices: Map<string, number>): number {
  let index = indices.get(blockInfo);
  if (index === undefined) {
    index = palette.length + 1;
    palette.push(blockInfo);
    indices.set(blockInfo, index);
  }
  return index;
}