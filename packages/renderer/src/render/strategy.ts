import type { ColumnTop } from "../anvil/chunk.js";
import type { BlockColorResolver } from "../palette/color-resolver.js";

export interface RegionGrid {
  regionX: number;
  regionZ: number;
  columns: (ColumnTop | null)[];
}

export interface RenderStrategy {
  renderRegion(grid: RegionGrid, resolver: BlockColorResolver): Uint8Array;
}

export const REGION_SIZE = 512;
export const RGBA_CHANNELS = 4;

export function regionCellIndex(blockX: number, blockZ: number): number {
  return blockX + blockZ * REGION_SIZE;
}

export function isAirColumn(top: ColumnTop | null): boolean {
  return top === null;
}