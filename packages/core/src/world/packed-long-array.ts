export class PackedLongArray {
    private readonly values: BigInt64Array;
    private readonly bitsPerValue: number;
    private readonly valueMask: bigint;
    private readonly valuesPerLong: number;

    public constructor(
        values: BigInt64Array,
        bitsPerValue: number,
    ) {
        if (
            !Number.isInteger(bitsPerValue) ||
            bitsPerValue <= 0 ||
            bitsPerValue > 32
        ) {
            throw new Error(`Invalid bits per value: ${bitsPerValue}.`);
        }

        this.values = values;
        this.bitsPerValue = bitsPerValue;
        this.valueMask = (1n << BigInt(bitsPerValue)) - 1n;
        this.valuesPerLong = Math.floor(64 / bitsPerValue);
    }

    public get(index: number): number {
        if (!Number.isInteger(index) || index < 0) {
            throw new Error(`Invalid packed array index: ${index}.`);
        }

        const paddedLength = Math.ceil(4096 / this.valuesPerLong);
        const continuousLength = Math.ceil(4096 * this.bitsPerValue / 64);
        const padded = this.values.length === paddedLength || paddedLength === continuousLength;
        const bitIndex = padded
            ? (index % this.valuesPerLong) * this.bitsPerValue
            : index * this.bitsPerValue;
        const longIndex = padded
            ? Math.floor(index / this.valuesPerLong)
            : Math.floor(bitIndex / 64);
        const bitOffset = padded ? bitIndex : bitIndex % 64;

        if (longIndex >= this.values.length) {
            throw new Error(`Packed array index ${index} is out of bounds.`);
        }

        let value = BigInt.asUintN(
            64,
            this.values[longIndex],
        );

        if (bitOffset + this.bitsPerValue <= 64) {
            return Number(
                (value >> BigInt(bitOffset)) &
                this.valueMask,
            );
        }

        const firstBits = 64 - bitOffset;
        const secondBits = this.bitsPerValue - firstBits;
        const firstMask = (1n << BigInt(firstBits)) - 1n;
        const firstPart = (value >> BigInt(bitOffset)) & firstMask;
        const secondValue = BigInt.asUintN(
            64,
            this.values[longIndex + 1],
        );
        const secondMask = (1n << BigInt(secondBits)) - 1n;
        const secondPart = secondValue & secondMask;

        return Number(
            firstPart |
            (secondPart << BigInt(firstBits)),
        );
    }
}