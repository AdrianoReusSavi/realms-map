import type { AssetPack, RgbaImage } from "./asset-pack.js";
import { type Rgb, TopView, TOP_VIEW_SIZE } from "./top-view.js";

interface Canvas {
  fill(x0: number, z0: number, x1: number, z1: number, color: Rgb | ImageRegion, height?: number): void;
  dot(x: number, z: number, color: Rgb, height?: number): void;
}

interface ImageRegion {
  image: RgbaImage;
  u0: number; v0: number; u1: number; v1: number;
}

type Painter = (canvas: Canvas, context: PainterContext) => Promise<void> | void;

interface PainterContext {
  name: string;
  state: Readonly<Record<string, string>>;
  assets: AssetPack;
  particle: () => Promise<RgbaImage | null>;
}

const WOOD: Rgb = [109, 85, 50];
const NO_TOP_VIEW = new Set(["air", "cave_air", "void_air", "light", "barrier", "structure_void", "moving_piston"]);

const HEAD_COLORS: Record<string, Rgb> = {
  skeleton: [196, 196, 190],
  wither_skeleton: [46, 46, 46],
  zombie: [70, 120, 55],
  creeper: [95, 165, 80],
  piglin: [220, 150, 140],
  dragon: [28, 28, 32],
  player: [110, 80, 55],
};

const PAINTERS: { matches: (name: string) => boolean; paint: Painter }[] = [
  { matches: (name) => /(^|_)chest$/.test(name), paint: paintChest },
  { matches: (name) => /(^|_)shulker_box$/.test(name), paint: paintShulkerBox },
  { matches: (name) => name.endsWith("_wall_banner"), paint: paintWallBanner },
  { matches: (name) => name.endsWith("_banner"), paint: paintBanner },
  { matches: (name) => /_wall_(head|skull)$/.test(name), paint: (canvas, context) => paintHead(canvas, context, true) },
  { matches: (name) => /_(head|skull)$/.test(name), paint: (canvas, context) => paintHead(canvas, context, false) },
  { matches: (name) => name === "decorated_pot", paint: async (canvas, { particle }) => paintParticle(canvas, await particle(), 1, 15) },
  { matches: (name) => name === "conduit", paint: async (canvas, { particle }) => paintParticle(canvas, await particle(), 5, 11) },
  { matches: (name) => name.endsWith("copper_golem_statue"), paint: async (canvas, { particle }) => paintParticle(canvas, await particle(), 4, 12) },
];

export async function paintEntityBlock(
  assets: AssetPack,
  name: string,
  state: Readonly<Record<string, string>>,
  particleTexture: string | undefined,
  tint: Rgb | undefined,
): Promise<TopView> {
  const view = new TopView();

  if (NO_TOP_VIEW.has(name)) return view;

  const turns = facingTurns(state.facing);
  const canvas = createCanvas(view, turns, tint);
  const particle = async () => particleTexture ? assets.image(`textures/${particleTexture}.png`) : null;
  const painter = PAINTERS.find((candidate) => candidate.matches(name));

  if (painter) await painter.paint(canvas, { name, state, assets, particle });
  else paintParticle(canvas, await particle(), 0, 16);

  return view;
}

async function paintChest(canvas: Canvas, { name, state, assets }: PainterContext): Promise<void> {
  const type = state.type === "left" || state.type === "right" ? state.type : "single";
  const image = await assets.image(`textures/entity/chest/${chestTexture(name)}${type === "single" ? "" : `_${type}`}.png`);

  if (!image) return;

  const lid: ImageRegion = type === "single"
    ? { image, u0: 28, v0: 0, u1: 42, v1: 14 }
    : { image, u0: 29, v0: 0, u1: 44, v1: 14 };
  const [x0, x1] = type === "left" ? [0, 15] : type === "right" ? [1, 16] : [1, 15];
  const latchX = type === "left" ? 0 : type === "right" ? 15 : 7;
  const latch = sampleAt(image, 1, 1);

  canvas.fill(x0, 1, x1, 15, lid, 14);
  canvas.fill(latchX, 15, latchX + (type === "single" ? 2 : 1), 16, latch, 14);
}

function chestTexture(name: string): string {
  const base = name.replace(/^waxed_/, "");

  if (base === "trapped_chest") return "trapped";
  if (base === "ender_chest") return "ender";
  if (base === "copper_chest") return "copper";

  const copper = /^(exposed|weathered|oxidized)_copper_chest$/.exec(base);

  return copper ? `copper_${copper[1]}` : "normal";
}

