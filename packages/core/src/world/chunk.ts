import type { NbtCompound, NbtList } from "../nbt/index.js";
import { ChunkSection } from "./section.js";
import type { BlockState } from "./block-state.js";

export class Chunk {
    private readonly sections: readonly ChunkSection[];

    private constructor(
        public readonly x: number,
        public readonly z: number,
        sections: readonly ChunkSection[],
    ) {
        this.sections = [...sections].sort((a, b) => b.y - a.y);
    }

    public static fromNbt(
        value: NbtCompound,
        x: number,
        z: number,
    ): Chunk {
        const sectionsValue = value.sections;

        if (!this.isList(sectionsValue)) {
            throw new Error("Chunk does not contain a valid sections list.");
        }

        const sections = sectionsValue.values.map(
            (sectionValue) => {
                if (!this.isCompound(sectionValue)) {
                    throw new Error("Invalid chunk section NBT.");
                }
                
                return ChunkSection.fromNbt(
                    sectionValue,
                );
            },
        );

        return new Chunk(
            x,
            z,
            sections
        );
    }

    public getBlock(x: number, y: number, z: number): BlockState {
        if (x < 0 || x >= 16 ||
            z < 0 || z >= 16
        ) {
            throw new Error(
                `Invalid chunk coordinates: ` +
                `(${x}), (${y}), (${z}).`,
            );
        }

        const sectionY = Math.floor(y / 16);
        const localY = y - sectionY * 16;
        const section = this.sections.find(
            (value) => value.y === sectionY,
        );

        if (section === undefined) {
            throw new Error(`Chunk section ${sectionY} was not found.`);
        }

        return section.getBlock(
            x,
            localY,
            z,
        );
    }

    public getSurfaceBlock(x: number, z: number): { y: number; state: BlockState } | null {
        return this.getSurfaceColumn(x, z).surface;
    }

    public getSurfaceColumn(x: number, z: number): {
        surface: { y: number; state: BlockState } | null;
        underwater?: { y: number; state: BlockState; depth: number };
        ground?: { y: number; state: BlockState };
    } {
        if (!Number.isInteger(x) || x < 0 || x >= 16 || !Number.isInteger(z) || z < 0 || z >= 16) {
            throw new Error(`Invalid chunk coordinates: (${x}, ${z}).`);
        }

        let surface: { y: number; state: BlockState } | null = null;
        let underwater: { y: number; state: BlockState; depth: number } | undefined;

        for (const section of this.sections) {
            for (let localY = 15; localY >= 0; localY--) {
                const state = section.getBlock(x, localY, z);

                if (isAir(state.id)) continue;

                const y = section.y * 16 + localY;

                if (surface === null) {
                    if (isAquaticDecoration(state.id)) {
                        surface = { y: y + 1, state: { id: "minecraft:water", properties: { level: "0" } } };
                        underwater = { y, state, depth: 1 };

                        continue;
                    }

                    surface = { y, state };

                    if (isDecoration(state.id)) continue;
                    if (!isWater(state.id)) return { surface };

                    continue;
                }

                if (isWater(surface.state.id)) {
                    if (isWater(state.id)) continue;

                    if (underwater === undefined) {
                        underwater = { y, state, depth: surface.y - y };
                        if (isDecoration(state.id)) continue;
                        return { surface, underwater };
                    }

                    if (isDecoration(underwater.state.id)) {
                        if (isDecoration(state.id) || isWater(state.id)) continue;
                        return { surface, underwater, ground: { y, state } };
                    }

                    return { surface, underwater };
                }

                if (isDecoration(surface.state.id)) {
                    if (isWater(state.id)) {
                        const decoration = surface;

                        surface = { y, state };
                        underwater = { ...decoration, depth: 0 };

                        continue;
                    }

                    if (isDecoration(state.id)) continue;

                    return { surface, ground: { y, state } };
                }

                return { surface };
            }
        }

        return { surface };
    }

    private static isCompound(value: unknown): value is NbtCompound {
        return (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
        );
    }

    public static isList(value: unknown): value is NbtList {
        return (
            this.isCompound(value) &&
            typeof value.elementType === "number" &&
            Array.isArray(value.values)
        );
    }
}

function isAir(id: string): boolean {
    return id === "minecraft:air" || id === "minecraft:cave_air" || id === "minecraft:void_air";
}

function isWater(id: string): boolean {
    return id === "minecraft:water" || id === "minecraft:bubble_column";
}

function isAquaticDecoration(id: string): boolean {
    return id === "minecraft:seagrass" || id === "minecraft:tall_seagrass" || id === "minecraft:kelp" || id === "minecraft:kelp_plant";
}

function isDecoration(id: string): boolean {
    const name = id.slice(id.indexOf(":") + 1);
    return /^(?:dandelion|poppy|blue_orchid|allium|azure_bluet|tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|short_grass|tall_grass|fern|large_fern|wheat|carrots|potatoes|beetroots|torchflower_crop|pitcher_crop|sapling|.*_sapling|.*_mushroom|dead_bush|sugar_cane|bamboo|.*_vine|cocoa|sweet_berry_bush|nether_wart|reeds|pink_petals|wildflowers|bush|firefly_bush|short_dry_grass|seagrass|tall_seagrass|kelp|kelp_plant|sea_pickle|pointed_dripstone)$/i.test(name);
}