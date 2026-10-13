import { describe, it, expect } from "vitest";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { AssetPack } from "../src/assets/asset-pack.js";
import { BlockTextures } from "../src/assets/block-textures.js";

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];

async function png(width: number, height: number, rgba: number[]): Promise<Uint8Array> {
  const data = Buffer.alloc(width * height * 4);

  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);

  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

async function fakeJar(files: Record<string, unknown>): Promise<AssetPack> {
  const entries: Record<string, Uint8Array> = {
    "assets/minecraft/textures/block/red.png": await png(16, 16, RED),
    "assets/minecraft/textures/block/blue.png": await png(16, 16, BLUE),
    "assets/minecraft/textures/block/animated.png": await png(16, 32, BLUE),
    "net/minecraft/Unrelated.class": new Uint8Array([1, 2, 3]),
  };

  for (const [path, value] of Object.entries(files)) {
    entries[`assets/minecraft/${path}`] = strToU8(JSON.stringify(value));
  }

  return AssetPack.fromJar(zipSync(entries));
}

const box = (from: number[], to: number[], texture: string) => ({
  from, to, faces: { up: { texture } },
});

function pixel(pixels: Uint8Array, x: number, z: number): number[] {
  return [...pixels.subarray((z * 16 + x) * 4, (z * 16 + x) * 4 + 4)];
}

describe("AssetPack", () => {
  it("reads only asset files from the client jar", async () => {
    const assets = await fakeJar({ "blockstates/stone.json": { variants: {} } });

    expect(assets.list("blockstates")).toEqual(["stone"]);
    expect(assets.list("textures/block")).toEqual(["red", "blue", "animated"]);
    expect(assets.json("blockstates/stone.json")).toEqual({ variants: {} });
  });

  it("crops animated textures to their first frame", async () => {
    const image = await (await fakeJar({})).image("textures/block/animated.png");

    expect(image).toMatchObject({ width: 16, height: 16 });
    expect(image!.data.length).toBe(16 * 16 * 4);
  });
});

describe("BlockTextures", () => {
  it("draws the highest element where elements overlap", async () => {
    const textures = BlockTextures.fromAssets(await fakeJar({
      "blockstates/stand.json": { variants: { "": { model: "block/stand" } } },
      "models/block/stand.json": {
        textures: { base: "block/blue", rod: "block/red" },
        elements: [box([0, 0, 0], [16, 2, 16], "#base"), box([7, 0, 7], [9, 14, 9], "#rod")],
      },
    }));
    const view = await textures.topView("minecraft:stand");

    expect(pixel(view!.pixels, 0, 0)).toEqual(BLUE);
    expect(pixel(view!.pixels, 8, 8)).toEqual(RED);
    expect(view!.coverage).toBe(1);
  });

  it("applies blockstate rotations and reports partial coverage", async () => {
    const textures = BlockTextures.fromAssets(await fakeJar({
      "blockstates/hatch.json": {
        variants: {
          "facing=north": { model: "block/hatch" },
          "facing=east": { model: "block/hatch", y: 90 },
        },
      },
      "models/block/hatch.json": { textures: { all: "block/red" }, elements: [box([0, 0, 13], [16, 16, 16], "#all")] },
    }));
    const north = await textures.topView(`minecraft:hatch {"facing":"north"}`);
    const east = await textures.topView(`minecraft:hatch {"facing":"east"}`);

    expect(pixel(north!.pixels, 8, 15)[3]).toBe(255);
    expect(pixel(north!.pixels, 8, 0)[3]).toBe(0);
    expect(pixel(east!.pixels, 0, 8)[3]).toBe(255);
    expect(pixel(east!.pixels, 15, 8)[3]).toBe(0);
    expect(north!.coverage).toBeCloseTo(3 / 16);
  });

  it("combines the multipart pieces whose conditions match", async () => {
    const textures = BlockTextures.fromAssets(await fakeJar({
      "blockstates/fence.json": {
        multipart: [
          { apply: { model: "block/post" } },
          { when: { north: "true|low" }, apply: { model: "block/arm" } },
          { when: { OR: [{ east: "true" }, { west: "true" }] }, apply: { model: "block/arm", y: 90 } },
        ],
      },
      "models/block/post.json": { textures: { all: "block/red" }, elements: [box([6, 0, 6], [10, 16, 10], "#all")] },
      "models/block/arm.json": { textures: { all: "block/blue" }, elements: [box([7, 0, 0], [9, 15, 6], "#all")] },
    }));
    const view = await textures.topView(`minecraft:fence {"north":"low","east":"false","west":"true"}`);

    expect(pixel(view!.pixels, 8, 8)).toEqual(RED);
    expect(pixel(view!.pixels, 8, 1)).toEqual(BLUE);
    expect(pixel(view!.pixels, 14, 8)).toEqual(BLUE);
    expect(pixel(view!.pixels, 8, 14)[3]).toBe(0);
  });

  it("recolours samples to the zoomed-out map colour", async () => {
    const textures = BlockTextures.fromAssets(await fakeJar({
      "blockstates/stone.json": { variants: { "": { model: "block/cube" } } },
      "models/block/cube.json": { textures: { all: "block/red" }, elements: [box([0, 0, 0], [16, 16, 16], "#all")] },
    }));
    const samples = await textures.samples(["minecraft:stone"], () => [128, 0, 0]);

    expect([...samples.get("minecraft:stone")!.subarray(0, 4)]).toEqual([128, 0, 0, 255]);
  });

  it("lists blocks that can leave their cell partly uncovered", async () => {
    const textures = BlockTextures.fromAssets(await fakeJar({
      "blockstates/stone.json": { variants: { "": { model: "block/cube" } } },
      "blockstates/torch.json": { variants: { "": { model: "block/torch" } } },
      "models/block/cube.json": { textures: { all: "block/blue" }, elements: [box([0, 0, 0], [16, 16, 16], "#all")] },
      "models/block/torch.json": { textures: { all: "block/red" }, elements: [box([7, 0, 7], [9, 10, 9], "#all")] },
    }));
    const profile = await textures.profile();

    expect(profile.seeThrough).toEqual(["minecraft:torch"]);
    expect(profile.coverage["minecraft:stone"]).toBe(1);
    expect(profile.colors["minecraft:torch"]).toEqual([255, 0, 0]);
  });
});