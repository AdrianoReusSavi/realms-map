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
        if (!Number.isInteger(x) || x < 0 || x >= 16 || !Number.isInteger(z) || z < 0 || z >= 16) {
            throw new Error(`Invalid chunk coordinates: (${x}, ${z}).`);
        }

        for (const section of this.sections) {
            for (let localY = 15; localY >= 0; localY--) {
                const state = section.getBlock(x, localY, z);
                if (state.id !== "minecraft:air" && state.id !== "minecraft:cave_air" && state.id !== "minecraft:void_air") {
                    return { y: section.y * 16 + localY, state };
                }
            }
        }

        return null;
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