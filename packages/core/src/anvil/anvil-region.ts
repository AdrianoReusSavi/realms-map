import { readFile } from "node:fs/promises";
import { gunzip, inflate } from "node:zlib";
import { promisify } from "node:util";

import { NbtReader } from "../nbt/index.js";

import type { NbtCompound } from "../nbt/index.js";

import { Chunk } from "../world/index.js";

const SECTOR_SIZE = 4096;
const HEADER_SECTORS = 2;
const LOCATION_ENTRY_SIZE = 4;
const LOCATION_ENTRY_COUNT = 1024;

const gunzipAsync = promisify(gunzip);
const inflateAsync = promisify(inflate);

export interface AnvilChunkLocation {
    readonly offset: number;
    readonly sectorCount: number;
}

export class AnvilRegion {
    private readonly data: Buffer;

    private constructor(
        public readonly x: number,
        public readonly z: number,
        data: Buffer,
    ) {
        this.data = data;
    }

    public static async read(
        path: string,
        x: number,
        z: number,
    ): Promise<AnvilRegion> {
        const data = await readFile(path);

        if (data.length < HEADER_SECTORS * SECTOR_SIZE) {
            throw new Error(`Invalid Anvil region file. Expected at least ` +
                `${HEADER_SECTORS * SECTOR_SIZE} bytes, got ${data.length}.`,
            );
        }

        return new AnvilRegion(
            x,
            z,
            data,
        );
    }

    public getChunkLocation(
        chunkIndex: number,
    ): AnvilChunkLocation | null {
        if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= LOCATION_ENTRY_COUNT) {
            throw new Error(`Invalid chunk index: ${chunkIndex}. ` +
                `Expected a value between 0 and 1023.`,
            );
        }

        const entryOffset = chunkIndex * LOCATION_ENTRY_SIZE;
        const sectorOffset = this.data.readUintBE(entryOffset, 3);
        const sectorCount = this.data.readUint8(entryOffset + 3);

        if (sectorOffset === 0 || sectorCount === 0) {
            return null;
        }

        return {
            offset: sectorOffset,
            sectorCount,
        };
    }

    public getChunkData(
        chunkIndex: number,
    ): Buffer | null {
        const location = this.getChunkLocation(chunkIndex);

        if (location === null) {
            return null;
        }

        const byteOffset = location.offset * SECTOR_SIZE;
        const byteLength = location.sectorCount * SECTOR_SIZE;

        if (byteOffset < HEADER_SECTORS * SECTOR_SIZE || byteOffset + byteLength > this.data.length) {
            throw new Error(`Invalid chunk location for index ${chunkIndex}.`);
        }

        return this.data.subarray(
            byteOffset,
            byteOffset + byteLength,
        );
    }

    public async readChunk(
        chunkIndex: number,
    ): Promise<NbtCompound | null> {
        const chunkData = this.getChunkData(chunkIndex);

        if (chunkData === null) {
            return null;
        }

        if (chunkData.length < 5) {
            throw new Error(`Invalid chunk data for index ${chunkIndex}.`);
        }

        const length = chunkData.readUInt32BE(0);
        const compressionType = chunkData.readUint8(4);

        if (length < 1) {
            throw new Error(`Invalid chunk length: ${length}.`);
        }
        
        const compressedLength = length - 1;

        if (compressedLength > chunkData.length - 5) {
            throw new Error(`Chunk data exceeds allocated sectors.`);
        }

        const compressedData = chunkData.subarray(
            5,
            5 + compressedLength,
        );

        let decompressed: Buffer;

        switch (compressionType) {
            case 1:
                decompressed = await gunzipAsync(compressedData);
                break;
            case 2:
                decompressed = await inflateAsync(compressedData);
                break;
            case 3:
                decompressed = compressedData;
                break;
            default:
                throw new Error(`Unsupported Anvil compression type: ${compressionType}.`);
        }

        return new NbtReader(decompressed).read();
    }

    public async readChunkAt(
        chunkX: number,
        chunkZ: number,
    ): Promise<Chunk | null> {
        if (
            !Number.isInteger(chunkX) || !Number.isInteger(chunkZ)) {
            throw new Error(`Invalid chunk coordinates: (${chunkX}, ${chunkZ}).`);
        }

        const localX = chunkX & 31;
        const localZ = chunkZ & 31;
        const chunkIndex = localX + localZ * 32;
        const chunkNbt = await this.readChunk(chunkIndex);

        if (chunkNbt === null) {
            return null;
        }

        return Chunk.fromNbt(
            chunkNbt,
            chunkX,
            chunkZ,
        );
    }
}