import sharp from "sharp";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import type { EncodedRegionBlocks } from "./block-data.js";
import { defaultResolver } from "../palette/color-resolver.js";

export const DEFAULT_TILE_SIZE = 256;

export interface WorldBounds {
  minBlockX: number;
  minBlockZ: number;
  widthBlocks: number;
  heightBlocks: number;
}

export interface PyramidResult {
  minZoom: number;
  maxZoom: number;
  baseZoom: number;
  tileSize: number;
  tilesPath: string;
  canvasSize: number;
}

export function computeMaxZoom(widthBlocks: number, heightBlocks: number, tileSize: number): number {
  const longest = Math.max(widthBlocks, heightBlocks);
  
  if (longest <= tileSize) return 0;
  
  return Math.ceil(Math.log2(longest / tileSize));
}

export async function buildTilePyramid(
  worldImage: Uint8Array,
  bounds: WorldBounds,
  outputPath: string,
  options?: {
    tileSize?: number;
    background?: [number, number, number];
    regionBlocks?: EncodedRegionBlocks[];
    textures?: Map<string, Buffer>;
  },
): Promise<PyramidResult> {
  const tileSize = options?.tileSize ?? DEFAULT_TILE_SIZE;
  const background = options?.background ?? [0, 0, 0];
  const { widthBlocks, heightBlocks } = bounds;
  const baseZoom = computeMaxZoom(widthBlocks, heightBlocks, tileSize);
  const hasTextures = Boolean(options?.textures?.size && options.regionBlocks?.length);
  const maxZoom = baseZoom + (hasTextures ? 3 : 0);
  const canvasSize = tileSize * 2 ** maxZoom;
  const tilesPath = join(outputPath, "tiles");

  await rm(tilesPath, { recursive: true, force: true });

  const source = sharp(Buffer.from(worldImage), {
    raw: { width: widthBlocks, height: heightBlocks, channels: 4 },
  });

  for (let z = 0; z <= baseZoom; z++) {
    const tilesPerSide = 2 ** z;
    const scaledW = Math.max(1, Math.round(widthBlocks * 2 ** (z - baseZoom)));
    const scaledH = Math.max(1, Math.round(heightBlocks * 2 ** (z - baseZoom)));

    const resized = await source
      .resize(scaledW, scaledH, { kernel: sharp.kernel.lanczos3 })
      .raw()
      .toBuffer();

    for (let tx = 0; tx < tilesPerSide; tx++) {
      for (let ty = 0; ty < tilesPerSide; ty++) {
        const tile = await extractTile(
          resized,
          scaledW,
          scaledH,
          tx * tileSize,
          ty * tileSize,
          tileSize,
          background,
        );
        
        const dir = join(tilesPath, String(z), String(tx));
        
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${ty}.png`), tile);
      }
    }
  }

  if (hasTextures) {
    await writeNearestZoom(worldImage, bounds, tilesPath, tileSize, background, 1);
    await writeNearestZoom(worldImage, bounds, tilesPath, tileSize, background, 2);
    await writeTextureZoom(worldImage, bounds, tilesPath, tileSize, background, options!.regionBlocks!, options!.textures!);
  }

  return { minZoom: 0, maxZoom, baseZoom, tileSize, tilesPath, canvasSize };
}

async function writeNearestZoom(
  worldImage: Uint8Array,
  bounds: WorldBounds,
  tilesPath: string,
  tileSize: number,
  background: [number, number, number],
  extraZoom: number,
): Promise<void> {
  const scale = 2 ** extraZoom;
  const width = bounds.widthBlocks * scale;
  const height = bounds.heightBlocks * scale;
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);

  for (let tx = 0; tx < tilesX; tx++) {
    for (let ty = 0; ty < tilesY; ty++) {
      const data = Buffer.alloc(tileSize * tileSize * 4);
      
      fillBackground(data, tileSize, background);

      const blocksPerTile = tileSize / scale;

      for (let blockZ = 0; blockZ < blocksPerTile && ty * blocksPerTile + blockZ < bounds.heightBlocks; blockZ++) {
        for (let blockX = 0; blockX < blocksPerTile && tx * blocksPerTile + blockX < bounds.widthBlocks; blockX++) {
          const source = (ty * blocksPerTile + blockZ) * bounds.widthBlocks + tx * blocksPerTile + blockX;
          const color = source * 4;

          for (let dz = 0; dz < scale; dz++) {
            for (let dx = 0; dx < scale; dx++) {
              const destination = ((blockZ * scale + dz) * tileSize + blockX * scale + dx) * 4;

              data[destination] = worldImage[color];
              data[destination + 1] = worldImage[color + 1];
              data[destination + 2] = worldImage[color + 2];
              data[destination + 3] = 255;
            }
          }
        }
      }

      await writeTile(data, tileSize, tilesPath, getBaseZoom(bounds, tileSize) + extraZoom, tx, ty);
    }
  }
}

async function writeTextureZoom(
  worldImage: Uint8Array,
  bounds: WorldBounds,
  tilesPath: string,
  tileSize: number,
  background: [number, number, number],
  regions: EncodedRegionBlocks[],
  textures: Map<string, Buffer>,
): Promise<void> {
  const textureScale = 8;
  const width = bounds.widthBlocks * textureScale;
  const height = bounds.heightBlocks * textureScale;
  const tilesX = Math.ceil(width / tileSize);
  const tilesY = Math.ceil(height / tileSize);
  const regionMap = new Map(regions.map((region) => [`${region.regionX},${region.regionZ}`, {
    palette: region.palette,
    data: inflateSync(region.data),
  }]));
  const extraZoom = 3;

  for (let tx = 0; tx < tilesX; tx++) {
    for (let ty = 0; ty < tilesY; ty++) {
      const tile = Buffer.alloc(tileSize * tileSize * 4);

      fillBackground(tile, tileSize, background);

      const blocksPerTile = tileSize / textureScale;

      for (let tileBlockZ = 0; tileBlockZ < blocksPerTile && ty * blocksPerTile + tileBlockZ < bounds.heightBlocks; tileBlockZ++) {
        for (let tileBlockX = 0; tileBlockX < blocksPerTile && tx * blocksPerTile + tileBlockX < bounds.widthBlocks; tileBlockX++) {
          const blockX = tx * blocksPerTile + tileBlockX;
          const blockZ = ty * blocksPerTile + tileBlockZ;
          const absoluteX = bounds.minBlockX + blockX;
          const absoluteZ = bounds.minBlockZ + blockZ;
          const regionX = Math.floor(absoluteX / 512);
          const regionZ = Math.floor(absoluteZ / 512);
          const region = regionMap.get(`${regionX},${regionZ}`);

          if (!region) continue;

          const localX = absoluteX - regionX * 512;
          const localZ = absoluteZ - regionZ * 512;
          const offset = (localZ * 512 + localX) * 12;
          const topIndex = region.data.readUInt16LE(offset);

          if (!topIndex) continue;

          const floorIndex = region.data.readUInt16LE(offset + 4);
          const groundIndex = region.data.readUInt16LE(offset + 8);
          const topInfo = region.palette[topIndex - 1];
          const topName = topInfo?.split(" ", 1)[0] ?? "";
          const isWater = topName === "minecraft:water" || topName === "minecraft:bubble_column";
          const visibleInfo = isWater && floorIndex ? region.palette[floorIndex - 1] : topInfo;
          const baseInfo = groundIndex ? region.palette[groundIndex - 1] : visibleInfo;
          const baseTexture = textures.get(baseInfo);
          const overlayTexture = groundIndex ? textures.get(visibleInfo) : undefined;

          let opacity = 0;

          if (isWater && floorIndex) {
            const surfaceY = region.data.readInt16LE(offset + 2);
            const floorY = groundIndex ? region.data.readInt16LE(offset + 10) : region.data.readInt16LE(offset + 6);
            const depth = Math.max(1, surfaceY - floorY);
            opacity = Math.min(0.65, 0.45 + Math.max(0, depth - 1) * 0.02);
          }

          const worldOffset = (blockZ * bounds.widthBlocks + blockX) * 4;
          const baseName = baseInfo?.split(" ", 1)[0] ?? topName;
          const base = [...defaultResolver.resolve(baseName)];
          const shade = [0, 0, 0];

          if (opacity > 0) {
            base[0] = base[0] * (1 - opacity) + 54 * opacity;
            base[1] = base[1] * (1 - opacity) + 112 * opacity;
            base[2] = base[2] * (1 - opacity) + 170 * opacity;
          }

          for (let channel = 0; channel < 3; channel++) {
            shade[channel] = worldImage[worldOffset + channel] / Math.max(1, base[channel]);
          }

          for (let dz = 0; dz < textureScale; dz++) {
            for (let dx = 0; dx < textureScale; dx++) {
              const textureOffset = (dz * textureScale + dx) * 4;
              const destination = ((tileBlockZ * textureScale + dz) * tileSize + tileBlockX * textureScale + dx) * 4;
              let red = base[0];
              let green = base[1];
              let blue = base[2];

              if (baseTexture) {
                const alpha = baseTexture[textureOffset + 3] / 255;
                red = baseTexture[textureOffset] * alpha + red * (1 - alpha);
                green = baseTexture[textureOffset + 1] * alpha + green * (1 - alpha);
                blue = baseTexture[textureOffset + 2] * alpha + blue * (1 - alpha);
              }

              if (opacity > 0) {
                red = red * (1 - opacity) + 54 * opacity;
                green = green * (1 - opacity) + 112 * opacity;
                blue = blue * (1 - opacity) + 170 * opacity;
              }

              if (overlayTexture) {
                const alpha = overlayTexture[textureOffset + 3] / 255;
                const plantWaterOpacity = opacity * 0.2;
                const overlayRed = overlayTexture[textureOffset] * (1 - plantWaterOpacity) + 54 * plantWaterOpacity;
                const overlayGreen = overlayTexture[textureOffset + 1] * (1 - plantWaterOpacity) + 112 * plantWaterOpacity;
                const overlayBlue = overlayTexture[textureOffset + 2] * (1 - plantWaterOpacity) + 170 * plantWaterOpacity;
                red = overlayRed * alpha + red * (1 - alpha);
                green = overlayGreen * alpha + green * (1 - alpha);
                blue = overlayBlue * alpha + blue * (1 - alpha);
              }

              tile[destination] = Math.max(0, Math.min(255, Math.round(red * shade[0])));
              tile[destination + 1] = Math.max(0, Math.min(255, Math.round(green * shade[1])));
              tile[destination + 2] = Math.max(0, Math.min(255, Math.round(blue * shade[2])));
              tile[destination + 3] = 255;
            }
          }
        }
      }

      await writeTile(tile, tileSize, tilesPath, getBaseZoom(bounds, tileSize) + extraZoom, tx, ty);
    }
  }
}

function fillBackground(data: Buffer, tileSize: number, color: [number, number, number]): void {
  for (let i = 0; i < tileSize * tileSize; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = 255;
  }
}

async function writeTile(data: Buffer, tileSize: number, tilesPath: string, zoom: number, x: number, y: number): Promise<void> {
  const dir = join(tilesPath, String(zoom), String(x));

  await mkdir(dir, { recursive: true });

  const png = await sharp(data, { raw: { width: tileSize, height: tileSize, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();

  await writeFile(join(dir, `${y}.png`), png);
}

function getBaseZoom(bounds: WorldBounds, tileSize: number): number {
  return computeMaxZoom(bounds.widthBlocks, bounds.heightBlocks, tileSize);
}

function extractTile(
  resized: Buffer,
  worldW: number,
  worldH: number,
  startX: number,
  startY: number,
  tileSize: number,
  background: [number, number, number],
): Promise<Buffer> {
  const w = Math.min(tileSize, Math.max(0, worldW - startX));
  const h = Math.min(tileSize, Math.max(0, worldH - startY));
  const padded = Buffer.alloc(tileSize * tileSize * 4);
  
  for (let i = 0; i < tileSize * tileSize; i++) {
    padded[i * 4] = background[0];
    padded[i * 4 + 1] = background[1];
    padded[i * 4 + 2] = background[2];
    padded[i * 4 + 3] = 255;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const src = ((startY + y) * worldW + (startX + x)) * 4;
      const dst = (y * tileSize + x) * 4;
      padded[dst] = resized[src];
      padded[dst + 1] = resized[src + 1];
      padded[dst + 2] = resized[src + 2];
      padded[dst + 3] = resized[src + 3];
    }
  }

  return sharp(padded, { raw: { width: tileSize, height: tileSize, channels: 4 } })
    .png()
    .toBuffer();
}