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

export async function runPipeline(file: File, callbacks: PipelineCallbacks): Promise<PipelineResult> {
  callbacks.onStage('loading-image', 'Reading image…');
  const img = await loadImageFile(file);
  const mask = extractMask(img);

  callbacks.onStage('estimating-depth', 'Loading depth model…');
  const dataUrl = img.canvas.toDataURL('image/png');
  const depth = shouldUseMockDepth()
    ? mockDepth(mask, img.width, img.height)
    : await estimateDepth(dataUrl, img.width, img.height, (label) => callbacks.onStage('estimating-depth', label));

  callbacks.onStage('building-mesh', 'Building 3D mesh…');
  const meshResult = buildCharacterMesh(mask, depth, img.width, img.height);

  callbacks.onStage('building-rig', 'Extracting skeleton…');
  const graph = skeletonize(mask, img.width, img.height);
  const rig = buildRig(graph, meshResult, mask, img.width, img.height);

  const texture = new THREE.CanvasTexture(img.canvas);
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

  const imageUrl = img.canvas.toDataURL('image/png');
  return { imageUrl, rig };
}
