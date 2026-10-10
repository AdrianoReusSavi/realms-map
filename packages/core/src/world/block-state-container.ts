import type { NbtList } from "../nbt/index.js";
import { BlockStatePalette } from "./block-state-palette.js";
import { PackedLongArray } from "./packed-long-array.js";
import type { BlockState } from "./block-state.js";

export class BlockStateContainer {
    private readonly palette: BlockStatePalette;
    private readonly data: PackedLongArray | null;

    public constructor(
        palette: NbtList,
        data: BigInt64Array | null,
    ) {
        this.palette = new BlockStatePalette(palette);

        if (data === null) {
            this.data = null;
            return;
        }

        const bitsPerValue = this.calculateBitsPerValue();

        this.data = new PackedLongArray(
            data,
            bitsPerValue,
        );
    }

    public get(x: number, y: number, z: number): BlockState {
        this.validateCoordinates(x, y, z);

        if (this.palette.size === 1) {
            return this.palette.get(0);
        }

        if (this.data === null) {
            throw new Error("Block state data is missing.");
        }

        const index = this.toIndex(x, y, z);
        const paletteIndex = this.data.get(index);
        
        return this.palette.get(
            paletteIndex,
        );
    }

    public get paletteSize(): number {
        return this.palette.size;
    }

    private calculateBitsPerValue(): number {
        if (this.palette.size <= 1) {
            return 0;
        }

        return Math.max(
            4,
            Math.ceil(Math.log2(this.palette.size))
        );
    }

    private toIndex(
        x: number,
        y: number,
        z: number
    ): number {
        return (
            (y * 16 + z) * 16 + x
        );
    }

    private validateCoordinates(
        x: number,
        y: number,
        z: number
    ): void {
        if (
            x < 0 || x >= 16 ||
            y < 0 || y >= 16 ||
            z < 0 || z >= 16
        ) {
            throw new Error(
                `Invalid section coordinates: ` +
                `(${x}, ${y}, ${z}). ` +
                `Expected values from 0 to 15.`,
            );
        }
    }
}