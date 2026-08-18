import * as THREE from 'three';
import type { BoneNode, RigDescription } from '../types';

export interface BoneHierarchy {
  rootBone: THREE.Bone;
  boneById: Map<string, THREE.Bone>;
  boneIndex: Map<string, number>;
  orderedBones: THREE.Bone[];
}

/**
 * Minimal shape the action library and timeline executor actually need. Both render
 * modes' runtimes (RigRuntime's skinned mesh, LayeredRigRuntime's per-bone planes)
 * satisfy this, so actions.ts/timelineExecutor.ts work unchanged against either —
 * they animate bones, not whatever happens to be attached to them.
 */
export interface AnimatableRig {
  rootBone: THREE.Bone;
  boneById: Map<string, THREE.Bone>;
  rig: RigDescription;
}

/**
 * Builds the THREE.Bone tree from a RigDescription's bind-pose absolute positions.
 * Shared by both render modes — a skinned mesh (Mode A) and a plane-per-layer rig
 * (Mode B) both need the exact same bone tree; only what gets attached differs.
 */
export function buildBoneHierarchy(rig: RigDescription): BoneHierarchy {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const rootDesc = rig.bones.find((b) => b.parentId === null);
  if (!rootDesc) throw new Error('Rig has no root bone.');

  const boneById = new Map<string, THREE.Bone>();
  const boneIndex = new Map<string, number>();
  const orderedBones: THREE.Bone[] = [];

  const createBone = (desc: BoneNode) => {
    const bone = new THREE.Bone();
    bone.name = desc.id;
    bone.userData = { rigId: desc.id, displayName: desc.name, jointType: desc.jointType };
    boneById.set(desc.id, bone);
    boneIndex.set(desc.id, orderedBones.length);
    orderedBones.push(bone);
    return bone;
  };

  // Breadth-first so parents are always created (and positioned) before children.
  const queue: BoneNode[] = [rootDesc];
  while (queue.length) {
    const desc = queue.shift()!;
    const bone = boneById.get(desc.id) ?? createBone(desc);
    if (desc.parentId) {
      const parentBone = boneById.get(desc.parentId)!;
      const parentDesc = byId.get(desc.parentId)!;
      bone.position.set(
        desc.position[0] - parentDesc.position[0],
        desc.position[1] - parentDesc.position[1],
        desc.position[2] - parentDesc.position[2],
      );
      parentBone.add(bone);
    } else {
      bone.position.set(desc.position[0], desc.position[1], desc.position[2]);
    }
    for (const child of rig.bones.filter((b) => b.parentId === desc.id)) {
      if (!boneById.has(child.id)) createBone(child);
      queue.push(child);
    }
  }

  const rootBone = boneById.get(rootDesc.id)!;
  rootBone.updateMatrixWorld(true);

  return { rootBone, boneById, boneIndex, orderedBones };
}

export interface Capsule {
  boneId: string;
  boneIndex: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  /** p1.distanceTo(p0) - how far this specific segment spans, for scaling the skin-weight blend zone to the bone's own size (see skinning.ts). */
  length: number;
}

/**
 * One capsule per bone, representing the segment from its parent to itself (the
 * "limb" that bone's rotation controls). Used for both skin-weight falloff (Mode A)
 * and nearest-bone layer assignment (Mode B) — same underlying question, "which bone
 * is this point closest to."
 */
export function buildCapsules(rig: RigDescription, boneIndex: Map<string, number>): Capsule[] {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const capsules: Capsule[] = [];
  for (const desc of rig.bones) {
    if (!desc.parentId) continue;
    const parentDesc = byId.get(desc.parentId)!;
    const p0 = new THREE.Vector3(...parentDesc.position);
    const p1 = new THREE.Vector3(...desc.position);
    capsules.push({
      boneId: desc.parentId,
      boneIndex: boneIndex.get(desc.parentId)!,
      p0,
      p1,
      length: p0.distanceTo(p1),
    });
  }
  // Guarantee every bone (including leaves and the root itself) owns at least a
  // zero-length capsule at its own position, so nearby points can still bind to it.
  for (const desc of rig.bones) {
    if (capsules.some((c) => c.boneId === desc.id)) continue;
    const p = new THREE.Vector3(...desc.position);
    capsules.push({ boneId: desc.id, boneIndex: boneIndex.get(desc.id)!, p0: p, p1: p, length: 0 });
  }
  return capsules;
}

/**
 * Parent/child adjacency between bones, keyed by boneIndex, for skin-weight
 * blending (skinning.ts): which bones are actually neighbors *in the
 * skeleton*, independent of how close together they happen to sit in space.
 * A curled tail can pass within a few centimeters of a leg without the two
 * being remotely related - restricting weight blending to hierarchy
 * neighbors (see hopDistances) is what stops the leg from ever tugging on
 * the tail, no matter how close it swings.
 */
export function buildBoneAdjacency(rig: RigDescription, boneIndex: Map<string, number>): Map<number, number[]> {
  const adjacency = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, []);
    adjacency.get(a)!.push(b);
  };
  for (const desc of rig.bones) {
    if (!desc.parentId) continue;
    const childIdx = boneIndex.get(desc.id);
    const parentIdx = boneIndex.get(desc.parentId);
    if (childIdx === undefined || parentIdx === undefined) continue;
    link(childIdx, parentIdx);
    link(parentIdx, childIdx);
  }
  return adjacency;
}

/** Bones reachable from `from` within `maxHops` hierarchy edges, mapped to their hop count (0 = from itself). */
export function hopDistances(adjacency: Map<number, number[]>, from: number, maxHops: number): Map<number, number> {
  const dist = new Map<number, number>([[from, 0]]);
  let frontier = [from];
  for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
    const next: number[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!dist.has(neighbor)) {
          dist.set(neighbor, hop);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

export function pointToSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  if (len2 < 1e-8) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
  const proj = a.clone().addScaledVector(ab, t);
  return p.distanceTo(proj);
}
