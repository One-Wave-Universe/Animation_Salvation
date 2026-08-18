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
  /** The live R3F renderer/scene/camera - used by frameCapture.ts to render an
   *  isolated, transparent still of just the character for the film-frame timeline,
   *  without disrupting the live viewport (same renderer, temporarily reconfigured
   *  and restored, not a second renderer/canvas). */
  gl: THREE.WebGLRenderer | null;
  threeScene: THREE.Scene | null;
  threeCamera: THREE.Camera | null;
  dispose: (() => void) | null;
  /**
   * Live joint overrides keyed by bone id (BoneNode.id, not the THREE.Bone's
   * own .name/.uuid) - the gamepad joint controller writes into this every
   * frame for whichever bone is selected. TimelineExecutor applies these
   * after the normal idle/action pose, so manual control composes with
   * playback instead of needing its own separate render path, and still
   * gets the same per-frame smoothing everything else does.
   */
  manualBoneOverrides: Map<string, THREE.Euler>;
  /** True 3D world position/facing the character walks around in, driven by
   *  WorldMovementController (WASD/gamepad). Read every frame by CharacterMesh to
   *  place the character group - real translation across real ground, not a faked
   *  depth-scale illusion, so perspective/scale just falls out of the normal camera
   *  projection. */
  worldPosition: THREE.Vector3;
  worldFacing: number;
  /** Non-null while WASD/gamepad movement is actively held: the accumulated time
   *  (seconds) driving the walk-gait phase. Null when standing still, so
   *  TimelineExecutor knows to leave the idle/scripted pose alone instead. */
  walkGaitElapsed: number | null;
} = {
  renderObject: null,
  animatable: null,
  executor: null,
  mode: null,
  canvas: null,
  gl: null,
  threeScene: null,
  threeCamera: null,
  dispose: null,
  manualBoneOverrides: new Map(),
  worldPosition: new THREE.Vector3(0, 0, 0),
  worldFacing: 0,
  walkGaitElapsed: null,
};

export function resetSceneRuntime() {
  sceneRuntime.dispose?.();
  sceneRuntime.renderObject = null;
  sceneRuntime.animatable = null;
  sceneRuntime.executor = null;
  sceneRuntime.mode = null;
  sceneRuntime.dispose = null;
  sceneRuntime.manualBoneOverrides.clear();
  sceneRuntime.worldPosition.set(0, 0, 0);
  sceneRuntime.worldFacing = 0;
  sceneRuntime.walkGaitElapsed = null;
}

export function setActiveCharacter(mode: RenderMode, renderObject: THREE.Object3D, animatable: AnimatableRig, dispose: () => void) {
  resetSceneRuntime();
  sceneRuntime.mode = mode;
  sceneRuntime.renderObject = renderObject;
  sceneRuntime.animatable = animatable;
  sceneRuntime.executor = new TimelineExecutor(animatable);
  sceneRuntime.dispose = dispose;
}

if (import.meta.env.DEV) {
  (window as unknown as { __SCENE_RUNTIME__: typeof sceneRuntime }).__SCENE_RUNTIME__ = sceneRuntime;
}
