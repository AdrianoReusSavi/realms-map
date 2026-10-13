import type { Rgb } from "../palette/color-resolver.js";
import type { AssetPack, RgbaImage } from "./asset-pack.js";
import { type FaceName, type ModelElement, type ModelFace, type PlacedModel, type Vec3, textureOf } from "./block-model.js";

export const TOP_VIEW_SIZE = 16;

export type { Rgb };

export class TopView {
  readonly pixels = new Uint8Array(TOP_VIEW_SIZE * TOP_VIEW_SIZE * 4);
  private readonly depth = new Float32Array(TOP_VIEW_SIZE * TOP_VIEW_SIZE).fill(-Infinity);

  get coverage(): number {
    let covered = 0;

    for (let i = 3; i < this.pixels.length; i += 4) if (this.pixels[i] > 0) covered++;

    return covered / (TOP_VIEW_SIZE * TOP_VIEW_SIZE);
  }

  plot(x: number, z: number, height: number, rgba: ArrayLike<number>): void {
    if (x < 0 || x >= TOP_VIEW_SIZE || z < 0 || z >= TOP_VIEW_SIZE || rgba[3] === 0) return;

    const index = z * TOP_VIEW_SIZE + x;

    if (height < this.depth[index]) return;

    this.depth[index] = height;
    this.pixels.set([rgba[0], rgba[1], rgba[2], rgba[3]], index * 4);
  }

  averageColor(): Rgb | undefined {
    const sum = [0, 0, 0];
    let weight = 0;

    for (let i = 0; i < this.pixels.length; i += 4) {
      const alpha = this.pixels[i + 3];

      sum[0] += this.pixels[i] * alpha; sum[1] += this.pixels[i + 1] * alpha; sum[2] += this.pixels[i + 2] * alpha;
      weight += alpha;
    }

    return weight ? [Math.round(sum[0] / weight), Math.round(sum[1] / weight), Math.round(sum[2] / weight)] : undefined;
  }

  downsample(size: number): Buffer {
    const factor = TOP_VIEW_SIZE / size;
    const out = Buffer.alloc(size * size * 4);

    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        let best = -1;

        for (let dz = 0; dz < factor; dz++) {
          for (let dx = 0; dx < factor; dx++) {
            const i = ((z * factor + dz) * TOP_VIEW_SIZE + x * factor + dx) * 4;

            if (best < 0 || this.pixels[i + 3] > this.pixels[best + 3]) best = i;
          }
        }

        out.set(this.pixels.subarray(best, best + 4), (z * size + x) * 4);
      }
    }

    return out;
  }
}

export async function rasterizeTopView(
  assets: AssetPack,
  placed: PlacedModel[],
  tint: (tintIndex: number) => Rgb | undefined,
): Promise<TopView> {
  const view = new TopView();

  for (const { model, x, y } of placed) {
    for (const element of model.elements) {
      for (const [faceName, face] of Object.entries(element.faces) as [FaceName, ModelFace][]) {
        const texturePath = textureOf(model, face.texture);
        const texture = texturePath ? await assets.image(`textures/${texturePath}.png`) : null;

        if (!texture) continue;

        const corners = faceCorners(element, faceName).map((corner) => placeVertex(corner, element, x, y));
        const normal = placeNormal(FACE_NORMALS[faceName], element, x, y);
        const color = face.tintindex !== undefined ? tint(face.tintindex) : undefined;
        const sampler = faceSampler(texture, faceUv(element, faceName, face), face.rotation ?? 0, color);

        if (normal[1] > 0.2) drawTopFace(view, corners, sampler);
        else if (Math.abs(normal[1]) < 0.01 && isPlane(element, faceName)) drawPlane(view, corners, sampler);
      }
    }
  }

  return view;
}

type Sampler = (s: number, t: number) => Uint8Array | null;

const FACE_NORMALS: Record<FaceName, Vec3> = {
  up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};

function faceCorners({ from: [x0, y0, z0], to: [x1, y1, z1] }: ModelElement, face: FaceName): [Vec3, Vec3, Vec3] {
  switch (face) {
    case "up": return [[x0, y1, z0], [x1, y1, z0], [x0, y1, z1]];
    case "down": return [[x0, y0, z1], [x1, y0, z1], [x0, y0, z0]];
    case "north": return [[x1, y1, z0], [x0, y1, z0], [x1, y0, z0]];
    case "south": return [[x0, y1, z1], [x1, y1, z1], [x0, y0, z1]];
    case "west": return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z0]];
    case "east": return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z1]];
  }
}

function faceUv({ from: [x0, y0, z0], to: [x1, y1, z1] }: ModelElement, name: FaceName, face: ModelFace): [number, number, number, number] {
  if (face.uv) return face.uv;

  switch (name) {
    case "up": return [x0, z0, x1, z1];
    case "down": return [x0, 16 - z1, x1, 16 - z0];
    case "north": return [16 - x1, 16 - y1, 16 - x0, 16 - y0];
    case "south": return [x0, 16 - y1, x1, 16 - y0];
    case "west": return [z0, 16 - y1, z1, 16 - y0];
    case "east": return [16 - z1, 16 - y1, 16 - z0, 16 - y0];
  }
}

function isPlane({ from, to }: ModelElement, face: FaceName): boolean {
  const axis = face === "north" || face === "south" ? 2 : face === "west" || face === "east" ? 0 : 1;

  return from[axis] === to[axis];
}

