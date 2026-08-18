import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';

const MOVE_SPEED = 1.6; // world units/second
const DEADZONE = 0.15;

const KEY_VECTORS: Record<string, [number, number]> = {
  w: [0, -1],
  arrowup: [0, -1],
  s: [0, 1],
  arrowdown: [0, 1],
  a: [-1, 0],
  arrowleft: [-1, 0],
  d: [1, 0],
  arrowright: [1, 0],
};

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

/**
 * Real 3D character movement: WASD/arrow keys and (when no rig joint is selected
 * for gamepad joint control) the gamepad's left stick both translate the
 * character across the actual ground plane, in world X/Z. This is the "video
 * game engine" placement layer - CharacterMesh just reads sceneRuntime.worldPosition/
 * worldFacing/walkGaitElapsed and renders wherever this puts them; real camera
 * perspective handles apparent scale, not a hand-authored depth curve.
 */
export function WorldMovementController() {
  const pressedKeys = useRef(new Set<string>());
  const walkClock = useRef(0);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (KEY_VECTORS[key]) pressedKeys.current.add(key);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      pressedKeys.current.delete(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useFrame((_, rawDelta) => {
    // Same clamp CharacterMesh applies to the animation executor - without it a
    // single dropped/stalled frame (GC pause, tab backgrounding, headless test
    // hitches) reports a large delta and teleports the character instead of just
    // rendering one chunkier step.
    const delta = Math.min(rawDelta, 0.05);
    let x = 0;
    let z = 0;
    for (const key of pressedKeys.current) {
      const v = KEY_VECTORS[key];
      if (v) {
        x += v[0];
        z += v[1];
      }
    }

    // Gamepad left stick, but only when no bone is selected for joint control -
    // GamepadJointControl owns the stick whenever a joint is being posed directly,
    // so the two never fight over the same input.
    const selectedBoneId = useAppStore.getState().selectedBoneId;
    if (!selectedBoneId) {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((p) => p);
      if (pad) {
        x += applyDeadzone(pad.axes[0] ?? 0);
        z += applyDeadzone(pad.axes[1] ?? 0);
      }
    }

    const mag = Math.hypot(x, z);
    if (mag > 1e-4) {
      const nx = x / Math.max(mag, 1);
      const nz = z / Math.max(mag, 1);
      const step = Math.min(mag, 1) * MOVE_SPEED * delta;
      sceneRuntime.worldPosition.x += nx * step;
      sceneRuntime.worldPosition.z += nz * step;
      sceneRuntime.worldFacing = Math.atan2(nx, nz);
      walkClock.current += delta;
      sceneRuntime.walkGaitElapsed = walkClock.current;
    } else {
      sceneRuntime.walkGaitElapsed = null;
    }
  });

  return null;
}
