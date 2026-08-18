import * as THREE from 'three';
import type { RigDescription } from '../types';
import { buildBoneAdjacency, buildBoneHierarchy, buildCapsules, hopDistances, pointToSegmentDistance, type Capsule } from './boneHierarchy';

export interface RigRuntime {
  skinnedMesh: THREE.SkinnedMesh;
  skeleton: THREE.Skeleton;
  boneById: Map<string, THREE.Bone>;
  rootBone: THREE.Bone;
  rig: RigDescription;
}

const MAX_INFLUENCES = 3;
const FALLOFF_POWER = 3;
// Hard cutoff, in model-space units (character height is normalized to 2 by
// meshBuilder - see TARGET_HEIGHT). Bones farther than this from a vertex get
// zero weight, full stop, instead of an ever-smaller but still nonzero one.
// Without a real cutoff, a torso vertex near the shoulder can end up with a
// *leg* bone as one of its "4 nearest" simply because the auto-rig packs 30-40
// bones into a ~2-unit-tall mesh - every part of the body ends up with a
// little pull from bones it has nothing to do with, which is exactly what
// reads as melty/taffy stretching once anything moves.
const MAX_INFLUENCE_DISTANCE = 0.45;
// How many parent/child hops from a vertex's true nearest bone another bone
// is still allowed to blend in. 2 covers a real joint (e.g. upper-arm ->
// elbow -> forearm all blending near the elbow) without reaching across to
// an anatomically unrelated limb that only happens to be spatially close.
const MAX_HIERARCHY_HOPS = 2;

export function buildSkinnedMesh(geometry: THREE.BufferGeometry, rig: RigDescription, material: THREE.Material): RigRuntime {
  const { rootBone, boneById, boneIndex, orderedBones } = buildBoneHierarchy(rig);
  const capsules = buildCapsules(rig, boneIndex);
  const adjacency = buildBoneAdjacency(rig, boneIndex);

  applySkinWeights(geometry, capsules, adjacency);

  const skeleton = new THREE.Skeleton(orderedBones);
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(skeleton);
  skinnedMesh.frustumCulled = false;

  return { skinnedMesh, skeleton, boneById, rootBone, rig };
}

function applySkinWeights(geometry: THREE.BufferGeometry, capsules: Capsule[], adjacency: Map<number, number[]>) {
  const posAttr = geometry.getAttribute('position');
  const vertexCount = posAttr.count;
  const skinIndex = new Float32Array(vertexCount * 4);
  const skinWeight = new Float32Array(vertexCount * 4);

  const v = new THREE.Vector3();
  const hopCache = new Map<number, Map<number, number>>();
  for (let i = 0; i < vertexCount; i++) {
    v.fromBufferAttribute(posAttr, i);

    // Pass 1: distance to every capsule, and which bone is truly nearest -
    // this is the vertex's "home" bone regardless of hierarchy.
    const dists: { boneIndex: number; d: number }[] = [];
    let nearestBoneIndex = -1;
    let nearestDist = Infinity;
    for (const cap of capsules) {
      const d = pointToSegmentDistance(v, cap.p0, cap.p1);
      dists.push({ boneIndex: cap.boneIndex, d });
      if (d < nearestDist) {
        nearestDist = d;
        nearestBoneIndex = cap.boneIndex;
      }
    }

    // Pass 2: only bones within MAX_HIERARCHY_HOPS of the home bone are
    // eligible to blend in at all, however spatially close they might be -
    // this is what actually stops a leg from tugging on the tail.
    let allowedHops = hopCache.get(nearestBoneIndex);
    if (!allowedHops) {
      allowedHops = hopDistances(adjacency, nearestBoneIndex, MAX_HIERARCHY_HOPS);
      hopCache.set(nearestBoneIndex, allowedHops);
    }

    const bestPerBone = new Map<number, number>();
    for (const { boneIndex, d } of dists) {
      if (!allowedHops.has(boneIndex)) continue;
      if (d >= MAX_INFLUENCE_DISTANCE) continue;
      // Smooth (compactly-supported) falloff rather than a hard-truncated
      // inverse-power curve: taper continuously to exactly 0 at the cutoff
      // instead of dropping straight from "full weight" to "excluded" at the
      // boundary, which would just relocate the tear to the cutoff radius
      // instead of the hierarchy boundary.
      const taper = 1 - (d / MAX_INFLUENCE_DISTANCE) ** 2;
      const w = (taper * taper) / Math.pow(d + 0.02, FALLOFF_POWER);
      const prev = bestPerBone.get(boneIndex);
      if (prev === undefined || w > prev) bestPerBone.set(boneIndex, w);
    }
    // The home bone itself was beyond the cutoff (a very sparse rig, or a
    // mesh scaled far from the usual normalized size) - fall back to a fully
    // rigid bind to it rather than leaving the vertex unweighted.
    if (bestPerBone.size === 0) bestPerBone.set(nearestBoneIndex, 1);

    const scored = Array.from(bestPerBone, ([boneIndex, weight]) => ({ boneIndex, weight }));
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
