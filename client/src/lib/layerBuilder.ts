import type { RigDescription } from '../types';
import { computeImageToModelTransform, FRONT_DEPTH_SCALE } from './meshBuilder';

export interface CharacterLayer {
  boneId: string;
  /** Cropped RGBA texture — transparent everywhere except this layer's own pixels. */
  canvas: HTMLCanvasElement;
  /** Plane center, in model units, relative to the owning bone's own bind position. */
  centerOffset: [number, number, number];
  width: number;
  height: number;
  /** Mean depth (0..1) of this layer's pixels — used for render/occlusion ordering. */
  avgDepth01: number;
  pixelBBox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface PixelAssignment {
  /** -1 = outside silhouette or unassigned; otherwise an index into boneIdByIndex. */
  layerIndex: Int32Array;
  boneIdByIndex: string[];
  indexByBoneId: Map<string, number>;
  imgWidth: number;
  imgHeight: number;
}

const PADDING_PX = 2;

interface PixelCapsule {
  boneId: string;
  p0: [number, number];
  p1: [number, number];
}

/**
 * Assigns every silhouette pixel to its nearest bone (2D point-to-segment distance —
 * the 2D analogue of the 3D skin-weight capsules in boneHierarchy.ts, but a hard
 * assignment instead of a blend: a pixel belongs to exactly one layer, the way a
 * paper cutout has exactly one piece per part). Shared by buildLayers and
 * occlusion.ts so the two agree on exactly which pixels belong to which layer.
 */
export function assignPixelsToBones(mask: Uint8Array, rig: RigDescription, imgWidth: number, imgHeight: number): PixelAssignment {
  const capsules = buildPixelCapsules(rig);
  const layerIndex = new Int32Array(imgWidth * imgHeight).fill(-1);
  const boneIdByIndex = capsules.reduce<string[]>((acc, c) => {
    if (!acc.includes(c.boneId)) acc.push(c.boneId);
    return acc;
  }, []);
  const indexByBoneId = new Map(boneIdByIndex.map((id, i) => [id, i]));

  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const i = y * imgWidth + x;
      if (!mask[i]) continue;
      let bestDist = Infinity;
      let bestBone = -1;
      for (const cap of capsules) {
        const d = pointToSegmentDistance2D(x, y, cap.p0, cap.p1);
        if (d < bestDist) {
          bestDist = d;
          bestBone = indexByBoneId.get(cap.boneId)!;
        }
      }
      layerIndex[i] = bestBone;
    }
  }

  return { layerIndex, boneIdByIndex, indexByBoneId, imgWidth, imgHeight };
}

export function buildLayers(
  mask: Uint8Array,
  depth: Float32Array,
  imgWidth: number,
  imgHeight: number,
  rig: RigDescription,
  sourceCanvas: HTMLCanvasElement,
  assignment: PixelAssignment,
): CharacterLayer[] {
  const boneById = new Map(rig.bones.map((b) => [b.id, b]));
  const transform = computeImageToModelTransform(mask, depth, imgWidth, imgHeight);
  const { layerIndex, boneIdByIndex, indexByBoneId } = assignment;

  const layers: CharacterLayer[] = [];
  for (const boneId of boneIdByIndex) {
    const bone = boneById.get(boneId);
    if (!bone) continue;
    const targetIndex = indexByBoneId.get(boneId)!;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let depthSum = 0;
    let count = 0;
    for (let y = 0; y < imgHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        if (layerIndex[y * imgWidth + x] !== targetIndex) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        depthSum += depth[y * imgWidth + x];
        count++;
      }
    }
    if (count === 0) continue; // this bone owns no visible pixels (e.g. fully occluded)

    minX = Math.max(0, minX - PADDING_PX);
    minY = Math.max(0, minY - PADDING_PX);
    maxX = Math.min(imgWidth - 1, maxX + PADDING_PX);
    maxY = Math.min(imgHeight - 1, maxY + PADDING_PX);
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h);

    // Clear pixels that belong to a different layer (or to no layer at all) so this
    // canvas shows only this bone's own silhouette region.
    const imgData = ctx.getImageData(0, 0, w, h);
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const srcX = minX + lx;
        const srcY = minY + ly;
        if (layerIndex[srcY * imgWidth + srcX] !== targetIndex) {
          imgData.data[(ly * w + lx) * 4 + 3] = 0;
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);

    const avgDepth01 = depthSum / count;
    const [centerModelX, centerModelY] = transform.toModelXY((minX + maxX) / 2, (minY + maxY) / 2);
    const centerModelZ = avgDepth01 * FRONT_DEPTH_SCALE;

    layers.push({
      boneId,
      canvas,
      centerOffset: [centerModelX - bone.position[0], centerModelY - bone.position[1], centerModelZ - bone.position[2]],
      width: w * transform.scale,
      height: h * transform.scale,
      avgDepth01,
      pixelBBox: { minX, minY, maxX, maxY },
    });
  }

  return layers;
}

function buildPixelCapsules(rig: RigDescription): PixelCapsule[] {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const capsules: PixelCapsule[] = [];
  for (const bone of rig.bones) {
    if (!bone.parentId || !bone.pixelPosition) continue;
    const parent = byId.get(bone.parentId);
    if (!parent?.pixelPosition) continue;
    capsules.push({ boneId: bone.parentId, p0: parent.pixelPosition, p1: bone.pixelPosition });
  }
  for (const bone of rig.bones) {
    if (!bone.pixelPosition) continue;
    if (capsules.some((c) => c.boneId === bone.id)) continue;
    capsules.push({ boneId: bone.id, p0: bone.pixelPosition, p1: bone.pixelPosition });
  }
  return capsules;
}

function pointToSegmentDistance2D(px: number, py: number, a: [number, number], b: [number, number]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  if (len2 < 1e-8) return Math.hypot(px - a[0], py - a[1]);
  const t = Math.max(0, Math.min(1, ((px - a[0]) * abx + (py - a[1]) * aby) / len2));
  return Math.hypot(px - (a[0] + t * abx), py - (a[1] + t * aby));
}
