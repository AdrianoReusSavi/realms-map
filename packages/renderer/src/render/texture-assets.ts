import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { defaultResolver } from "../palette/color-resolver.js";

const execFileAsync = promisify(execFile);
const SAMPLE_SIZE = 8;

export async function loadSurfaceTextureSamples(
  gameVersion: string | undefined,
  blockInfos: string[],
): Promise<Map<string, Buffer>> {
  if (!gameVersion || !/^[\w.-]+$/.test(gameVersion)) return new Map();

  const jarPath = await findClientJar(gameVersion);

  if (!jarPath) {
    console.warn(`Minecraft ${gameVersion} client assets were not found; using the color palette at close zoom.`);
    return new Map();
  }

  const extracted = await mkdtemp(join(tmpdir(), "realms-map-assets-"));

  try {
    await execFileAsync("tar", [
      "-xf", jarPath,
      "-C", extracted,
      "assets/minecraft/blockstates",
      "assets/minecraft/models/block",
      "assets/minecraft/textures/block",
    ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });

    const cache = new Map<string, Buffer | null>();
    const samples = new Map<string, Buffer>();
    const unresolved: string[] = [];

    for (const info of new Set(blockInfos)) {
      const texture = await resolveTexturePath(extracted, info);

      if (!texture) {
        unresolved.push(info);
        continue;
      }

      const cacheKey = `${texture.path}:${texture.rotation}:${texture.sprite}:${texture.uv?.join(",") ?? ""}:${texture.footprint?.join(",") ?? ""}`;
      let sample = cache.get(cacheKey);

      if (sample === undefined) {
        sample = await sampleTexture(texture.path, texture.rotation, texture.uv, texture.footprint);
        cache.set(cacheKey, sample);
      }

      if (sample) {
        samples.set(info, texture.sprite || hasCustomTopView(info)
          ? createTopViewMark(info, sample)
          : parseBlockName(info).endsWith("_trapdoor")
            ? sample
            : tintSample(sample, parseBlockName(info)));
      }
    }

    console.log(`Loaded ${samples.size} block textures from Minecraft ${gameVersion}.`);

    if (unresolved.length) {
      console.warn(`Could not resolve textures for ${unresolved.length} block states: ${unresolved.slice(0, 20).join(", ")}${unresolved.length > 20 ? ", …" : ""}`);
    }

    return samples;
  } catch (error) {
    console.warn(`Could not load Minecraft textures: ${error instanceof Error ? error.message : String(error)}`);

    return new Map();
  } finally {
    await rm(extracted, { recursive: true, force: true });

    if (jarPath.startsWith(join(tmpdir(), `minecraft-${gameVersion}-`))) {
      await rm(jarPath, { force: true });
    }
  }
}

async function findClientJar(version: string): Promise<string | null> {
  const minecraftDirs = [
    process.env.MINECRAFT_DIR,
    process.env.APPDATA ? join(process.env.APPDATA, ".minecraft") : undefined,
    join(homedir(), ".minecraft"),
  ].filter((value): value is string => Boolean(value));

  for (const directory of minecraftDirs) {
    const path = join(directory, "versions", version, `${version}.jar`);

    try {
      await access(path);
      return path;
    } catch {}
  }

  try {
    const manifestResponse = await fetch("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");

    if (!manifestResponse.ok) return null;

    const manifest = await manifestResponse.json() as { versions?: { id: string; url: string }[] };
    const entry = manifest.versions?.find((item) => item.id === version);

    if (!entry) return null;

    const versionResponse = await fetch(entry.url);

    if (!versionResponse.ok) return null;

    const metadata = await versionResponse.json() as { downloads?: { client?: { url?: string } } };
    const clientUrl = metadata.downloads?.client?.url;

    if (!clientUrl) return null;

    const clientResponse = await fetch(clientUrl);

    if (!clientResponse.ok) return null;

    const tempJar = join(tmpdir(), `minecraft-${version}-${Date.now()}.jar`);

    await writeFile(tempJar, Buffer.from(await clientResponse.arrayBuffer()));

    return tempJar;
  } catch {
    return null;
  }
}

