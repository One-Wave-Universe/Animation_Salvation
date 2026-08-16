import * as THREE from 'three';
import type { AnimatableRig } from './boneHierarchy';
import type { BoneNode } from '../types';
import { poseBone } from './jointConstraints';

export interface ActionContext {
  runtime: AnimatableRig;
  findByPrefix: (prefix: string) => THREE.Bone[];
}

export function makeActionContext(runtime: AnimatableRig): ActionContext {
  const findByPrefix = (prefix: string) =>
    runtime.rig.bones
      .filter((b) => b.name.startsWith(prefix))
      .map((b) => runtime.boneById.get(b.id)!)
      .filter(Boolean);
  return { runtime, findByPrefix };
}

export type ActionFn = (ctx: ActionContext, t: number, elapsed: number, params: Record<string, unknown>, state: Record<string, unknown>) => void;

const q = new THREE.Quaternion();
const euler = new THREE.Euler();

function boneDesc(runtime: AnimatableRig, bone: THREE.Bone): BoneNode {
  return runtime.rig.bones.find((b) => b.id === bone.userData.rigId)!;
}

function setLocalEuler(ctx: ActionContext, bone: THREE.Bone, x: number, y: number, z: number) {
  euler.set(x, y, z);
  q.setFromEuler(euler);
  poseBone(bone, boneDesc(ctx.runtime, bone), q);
}

const idle: ActionFn = (ctx, _t, elapsed) => {
  const root = ctx.runtime.rootBone;
  root.position.y += Math.sin(elapsed * 1.6) * 0.015;
  root.rotation.z = Math.sin(elapsed * 1.1) * 0.02;
  for (const bone of ctx.findByPrefix('Arm')) {
    setLocalEuler(ctx, bone, Math.sin(elapsed * 1.3 + bone.name.length) * 0.03, 0, 0);
  }
};

const lookAt: ActionFn = (ctx, t, _elapsed, params) => {
  const target = new THREE.Vector3(Number(params.x ?? 0), Number(params.y ?? 0), Number(params.z ?? 1));
  const heads = ctx.findByPrefix('Head');
  const bone = heads[0];
  if (!bone) return;
  const worldPos = new THREE.Vector3();
  bone.getWorldPosition(worldPos);
  const dir = target.clone().sub(worldPos).normalize();
  const yaw = Math.atan2(dir.x, dir.z);
  const pitch = Math.atan2(-dir.y, Math.hypot(dir.x, dir.z));
  const amount = Math.min(1, t * 3);
  setLocalEuler(ctx, bone, pitch * amount, yaw * amount, 0);
};

const wave: ActionFn = (ctx, t, elapsed, params) => {
  const side = params.hand === 'left' ? 'L' : 'R';
  const arms = ctx.findByPrefix(`Arm.${side}`);
  if (arms.length === 0) return;
  const raise = THREE.MathUtils.smoothstep(t, 0, 0.2) * (1 - THREE.MathUtils.smoothstep(t, 0.8, 1));
  const [upper, ...rest] = arms;
  setLocalEuler(ctx, upper, 0, 0, side === 'R' ? -raise * 1.4 : raise * 1.4);
  for (const bone of rest) {
    setLocalEuler(ctx, bone, Math.sin(elapsed * 10) * raise * 0.6, 0, 0);
  }
};

const jump: ActionFn = (ctx, t, _elapsed, params) => {
  const height = Number(params.height ?? 0.6);
  const arc = Math.sin(Math.PI * THREE.MathUtils.clamp(t, 0, 1));
  ctx.runtime.rootBone.position.y = arc * height;
  const squash = 1 - 0.15 * Math.max(0, Math.sin(Math.PI * 2 * t)) * (t < 0.1 || t > 0.9 ? 1 : 0);
  ctx.runtime.rootBone.scale.set(2 - squash, squash, 2 - squash);
};

const sit: ActionFn = (ctx, t) => {
  const amount = THREE.MathUtils.smoothstep(t, 0, 0.4);
  ctx.runtime.rootBone.position.y = -amount * 0.35;
  for (const bone of ctx.findByPrefix('Leg')) {
    setLocalEuler(ctx, bone, amount * 1.1, 0, 0);
  }
};

const walkTo: ActionFn = (ctx, t, elapsed, params, state) => {
  if (!state.startPos) state.startPos = ctx.runtime.rootBone.position.clone();
  const startPos = state.startPos as THREE.Vector3;
  const target = new THREE.Vector3(Number(params.x ?? 0), startPos.y, Number(params.z ?? 0));
  ctx.runtime.rootBone.position.lerpVectors(startPos, target, THREE.MathUtils.smoothstep(t, 0, 1));

  const dir = target.clone().sub(startPos);
  if (dir.lengthSq() > 1e-6) {
    ctx.runtime.rootBone.rotation.y = Math.atan2(dir.x, dir.z);
  }

  const stride = Math.sin(elapsed * 8);
  const legs = ctx.findByPrefix('Leg');
  legs.forEach((bone, i) => {
    const phase = i % 2 === 0 ? stride : -stride;
    setLocalEuler(ctx, bone, phase * 0.5, 0, 0);
  });
  const arms = ctx.findByPrefix('Arm');
  arms.forEach((bone, i) => {
    const phase = i % 2 === 0 ? -stride : stride;
    setLocalEuler(ctx, bone, phase * 0.3, 0, 0);
  });
};

const turnToFace: ActionFn = (ctx, t, _elapsed, params, state) => {
  if (state.startYaw === undefined) state.startYaw = ctx.runtime.rootBone.rotation.y;
  const target = new THREE.Vector3(Number(params.x ?? 0), 0, Number(params.z ?? 1));
  const targetYaw = Math.atan2(target.x, target.z);
  const startYaw = state.startYaw as number;
  ctx.runtime.rootBone.rotation.y = THREE.MathUtils.lerp(startYaw, targetYaw, THREE.MathUtils.smoothstep(t, 0, 1));
};

const moveTo: ActionFn = (ctx, t, _elapsed, params, state) => {
  if (!state.startPos) state.startPos = ctx.runtime.rootBone.position.clone();
  const startPos = state.startPos as THREE.Vector3;
  const target = new THREE.Vector3(Number(params.x ?? 0), Number(params.y ?? startPos.y), Number(params.z ?? 0));
  ctx.runtime.rootBone.position.lerpVectors(startPos, target, THREE.MathUtils.smoothstep(t, 0, 1));
};

const customPose: ActionFn = (ctx, t, _elapsed, params) => {
  const poses = (params.bonePoses ?? {}) as Record<string, [number, number, number]>;
  for (const [name, [x, y, z]] of Object.entries(poses)) {
    const desc = ctx.runtime.rig.bones.find((b) => b.name === name);
    if (!desc) continue;
    const bone = ctx.runtime.boneById.get(desc.id);
    if (!bone) continue;
    setLocalEuler(ctx, bone, x * t, y * t, z * t);
  }
};

export const ACTIONS: Record<string, ActionFn> = {
  idle,
  look_at: lookAt,
  wave,
  jump,
  sit,
  walk_to: walkTo,
  turn_to_face: turnToFace,
  move_to: moveTo,
  custom_pose: customPose,
};
