import * as THREE from 'three';
import { loadImageFile, extractMask } from './imageProcessing';
import { buildCharacterMesh } from './meshBuilder';
import { skeletonize } from './skeletonize';
import { buildRig } from './rigBuilder';
import { buildSkinnedMesh } from './skinning';
import { estimateDepth, mockDepth, shouldUseMockDepth } from './depthEstimation';
import { setActiveCharacter } from './sceneRuntime';
import type { RigDescription } from '../types';

export interface PipelineResult {
  imageUrl: string;
  rig: RigDescription;
}

export interface PipelineCallbacks {
  onStage: (stage: string, label?: string) => void;
}

export interface CurrentCharacterData {
  sourceCanvas: HTMLCanvasElement;
  mask: Uint8Array;
  depth: Float32Array;
  width: number;
  height: number;
  rig: RigDescription;
}

let current: CurrentCharacterData | null = null;

/** For the "save this character" action — whatever's currently loaded, regardless
 *  of whether it came from a fresh upload or was itself loaded from a save. */
export function getCurrentCharacterData(): CurrentCharacterData | null {
  return current;
}

export async function runPipeline(file: File, callbacks: PipelineCallbacks): Promise<PipelineResult> {
  callbacks.onStage('loading-image', 'Reading image…');
  const img = await loadImageFile(file);
  const mask = extractMask(img);

  callbacks.onStage('estimating-depth', 'Loading depth model…');
  const dataUrl = img.canvas.toDataURL('image/png');
  const depth = shouldUseMockDepth()
    ? mockDepth(mask, img.width, img.height)
    : await estimateDepth(dataUrl, img.width, img.height, (label) => callbacks.onStage('estimating-depth', label));

  return assembleCharacter(img.canvas, mask, depth, img.width, img.height, undefined, callbacks);
}

/**
 * Rebuilds a character from previously-saved mask/depth/rig — skips the two
 * expensive/paid-adjacent steps (depth model inference, and re-deriving a rig that
 * may carry the user's own joint-type edits) entirely.
 */
export async function loadPipelineFromSaved(
  sourceCanvas: HTMLCanvasElement,
  mask: Uint8Array,
  depth: Float32Array,
  width: number,
  height: number,
  savedRig: RigDescription,
): Promise<PipelineResult> {
  return assembleCharacter(sourceCanvas, mask, depth, width, height, savedRig);
}

async function assembleCharacter(
  sourceCanvas: HTMLCanvasElement,
  mask: Uint8Array,
  depth: Float32Array,
  width: number,
  height: number,
  savedRig: RigDescription | undefined,
  callbacks?: PipelineCallbacks,
): Promise<PipelineResult> {
  callbacks?.onStage('building-mesh', 'Building 3D mesh…');
  const meshResult = buildCharacterMesh(mask, depth, width, height);

  let rig = savedRig;
  if (!rig) {
    callbacks?.onStage('building-rig', 'Extracting skeleton…');
    const graph = skeletonize(mask, width, height);
    rig = buildRig(graph, meshResult, mask, width, height);
  }

  const texture = new THREE.CanvasTexture(sourceCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.05,
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });

  const runtime = buildSkinnedMesh(meshResult.geometry, rig, material);
  setActiveCharacter('rig3d', runtime.skinnedMesh, runtime, () => {
    runtime.skinnedMesh.geometry.dispose();
    material.dispose();
    texture.dispose();
  });

  current = { sourceCanvas, mask, depth, width, height, rig };

  const imageUrl = sourceCanvas.toDataURL('image/png');
  return { imageUrl, rig };
}
