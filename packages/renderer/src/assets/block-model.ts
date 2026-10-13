import type { AssetPack } from "./asset-pack.js";

export type Vec3 = [number, number, number];
export type FaceName = "up" | "down" | "north" | "south" | "east" | "west";

export interface ModelFace {
  texture: string;
  uv?: [number, number, number, number];
  rotation?: number;
  tintindex?: number;
}

export interface ModelElement {
  from: Vec3;
  to: Vec3;
  rotation?: {
    origin: Vec3;
    axis?: "x" | "y" | "z";
    angle?: number;
    rescale?: boolean;
    x?: number;
    y?: number;
    z?: number;
  };
  faces: Partial<Record<FaceName, ModelFace>>;
}

export interface BlockModel {
  name: string;
  textures: Record<string, string>;
  elements: ModelElement[];
}

export interface PlacedModel {
  model: BlockModel;
  x: number;
  y: number;
}

interface ModelReference {
  model: string;
  x?: number;
  y?: number;
}

interface RawModel {
  parent?: string;
  textures?: Record<string, string | { sprite?: string }>;
  elements?: ModelElement[];
}

type Condition = Record<string, unknown> & { OR?: Condition[]; AND?: Condition[] };

interface BlockStateFile {
  variants?: Record<string, ModelReference | ModelReference[]>;
  multipart?: { when?: Condition; apply: ModelReference | ModelReference[] }[];
}

export class BlockModels {
  private readonly models = new Map<string, BlockModel | null>();

  constructor(private readonly assets: AssetPack) {}

  blockNames(): string[] {
    return this.assets.list("blockstates");
  }

  forState(name: string, properties: Readonly<Record<string, string>>): PlacedModel[] {
    const state = this.assets.json<BlockStateFile>(`blockstates/${name}.json`);

    if (!state) return [];

    if (state.variants) {
      const entry = Object.entries(state.variants).find(([key]) => matchesVariant(key, properties))
        ?? Object.entries(state.variants)[0];

      return entry ? this.place([entry[1]]) : [];
    }

    return this.place((state.multipart ?? [])
      .filter((part) => !part.when || matchesCondition(part.when, properties))
      .map((part) => part.apply));
  }

  allShapes(name: string): PlacedModel[][] {
    const state = this.assets.json<BlockStateFile>(`blockstates/${name}.json`);

    if (state?.variants) return Object.values(state.variants).map((variant) => this.place([variant]));
    if (state?.multipart) return [this.place(state.multipart.map((part) => part.apply))];

    return [];
  }

  private place(references: (ModelReference | ModelReference[])[]): PlacedModel[] {
    return references.flatMap((reference) => {
      const choice = Array.isArray(reference) ? reference[0] : reference;
      const model = choice && this.model(choice.model);

      return model ? [{ model, x: choice.x ?? 0, y: choice.y ?? 0 }] : [];
    });
  }

  private model(name: string): BlockModel | null {
    const key = withoutNamespace(name);
    const cached = this.models.get(key);

    if (cached !== undefined) return cached;

    const chain: RawModel[] = [];
    const seen = new Set<string>();

    for (let current: string | undefined = key; current && !seen.has(current); ) {
      seen.add(current);

      const raw: RawModel | undefined = this.assets.json<RawModel>(`models/${current}.json`);

      if (!raw) break;

      chain.push(raw);
      current = raw.parent ? withoutNamespace(raw.parent) : undefined;
    }

    if (!chain.length) {
      this.models.set(key, null);
      return null;
    }

    const variables: Record<string, string> = {};

    for (const raw of [...chain].reverse()) {
      for (const [variable, value] of Object.entries(raw.textures ?? {})) {
        const sprite = typeof value === "string" ? value : value.sprite;

        if (sprite) variables[variable] = sprite;
      }
    }

    const textures: Record<string, string> = {};

    for (const variable of Object.keys(variables)) {
      const texture = resolveTexture(variables, variable);

      if (texture) textures[variable] = texture;
    }

    const model: BlockModel = {
      name: key,
      textures,
      elements: chain.find((raw) => raw.elements)?.elements ?? [],
    };

    this.models.set(key, model);

    return model;
  }
}

export function textureOf(model: BlockModel, reference: string): string | undefined {
  return reference.startsWith("#") ? model.textures[reference.slice(1)] : withoutNamespace(reference);
}

function resolveTexture(variables: Record<string, string>, variable: string): string | undefined {
  let value: string | undefined = variables[variable];

  for (let depth = 0; value?.startsWith("#") && depth < 16; depth++) value = variables[value.slice(1)];

  return value && !value.startsWith("#") ? withoutNamespace(value) : undefined;
}

function withoutNamespace(name: string): string {
  return name.startsWith("minecraft:") ? name.slice("minecraft:".length) : name;
}

function matchesVariant(key: string, properties: Readonly<Record<string, string>>): boolean {
  return key === "" || key.split(",").every((pair) => {
    const [name, value] = pair.split("=");
    return properties[name] === value;
  });
}

function matchesCondition(condition: Condition, properties: Readonly<Record<string, string>>): boolean {
  if (condition.OR) return condition.OR.some((inner) => matchesCondition(inner, properties));
  if (condition.AND) return condition.AND.every((inner) => matchesCondition(inner, properties));

  return Object.entries(condition).every(([name, expected]) =>
    String(expected).split("|").includes(properties[name] ?? ""));
}