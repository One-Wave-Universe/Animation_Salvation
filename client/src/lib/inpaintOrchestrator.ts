import type { RigDescription } from '../types';
import type { CharacterLayer, PixelAssignment } from './layerBuilder';
import type { OcclusionRegion } from './occlusion';
import { computeImageToModelTransform } from './meshBuilder';

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8787';

export interface InpaintProgress {
  done: number;
  total: number;
  boneId: string;
}

/**
 * Calls /api/inpaint-layer once per occlusion region and returns an updated layer
 * list with the affected layers replaced by wider canvases that include the filled
 * content. Layers with no occlusion region are passed through unchanged.
 */
export async function applyInpainting(
  layers: CharacterLayer[],
  regions: OcclusionRegion[],
  assignment: PixelAssignment,
  rig: RigDescription,
  mask: Uint8Array,
  depth: Float32Array,
  imgWidth: number,
  imgHeight: number,
  sourceCanvas: HTMLCanvasElement,
  onProgress?: (p: InpaintProgress) => void,
): Promise<CharacterLayer[]> {
  if (regions.length === 0) return layers;

  const boneById = new Map(rig.bones.map((b) => [b.id, b]));
  const transform = computeImageToModelTransform(mask, depth, imgWidth, imgHeight);
  const layerByBoneId = new Map(layers.map((l) => [l.boneId, l]));
  const { layerIndex, indexByBoneId } = assignment;

  let done = 0;
  for (const region of regions) {
    onProgress?.({ done, total: regions.length, boneId: region.targetBoneId });

    const existing = layerByBoneId.get(region.targetBoneId);
    const bone = boneById.get(region.targetBoneId);
    if (!existing || !bone) {
      done++;
      continue;
    }

    const { minX, minY, maxX, maxY } = region.extendedBBox;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;

    const imageCanvas = document.createElement('canvas');
    imageCanvas.width = w;
    imageCanvas.height = h;
    imageCanvas.getContext('2d')!.drawImage(sourceCanvas, minX, minY, w, h, 0, 0, w, h);

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext('2d')!;
    const maskData = maskCtx.createImageData(w, h);
    for (let i = 0; i < region.needsFill.length; i++) {
      // OpenAI images.edit convention: transparent (alpha 0) = regenerate, opaque = keep.
      maskData.data[i * 4 + 3] = region.needsFill[i] ? 0 : 255;
    }
    maskCtx.putImageData(maskData, 0, 0);

    let resultDataUrl: string;
    try {
      const res = await fetch(`${API_BASE}/api/inpaint-layer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: imageCanvas.toDataURL('image/png'),
          maskBase64: maskCanvas.toDataURL('image/png'),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Server error (${res.status})`);
      resultDataUrl = data.imageBase64 as string;
    } catch (err) {
      // One region failing shouldn't sink the whole pass — that layer just keeps its
      // original (possibly gappy) texture, same as if inpainting were never run.
      console.warn(`Inpainting failed for ${region.targetBoneId}:`, err);
      done++;
      continue;
    }

    const filledImg = await loadImage(resultDataUrl);
    const finalCanvas = document.createElement('canvas');
    finalCanvas.width = w;
    finalCanvas.height = h;
    const finalCtx = finalCanvas.getContext('2d')!;
    finalCtx.drawImage(filledImg, 0, 0, w, h);

    const targetIndex = indexByBoneId.get(region.targetBoneId);
    const finalData = finalCtx.getImageData(0, 0, w, h);
    for (let ly = 0; ly < h; ly++) {
      for (let lx = 0; lx < w; lx++) {
        const srcX = minX + lx;
        const srcY = minY + ly;
        const local = ly * w + lx;
        const isOwnPixel = layerIndex[srcY * imgWidth + srcX] === targetIndex;
        const isFilled = region.needsFill[local] > 0;
        if (!isOwnPixel && !isFilled) finalData.data[local * 4 + 3] = 0;
      }
    }
    finalCtx.putImageData(finalData, 0, 0);

    const [centerModelX, centerModelY] = transform.toModelXY((minX + maxX) / 2, (minY + maxY) / 2);
    layerByBoneId.set(region.targetBoneId, {
      ...existing,
      canvas: finalCanvas,
      width: w * transform.scale,
      height: h * transform.scale,
      centerOffset: [centerModelX - bone.position[0], centerModelY - bone.position[1], existing.centerOffset[2]],
      pixelBBox: region.extendedBBox,
    });

    done++;
    onProgress?.({ done, total: regions.length, boneId: region.targetBoneId });
  }

  return layers.map((l) => layerByBoneId.get(l.boneId) ?? l);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
