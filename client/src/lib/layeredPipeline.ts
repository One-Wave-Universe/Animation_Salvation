import { loadImageFile, extractMask } from './imageProcessing';
import { buildCharacterMesh } from './meshBuilder';
import { skeletonize } from './skeletonize';
import { buildRig } from './rigBuilder';
import { assignPixelsToBones, buildLayers, type CharacterLayer, type PixelAssignment } from './layerBuilder';
import { computeOcclusionRegions, type OcclusionRegion } from './occlusion';
import { buildLayeredRig, disposeLayeredRig } from './layeredRig';
import { applyInpainting, type InpaintProgress } from './inpaintOrchestrator';
import { setActiveCharacter } from './sceneRuntime';
import { estimateDepth, mockDepth, shouldUseMockDepth } from './depthEstimation';
import type { RigDescription } from '../types';

export interface LayeredPipelineCallbacks {
  onStage: (stage: string, label?: string) => void;
}

export interface LayeredPipelineResult {
  imageUrl: string;
  rig: RigDescription;
  regionsCount: number;
}

/** Held so a later "fill hidden areas" click can re-run inpainting without redoing the free steps. */
interface LayeredRecipe {
  rig: RigDescription;
  mask: Uint8Array;
  depth: Float32Array;
  imgWidth: number;
  imgHeight: number;
  sourceCanvas: HTMLCanvasElement;
  assignment: PixelAssignment;
  regions: OcclusionRegion[];
  layers: CharacterLayer[];
  inpaintDone: boolean;
}

let recipe: LayeredRecipe | null = null;

export interface CurrentLayeredData {
  rig: RigDescription;
  mask: Uint8Array;
  depth: Float32Array;
  imgWidth: number;
  imgHeight: number;
  sourceCanvas: HTMLCanvasElement;
  layers: CharacterLayer[];
  inpaintDone: boolean;
}

/** For the "save this character" action — whatever's currently loaded, regardless
 *  of whether it came from a fresh upload or was itself loaded from a save. */
export function getCurrentLayeredData(): CurrentLayeredData | null {
  if (!recipe) return null;
  const { rig, mask, depth, imgWidth, imgHeight, sourceCanvas, layers, inpaintDone } = recipe;
  return { rig, mask, depth, imgWidth, imgHeight, sourceCanvas, layers, inpaintDone };
}

export async function runLayeredPipeline(file: File, callbacks: LayeredPipelineCallbacks): Promise<LayeredPipelineResult> {
  callbacks.onStage('loading-image', 'Reading image…');
  const img = await loadImageFile(file);
  const mask = extractMask(img);

  callbacks.onStage('estimating-depth', 'Loading depth model…');
  const dataUrl = img.canvas.toDataURL('image/png');
  const depth = shouldUseMockDepth()
    ? mockDepth(mask, img.width, img.height)
    : await estimateDepth(dataUrl, img.width, img.height, (label) => callbacks.onStage('estimating-depth', label));

  // Only sampleFront (pixel -> model space) is needed from the relief-mesh builder;
  // the geometry itself isn't rendered in this mode.
  callbacks.onStage('building-rig', 'Extracting skeleton & rig…');
  const meshResult = buildCharacterMesh(mask, depth, img.width, img.height);
  const graph = skeletonize(mask, img.width, img.height);
  const rig = buildRig(graph, meshResult, mask, img.width, img.height);
  meshResult.geometry.dispose();

  return assembleLayered(img.canvas, mask, depth, img.width, img.height, rig, null, callbacks);
}

/**
 * Rebuilds a layered character from previously-saved data. If inpainting was
 * already run, the saved layers (which include the AI-filled pixels — not
 * something derivable from mask/depth/rig alone) are reused as-is instead of
 * being rebuilt, so a paid inpainting pass is never silently lost on reload.
 */
export async function loadLayeredPipelineFromSaved(
  sourceCanvas: HTMLCanvasElement,
  mask: Uint8Array,
  depth: Float32Array,
  width: number,
  height: number,
  rig: RigDescription,
  savedLayers: CharacterLayer[] | null,
): Promise<LayeredPipelineResult> {
  return assembleLayered(sourceCanvas, mask, depth, width, height, rig, savedLayers);
}

async function assembleLayered(
  sourceCanvas: HTMLCanvasElement,
  mask: Uint8Array,
  depth: Float32Array,
  width: number,
  height: number,
  rig: RigDescription,
  savedLayers: CharacterLayer[] | null,
  callbacks?: LayeredPipelineCallbacks,
): Promise<LayeredPipelineResult> {
  callbacks?.onStage('building-rig', 'Splitting into layers…');
  const assignment = assignPixelsToBones(mask, rig, width, height);
  const layers = savedLayers ?? buildLayers(mask, depth, width, height, rig, sourceCanvas, assignment);
  const regions = savedLayers ? [] : computeOcclusionRegions(rig, assignment);

  recipe = {
    rig,
    mask,
    depth,
    imgWidth: width,
    imgHeight: height,
    sourceCanvas,
    assignment,
    regions,
    layers,
    inpaintDone: savedLayers !== null,
  };
  mountLayeredRig(layers);

  const imageUrl = sourceCanvas.toDataURL('image/png');
  return { imageUrl, rig, regionsCount: regions.length };
}

export function getPendingRegionsCount(): number {
  return recipe?.regions.length ?? 0;
}

export async function runInpaintingPass(onProgress?: (p: InpaintProgress) => void): Promise<void> {
  if (!recipe) throw new Error('Upload a character first.');
  const result = await applyInpainting(
    recipe.layers,
    recipe.regions,
    recipe.assignment,
    recipe.rig,
    recipe.mask,
    recipe.depth,
    recipe.imgWidth,
    recipe.imgHeight,
    recipe.sourceCanvas,
    onProgress,
  );
  recipe.layers = result.layers;
  // Only clear the queue for regions that actually got filled — an all-failed pass
  // (e.g. missing API key) should leave regions in place so retrying is meaningful.
  if (result.succeeded > 0) {
    recipe.regions = [];
    recipe.inpaintDone = true;
  }
  mountLayeredRig(result.layers);

  if (result.succeeded === 0 && result.failed > 0) {
    throw new Error(result.lastError ?? 'Inpainting failed for every region.');
  }
}

function mountLayeredRig(layers: CharacterLayer[]) {
  if (!recipe) return;
  const runtime = buildLayeredRig(recipe.rig, layers);
  setActiveCharacter('photo', runtime.group, runtime, () => disposeLayeredRig(runtime));
}
