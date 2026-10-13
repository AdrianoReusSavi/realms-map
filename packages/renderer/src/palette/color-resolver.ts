import rawPalette from "./block-colors.json" with { type: "json" };

export type Rgb = readonly [number, number, number];

const FALLBACK: Rgb = [128, 128, 128];
const AIR: Rgb = [0, 0, 0];

const palette = rawPalette as unknown as Record<string, [number, number, number]>;

const normalized = new Map<string, Rgb>();

for (const [key, value] of Object.entries(palette)) {
  normalized.set(normalizeName(key), value as Rgb);
}

function normalizeName(name: string): string {
  return name.startsWith("minecraft:") ? name : `minecraft:${name}`;
}

export class BlockColorResolver {
  private readonly overrides: Map<string, Rgb>;

  constructor(overrides?: Record<string, Rgb>) {
    this.overrides = new Map();

    if (overrides) {
      for (const [k, v] of Object.entries(overrides)) {
        this.overrides.set(normalizeName(k), v);
      }
    }
  }

  resolve(blockName: string): Rgb {
    const name = normalizeName(blockName);
    const override = this.overrides.get(name);

    if (override) return override;

    const known = normalized.get(name);

    if (known) return known;
    if (name === "minecraft:air") return AIR;

    return FALLBACK;
  }

  has(blockName: string): boolean {
    const name = normalizeName(blockName);

    return this.overrides.has(name) || normalized.has(name);
  }

  isAir(blockName: string): boolean {
    const name = normalizeName(blockName);
    
    return name === "minecraft:air" || name === "minecraft:cave_air" || name === "minecraft:void_air";
  }
}

export const defaultResolver = new BlockColorResolver();