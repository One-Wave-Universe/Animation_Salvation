import * as THREE from 'three';
import type { RigRuntime } from './skinning';
import { TimelineExecutor } from './timelineExecutor';

/**
 * Mutable, non-reactive home for heavy Three.js objects (mesh, skeleton, animation
 * clock). Kept out of the Zustand store on purpose: these get written every frame by
 * the render loop, and funneling that through React state would cause a re-render per
 * frame. React only needs to know *that* a character is ready (see store.stage);
 * Viewport reads this singleton directly inside its useFrame loop.
 */
export const sceneRuntime: {
  runtime: RigRuntime | null;
  executor: TimelineExecutor | null;
  material: THREE.MeshStandardMaterial | null;
  texture: THREE.Texture | null;
  canvas: HTMLCanvasElement | null;
} = {
  runtime: null,
  executor: null,
  material: null,
  texture: null,
  canvas: null,
};

export function resetSceneRuntime() {
  sceneRuntime.runtime?.skinnedMesh.geometry.dispose();
  sceneRuntime.material?.dispose();
  sceneRuntime.texture?.dispose();
  sceneRuntime.runtime = null;
  sceneRuntime.executor = null;
  sceneRuntime.material = null;
  sceneRuntime.texture = null;
}

export function setCharacter(runtime: RigRuntime, material: THREE.MeshStandardMaterial, texture: THREE.Texture) {
  resetSceneRuntime();
  sceneRuntime.runtime = runtime;
  sceneRuntime.material = material;
  sceneRuntime.texture = texture;
  sceneRuntime.executor = new TimelineExecutor(runtime);
}
