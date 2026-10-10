import { readFile } from "node:fs/promises";
import { gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";

import type { NbtCompound } from "./types.js";
import { NbtReader } from "./nbt-reader.js";

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

export enum NbtCompression {
    None = "none",
    Gzip = "gzip",
    Zlib = "zlib",
}

export class NbtFile {
    public static async read(
        path: string,
        compression?: NbtCompression,
    ): Promise<NbtCompound> {
        const data = await readFile(path);

        const decompressed = await this.decompress(
            data,
            compression ?? this.detectCompression(data),
        );

        return new NbtReader(decompressed).read();
    }

    private static async decompress(
        data: Buffer,
        compression: NbtCompression,
    ): Promise<Buffer> {
        switch (compression) {
            case NbtCompression.None:
                return data;
            case NbtCompression.Gzip:
                return gunzipAsync(data);
            case NbtCompression.Zlib:
                return inflateAsync(data);
            default:
                throw new Error(`Unsupported NBT compression: ${compression}`);
        }
    }

    private static detectCompression(data: Buffer): NbtCompression {
        if (data.length < 2) {
            return NbtCompression.None;
        }

        if (data[0] === 0x1f && data[1] === 0x8b) {
            return NbtCompression.Gzip;
        }

        if (data[0] === 0x78) {
            return NbtCompression.Zlib;
        }

        return NbtCompression.None;
    }
}