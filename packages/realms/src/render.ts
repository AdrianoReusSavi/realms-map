import {
  renderMap as renderWorldMap,
  scanWorld,
  type MapSource,
} from "@minecraft-map/renderer";
import { config } from "./config.js";

export async function renderMap(worldPath: string, realmName = "Unknown"): Promise<void> {
  const meta = await scanWorld(worldPath);
  const source: MapSource = {
    name: `Realm: ${realmName}`,
    async acquire() {
      return { worldPath, meta };
    },
    async release() {},
  };

  await renderWorldMap(source, {
    outputPath: config.outputPath,
    dimension: "overworld",
  });
}