async function resolveTexturePath(root: string, info: string): Promise<{
  path: string;
  rotation: number;
  sprite: boolean;
  uv?: [number, number, number, number];
  footprint?: [number, number];
} | null> {
  const blockName = parseBlockName(info);
  const namespaceSeparator = blockName.indexOf(":");
  const namespace = namespaceSeparator < 0 ? "minecraft" : blockName.slice(0, namespaceSeparator);
  const name = namespaceSeparator < 0 ? blockName : blockName.slice(namespaceSeparator + 1);

  if (namespace !== "minecraft") return null;

  const state = parseProperties(info);
  const statePath = join(root, "assets", namespace, "blockstates", `${name}.json`);
  let modelChoice: ModelChoice | undefined;

  try {
    const blockState = JSON.parse(await readFile(statePath, "utf8")) as {
      variants?: Record<string, unknown>;
      multipart?: { apply?: unknown }[];
    };

    modelChoice = selectModel(blockState.variants, state) ?? firstModel(blockState.multipart?.[0]?.apply);
  } catch {}

  const face = faceForRotation(modelChoice?.x);
  const model = modelChoice ? await resolveModel(root, modelChoice.name, new Set(), face) : { textures: {}, topFace: undefined };
  const spriteTexture = model.textures.cross ?? model.textures.crop ?? model.textures.plant ?? model.textures.flower;
  const candidates = [
    model.topFace?.texture,
    spriteTexture,
    model.textures.up,
    model.textures.top,
    model.textures.end,
    model.textures.all,
    model.textures.side,
    model.textures.front,
    model.textures.wall,
    model.textures.texture,
    model.textures.particle,
    ...Object.values(model.textures),
    `block/${name}`,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;

    const textureName = resolveTextureReference(candidate, model.textures);
    const texture = textureName.replace(/^minecraft:/, "");

    if (texture.includes(":") || texture.includes("..")) continue;

    const path = join(root, "assets", "minecraft", "textures", `${texture}.png`);

    try {
      await access(path);

      return {
        path,
        rotation: ((modelChoice?.y ?? 0) + (model.topFace?.rotation ?? 0)) % 360,
        sprite: typeof spriteTexture === "string" && !model.topFace,
        uv: model.topFace?.uv,
        footprint: model.topFace?.size && [90, 270].includes((modelChoice?.y ?? 0) % 360)
          ? [model.topFace.size[1], model.topFace.size[0]]
          : model.topFace?.size,
      };
    } catch {}
  }

  return null;
}

function resolveTextureReference(value: string, textures: Record<string, string>): string {
  let resolved = value;

  for (let depth = 0; resolved.startsWith("#") && depth < 8; depth++) {
    const next = textures[resolved.slice(1)];

    if (typeof next !== "string" || next === resolved) break;

    resolved = next;
  }

  return resolved;
}

interface ModelChoice {
  name: string;
  x?: number;
  y?: number;
}

type ModelFace = "up" | "down" | "north" | "south" | "east" | "west";

interface TopFace {
  texture: string;
  rotation: number;
  uv?: [number, number, number, number];
  size?: [number, number];
}

function faceForRotation(x = 0): ModelFace {
  switch (((x % 360) + 360) % 360) {
    case 90: return "north";
    case 180: return "down";
    case 270: return "south";
    default: return "up";
  }
}

async function resolveModel(
  root: string,
  modelName: string,
  visited: Set<string>,
  topFaceName: ModelFace,
): Promise<{ textures: Record<string, string>; topFace?: TopFace }> {
  const [namespace, modelPath] = modelName.includes(":") ? modelName.split(":", 2) : ["minecraft", modelName];

  if (namespace !== "minecraft" || visited.has(modelName)) return { textures: {} };

  visited.add(modelName);

  try {
    const path = join(root, "assets", namespace, "models", `${modelPath}.json`);
    const model = JSON.parse(await readFile(path, "utf8")) as {
      parent?: string;
      textures?: Record<string, string>;
      elements?: {
        from?: [number, number, number];
        to?: [number, number, number];
        faces?: Partial<Record<ModelFace, { texture?: string; rotation?: number; uv?: [number, number, number, number] }>>;
      }[];
    };
    const inherited = model.parent ? await resolveModel(root, model.parent, visited, topFaceName) : { textures: {} };
    const topElement = model.elements
      ? model.elements
        .filter((element) => element.faces?.[topFaceName]?.texture)
        .sort((a, b) => (b.to?.[1] ?? 0) - (a.to?.[1] ?? 0))[0]
      : inherited.topFace;
    const topFace = topElement && "faces" in topElement ? topElement.faces?.[topFaceName] : undefined;
    const size = topElement && "from" in topElement && topElement.from && topElement.to
      ? faceSize(topElement.from, topElement.to, topFaceName)
      : undefined;

    return {
      textures: { ...inherited.textures, ...model.textures },
      topFace: topFace?.texture
        ? { texture: topFace.texture, rotation: topFace.rotation ?? 0, uv: topFace.uv, size }
        : inherited.topFace,
    };
  } catch {
    return { textures: {} };
  }
}

