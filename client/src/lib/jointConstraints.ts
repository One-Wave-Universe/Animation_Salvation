import * as THREE from 'three';
import type { BoneNode } from '../types';

const tmpAxis = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
const identity = new THREE.Quaternion();

/**
 * Writes a constrained local rotation onto `bone`, given the desired rotation and the
 * bone's joint description. Hinge joints are hard-clamped to a single axis + angle
 * range; ball joints are clamped to a maximum cone deflection from bind pose; the root
 * is unconstrained.
 */
export function poseBone(bone: THREE.Bone, desc: BoneNode, desiredLocalQuat: THREE.Quaternion) {
  if (desc.jointType === 'root') {
    bone.quaternion.copy(desiredLocalQuat);
    return;
  }

  if (desc.jointType === 'hinge') {
    const axis = desc.hingeAxis ?? [0, 0, 1];
    tmpAxis.set(axis[0], axis[1], axis[2]).normalize();
    const angle = swingTwistAngleAroundAxis(desiredLocalQuat, tmpAxis);
    const min = THREE.MathUtils.degToRad(desc.hingeMinDeg ?? -100);
    const max = THREE.MathUtils.degToRad(desc.hingeMaxDeg ?? 100);
    const clamped = THREE.MathUtils.clamp(angle, min, max);
    tmpQuat.setFromAxisAngle(tmpAxis, clamped);
    bone.quaternion.copy(tmpQuat);
    return;
  }

  // Ball joint: clamp total deflection from identity (bind pose) to the cone limit.
  const limit = THREE.MathUtils.degToRad(desc.ballConeLimitDeg ?? 70);
  const angleFromIdentity = 2 * Math.acos(THREE.MathUtils.clamp(Math.abs(desiredLocalQuat.w), -1, 1));
  if (angleFromIdentity <= limit) {
    bone.quaternion.copy(desiredLocalQuat);
  } else {
    bone.quaternion.copy(identity).slerp(desiredLocalQuat, limit / angleFromIdentity);
  }
}

/** Angle (radians, signed) of the rotation's component around `axis`. */
function swingTwistAngleAroundAxis(q: THREE.Quaternion, axis: THREE.Vector3): number {
  const qAxis = new THREE.Vector3(q.x, q.y, q.z);
  const dot = qAxis.dot(axis);
  const twist = new THREE.Quaternion(axis.x * dot, axis.y * dot, axis.z * dot, q.w).normalize();
  let angle = 2 * Math.acos(THREE.MathUtils.clamp(twist.w, -1, 1));
  if (angle > Math.PI) angle -= 2 * Math.PI;
  const sign = new THREE.Vector3(twist.x, twist.y, twist.z).dot(axis) < 0 ? -1 : 1;
  return angle * sign;
}
