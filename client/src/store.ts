import { create } from 'zustand';
import type { RigDescription, SceneTimeline } from './types';
import { sceneRuntime } from './lib/sceneRuntime';

export type PipelineStage = 'idle' | 'loading-image' | 'estimating-depth' | 'building-mesh' | 'building-rig' | 'ready' | 'error';

interface AppState {
  stage: PipelineStage;
  error: string | null;
  progressLabel: string | null;
  imageUrl: string | null;
  rig: RigDescription | null;
  timeline: SceneTimeline | null;
  directorBusy: boolean;
  directorError: string | null;
  readyVersion: number;

  setStage: (stage: PipelineStage, label?: string | null) => void;
  setError: (message: string) => void;
  setImageUrl: (url: string | null) => void;
  setRig: (rig: RigDescription | null) => void;
  markReady: () => void;
  updateBone: (id: string, patch: Partial<RigDescription['bones'][number]>) => void;
  setTimeline: (timeline: SceneTimeline | null) => void;
  setDirectorBusy: (busy: boolean) => void;
  setDirectorError: (message: string | null) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  stage: 'idle',
  error: null,
  progressLabel: null,
  imageUrl: null,
  rig: null,
  timeline: null,
  directorBusy: false,
  directorError: null,
  readyVersion: 0,

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
      const runtimeBone = sceneRuntime.runtime?.rig.bones.find((b) => b.id === id);
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
  reset: () => set({ stage: 'idle', error: null, progressLabel: null, imageUrl: null, rig: null, timeline: null }),
}));
