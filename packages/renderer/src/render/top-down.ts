import type { BlockColorResolver } from "../palette/color-resolver.js";
import {
  type RegionGrid,
  type RenderStrategy,
  REGION_SIZE,
  RGBA_CHANNELS,
  regionCellIndex,
} from "./strategy.js";

export class TopDownStrategy implements RenderStrategy {
  private readonly background: [number, number, number];

  constructor(background: [number, number, number] = [0, 0, 0]) {
    this.background = background;
  }

  renderRegion(grid: RegionGrid, resolver: BlockColorResolver): Uint8Array {
    const buf = new Uint8Array(REGION_SIZE * REGION_SIZE * RGBA_CHANNELS);
    const heights = new Int32Array(REGION_SIZE * REGION_SIZE);

    for (let i = 0; i < grid.columns.length; i++) {
      const top = grid.columns[i];
      heights[i] = top === null ? -1 : top.y;
    }

    for (let z = 0; z < REGION_SIZE; z++) {
      for (let x = 0; x < REGION_SIZE; x++) {
        const i = regionCellIndex(x, z);
        const top = grid.columns[i];
        const out = i * RGBA_CHANNELS;

        if (top === null) {
          buf[out] = this.background[0];
          buf[out + 1] = this.background[1];
          buf[out + 2] = this.background[2];
          buf[out + 3] = 255;
          continue;
        }

        const [r, g, b] = resolver.resolve(top.blockName);
        const shade = hillshade(heights, x, z);
        buf[out] = clamp(r * shade);
        buf[out + 1] = clamp(g * shade);
        buf[out + 2] = clamp(b * shade);
        buf[out + 3] = 255;
      }
    }

    return buf;
  }
}

const HILLSCALE = 0.15;
const SHADE_MIN = 0.45;
const SHADE_MAX = 1.45;

function hillshade(heights: Int32Array, x: number, z: number): number {
  const i = regionCellIndex(x, z);
  const h = heights[i];
  const xEast = x < REGION_SIZE - 1 ? regionCellIndex(x + 1, z) : i;
  const zSouth = z < REGION_SIZE - 1 ? regionCellIndex(x, z + 1) : i;
  const dx = (heights[xEast] - h) * HILLSCALE;
  const dz = (heights[zSouth] - h) * HILLSCALE;
  const shade = 1 - (dx + dz);
  
  if (shade < SHADE_MIN) return SHADE_MIN;
  if (shade > SHADE_MAX) return SHADE_MAX;
  
  return shade;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}