function faceSize(from: [number, number, number], to: [number, number, number], face: ModelFace): [number, number] {
  if (face === "up" || face === "down") return [Math.abs(to[0] - from[0]), Math.abs(to[2] - from[2])];
  if (face === "north" || face === "south") return [Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])];
  return [Math.abs(to[2] - from[2]), Math.abs(to[1] - from[1])];
}

function selectModel(variants: Record<string, unknown> | undefined, state: Record<string, string>): ModelChoice | undefined {
  if (!variants) return undefined;

  const matches = Object.entries(variants)
    .map(([key, value]) => ({ key, value, conditions: key ? key.split(",") : [] }))
    .filter(({ conditions }) => conditions.every((condition) => {
      const [name, value] = condition.split("=");
      return state[name] === value;
    }))
    .sort((a, b) => b.conditions.length - a.conditions.length);

  return matches.length ? firstModel(matches[0].value) : firstModel(Object.values(variants)[0]);
}

function firstModel(value: unknown): ModelChoice | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (typeof candidate !== "object" || candidate === null) return undefined;

  const choice = candidate as { model?: unknown; x?: unknown; y?: unknown };

  return typeof choice.model === "string"
    ? {
      name: choice.model,
      x: typeof choice.x === "number" ? choice.x : undefined,
      y: typeof choice.y === "number" ? choice.y : undefined,
    }
    : undefined;
}

async function sampleTexture(
  path: string,
  rotation: number,
  uv?: [number, number, number, number],
  footprint?: [number, number],
): Promise<Buffer | null> {
  try {
    let image = sharp(path);

    if (uv) {
      const metadata = await image.metadata();
      const scaleX = (metadata.width ?? 16) / 16;
      const scaleY = (metadata.height ?? 16) / 16;
      const left = Math.max(0, Math.floor(Math.min(uv[0], uv[2]) * scaleX));
      const top = Math.max(0, Math.floor(Math.min(uv[1], uv[3]) * scaleY));
      const right = Math.min(metadata.width ?? 16, Math.ceil(Math.max(uv[0], uv[2]) * scaleX));
      const bottom = Math.min(metadata.height ?? 16, Math.ceil(Math.max(uv[1], uv[3]) * scaleY));

      image = image.extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) });
      if (uv[0] > uv[2]) image = image.flop();
      if (uv[1] > uv[3]) image = image.flip();
    }

    const width = footprint ? Math.max(1, Math.min(SAMPLE_SIZE, Math.round(footprint[0] / 16 * SAMPLE_SIZE))) : SAMPLE_SIZE;
    const height = footprint ? Math.max(1, Math.min(SAMPLE_SIZE, Math.round(footprint[1] / 16 * SAMPLE_SIZE))) : SAMPLE_SIZE;
    const sample = await image
      .rotate(rotation)
      .ensureAlpha()
      .resize(width, height, { fit: "fill", kernel: "lanczos3" })
      .raw()
      .toBuffer();

    if (width === SAMPLE_SIZE && height === SAMPLE_SIZE) return sample;

    const canvas = Buffer.alloc(SAMPLE_SIZE * SAMPLE_SIZE * 4);
    const left = Math.floor((SAMPLE_SIZE - width) / 2);
    const top = Math.floor((SAMPLE_SIZE - height) / 2);

    for (let y = 0; y < height; y++) {
      const from = y * width * 4;
      const to = ((top + y) * SAMPLE_SIZE + left) * 4;
      sample.copy(canvas, to, from, from + width * 4);
    }

    return canvas;
  } catch {
    return null;
  }
}

