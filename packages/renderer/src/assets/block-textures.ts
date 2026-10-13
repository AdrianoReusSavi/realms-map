import { AssetPack } from "./asset-pack.js";
import { BlockModels, type PlacedModel } from "./block-model.js";
import { paintEntityBlock } from "./entity-blocks.js";
import { type Rgb, TopView, rasterizeTopView } from "./top-view.js";

export interface SurfaceProfile {
  coverage: Record<string, number>;
  seeThrough: string[];
  colors: Record<string, Rgb>;
}

const GRASS: Rgb = [145, 189, 89];
const FOLIAGE: Rgb = [119, 171, 47];
const WATER: Rgb = [63, 118, 228];
const TINTS: Record<string, Rgb> = {
  spruce_leaves: [97, 153, 97],
  birch_leaves: [128, 167, 85],
  mangrove_leaves: [141, 177, 39],
  lily_pad: [32, 128, 48],
  water: WATER,
  bubble_column: WATER,
  water_cauldron: WATER,
};

export class BlockTextures {
  private readonly models: BlockModels;
  private readonly views = new Map<string, Promise<TopView | null>>();

  private constructor(private readonly assets: AssetPack) {
    this.models = new BlockModels(assets);
  }

  static async load(gameVersion: string): Promise<BlockTextures> {
    return new BlockTextures(await AssetPack.forVersion(gameVersion));
  }

  static fromAssets(assets: AssetPack): BlockTextures {
    return new BlockTextures(assets);
  }

  async profile(): Promise<SurfaceProfile> {
    const profile: SurfaceProfile = { coverage: {}, seeThrough: [], colors: {} };

    for (const name of this.models.blockNames()) {
      const id = `minecraft:${name}`;
      const views = await Promise.all(this.models.allShapes(name).map((shape) => this.render(name, {}, shape)));
      const coverages = views.map((view) => view.coverage);

      if (!coverages.length) continue;

      const color = views[0].averageColor();

      profile.coverage[id] = coverages.reduce((sum, value) => sum + value, 0) / coverages.length;
      if (Math.min(...coverages) < 1) profile.seeThrough.push(id);
      if (color) profile.colors[id] = color;
    }

    return profile;
  }

  async samples(blockInfos: Iterable<string>, colorOf?: (id: string) => Rgb | undefined, size = 8): Promise<Map<string, Buffer>> {
    const samples = new Map<string, Buffer>();

    for (const info of new Set(blockInfos)) {
      const view = await this.topView(info);

      if (!view) continue;

      const sample = view.downsample(size);

      const target = colorOf?.(info.split(" ", 1)[0]);

      if (target) matchAverage(sample, target);
      samples.set(info, sample);
    }

    return samples;
  }

  topView(info: string): Promise<TopView | null> {
    let view = this.views.get(info);

    if (!view) {
      view = this.resolve(info);
      this.views.set(info, view);
    }

    return view;
  }

  private async resolve(info: string): Promise<TopView | null> {
    const { name, state } = parseBlockInfo(info);

    if (!name) return null;

    const placed = this.models.forState(name, state);

    return placed.length ? this.render(name, state, placed) : null;
  }

  private async render(name: string, state: Readonly<Record<string, string>>, placed: PlacedModel[]): Promise<TopView> {
    if (!placed.some(({ model }) => model.elements.length)) {
      const fluidTint = name === "water" || name === "bubble_column" ? WATER : undefined;

      return paintEntityBlock(this.assets, name, state, placed[0]?.model.textures.particle, fluidTint);
    }

    const view = await rasterizeTopView(this.assets, placed, () => tintFor(name, state));

    if (name.endsWith("_leaves")) fillGaps(view);

    return view;
  }
}

function tintFor(name: string, state: Readonly<Record<string, string>>): Rgb | undefined {
  if (name === "redstone_wire") {
    const power = Number(state.power ?? 0) / 15;

    return [
      Math.round(255 * (power * 0.6 + (power > 0 ? 0.4 : 0.3))),
      Math.round(255 * Math.max(0, power * power * 0.7 - 0.5)),
      Math.round(255 * Math.max(0, power * power * 0.6 - 0.7)),
    ];
  }

  if (TINTS[name]) return TINTS[name];
  if (/_stem$/.test(name)) return [224, 199, 28];
  if (/(_leaves|vine)$/.test(name)) return FOLIAGE;

  return GRASS;
}

function matchAverage(sample: Buffer, target: Rgb): void {
  const sum = [0, 0, 0];
  let weight = 0;

  for (let i = 0; i < sample.length; i += 4) {
    const alpha = sample[i + 3];

    sum[0] += sample[i] * alpha; sum[1] += sample[i + 1] * alpha; sum[2] += sample[i + 2] * alpha;
    weight += alpha;
  }

  if (!weight) return;

  const ratio = sum.map((total, c) => Math.min(4, Math.max(0.25, target[c] / Math.max(1, total / weight))));

  for (let i = 0; i < sample.length; i += 4) {
    if (!sample[i + 3]) continue;

    for (let c = 0; c < 3; c++) sample[i + c] = Math.min(255, Math.round(sample[i + c] * ratio[c]));
  }
}

function fillGaps(view: TopView): void {
  const color = view.averageColor();

  if (!color) return;

  const shade = color.map((channel) => Math.round(channel * 0.6));

  for (let i = 0; i < view.pixels.length; i += 4) {
    if (view.pixels[i + 3] === 0) view.pixels.set([shade[0], shade[1], shade[2], 255], i);
  }
}

export function parseBlockInfo(info: string): { name: string; state: Record<string, string> } {
  const space = info.indexOf(" ");
  const id = space < 0 ? info : info.slice(0, space);
  const [namespace, name] = id.includes(":") ? id.split(":", 2) : ["minecraft", id];
  let state: Record<string, string> = {};

  if (space >= 0) {
    try {
      state = JSON.parse(info.slice(space + 1)) as Record<string, string>;
    } catch {}
  }

  return { name: namespace === "minecraft" ? name : "", state };
}