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
// The blend zone around each capsule scales with that bone's *own* length,
// not a fixed world-space radius. A real rig reads as rigid limb segments
// with blending confined to a narrow band right at each joint - the blend
// zone is small relative to the bone. A fixed absolute cutoff doesn't know
// how long any given bone actually is: on a 24-hinge-joint auto-rig where
// individual segments can be quite short, a "generous" fixed radius like
// 0.45 can end up wider than the segment itself, so nearly the whole limb
// blends across its neighbors instead of just the joint - which is what
// reads as a limb built from rubber rather than rigid segments.
const BLEND_FRACTION = 0.4; // fraction of a capsule's own length that blends into its neighbors
const MIN_INFLUENCE_DISTANCE = 0.08; // floor for zero-length (leaf/root) capsules
const MAX_INFLUENCE_DISTANCE_CAP = 0.4; // ceiling so a long torso/spine capsule doesn't blend absurdly wide either
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

  // Each capsule's blend-zone cutoff is a fraction of its own length, not a
  // fixed world-space radius - see BLEND_FRACTION above.
  const capsuleCutoffs = capsules.map((cap) =>
    THREE.MathUtils.clamp(cap.length * BLEND_FRACTION, MIN_INFLUENCE_DISTANCE, MAX_INFLUENCE_DISTANCE_CAP),
  );

  const v = new THREE.Vector3();
  const hopCache = new Map<number, Map<number, number>>();
  for (let i = 0; i < vertexCount; i++) {
    v.fromBufferAttribute(posAttr, i);

    // Pass 1: distance to every capsule, and which bone is truly nearest -
    // this is the vertex's "home" bone regardless of hierarchy.
    const dists: { boneIndex: number; d: number; cutoff: number }[] = [];
    let nearestBoneIndex = -1;
    let nearestDist = Infinity;
    for (let c = 0; c < capsules.length; c++) {
      const cap = capsules[c];
      const d = pointToSegmentDistance(v, cap.p0, cap.p1);
      dists.push({ boneIndex: cap.boneIndex, d, cutoff: capsuleCutoffs[c] });
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
    for (const { boneIndex, d, cutoff } of dists) {
      if (!allowedHops.has(boneIndex)) continue;
      if (d >= cutoff) continue;
      // Smooth (compactly-supported) falloff rather than a hard-truncated
      // inverse-power curve: taper continuously to exactly 0 at the cutoff
      // instead of dropping straight from "full weight" to "excluded" at the
      // boundary, which would just relocate the tear to the cutoff radius
      // instead of the hierarchy boundary.
      const taper = 1 - (d / cutoff) ** 2;
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
