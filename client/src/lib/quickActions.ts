import type { SceneTimeline } from '../types';

/**
 * Hand-built timelines for the action library — no AI call, no API key, no network.
 * The scene director (DirectorPanel) turns free text into a timeline via an LLM;
 * these are the same underlying timeline format, just written by hand for the most
 * common single actions so a usable animated clip is always one click away.
 */
export const QUICK_ACTIONS: { label: string; build: () => SceneTimeline }[] = [
  {
    label: 'Wave',
    build: () => ({
      events: [{ id: 'e1', action: 'wave', start: 0, duration: 1.8, params: { hand: 'right' } }],
      totalDuration: 2.2,
    }),
  },
  {
    label: 'Walk forward',
    build: () => ({
      events: [{ id: 'e1', action: 'walk_to', start: 0, duration: 3, params: { x: 0, z: 2.5 } }],
      totalDuration: 3.3,
    }),
  },
  {
    label: 'Turn around',
    build: () => ({
      events: [{ id: 'e1', action: 'turn_to_face', start: 0, duration: 1.5, params: { x: 0, z: -1 } }],
      totalDuration: 1.8,
    }),
  },
  {
    label: 'Jump',
    build: () => ({
      events: [{ id: 'e1', action: 'jump', start: 0, duration: 1, params: { height: 0.6 } }],
      totalDuration: 1.3,
    }),
  },
  {
    label: 'Sit',
    build: () => ({
      events: [{ id: 'e1', action: 'sit', start: 0, duration: 1.5, params: {} }],
      totalDuration: 1.8,
    }),
  },
  {
    label: 'Wave, walk, turn',
    build: () => ({
      events: [
        { id: 'e1', action: 'wave', start: 0, duration: 1.8, params: { hand: 'right' } },
        { id: 'e2', action: 'walk_to', start: 1.8, duration: 2.5, params: { x: 0, z: 2 } },
        { id: 'e3', action: 'turn_to_face', start: 4.3, duration: 1.2, params: { x: 0, z: -2 } },
      ],
      totalDuration: 5.8,
    }),
  },
  {
    // Longer scene, deliberately built without turn_to_face: the rig only has a
    // front-facing source photo, and rotating the root exposes the mesh's guessed
    // (and currently unreliable) side/back geometry. Every event here only ever
    // faces the camera, so it stays clean regardless of source-image angle coverage.
    label: 'Long walk (no turn)',
    build: () => ({
      events: [
        { id: 'e1', action: 'wave', start: 0, duration: 1.8, params: { hand: 'right' } },
        { id: 'e2', action: 'walk_to', start: 1.8, duration: 2.5, params: { x: 0, z: 2.5 } },
        { id: 'e3', action: 'jump', start: 4.3, duration: 1, params: { height: 0.6 } },
        { id: 'e4', action: 'walk_to', start: 5.3, duration: 2.5, params: { x: 0, z: 0 } },
        { id: 'e5', action: 'sit', start: 7.8, duration: 1.5, params: {} },
      ],
      totalDuration: 9.6,
    }),
  },
];
