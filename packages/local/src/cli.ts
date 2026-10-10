import { renderMap, type Dimension } from "@minecraft-map/renderer";
import { LocalMapSource } from "./source.js";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

interface Args {
  worldPath: string;
  output: string;
  dimension: Dimension;
  zoomIn: number;
  open: boolean;
  background: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let output = "./output";
  let dimension: Dimension = "overworld";
  let zoomIn = 4;
  let open = false;
  let background = "#000000";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--output" || a === "-o") output = argv[++i];
    else if (a === "--dimension" || a === "-d") dimension = argv[++i] as Dimension;
    else if (a === "--zoom-in" || a === "-z") zoomIn = parseInt(argv[++i], 10);
    else if (a === "--background" || a === "-b") background = argv[++i];
    else if (a === "--open") open = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else positional.push(a);
  }

  if (positional.length === 0) {
    console.error("Error: world path was not provided.\n");
    printHelp();
    process.exit(1);
  }

  return {
    worldPath: resolve(positional[0]),
    output: resolve(output),
    dimension,
    zoomIn,
    open,
    background,
  };
}

function printHelp(): void {
  console.log(`minecraft-map - render a Minecraft Java world as a navigable 2D map.

Usage:
  minecraft-map <world-path> [options]

Options:
  --output, -o <dir>       Output directory (default: ./output)
  --dimension, -d <dim>    overworld | nether | end (default: overworld)
  --zoom-in, -z <n>        Extra zoom levels (default: 4)
  --background, -b <#hex>  Background color (default: #000000)
  --open                   Open the map in a browser after rendering
  --help, -h               Show this help

Example:
  minecraft-map "C:/Users/you/AppData/Roaming/.minecraft/saves/MyWorld" --open`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = new LocalMapSource(args.worldPath);

  console.log(`Rendering: ${args.worldPath}`);
  const t0 = Date.now();
  const result = await renderMap(source, {
    outputPath: args.output,
    dimension: args.dimension,
    zoomIn: args.zoomIn,
    background: args.background,
  });
  console.log(
    `Done in ${Date.now() - t0}ms - ${result.widthBlocks}x${result.heightBlocks} blocks, zoom 0..${result.maxZoom}`,
  );
  console.log(`Output: ${args.output}`);

  if (args.open) {
    const index = resolve(args.output, "index.html");
    spawn(process.platform === "win32" ? "explorer.exe" : "xdg-open", [index], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
}

main().catch((err) => {
  console.error("Failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});