function createTopViewMark(info: string, source: Buffer): Buffer {
  const blockName = parseBlockName(info);
  const name = blockName.split(":").at(-1) ?? blockName;
  const state = parseProperties(info);
  const base = defaultResolver.resolve(blockName);
  const mark = Buffer.alloc(SAMPLE_SIZE * SAMPLE_SIZE * 4);

  const dot = (x: number, y: number, rgb: readonly number[] = base, alpha = 255) => {
    if (x < 0 || x >= 8 || y < 0 || y >= 8) return;
    const offset = (y * 8 + x) * 4;
    mark[offset] = rgb[0]; mark[offset + 1] = rgb[1]; mark[offset + 2] = rgb[2]; mark[offset + 3] = alpha;
  };
  const rect = (x1: number, y1: number, x2: number, y2: number, color: readonly number[]) => {
    for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) dot(x, y, color);
  };
  const line = (points: number[][], color: readonly number[]) => {
    for (const [x, y] of points) dot(x, y, color);
  };
  const drawPaletteGrid = (pixels: (string | null)[]) => {
    for (let i = 0; i < Math.min(64, pixels.length); i++) {
      const hex = pixels[i];
      if (hex === null) continue;
      const color: readonly number[] = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      dot(i % 8, Math.floor(i / 8), color, 255);
    }
  };
  const dark = (rgb: readonly number[]) => rgb.map((v) => Math.round(v * 0.48));
  const light = (rgb: readonly number[]) => rgb.map((v) => Math.min(255, Math.round(v * 1.35)));
  const wood: readonly number[] = [126, 83, 45];
  const woodLight: readonly number[] = [178, 127, 76];
  const stone: readonly number[] = [166, 165, 158];
  const outline: readonly number[] = [47, 43, 39];

  if (/^(torch|wall_torch|redstone_torch|redstone_wall_torch|soul_torch|soul_wall_torch)$/.test(name)) {
    const soul = name.startsWith("soul_");
    const redstone = name.startsWith("redstone_");
    const flame: readonly number[] = soul ? [88, 222, 220] : redstone ? [225, 48, 42] : [247, 175, 48];
    const flameLight: readonly number[] = soul ? [166, 239, 228] : redstone ? [255, 112, 67] : [255, 220, 103];

    dot(3, 3, flame);
    dot(4, 4, flameLight);

    return mark;
  }

  if (name === "pointed_dripstone") {
    const thickness = state.thickness ?? "tip";
    const radius = thickness === "base" ? 3 : thickness === "middle" ? 2 : thickness === "frustum" ? 1.5 : 1;

    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const distance = Math.abs(x - 3.5) + Math.abs(y - 3.5);

      if (distance <= radius * 2) {
        const offset = (y * 8 + x) * 4;
        dot(x, y, [source[offset], source[offset + 1], source[offset + 2]]);
      }
    }

    return mark;
  }

  if (name === "chest") {
    drawPaletteGrid([
      null, null, null, null, null, null, null, null,
      null, "#57391f", "#96643b", "#96643b", "#c4894a", "#96643b", "#57391f", null,
      null, "#96643b", "#c4894a", "#c4894a", "#96643b", "#c4894a", "#57391f", null,
      null, "#96643b", "#c4894a", "#c4894a", "#c4894a", "#c4894a", "#96643b", null,
      null, "#96643b", "#c4894a", "#96643b", "#96643b", "#c4894a", "#96643b", null,
      null, "#57391f", "#96643b", "#96643b", "#96643b", "#96643b", "#57391f", null,
      null, null, null, "#9c9b94", "#9c9b94", null, null, null,
      null, null, null, null, null, null, null, null,
    ]);

    return mark;
  }

  if (name === "trapped_chest" || name === "ender_chest") {
    const ender = name === "ender_chest";
    const edge: readonly number[] = ender ? [35, 28, 62] : [87, 48, 28];
    const lid: readonly number[] = ender ? [67, 48, 105] : [188, 117, 57];

    rect(0, 0, 7, 7, edge);
    rect(1, 1, 6, 6, lid);
    rect(1, 3, 6, 3, dark(lid));
    rect(3, 6, 4, 7, ender ? [67, 224, 207] : [235, 70, 48]);

    return mark;
  }

  if (name === "barrel") {
    rect(1, 0, 6, 7, wood); rect(2, 1, 5, 6, woodLight);
    rect(0, 1, 0, 6, outline); rect(7, 1, 7, 6, outline);
    rect(1, 2, 6, 2, dark(wood)); rect(1, 5, 6, 5, dark(wood));

    if (state.open === "true") rect(2, 2, 5, 5, [43, 31, 22]);

    return mark;
  }

  if (name === "grindstone") {
    drawPaletteGrid([
      null, null, null, "#96643b", "#96643b", null, null, null,
      null, null, "#9c9b94", "#bebdb4", "#bebdb4", "#9c9b94", null, null,
      null, "#96643b", "#9c9b94", "#bebdb4", "#bebdb4", "#9c9b94", "#96643b", null,
      null, "#96643b", "#9c9b94", "#9c9b94", "#9c9b94", "#9c9b94", "#96643b", null,
      null, "#96643b", "#9c9b94", "#bebdb4", "#bebdb4", "#9c9b94", "#96643b", null,
      null, null, "#9c9b94", "#9c9b94", "#9c9b94", "#9c9b94", null, null,
      null, null, null, "#96643b", "#96643b", null, null, null,
      null, null, null, null, null, null, null, null,
    ]);

    return mark;
  }

  if (name.endsWith("_door")) {
    const metal = name === "iron_door";
    const material: readonly number[] = metal ? [157, 162, 164] : base;
    const edge: readonly number[] = metal ? [76, 81, 84] : dark(material);
    const panel: readonly number[] = metal ? [190, 195, 197] : light(material);
    const facing = state.facing ?? "north";

    if (state.open === "true") {
      const hingeRight = state.hinge === "right";

      if (facing === "north" || facing === "south") {
        const x = (facing === "north") !== hingeRight ? 0 : 7;

        rect(x, 0, x, 7, edge);
        rect(x === 0 ? 1 : 6, 1, x === 0 ? 1 : 6, 6, material);
      } else {
        const y = (facing === "west") !== hingeRight ? 0 : 7;

        rect(0, y, 7, y, edge);
        rect(1, y === 0 ? 1 : 6, 6, y === 0 ? 1 : 6, material);
      }
    } else {
      rect(0, 0, 7, 7, edge); rect(1, 1, 6, 6, material);

      if (metal) {
        rect(2, 1, 2, 6, panel); rect(5, 1, 5, 6, panel); rect(3, 3, 4, 4, edge);
      } else if (facing === "north" || facing === "south") {
        rect(2, 1, 2, 6, dark(material)); rect(5, 1, 5, 6, light(material)); rect(3, 3, 4, 3, dark(material));
      } else {
        rect(1, 2, 6, 2, dark(material)); rect(1, 5, 6, 5, light(material)); rect(3, 3, 3, 4, dark(material));
      }
    }

    return mark;
  }

  if (name.endsWith("_banner") || name === "banner") {
    const color = base;

    dot(3, 3, wood); dot(4, 3, wood);
    dot(3, 4, color); dot(4, 4, color);
    dot(2, 3, color); dot(5, 4, color);

    return mark;
  }

  if (name === "lever" || name.endsWith("_button")) {
    if (name === "lever") {
      rect(2, 5, 5, 6, stone); line([[3, 4], [3, 3], [4, 2], [4, 1]], [205, 190, 157]);
    } else rect(2, 2, 5, 5, light(base));

    return mark;
  }
  if (name.endsWith("_pressure_plate")) {
    rect(1, 1, 6, 6, dark(base)); rect(2, 2, 5, 5, base);

    if (state.powered === "true") rect(3, 3, 4, 4, light(base));

    return mark;
  }
  if (name === "chain") {
    for (let i = 0; i < 8; i++) { dot(3, i, [105, 111, 117]); dot(4, i, [166, 171, 176]); }

    return mark;
  }
  if (name === "lightning_rod") {
    const axis = state.facing ?? "up";

    if (axis === "north" || axis === "south") rect(3, 0, 4, 7, [184, 104, 55]);
    else if (axis === "east" || axis === "west") rect(0, 3, 7, 4, [184, 104, 55]);
    else line([[3, 6], [4, 5], [3, 4], [4, 3], [3, 2], [4, 1]], [184, 104, 55]);

    return mark;
  }

  if (name.endsWith("_rails") || name === "rail") {
    const powered = name.includes("powered") || name.includes("activator") || name.includes("detector");
    const rail = powered ? [207, 63, 47] : [125, 91, 62];
    const metal = [177, 179, 174];

    if (state.shape?.includes("east_west")) {
      rect(0, 2, 7, 2, rail); rect(0, 5, 7, 5, rail);
      for (const x of [1, 4, 6]) { dot(x, 1, metal); dot(x, 6, metal); }
    } else if (state.shape?.includes("north_south")) {
      rect(2, 0, 2, 7, rail); rect(5, 0, 5, 7, rail);
      for (const y of [1, 4, 6]) { dot(1, y, metal); dot(6, y, metal); }
    } else {
      line([[1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1]], rail);
      line([[2, 7], [3, 6], [4, 5], [5, 4], [6, 3], [7, 2]], metal);
    }

    return mark;
  }

  if (/^(dandelion|poppy|blue_orchid|allium|azure_bluet|tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers)$/.test(name)) {
    for (let y = 3; y <= 4; y++) for (let x = 3; x <= 4; x++) dot(x, y);
    return mark;
  }
  if (/^(short_grass|tall_grass|fern|large_fern|short_dry_grass)$/.test(name)) {
    const points = name === "short_grass" ? [[2,1],[4,1],[1,3],[3,3],[5,3],[2,5],[4,5]] : [[2,1],[4,1],[1,2],[3,2],[5,2],[2,3],[4,3],[1,4],[3,4],[5,4],[2,5],[4,5],[3,6]];
    for (const [x, y] of points) dot(x, y);
    return mark;
  }
  if (name === "seagrass" || name === "tall_seagrass") {
    for (const [x, y] of [[3,2],[2,3],[4,3],[3,4],[2,4],[4,4]]) dot(x, y);
    return mark;
  }
  if (/^(kelp|kelp_plant)$/.test(name)) {
    for (const [x, y] of [[3,1],[3,2],[4,3],[4,4],[3,5],[3,6]]) dot(x, y);
    return mark;
  }
  if (name === "sea_pickle") {
    for (const [x, y] of [[2,2],[4,2],[2,4],[4,4]]) dot(x, y);
    return mark;
  }
  if (/^(wheat|carrots|potatoes|beetroots|torchflower_crop|pitcher_crop)$/.test(name)) {
    const age = Number(state.age ?? 7);
    const points = [[3,1],[4,2],[2,2],[3,3],[4,4],[2,4],[3,5],[4,6]];
    for (const [x, y] of points.slice(0, Math.max(1, Math.ceil((age + 1) * points.length / 8)))) dot(x, y);
    return mark;
  }

  if (/(_sapling|^sapling$|mushroom|dead_bush|bamboo|sugar_cane|_vine|nether_wart|sweet_berry_bush|cocoa)/.test(name)) {
    for (const [x, y] of [[2,2],[4,2],[3,3],[2,4],[4,4],[3,5]]) dot(x, y);
    return mark;
  }

  return tintSample(source, blockName);
}

