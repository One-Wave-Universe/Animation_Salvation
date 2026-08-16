import * as THREE from 'three';
import type { BoneNode, RigDescription } from '../types';

export interface RigRuntime {
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  boneById: Map<string, THREE.Bone>;
  rootBone: THREE.Bone;
  rig: RigDescription;
}

interface Capsule {
  boneId: string;
  boneIndex: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
}

const MAX_INFLUENCES = 4;
const FALLOFF_POWER = 2;

export function buildSkinnedMesh(geometry: THREE.BufferGeometry, rig: RigDescription, material: THREE.Material): RigRuntime {
  const byId = new Map(rig.bones.map((b) => [b.id, b]));
  const rootDesc = rig.bones.find((b) => b.parentId === null);
  if (!rootDesc) throw new Error('Rig has no root bone.');

  const threeBones = new Map<string, THREE.Bone>();
  const boneIndex = new Map<string, number>();
  const orderedBones: THREE.Bone[] = [];

  const createBone = (desc: BoneNode) => {
    const bone = new THREE.Bone();
    bone.name = desc.id;
    bone.userData = { rigId: desc.id, displayName: desc.name, jointType: desc.jointType };
    threeBones.set(desc.id, bone);
    boneIndex.set(desc.id, orderedBones.length);
    orderedBones.push(bone);
    return bone;
  };

  // Breadth-first so parents are always created (and positioned) before children.
  const queue: BoneNode[] = [rootDesc];
  while (queue.length) {
    const desc = queue.shift()!;
    const bone = threeBones.get(desc.id) ?? createBone(desc);
    if (desc.parentId) {
      const parentBone = threeBones.get(desc.parentId)!;
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
      if (!threeBones.has(child.id)) createBone(child);
      queue.push(child);
    }
  }

  const rootBone = threeBones.get(rootDesc.id)!;
  rootBone.updateMatrixWorld(true);

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
  // zero-length capsule at its own position, so nearby vertices can still bind to it.
  for (const desc of rig.bones) {
    if (capsules.some((c) => c.boneId === desc.id)) continue;
    const p = new THREE.Vector3(...desc.position);
    capsules.push({ boneId: desc.id, boneIndex: boneIndex.get(desc.id)!, p0: p, p1: p });
  }

  applySkinWeights(geometry, capsules);

  const skeleton = new THREE.Skeleton(orderedBones);
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(skeleton);
  skinnedMesh.frustumCulled = false;

  return { skinnedMesh, skeleton, boneById: threeBones, rootBone, rig };
}

function applySkinWeights(geometry: THREE.BufferGeometry, capsules: Capsule[]) {
  const posAttr = geometry.getAttribute('position');
  const vertexCount = posAttr.count;
  const skinIndex = new Float32Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);

  const v = new THREE.Vector3();
  for (let i = 0; i < vertexCount; i++) {
    v.fromBufferAttribute(posAttr, i);

    const scored: { boneIndex: number; weight: number }[] = [];
    const bestPerBone = new Map<number, number>();
    for (const cap of capsules) {
      const d = pointToSegmentDistance(v, cap.p0, cap.p1);
      const w = 1 / Math.pow(d + 0.02, FALLOFF_POWER);
      const prev = bestPerBone.get(cap.boneIndex);
      if (prev === undefined || w > prev) bestPerBone.set(cap.boneIndex, w);
    }
    for (const [boneIndex, weight] of bestPerBone) scored.push({ boneIndex, weight });
    scored.sort((a, b) => b.weight - a.weight);
    const top = scored.slice(0, MAX_INFLUENCES);
    const sum = top.reduce((a, s) => a + s.weight, 0) || 1;

    for (let k = 0; k < MAX_INFLUENCES; k++) {
      skinIndex[i * 4 + k] = top[k] ? top[k].boneIndex : 0;
      skinWeight[i * 4 + k] = top[k] ? top[k].weight / sum : 0;
    }
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
}

function pointToSegmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = new THREE.Vector3().subVectors(b, a);
  const len2 = ab.lengthSq();
  if (len2 < 1e-8) return p.distanceTo(a);
  const t = Math.max(0, Math.min(1, new THREE.Vector3().subVectors(p, a).dot(ab) / len2));
  const proj = a.clone().addScaledVector(ab, t);
  return p.distanceTo(proj);
}
