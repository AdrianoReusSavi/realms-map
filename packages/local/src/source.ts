import { scanWorld, type MapSource, type WorldHandle, type WorldMeta } from "@minecraft-map/renderer";

export class LocalMapSource implements MapSource {
  name: string;
  private readonly worldPath: string;
  private meta: WorldMeta | null = null;

  constructor(worldPath: string, displayName?: string) {
    this.worldPath = worldPath;
    this.name = displayName ?? `Local: ${worldPath}`;
  }

  async acquire(): Promise<WorldHandle> {
    this.meta = await scanWorld(this.worldPath);
    this.name = `Local: ${this.meta.name}`;
    return { worldPath: this.worldPath, meta: this.meta };
  }

  async release(): Promise<void> {}
}