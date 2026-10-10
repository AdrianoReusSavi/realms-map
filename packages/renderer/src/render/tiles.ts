import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  options?: { tileSize?: number; background?: [number, number, number] },
): Promise<PyramidResult> {
  const tileSize = options?.tileSize ?? DEFAULT_TILE_SIZE;
  const background = options?.background ?? [0, 0, 0];
  const { widthBlocks, heightBlocks } = bounds;
  const maxZoom = computeMaxZoom(widthBlocks, heightBlocks, tileSize);
  const canvasSize = tileSize * 2 ** maxZoom;
  const tilesPath = join(outputPath, "tiles");

  const source = sharp(Buffer.from(worldImage), {
    raw: { width: widthBlocks, height: heightBlocks, channels: 4 },
  });

  for (let z = 0; z <= maxZoom; z++) {
    const tilesPerSide = 2 ** z;
    const scaledW = Math.max(1, Math.round(widthBlocks * 2 ** (z - maxZoom)));
    const scaledH = Math.max(1, Math.round(heightBlocks * 2 ** (z - maxZoom)));

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

  return { minZoom: 0, maxZoom, tileSize, tilesPath, canvasSize };
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