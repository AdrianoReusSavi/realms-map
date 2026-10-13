import type { BlockColorResolver, Rgb } from "../palette/color-resolver.js";
import {
  type RegionGrid,
  type RenderStrategy,
  REGION_SIZE,
  RGBA_CHANNELS,
  regionCellIndex,
} from "./strategy.js";

export class TopDownStrategy implements RenderStrategy {
  private readonly background: [number, number, number];
  private readonly coverage: Readonly<Record<string, number>>;

  constructor(background: [number, number, number] = [0, 0, 0], coverage: Readonly<Record<string, number>> = {}) {
    this.background = background;
    this.coverage = coverage;
  }

  renderRegion(grid: RegionGrid, resolver: BlockColorResolver): Uint8Array {
    const buf = new Uint8Array(REGION_SIZE * REGION_SIZE * RGBA_CHANNELS);
    const heights = new Int32Array(REGION_SIZE * REGION_SIZE);

    for (let i = 0; i < grid.columns.length; i++) {
      const top = grid.columns[i];
      heights[i] = top === null ? -1 : top.ground?.y ?? top.underwater?.y ?? top.y;
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

        const ground = surfaceColor(resolver, this.coverage, top.underwater?.blockName ?? top.blockName, top.ground?.blockName);
        const waterDepth = top.ground ? top.y - top.ground.y : top.underwater?.depth ?? 0;
        const [r, g, b] = top.underwater ? blendWater(ground, waterDepth) : ground;
        const shade = hillshade(heights, x, z) * castShadow(heights, x, z);
        buf[out] = clamp(r * shade);
        buf[out + 1] = clamp(g * shade);
        buf[out + 2] = clamp(b * shade);
        buf[out + 3] = 255;
      }
    }

    return buf;
  }
}

export function surfaceColor(
  resolver: BlockColorResolver,
  coverage: Readonly<Record<string, number>>,
  visible: string,
  ground: string | undefined,
): Rgb {
  const top = resolver.resolve(visible);

  if (!ground) return top;

  const below = resolver.resolve(ground);
  const amount = coverage[visible] ?? 0;

  return [
    below[0] + (top[0] - below[0]) * amount,
    below[1] + (top[1] - below[1]) * amount,
    below[2] + (top[2] - below[2]) * amount,
  ];
}

const VERTICAL_EXAGGERATION = 1.25;
const AMBIENT_LIGHT = 0.68;
const DIRECT_LIGHT = 0.32;
const SHADE_MIN = 0.55;
const SHADE_MAX = 1.25;
const LIGHT_AZIMUTH = (315 * Math.PI) / 180;
const LIGHT_ALTITUDE = Math.PI / 4;
const WATER_COLOR: readonly [number, number, number] = [54, 112, 170];

function blendWater(ground: readonly [number, number, number], depth: number): [number, number, number] {
  const opacity = Math.min(0.65, 0.45 + Math.max(0, depth - 1) * 0.02);
  return [
    ground[0] * (1 - opacity) + WATER_COLOR[0] * opacity,
    ground[1] * (1 - opacity) + WATER_COLOR[1] * opacity,
    ground[2] * (1 - opacity) + WATER_COLOR[2] * opacity,
  ];
}

function castShadow(heights: Int32Array, x: number, z: number): number {
  const groundHeight = heights[regionCellIndex(x, z)];
  if (groundHeight < 0) return 1;

  let occlusion = 0;
  for (let distance = 1; distance <= 14; distance++) {
    const sourceX = x - distance;
    const sourceZ = z - distance;
    if (sourceX < 0 || sourceZ < 0) break;

    const sourceHeight = heights[regionCellIndex(sourceX, sourceZ)];
    if (sourceHeight < 0) continue;

    const rise = sourceHeight - groundHeight - distance * Math.SQRT2 * Math.tan(LIGHT_ALTITUDE);
    if (rise <= 0) continue;

    const strength = Math.min(0.5, (rise / 10) * (1 - distance / 18));
    occlusion = Math.max(occlusion, strength);
  }

  return 1 - occlusion;
}

function hillshade(heights: Int32Array, x: number, z: number): number {
  const i = regionCellIndex(x, z);
  const h = heights[i];
  const west = sampleHeight(heights, x - 1, z, h);
  const east = sampleHeight(heights, x + 1, z, h);
  const north = sampleHeight(heights, x, z - 1, h);
  const south = sampleHeight(heights, x, z + 1, h);
  const dx = (east - west) * gradientScale(x);
  const dz = (south - north) * gradientScale(z);

  const nx = -dx * VERTICAL_EXAGGERATION;
  const nz = -dz * VERTICAL_EXAGGERATION;
  const normalLength = Math.sqrt(nx * nx + nz * nz + 1);
  const lx = Math.sin(LIGHT_AZIMUTH) * Math.cos(LIGHT_ALTITUDE);
  const lz = -Math.cos(LIGHT_AZIMUTH) * Math.cos(LIGHT_ALTITUDE);
  const ly = Math.sin(LIGHT_ALTITUDE);
  const illumination = (nx * lx + nz * lz + ly) / normalLength;
  const shade = AMBIENT_LIGHT + DIRECT_LIGHT * illumination / ly;

  if (shade < SHADE_MIN) return SHADE_MIN;
  if (shade > SHADE_MAX) return SHADE_MAX;

  return shade;
}

function sampleHeight(heights: Int32Array, x: number, z: number, fallback: number): number {
  const clampedX = Math.max(0, Math.min(REGION_SIZE - 1, x));
  const clampedZ = Math.max(0, Math.min(REGION_SIZE - 1, z));
  const height = heights[regionCellIndex(clampedX, clampedZ)];
  
  return height < 0 ? fallback : height;
}

function gradientScale(coordinate: number): number {
  return coordinate === 0 || coordinate === REGION_SIZE - 1 ? 1 : 0.5;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}