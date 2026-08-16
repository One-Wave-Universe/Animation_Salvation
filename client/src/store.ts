import { create } from 'zustand';
import type { RigDescription, SceneTimeline } from './types';
import { sceneRuntime } from './lib/sceneRuntime';

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
