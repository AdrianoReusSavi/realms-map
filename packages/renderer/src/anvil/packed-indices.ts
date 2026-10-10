export function bitsPerIndexForPalette(paletteLength: number): number {
  if (paletteLength <= 1) return 0;
  
  let bits = 1;
  
  while ((1 << bits) < paletteLength) bits++;
  
  return Math.max(4, bits);
}

export function decodePackedIndices(
  data: bigint[],
  bitsPerIndex: number,
  count: number,
): number[] {
  if (bitsPerIndex === 0 || data.length === 0) {
    return new Array(count).fill(0);
  }

  const indicesPerLong = Math.floor(64 / bitsPerIndex);
  const mask = (1n << BigInt(bitsPerIndex)) - 1n;
  const result = new Array<number>(count);

  for (let i = 0; i < count; i++) {
    const longIdx = Math.floor(i / indicesPerLong);
    const subIdx = i % indicesPerLong;
    const longVal = BigInt.asUintN(64, data[longIdx]);
    const shifted = longVal >> BigInt(subIdx * bitsPerIndex);
    result[i] = Number(shifted & mask);
  }

  return result;
}

export function encodePackedIndices(
  indices: number[],
  bitsPerIndex: number,
): bigint[] {
  if (bitsPerIndex === 0) return [];

  const indicesPerLong = Math.floor(64 / bitsPerIndex);
  const longCount = Math.ceil(indices.length / indicesPerLong);
  const longs = new Array<bigint>(longCount).fill(0n);

  for (let i = 0; i < indices.length; i++) {
    const longIdx = Math.floor(i / indicesPerLong);
    const subIdx = i % indicesPerLong;
    longs[longIdx] |= BigInt(indices[i]) << BigInt(subIdx * bitsPerIndex);
  }
  
  return longs.map((v) => BigInt.asIntN(64, v));
}