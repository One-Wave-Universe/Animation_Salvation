import type { RigDescription } from '../types';
import type { PixelAssignment } from './layerBuilder';
import { dilate } from './imageProcessing';

export interface OcclusionRegion {
  /** The layer (parent bone) whose texture has a gap that needs filling. */
  targetBoneId: string;
  /** Pixel-space rectangle, in ORIGINAL image coordinates, covering the parent's own
   *  region plus the newly-identified gap — the crop to send for inpainting. */
  extendedBBox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Same size as extendedBBox (row-major), 255 = needs fill, 0 = keep as-is. */
  needsFill: Uint8Array;
}

const JOINT_DILATION_PX = 22;
const CONTEXT_PADDING_PX = 6;

interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Heuristic occlusion estimate: for every parent/child bone pair, "grow" the
 * parent's own visible region outward — a stand-in for "where the parent would
 * plausibly extend if nothing were in front of it" — and intersect that with the
 * child's actual region. The overlap is pixels currently painted as the child but
 * which plausibly belong to the parent underneath it (e.g. torso hidden behind an
 * upper arm). This is an approximation, not a physical occlusion solve — there is no
 * way to know the true hidden shape from one photo — but it targets inpainting at
 * exactly the seams where a moving limb is likely to reveal a gap, rather than
 * guessing blindly across the whole layer.
 */
export function computeOcclusionRegions(rig: RigDescription, assignment: PixelAssignment): OcclusionRegion[] {
  const { layerIndex, indexByBoneId, imgWidth, imgHeight } = assignment;
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const regions: OcclusionRegion[] = [];

  // Every bone's own bbox, computed once (a bone can be someone's parent multiple
  // times — recomputing this per pair was the main cost blowup on complex rigs).
  const bboxByIndex = new Map<number, BBox>();
  for (let y = 0; y < imgHeight; y++) {
    for (let x = 0; x < imgWidth; x++) {
      const idx = layerIndex[y * imgWidth + x];
      if (idx < 0) continue;
      const b = bboxByIndex.get(idx);
      if (!b) bboxByIndex.set(idx, { minX: x, minY: y, maxX: x, maxY: y });
      else {
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
      }
    }
  }

  for (const child of rig.bones) {
    if (!child.parentId) continue;
    const parent = byId.get(child.parentId);
    if (!parent) continue;

    const parentIndex = indexByBoneId.get(parent.id);
    const childIndex = indexByBoneId.get(child.id);
    if (parentIndex === undefined || childIndex === undefined) continue;

    const parentBBox = bboxByIndex.get(parentIndex);
    const childBBox = bboxByIndex.get(childIndex);
    if (!parentBBox || !childBBox) continue;

    // A dilated-parent/child overlap can only occur within JOINT_DILATION_PX of
    // BOTH bboxes at once — restrict all the pixel work (mask build + dilate) to
    // that small crop instead of the whole image. On a detailed rig (dozens of
    // bones, each pair scanning/dilating a full-size image) that whole-image
    // approach is what made this hang on real character art.
    const cropMinX = Math.max(0, Math.max(parentBBox.minX, childBBox.minX) - JOINT_DILATION_PX);
    const cropMinY = Math.max(0, Math.max(parentBBox.minY, childBBox.minY) - JOINT_DILATION_PX);
    const cropMaxX = Math.min(imgWidth - 1, Math.min(parentBBox.maxX, childBBox.maxX) + JOINT_DILATION_PX);
    const cropMaxY = Math.min(imgHeight - 1, Math.min(parentBBox.maxY, childBBox.maxY) + JOINT_DILATION_PX);
    if (cropMinX > cropMaxX || cropMinY > cropMaxY) continue; // bboxes too far apart to ever overlap

    const cw = cropMaxX - cropMinX + 1;
    const ch = cropMaxY - cropMinY + 1;
    const parentMask = new Uint8Array(cw * ch);
    const childMask = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const idx = layerIndex[(cropMinY + y) * imgWidth + (cropMinX + x)];
        if (idx === parentIndex) parentMask[y * cw + x] = 255;
        else if (idx === childIndex) childMask[y * cw + x] = 255;
      }
    }

    const dilatedParent = dilate(parentMask, cw, ch, JOINT_DILATION_PX);

    // needsFill pixels, in crop-local coords, translated to full-image coords for
    // the bbox math below (the final extendedBBox/needsFill array are always
    // expressed in full-image coordinates, same contract as before).
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const fillPixels: [number, number][] = [];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        if (dilatedParent[i] && childMask[i]) {
          const fx = cropMinX + x;
          const fy = cropMinY + y;
          fillPixels.push([fx, fy]);
          if (fx < minX) minX = fx;
          if (fx > maxX) maxX = fx;
          if (fy < minY) minY = fy;
          if (fy > maxY) maxY = fy;
        }
      }
    }
    if (fillPixels.length === 0) continue;

    // The inpainting crop needs the parent's FULL region for context, not just the
    // small joint-area crop used above to find the gap efficiently.
    const extMinX = Math.max(0, Math.min(parentBBox.minX, minX) - CONTEXT_PADDING_PX);
    const extMinY = Math.max(0, Math.min(parentBBox.minY, minY) - CONTEXT_PADDING_PX);
    const extMaxX = Math.min(imgWidth - 1, Math.max(parentBBox.maxX, maxX) + CONTEXT_PADDING_PX);
    const extMaxY = Math.min(imgHeight - 1, Math.max(parentBBox.maxY, maxY) + CONTEXT_PADDING_PX);
    const w = extMaxX - extMinX + 1;
    const h = extMaxY - extMinY + 1;

    const needsFill = new Uint8Array(w * h);
    for (const [fx, fy] of fillPixels) {
      needsFill[(fy - extMinY) * w + (fx - extMinX)] = 255;
    }

    regions.push({
      targetBoneId: parent.id,
      extendedBBox: { minX: extMinX, minY: extMinY, maxX: extMaxX, maxY: extMaxY },
      needsFill,
    });
  }

  return regions;
}
