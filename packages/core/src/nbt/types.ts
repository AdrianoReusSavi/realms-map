export enum NbtTagType {
    End = 0,
    Byte = 1,
    Short = 2,
    Int = 3,
    Long = 4,
    Float = 5,
    Double = 6,
    ByteArray = 7,
    String = 8,
    List = 9,
    Compound = 10,
    IntArray = 11,
    LongArray = 12,
}

export type NbtPrimitive =
    | number
    | bigint
    | string;

export type NbtValue =
    | NbtPrimitive
    | Uint8Array
    | Int32Array
    | BigInt64Array
    | NbtList
    | NbtCompound;

export interface NbtList {
    readonly elementType: NbtTagType;
    readonly values: readonly NbtValue[];
}

export interface NbtCompound {
    [name: string]: NbtValue;
}