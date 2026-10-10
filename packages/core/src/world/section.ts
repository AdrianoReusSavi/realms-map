import type { NbtCompound, NbtList } from "../nbt/index.js";
import { BlockStateContainer } from "./block-state-container.js";
import type { BlockState } from "./block-state.js";

export class ChunkSection {
    public readonly y: number;
    private readonly blockStates: BlockStateContainer;

    private constructor(
        y: number,
        blockStates: BlockStateContainer,
    ) {
        this.y = y;
        this.blockStates = blockStates;
    }

    public static fromNbt(value: NbtCompound): ChunkSection {
        const y = value.Y;

        if (typeof y !== "number") {
            throw new Error("Chunk section does not contain a valid Y.");
        }

        const modern = value.block_states;
        const legacyPalette = value.Palette;
        const blockStates = this.isCompound(modern) ? modern : null;
        const pallete = blockStates?.palette ?? legacyPalette;

        if (pallete === undefined) {
            return new ChunkSection(y, new BlockStateContainer(
                { elementType: 10, values: [{ Name: "minecraft:air" }] },
                null,
            ));
        }

        if (!this.isList(pallete)) {
            throw new Error("Chunk section block_states does not contain a palette.");
        }

        const data = blockStates?.data ?? value.BlockStates;

        if (data !== undefined && !this.isBigIntArray(data)) {
            throw new Error("Chunk section block_states.data is invalid.");
        }

        return new ChunkSection(
            y,
            new BlockStateContainer(
                pallete,
                data ?? null,
            ),
        );
    }

    public getBlock(x: number, y: number, z: number): BlockState {
        return this.blockStates.get(x, y, z);
    }
    
    public get paletteSize(): number {
        return this.blockStates.paletteSize;
    }

    private static isCompound(value: unknown): value is NbtCompound {
        return (
            typeof value === "object" &&
            value !== null &&
            !Array.isArray(value)
        );
    }

    private static isList(value: unknown): value is NbtList {
        return (
            this.isCompound(value) &&
            typeof value.elementType === "number" &&
            Array.isArray(value.values)
        );
    }

    private static isBigIntArray(value: unknown): value is BigInt64Array {
        return value instanceof BigInt64Array;
    }
}