function faceSampler(texture: RgbaImage, [u0, v0, u1, v1]: number[], rotation: number, tint?: Rgb): Sampler {
  const texel = new Uint8Array(4);
  const turns = (((rotation / 90) % 4) + 4) % 4;

  return (s, t) => {
    for (let i = 0; i < turns; i++) [s, t] = [t, 1 - s];

    const u = u0 + (u1 - u0) * s;
    const v = v0 + (v1 - v0) * t;
    const px = Math.min(texture.width - 1, Math.max(0, Math.floor(u / 16 * texture.width)));
    const py = Math.min(texture.height - 1, Math.max(0, Math.floor(v / 16 * texture.height)));
    const offset = (py * texture.width + px) * 4;

    if (texture.data[offset + 3] === 0) return null;

    texel.set(texture.data.subarray(offset, offset + 4));

    if (tint) for (let c = 0; c < 3; c++) texel[c] = Math.round(texel[c] * tint[c] / 255);

    return texel;
  };
}

function drawTopFace(view: TopView, [a, b, c]: Vec3[], sample: Sampler): void {
  const ex = [b[0] - a[0], b[2] - a[2]];
  const ey = [c[0] - a[0], c[2] - a[2]];
  const det = ex[0] * ey[1] - ex[1] * ey[0];

  if (Math.abs(det) < 1e-6) return;

  const minX = Math.floor(Math.min(a[0], b[0], c[0], b[0] + ey[0]));
  const maxX = Math.ceil(Math.max(a[0], b[0], c[0], b[0] + ey[0]));
  const minZ = Math.floor(Math.min(a[2], b[2], c[2], b[2] + ey[1]));
  const maxZ = Math.ceil(Math.max(a[2], b[2], c[2], b[2] + ey[1]));

  for (let z = Math.max(0, minZ); z < Math.min(TOP_VIEW_SIZE, maxZ); z++) {
    for (let x = Math.max(0, minX); x < Math.min(TOP_VIEW_SIZE, maxX); x++) {
      const px = x + 0.5 - a[0];
      const pz = z + 0.5 - a[2];
      const s = (px * ey[1] - pz * ey[0]) / det;
      const t = (ex[0] * pz - ex[1] * px) / det;

      if (s < 0 || s > 1 || t < 0 || t > 1) continue;

      const texel = sample(s, t);

      if (texel) view.plot(x, z, a[1] + (b[1] - a[1]) * s + (c[1] - a[1]) * t, texel);
    }
  }
}

function drawPlane(view: TopView, [a, b]: Vec3[], sample: Sampler): void {
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const top = Math.max(a[1], b[1]);
  const steps = Math.max(1, Math.ceil(length * 2));

  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const texel = columnColor(sample, s);

    if (!texel) continue;

    const x = a[0] + (b[0] - a[0]) * s;
    const z = a[2] + (b[2] - a[2]) * s;

    view.plot(Math.floor(x), Math.floor(z), top, texel);
  }
}

function columnColor(sample: Sampler, s: number): Uint8Array | null {
  const sum = [0, 0, 0];
  let count = 0;

  for (let t = 1 / 32; t < 1; t += 1 / 16) {
    const texel = sample(s, t);

    if (!texel) continue;

    sum[0] += texel[0]; sum[1] += texel[1]; sum[2] += texel[2];
    count++;
  }

  return count ? Uint8Array.of(sum[0] / count, sum[1] / count, sum[2] / count, 255) : null;
}

function placeVertex(vertex: Vec3, element: ModelElement, x: number, y: number): Vec3 {
  const origin = element.rotation?.origin ?? [8, 8, 8];

  return placeNormalOrPoint(rotateElement(vertex, element, origin), x, y, [8, 8, 8]);
}

function placeNormal(normal: Vec3, element: ModelElement, x: number, y: number): Vec3 {
  return placeNormalOrPoint(rotateElement(normal, element, [0, 0, 0], false), x, y, [0, 0, 0]);
}

function rotateElement(point: Vec3, { rotation }: ModelElement, origin: Vec3, allowRescale = true): Vec3 {
  if (!rotation) return point;

  if (rotation.axis) {
    const radians = (rotation.angle ?? 0) * Math.PI / 180;
    const scale = rotation.rescale && allowRescale ? 1 / Math.cos(radians) : 1;

    return rotate(point, origin, rotation.axis, radians, scale);
  }

  let rotated = point;

  for (const axis of ["x", "y", "z"] as const) {
    const angle = rotation[axis];

    if (angle) rotated = rotate(rotated, origin, axis, angle * Math.PI / 180, 1);
  }

  return rotated;
}

function placeNormalOrPoint(point: Vec3, x: number, y: number, origin: Vec3): Vec3 {
  const rotatedX = x ? rotate(point, origin, "x", -x * Math.PI / 180, 1) : point;

  return y ? rotate(rotatedX, origin, "y", -y * Math.PI / 180, 1) : rotatedX;
}

function rotate(point: Vec3, origin: Vec3, axis: "x" | "y" | "z", radians: number, scale: number): Vec3 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const [px, py, pz] = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
  let result: Vec3;

  switch (axis) {
    case "x": result = [px, (py * cos - pz * sin) * scale, (py * sin + pz * cos) * scale]; break;
    case "y": result = [(px * cos + pz * sin) * scale, py, (-px * sin + pz * cos) * scale]; break;
    case "z": result = [(px * cos - py * sin) * scale, (px * sin + py * cos) * scale, pz]; break;
  }

  return [
    Math.round((result[0] + origin[0]) * 1e6) / 1e6,
    Math.round((result[1] + origin[1]) * 1e6) / 1e6,
    Math.round((result[2] + origin[2]) * 1e6) / 1e6,
  ];
}