import * as THREE from 'three';
import type { BoneNode, RigDescription } from '../types';

export interface BoneHierarchy {
  rootBone: THREE.Bone;
  boneById: Map<string, THREE.Bone>;
  boneIndex: Map<string, number>;
  orderedBones: THREE.Bone[];
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
    capsules.push({
      boneId: desc.parentId,
      boneIndex: boneIndex.get(desc.parentId)!,
      p0: new THREE.Vector3(...parentDesc.position),
      p1: new THREE.Vector3(...desc.position),
    });
  }
  // Guarantee every bone (including leaves and the root itself) owns at least a
  // zero-length capsule at its own position, so nearby points can still bind to it.
  for (const desc of rig.bones) {
    if (capsules.some((c) => c.boneId === desc.id)) continue;
    const p = new THREE.Vector3(...desc.position);
    capsules.push({ boneId: desc.id, boneIndex: boneIndex.get(desc.id)!, p0: p, p1: p });
  }
  return capsules;
}

export function pointToSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  if (len2 < 1e-8) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
  const proj = a.clone().addScaledVector(ab, t);
  return p.distanceTo(proj);
}