async function paintShulkerBox(canvas: Canvas, { name, assets }: PainterContext): Promise<void> {
  const color = name === "shulker_box" ? "" : `_${name.replace(/_shulker_box$/, "")}`;
  const image = await assets.image(`textures/entity/shulker/shulker${color}.png`);

  if (image) canvas.fill(0, 0, 16, 16, { image, u0: 16, v0: 0, u1: 32, v1: 16 }, 16);
}

async function paintBanner(canvas: Canvas, { name, state, assets }: PainterContext): Promise<void> {
  const cloth = await woolColor(assets, name.replace(/_banner$/, ""));
  const angle = Number(state.rotation ?? 0) * Math.PI / 8;
  const [dx, dz] = [Math.cos(angle), Math.sin(angle)];

  for (let step = -7; step <= 7; step += 0.5) {
    canvas.dot(8 + dx * step, 8 + dz * step, cloth, 16);
    canvas.dot(8 + dx * step - dz, 8 + dz * step + dx, cloth, 16);
  }

  canvas.fill(7, 7, 9, 9, WOOD, 16);
}

async function paintWallBanner(canvas: Canvas, { name, assets }: PainterContext): Promise<void> {
  canvas.fill(0, 0, 16, 2, await woolColor(assets, name.replace(/_wall_banner$/, "")), 16);
  canvas.fill(0, 0, 1, 2, WOOD, 16);
  canvas.fill(15, 0, 16, 2, WOOD, 16);
}

function paintHead(canvas: Canvas, { name }: PainterContext, wall: boolean): void {
  const mob = name.replace(/_wall_(head|skull)$|_(head|skull)$/, "");
  const color = HEAD_COLORS[mob] ?? HEAD_COLORS.player;
  const edge: Rgb = [color[0] * 0.6, color[1] * 0.6, color[2] * 0.6];
  const [z0, z1] = wall ? [0, 8] : [4, 12];

  canvas.fill(4, z0, 12, z1, edge, 8);
  canvas.fill(5, z0 + 1, 11, z1 - 1, color, 8);
}

function paintParticle(canvas: Canvas, image: RgbaImage | null, from: number, to: number): void {
  if (image) canvas.fill(from, from, to, to, { image, u0: 0, v0: 0, u1: 64, v1: 64 }, 16);
}

async function woolColor(assets: AssetPack, color: string): Promise<Rgb> {
  const image = await assets.image(`textures/block/${color}_wool.png`);

  if (!image) return [200, 200, 200];

  const sum = [0, 0, 0];

  for (let i = 0; i < image.data.length; i += 4) {
    sum[0] += image.data[i]; sum[1] += image.data[i + 1]; sum[2] += image.data[i + 2];
  }

  const pixels = image.data.length / 4;

  return [sum[0] / pixels, sum[1] / pixels, sum[2] / pixels];
}

function sampleAt(image: RgbaImage, u: number, v: number): Rgb {
  const offset = (Math.floor(v / 64 * image.height) * image.width + Math.floor(u / 64 * image.width)) * 4;

  return [image.data[offset], image.data[offset + 1], image.data[offset + 2]];
}

function facingTurns(facing: string | undefined): number {
  switch (facing) {
    case "west": return 1;
    case "north": return 2;
    case "east": return 3;
    default: return 0;
  }
}

function createCanvas(view: TopView, turns: number, tint: Rgb | undefined): Canvas {
  const put = (x: number, z: number, rgba: ArrayLike<number>, height: number) => {
    let [px, pz] = [Math.floor(x), Math.floor(z)];

    for (let i = 0; i < turns; i++) [px, pz] = [TOP_VIEW_SIZE - 1 - pz, px];

    const color = tint
      ? [rgba[0] * tint[0] / 255, rgba[1] * tint[1] / 255, rgba[2] * tint[2] / 255, rgba[3]]
      : rgba;

    view.plot(px, pz, height, color);
  };

  return {
    fill(x0, z0, x1, z1, color, height = 16) {
      for (let z = z0; z < z1; z++) {
        for (let x = x0; x < x1; x++) {
          if (!("image" in color)) {
            put(x, z, [color[0], color[1], color[2], 255], height);
            continue;
          }

          const { image, u0, v0, u1, v1 } = color;
          const u = u0 + (u1 - u0) * (x - x0 + 0.5) / (x1 - x0);
          const v = v0 + (v1 - v0) * (z - z0 + 0.5) / (z1 - z0);
          const offset = (Math.floor(v / 64 * image.height) * image.width + Math.floor(u / 64 * image.width)) * 4;

          put(x, z, image.data.subarray(offset, offset + 4), height);
        }
      }
    },
    dot(x, z, color, height = 16) {
      put(x, z, [color[0], color[1], color[2], 255], height);
    },
  };
}