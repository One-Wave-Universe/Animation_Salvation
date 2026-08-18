import * as THREE from 'three';
import type { AnimatableRig } from './boneHierarchy';
import type { BoneNode } from '../types';
import { poseBone } from './jointConstraints';

export interface ActionContext {
  runtime: AnimatableRig;
  findByPrefix: (prefix: string) => THREE.Bone[];
}

export function makeActionContext(runtime: AnimatableRig): ActionContext {
  // Matches `prefix` itself and any real sub-chain of it ("Arm.R" -> also
  // "Arm.R.2", "Arm.R.L3", ...), but *not* an unrelated numbered sibling
  // ("Arm.R6") that the auto-rig classifier found elsewhere and just
  // happens to share the same textual prefix. Every generated sub-chain
  // label always has a "." right after its base (see rigBuilder.ts's
  // labelFor/nameChain); only a fresh top-level duplicate glues a bare
  // number straight onto the base, which a plain startsWith can't tell
  // apart from a genuine child joint.
  const findByPrefix = (prefix: string) =>
    runtime.rig.bones
      .filter((b) => b.name === prefix || b.name.startsWith(`${prefix}.`))
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

// Deliberately root-only: this runs every single frame regardless of what
// action is playing, so anything it touches has to be trustworthy on *any*
// auto-rig, not just a clean one. An earlier version also swayed
// findByPrefix('Arm')/('Head') for a bit of idle life, but on a rig where
// the classifier mis-splits a detailed head into several small "Arm.L2" /
// "Arm.R6" sub-branches (a real case - see rigBuilder.ts's classifyBranch),
// that meant continuously animating stray pieces of the face, every frame,
// forever - a constant low-level jitter that read as "rubbery," not alive.
// Root motion moves the whole character rigidly, so it can't cause that.
const idle: ActionFn = (ctx, _t, elapsed) => {
  const root = ctx.runtime.rootBone;
  root.position.y += Math.sin(elapsed * 1.6) * 0.015;
  root.rotation.z = Math.sin(elapsed * 1.1) * 0.02;
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

// Fraction of the jump's duration spent crouching before takeoff / settling
// after landing. The old version's squash math worked out to a change of a
// few percent for one tenth of the animation - essentially invisible; this
// gives each phase real screen time and a distinct silhouette.
const JUMP_ANTICIPATION = 0.14;
const JUMP_SETTLE = 0.14;

const jump: ActionFn = (ctx, t, _elapsed, params) => {
  const height = Number(params.height ?? 0.6);
  const airStart = JUMP_ANTICIPATION;
  const airEnd = 1 - JUMP_SETTLE;

  let y: number;
  let squash: number; // 1 = normal; <1 squashed (crouch/landing), >1 stretched (mid-air motion)
  if (t < airStart) {
    const p = t / airStart;
    y = -0.07 * Math.sin((p * Math.PI) / 2);
    squash = 1 - 0.22 * p;
  } else if (t < airEnd) {
    const airT = (t - airStart) / (airEnd - airStart);
    y = Math.sin(Math.PI * airT) * height;
    squash = 1 + 0.12 * Math.abs(Math.cos(Math.PI * airT));
  } else {
    const p = (t - airEnd) / JUMP_SETTLE;
    y = THREE.MathUtils.lerp(0, 0, p);
    squash = THREE.MathUtils.lerp(0.78, 1, THREE.MathUtils.smoothstep(p, 0, 1));
  }

  ctx.runtime.rootBone.position.y = y;
  const stretchXZ = 1 / Math.sqrt(squash); // rough volume preservation
  ctx.runtime.rootBone.scale.set(stretchXZ, squash, stretchXZ);
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
  // The lerp above pins position.y to a single captured value for the whole
  // action, so without this the walk has no vertical motion at all - every
  // step lands perfectly flat. Real gait dips slightly at each foot plant,
  // twice per stride cycle, so this runs at double the leg-swing frequency.
  ctx.runtime.rootBone.position.y += Math.abs(Math.cos(elapsed * 8)) * 0.045;
  ctx.runtime.rootBone.rotation.z = stride * 0.035;
  const legs = ctx.findByPrefix('Leg');
  legs.forEach((bone, i) => {
    const phase = i % 2 === 0 ? stride : -stride;
    setLocalEuler(ctx, bone, phase * 0.5, 0, 0);
  });
  // The bare 'Arm' prefix would also match any spurious numbered top-level
  // duplicate the auto-rig classifier produced (e.g. "Arm.R6" turning out to
  // be a piece of an ear, not a second right arm) - explicitly union just
  // the two real arms instead, same fix as wave()'s findByPrefix('Arm.R').
  const arms = [...ctx.findByPrefix('Arm.L'), ...ctx.findByPrefix('Arm.R')];
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
