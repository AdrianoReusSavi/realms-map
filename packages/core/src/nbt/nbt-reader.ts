export class BinaryReader {
    private readonly buffer: Buffer;
    private offset = 0;

    public constructor(buffer: Buffer) {
        this.buffer = buffer;
    }

    public get position(): number {
        return this.offset;
    }

    public get remaining(): number {
        return this.buffer.length - this.offset;
    }

    public readByte(): number {
        this.ensureAvaliable(1);

        return this.buffer.readInt8(this.offset++);
    }

    public readUnsignedByte(): number {
        this.ensureAvaliable(1);

        return this.buffer.readInt8(this.offset++);
    }

    public readShort(): number {
        this.ensureAvaliable(2);

        const value = this.buffer.readInt16BE(this.offset);
        this.offset += 2;

        return value;
    }

    public readInt(): number {
        this.ensureAvaliable(4);

        const value = this.buffer.readInt32BE(this.offset);
        this.offset += 4;

        return value;
    }

    public readLong(): bigint {
        this.ensureAvaliable(8);

        const value = this.buffer.readBigInt64BE(this.offset);
        this.offset += 8;

        return value;
    }

    public readFloat(): number {
        this.ensureAvaliable(4);

        const value = this.buffer.readFloatBE(this.offset);
        this.offset += 4;

        return value;
    }

    public readDouble(): number {
        this.ensureAvaliable(8);

        const value = this.buffer.readDoubleBE(this.offset);
        this.offset += 8;

        return value;
    }

    public readBytes(length: number): Buffer {
        if (length < 0) {
            throw new Error(`Invalid byte length ${length}`);
        }

        this.ensureAvaliable(length);

        const value = this.buffer.subarray(
            this.offset,
            this.offset + length
        );

        this.offset += length;

        return value;
    }

    public readString(): string {
        const length = this.readUnsignedShort();

        return this.readBytes(length).toString("utf8");
    }

    private readUnsignedShort(): number {
        this.ensureAvaliable(2);

        const value = this.buffer.readUint16BE(this.offset);
        this.offset += 2;

        return value;
    }

    private ensureAvaliable(length: number): void {
        if (this.offset + length > this.buffer.length) {
            throw new Error(
                `Unexpected end of buffer at offset ${this.offset}.` +
                `Needed ${length} bytes, but only ${this.remaining} remain.`,
            );
        }
    }
}

import {
    NbtTagType,
    type NbtCompound,
    type NbtList,
    type NbtValue,
} from "./types.js";

export class NbtReader {
    private readonly reader: BinaryReader;

    public constructor(buffer: Buffer) {
        this.reader = new BinaryReader(buffer);
    }

    public read(): NbtCompound {
        const rootType = this.reader.readUnsignedByte();

        if (rootType !== NbtTagType.Compound) {
            throw new Error(
                `Invalid NBT root tag. Expected Compound (10), got ${rootType}`,
            );
        }

        this.reader.readString();

        return this.readCompound();
    }

    private readCompound(): NbtCompound {
        const compound: NbtCompound = {};

        while (true) {
            const type = this.reader.readUnsignedByte();

            if (type === NbtTagType.End) {
                break;
            }

            const name = this.reader.readString();

            compound[name] = this.readPayload(type);
        }

        return compound;
    }

    private readPayload(type: number): NbtValue {
        switch (type) {
            case NbtTagType.Byte:
                return this.reader.readByte();
            case NbtTagType.Short:
                return this.reader.readShort();
            case NbtTagType.Int:
                return this.reader.readInt();
            case NbtTagType.Long:
                return this.reader.readLong();
            case NbtTagType.Float:
                return this.reader.readFloat();
            case NbtTagType.Double:
                return this.reader.readDouble();
            case NbtTagType.ByteArray:
                return this.readByteArray();
            case NbtTagType.String:
                return this.reader.readString();
            case NbtTagType.List:
                return this.readList();
            case NbtTagType.Compound:
                return this.readCompound();
            case NbtTagType.IntArray:
                return this.readIntArray();
            case NbtTagType.LongArray:
                return this.readLongArray();
            default:
                throw new Error(`Unknown NBT tag type: ${type}`);
        }
    }

    private readByteArray(): Uint8Array {
        const length = this.reader.readInt();

        if (length < 0) {
            throw new Error(`Invalid NBT type array length: ${length}`);
        }

        return this.reader.readBytes(length);
    }

    private readList(): NbtList {
        const elementType = this.reader.readUnsignedByte();
        const length = this.reader.readInt();

        if (length < 0) {
            throw new Error(`Invalid NBT list length: ${length}`);
        }

        const values: NbtValue[] = [];

        for (let i = 0; i < length; i++) {
            values.push(this.readPayload(elementType));
        }

        return { 
            elementType,
            values,
        };
    }

    private readIntArray(): Int32Array {
        const length = this.reader.readInt();

        if (length < 0) {
            throw new Error(`Invalid NBT int array length: ${length}`);
        }

        const values = new Int32Array(length);

        for (let i = 0; i < length; i++) {
            values[i] = this.reader.readInt();
        }

        return values;
    }

    private readLongArray(): BigInt64Array {
        const length = this.reader.readInt();

        if (length < 0) {
            throw new Error(`Invalid NBT long array length: ${length}`);
        }

        const values = new BigInt64Array(length);

        for (let i = 0; i < length; i++) {
            values[i] = this.reader.readLong();
        }

        return values;
    }
}