function hasCustomTopView(info: string): boolean {
  const name = parseBlockName(info).split(":").at(-1) ?? "";
  return /^(torch|wall_torch|redstone_torch|redstone_wall_torch|soul_torch|soul_wall_torch|pointed_dripstone|grindstone|chest|trapped_chest|ender_chest|barrel|.*_door|.*_banner|banner|lever|.*_button|.*_pressure_plate|chain|lightning_rod|rail|.*_rails|dandelion|poppy|blue_orchid|allium|azure_bluet|tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|pink_petals|wildflowers|short_grass|tall_grass|fern|large_fern|short_dry_grass|wheat|carrots|potatoes|beetroots|torchflower_crop|pitcher_crop|seagrass|tall_seagrass|kelp|kelp_plant|sea_pickle)$/.test(name)
    || /(_sapling|mushroom|dead_bush|bamboo|sugar_cane|_vine|nether_wart|sweet_berry_bush|cocoa)$/.test(name);
}


function tintSample(sample: Buffer, blockName: string): Buffer {
  const target = defaultResolver.resolve(blockName);
  const average = [0, 0, 0];

  for (let i = 0; i < sample.length; i += 4) {
    const alpha = sample[i + 3] / 255;

    for (let channel = 0; channel < 3; channel++) {
      average[channel] += sample[i + channel] * alpha + target[channel] * (1 - alpha);
    }
  }

  for (let channel = 0; channel < 3; channel++) average[channel] /= sample.length / 4;

  const tinted = Buffer.from(sample);

  for (let i = 0; i < tinted.length; i += 4) {
    const alpha = tinted[i + 3] / 255;

    for (let channel = 0; channel < 3; channel++) {
      const composited = tinted[i + channel] * alpha + target[channel] * (1 - alpha);
      const ratio = average[channel] > 0 ? target[channel] / average[channel] : 1;
      tinted[i + channel] = Math.max(0, Math.min(255, Math.round(composited * ratio)));
    }

    tinted[i + 3] = sample[i + 3];
  }

  return tinted;
}

function parseBlockName(info: string): string {
  return info.split(" ", 1)[0];
}

function parseProperties(info: string): Record<string, string> {
  const propertiesText = info.slice(info.indexOf(" ") + 1);
  
  if (!propertiesText || propertiesText === info) return {};
  try {
    return JSON.parse(propertiesText) as Record<string, string>;
  } catch {
    return {};
  }
}