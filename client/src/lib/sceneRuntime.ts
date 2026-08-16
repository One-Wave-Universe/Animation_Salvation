import * as THREE from 'three';
import { TimelineExecutor } from './timelineExecutor';
import type { AnimatableRig } from './boneHierarchy';

export type RenderMode = 'rig3d' | 'photo';

/**
 * Mutable, non-reactive home for heavy Three.js objects (mesh, skeleton, animation
 * clock). Kept out of the Zustand store on purpose: these get written every frame by
 * the render loop, and funneling that through React state would cause a re-render per
 * frame. React only needs to know *that* a character is ready (see store.stage);
 * Viewport reads this singleton directly inside its useFrame loop.
 *
 * `renderObject` is deliberately generic (just "the thing Viewport adds to the
 * scene") so the same Viewport/export code works for both render modes: Mode A's
 * single SkinnedMesh, or Mode B's group of per-bone layer planes.
 */
export const sceneRuntime: {
  renderObject: THREE.Object3D | null;
  animatable: AnimatableRig | null;
  executor: TimelineExecutor | null;
  mode: RenderMode | null;
  canvas: HTMLCanvasElement | null;
  dispose: (() => void) | null;
} = {
  renderObject: null,
  animatable: null,
  executor: null,
  mode: null,
  canvas: null,
  dispose: null,
};

export function resetSceneRuntime() {
  sceneRuntime.dispose?.();
  sceneRuntime.renderObject = null;
  sceneRuntime.animatable = null;
  sceneRuntime.executor = null;
  sceneRuntime.mode = null;
  sceneRuntime.dispose = null;
}

export function setActiveCharacter(mode: RenderMode, renderObject: THREE.Object3D, animatable: AnimatableRig, dispose: () => void) {
  resetSceneRuntime();
  sceneRuntime.mode = mode;
  sceneRuntime.renderObject = renderObject;
  sceneRuntime.animatable = animatable;
  sceneRuntime.executor = new TimelineExecutor(animatable);
  sceneRuntime.dispose = dispose;
}
