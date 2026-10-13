import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const ASSET_FILTER = /^assets\/minecraft\/(blockstates|models\/block|textures\/block|textures\/entity\/(chest|shulker))\//;
const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

export class AssetPack {
  private readonly images = new Map<string, Promise<RgbaImage | null>>();
  private readonly jsons = new Map<string, unknown>();

  private constructor(private readonly files: Record<string, Uint8Array>) {}

  static fromJar(jar: Uint8Array): AssetPack {
    return new AssetPack(unzipSync(jar, { filter: (file) => ASSET_FILTER.test(file.name) }));
  }

  static async forVersion(version: string): Promise<AssetPack> {
    if (!/^[\w.-]+$/.test(version)) throw new Error(`Invalid Minecraft version: ${version}`);

    return AssetPack.fromJar(await readClientJar(version));
  }

  list(directory: string): string[] {
    const prefix = `assets/minecraft/${directory}/`;

    return Object.keys(this.files)
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => path.slice(prefix.length).replace(/\.[^.]+$/, ""));
  }

  json<T>(path: string): T | undefined {
    if (this.jsons.has(path)) return this.jsons.get(path) as T | undefined;

    const file = this.files[`assets/minecraft/${path}`];
    let value: unknown;

    try {
      value = file ? JSON.parse(new TextDecoder().decode(file)) : undefined;
    } catch {
      value = undefined;
    }

    this.jsons.set(path, value);

    return value as T | undefined;
  }

  image(path: string): Promise<RgbaImage | null> {
    let image = this.images.get(path);

    if (!image) {
      image = this.decode(path);
      this.images.set(path, image);
    }

    return image;
  }

  private async decode(path: string): Promise<RgbaImage | null> {
    const file = this.files[`assets/minecraft/${path}`];

    if (!file) return null;

    try {
      const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const height = info.height > info.width && info.height % info.width === 0 ? info.width : info.height;

      return { width: info.width, height, data: new Uint8Array(data.buffer, data.byteOffset, info.width * height * 4) };
    } catch {
      return null;
    }
  }
}

async function readClientJar(version: string): Promise<Uint8Array> {
  const minecraftDirs = [
    process.env.MINECRAFT_DIR,
    process.env.APPDATA ? join(process.env.APPDATA, ".minecraft") : undefined,
    join(homedir(), ".minecraft"),
  ].filter((value): value is string => Boolean(value));

  for (const directory of minecraftDirs) {
    const path = join(directory, "versions", version, `${version}.jar`);

    try {
      await access(path);
      return await readFile(path);
    } catch {}
  }

  const manifest = await fetchJson<{ versions?: { id: string; url: string }[] }>(MANIFEST_URL);
  const entry = manifest.versions?.find((item) => item.id === version);

  if (!entry) throw new Error(`Minecraft ${version} is not listed in the version manifest`);

  const metadata = await fetchJson<{ downloads?: { client?: { url?: string } } }>(entry.url);
  const clientUrl = metadata.downloads?.client?.url;

  if (!clientUrl) throw new Error(`Minecraft ${version} has no client download`);

  const response = await fetch(clientUrl);

  if (!response.ok) throw new Error(`Client jar download failed: HTTP ${response.status}`);

  return new Uint8Array(await response.arrayBuffer());
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);

  return await response.json() as T;
}