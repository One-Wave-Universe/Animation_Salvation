import { create } from 'zustand';
import type { RigDescription, SceneCalibration, ScenePlacement, SceneTimeline } from './types';
import { sceneRuntime } from './lib/sceneRuntime';
import { defaultCalibration } from './lib/perspective';

export type PipelineStage = 'idle' | 'loading-image' | 'estimating-depth' | 'building-mesh' | 'building-rig' | 'ready' | 'error';
export type RenderMode = 'rig3d' | 'photo';

interface AppState {
  mode: RenderMode;
  stage: PipelineStage;
  error: string | null;
  progressLabel: string | null;
  imageUrl: string | null;
  rig: RigDescription | null;
  timeline: SceneTimeline | null;
  directorBusy: boolean;
  directorError: string | null;
  readyVersion: number;
  backgroundUrl: string | null;

  showSkeleton: boolean;
  showWireframe: boolean;
  selectedBoneId: string | null;
  cameraPresetRequest: string | null;
  keyLightIntensity: number;
  ambientIntensity: number;
  gamepadConnected: string | null;

  /** Per-background depth/scale calibration. Null until a background's real pixel
   *  dimensions are known (set once the background texture finishes loading). */
  sceneCalibration: SceneCalibration | null;
  /** Where the character's feet are planted in the background, as fractions of its
   *  pixel dimensions - drives depth-derived scale via sceneCalibration. */
  scenePlacement: ScenePlacement;
  showPerspectiveGrid: boolean;

  inpaintRegionsCount: number;
  inpaintBusy: boolean;
  inpaintProgress: { done: number; total: number } | null;
  inpaintDone: boolean;
  inpaintError: string | null;

  setMode: (mode: RenderMode) => void;
  setStage: (stage: PipelineStage, label?: string | null) => void;
  setError: (message: string) => void;
  setImageUrl: (url: string | null) => void;
  setRig: (rig: RigDescription | null) => void;
  markReady: () => void;
  updateBone: (id: string, patch: Partial<RigDescription['bones'][number]>) => void;
  setTimeline: (timeline: SceneTimeline | null) => void;
  setDirectorBusy: (busy: boolean) => void;
  setDirectorError: (message: string | null) => void;
  setInpaintRegionsCount: (n: number) => void;
  setInpaintBusy: (busy: boolean) => void;
  setInpaintProgress: (p: { done: number; total: number } | null) => void;
  setInpaintDone: (done: boolean) => void;
  setInpaintError: (message: string | null) => void;
  setBackgroundUrl: (url: string | null) => void;
  setShowSkeleton: (show: boolean) => void;
  setShowWireframe: (show: boolean) => void;
  setSelectedBoneId: (id: string | null) => void;
  requestCameraPreset: (preset: string) => void;
  clearCameraPresetRequest: () => void;
  setKeyLightIntensity: (v: number) => void;
  setAmbientIntensity: (v: number) => void;
  setGamepadConnected: (name: string | null) => void;
  ensureSceneCalibration: (sceneWidth: number, sceneHeight: number) => void;
  patchSceneCalibration: (patch: Partial<SceneCalibration>) => void;
  setScenePlacement: (placement: Partial<ScenePlacement>) => void;
  setShowPerspectiveGrid: (show: boolean) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  mode: 'rig3d',
  stage: 'idle',
  error: null,
  progressLabel: null,
  imageUrl: null,
  rig: null,
  timeline: null,
  directorBusy: false,
  directorError: null,
  readyVersion: 0,
  backgroundUrl: null,

  showSkeleton: false,
  showWireframe: false,
  selectedBoneId: null,
  cameraPresetRequest: null,
  keyLightIntensity: 1.6,
  ambientIntensity: 0.7,
  gamepadConnected: null,

  sceneCalibration: null,
  scenePlacement: { footX: 0.5, footY: 0.85 },
  showPerspectiveGrid: false,

  inpaintRegionsCount: 0,
  inpaintBusy: false,
  inpaintProgress: null,
  inpaintDone: false,
  inpaintError: null,

  setMode: (mode) => set({ mode }),
  setStage: (stage, label = null) => set({ stage, progressLabel: label, error: stage === 'error' ? undefined : null }),
  setError: (message) => set({ stage: 'error', error: message }),
  setImageUrl: (url) => set({ imageUrl: url }),
  setRig: (rig) => set({ rig }),
  markReady: () => set((s) => ({ readyVersion: s.readyVersion + 1 })),
  updateBone: (id, patch) =>
    set((s) => {
      if (!s.rig) return s;
      // Keep the live runtime rig (read by the animation/constraint system every
      // frame) in sync with edits, not just this UI-facing copy.
      const runtimeBone = sceneRuntime.animatable?.rig.bones.find((b) => b.id === id);
      if (runtimeBone) Object.assign(runtimeBone, patch);
      return {
        rig: {
          bones: s.rig.bones.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        },
      };
    }),
  setTimeline: (timeline) => set({ timeline }),
  setDirectorBusy: (directorBusy) => set({ directorBusy }),
  setDirectorError: (directorError) => set({ directorError }),
  setInpaintRegionsCount: (inpaintRegionsCount) => set({ inpaintRegionsCount }),
  setInpaintBusy: (inpaintBusy) => set({ inpaintBusy }),
  setInpaintProgress: (inpaintProgress) => set({ inpaintProgress }),
  setInpaintDone: (inpaintDone) => set({ inpaintDone }),
  setInpaintError: (inpaintError) => set({ inpaintError }),
  setBackgroundUrl: (backgroundUrl) => set({ backgroundUrl }),
  setShowSkeleton: (showSkeleton) => set({ showSkeleton }),
  setShowWireframe: (showWireframe) => set({ showWireframe }),
  setSelectedBoneId: (selectedBoneId) => set({ selectedBoneId }),
  requestCameraPreset: (cameraPresetRequest) => set({ cameraPresetRequest }),
  clearCameraPresetRequest: () => set({ cameraPresetRequest: null }),
  setKeyLightIntensity: (keyLightIntensity) => set({ keyLightIntensity }),
  setAmbientIntensity: (ambientIntensity) => set({ ambientIntensity }),
  setGamepadConnected: (gamepadConnected) => set({ gamepadConnected }),
  // Only (re)creates calibration when the background's actual pixel size changes -
  // an already-matching calibration is left alone so a human's or AI's edits to it
  // survive re-renders of the same background (e.g. a texture reload).
  ensureSceneCalibration: (sceneWidth, sceneHeight) =>
    set((s) => {
      if (s.sceneCalibration && s.sceneCalibration.sceneWidth === sceneWidth && s.sceneCalibration.sceneHeight === sceneHeight) {
        return s;
      }
      return { sceneCalibration: defaultCalibration(sceneWidth, sceneHeight) };
    }),
  patchSceneCalibration: (patch) =>
    set((s) => (s.sceneCalibration ? { sceneCalibration: { ...s.sceneCalibration, ...patch } } : s)),
  setScenePlacement: (placement) => set((s) => ({ scenePlacement: { ...s.scenePlacement, ...placement } })),
  setShowPerspectiveGrid: (showPerspectiveGrid) => set({ showPerspectiveGrid }),
  reset: () =>
    set({
      stage: 'idle',
      error: null,
      progressLabel: null,
      imageUrl: null,
      rig: null,
      timeline: null,
      inpaintRegionsCount: 0,
      inpaintBusy: false,
      inpaintProgress: null,
      inpaintDone: false,
      inpaintError: null,
    }),
}));
