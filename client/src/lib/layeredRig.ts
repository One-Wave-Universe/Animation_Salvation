import * as THREE from 'three';
import type { RigDescription } from '../types';
import type { CharacterLayer } from './layerBuilder';
import { buildBoneHierarchy, type AnimatableRig } from './boneHierarchy';

export interface LayeredRigRuntime extends AnimatableRig {
  group: THREE.Group;
  layerMeshes: Map<string, THREE.Mesh>;
}

/**
 * Mode B ("Photo Animation") attachment: the same bone tree as Mode A, but each bone
 * gets a small flat (or lightly displaced) textured plane as a child instead of a
 * shared skinned mesh. The plane already carries the original photo's own lighting
 * baked into its pixels, so it renders unlit (MeshBasicMaterial) — applying scene
 * lighting on top would double up the shading that's already in the photo.
 */
export function buildLayeredRig(rig: RigDescription, layers: CharacterLayer[]): LayeredRigRuntime {
  const { rootBone, boneById } = buildBoneHierarchy(rig);

  const layerMeshes = new Map<string, THREE.Mesh>();
  for (const layer of layers) {
    const bone = boneById.get(layer.boneId);
    if (!bone) continue;

    const texture = new THREE.CanvasTexture(layer.canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      alphaTest: 0.05,
      side: THREE.DoubleSide,
    });
    const geometry = new THREE.PlaneGeometry(Math.max(layer.width, 0.001), Math.max(layer.height, 0.001));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(layer.centerOffset[0], layer.centerOffset[1], layer.centerOffset[2]);
    mesh.userData = { boneId: layer.boneId };

    bone.add(mesh);
    layerMeshes.set(layer.boneId, mesh);
  }

  const group = new THREE.Group();
  group.add(rootBone);

  return { rootBone, boneById, rig, group, layerMeshes };
}

export function disposeLayeredRig(runtime: LayeredRigRuntime) {
  for (const mesh of runtime.layerMeshes.values()) {
    mesh.geometry.dispose();
    const mat = mesh.material as THREE.MeshBasicMaterial;
    mat.map?.dispose();
    mat.dispose();
  }
}
