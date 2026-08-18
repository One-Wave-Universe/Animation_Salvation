import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '../store';
import { sceneRuntime } from '../lib/sceneRuntime';

const DEADZONE = 0.12;
const MAX_ANGLE = 1.2; // radians (~69deg) - a generous puppet-control range; poseBone still clamps to the joint's own ball/hinge limit on top of this

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

/**
 * Drives whichever bone is selected in the Rig panel from a connected
 * gamepad's analog sticks - left stick X/Y -> local X/Z rotation, right
 * stick X -> local Y (twist). Proportional, not integrated: stick fully
 * deflected means the joint sits at MAX_ANGLE, releasing the stick eases it
 * back to neutral (through the same smoothing every other pose goes
 * through) rather than the angle drifting or needing to be re-centered by
 * hand. Writes into sceneRuntime.manualBoneOverrides, which
 * TimelineExecutor applies through the normal poseBone constraint path, so
 * a ball joint's cone limit and a hinge's axis/range still apply - the
 * gamepad can't pose a joint anywhere the rig itself says is out of range,
 * which is exactly what makes it useful for finding a joint's *real* limits
 * by feel rather than by reading numbers off the Rig panel.
 */
export function GamepadJointControl() {
  const selectedBoneId = useAppStore((s) => s.selectedBoneId);
  const setGamepadConnected = useAppStore((s) => s.setGamepadConnected);
  const lastBoneId = useRef<string | null>(null);
  const euler = useRef(new THREE.Euler());

  useEffect(() => {
    const onConnect = (e: GamepadEvent) => setGamepadConnected(e.gamepad.id);
    const onDisconnect = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const stillConnected = Array.from(pads).find((p) => p);
      setGamepadConnected(stillConnected ? stillConnected.id : null);
    };
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    return () => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
    };
  }, [setGamepadConnected]);

  // Selection changed (or cleared) - stop overriding whichever bone was
  // previously selected so it goes back to being driven by idle/actions
  // instead of staying frozen at its last gamepad pose forever.
  useEffect(() => {
    if (lastBoneId.current && lastBoneId.current !== selectedBoneId) {
      sceneRuntime.manualBoneOverrides.delete(lastBoneId.current);
    }
    lastBoneId.current = selectedBoneId;
    return () => {
      if (selectedBoneId) sceneRuntime.manualBoneOverrides.delete(selectedBoneId);
    };
  }, [selectedBoneId]);

  useFrame(() => {
    if (!selectedBoneId) return;
    const pads = navigator.getGamepads?.() ?? [];
    const pad = Array.from(pads).find((p) => p);
    if (!pad) return;

    const x = applyDeadzone(pad.axes[0] ?? 0);
    const y = applyDeadzone(pad.axes[1] ?? 0);
    const twist = applyDeadzone(pad.axes[2] ?? 0);

    euler.current.set(y * MAX_ANGLE, twist * MAX_ANGLE, -x * MAX_ANGLE);
    sceneRuntime.manualBoneOverrides.set(selectedBoneId, euler.current);
  });

  return null;
}
