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

  for (const child of rig.bones) {
    if (!child.parentId) continue;
    const parent = byId.get(child.parentId);
    if (!parent) continue;

    const parentIndex = indexByBoneId.get(parent.id);
    const childIndex = indexByBoneId.get(child.id);
    if (parentIndex === undefined || childIndex === undefined) continue;

    const parentMask = new Uint8Array(imgWidth * imgHeight);
    const childMask = new Uint8Array(imgWidth * imgHeight);
    let parentMinX = Infinity;
    let parentMinY = Infinity;
    let parentMaxX = -Infinity;
    let parentMaxY = -Infinity;
    for (let y = 0; y < imgHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        const i = y * imgWidth + x;
        if (layerIndex[i] === parentIndex) {
          parentMask[i] = 255;
          if (x < parentMinX) parentMinX = x;
          if (x > parentMaxX) parentMaxX = x;
          if (y < parentMinY) parentMinY = y;
          if (y > parentMaxY) parentMaxY = y;
        } else if (layerIndex[i] === childIndex) {
          childMask[i] = 255;
        }
      }
    }
    if (parentMinX === Infinity) continue; // parent owns no pixels at all

    const dilatedParent = dilate(parentMask, imgWidth, imgHeight, JOINT_DILATION_PX);

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const needsFillFull = new Uint8Array(imgWidth * imgHeight);
    let any = false;
    for (let y = 0; y < imgHeight; y++) {
      for (let x = 0; x < imgWidth; x++) {
        const i = y * imgWidth + x;
        if (dilatedParent[i] && childMask[i]) {
          needsFillFull[i] = 255;
          any = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!any) continue;

    const extMinX = Math.max(0, Math.min(parentMinX, minX) - CONTEXT_PADDING_PX);
    const extMinY = Math.max(0, Math.min(parentMinY, minY) - CONTEXT_PADDING_PX);
    const extMaxX = Math.min(imgWidth - 1, Math.max(parentMaxX, maxX) + CONTEXT_PADDING_PX);
    const extMaxY = Math.min(imgHeight - 1, Math.max(parentMaxY, maxY) + CONTEXT_PADDING_PX);
    const w = extMaxX - extMinX + 1;
    const h = extMaxY - extMinY + 1;

    const needsFill = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        needsFill[y * w + x] = needsFillFull[(extMinY + y) * imgWidth + (extMinX + x)];
      }
    }

    regions.push({
      targetBoneId: parent.id,
      extendedBBox: { minX: extMinX, minY: extMinY, maxX: extMaxX, maxY: extMaxY },
      needsFill,
    });
  }

  return regions;
}
