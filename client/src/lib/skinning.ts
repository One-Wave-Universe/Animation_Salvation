import * as THREE from 'three';
import type { RigDescription } from '../types';
import { buildBoneHierarchy, buildCapsules, pointToSegmentDistance, type Capsule } from './boneHierarchy';

export interface RigRuntime {
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  boneById: Map<string, THREE.Bone>;
  rootBone: THREE.Bone;
  rig: RigDescription;
}

const MAX_INFLUENCES = 4;
const FALLOFF_POWER = 2;

export function buildSkinnedMesh(geometry: THREE.BufferGeometry, rig: RigDescription, material: THREE.Material): RigRuntime {
  const { rootBone, boneById, boneIndex, orderedBones } = buildBoneHierarchy(rig);
  const capsules = buildCapsules(rig, boneIndex);

  applySkinWeights(geometry, capsules);

  const skeleton = new THREE.Skeleton(orderedBones);
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(skeleton);
  skinnedMesh.frustumCulled = false;

  return { skinnedMesh, skeleton, boneById, rootBone, rig };
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
