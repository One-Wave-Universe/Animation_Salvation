import { useAppStore } from '../store';
import type { JointType } from '../types';

const NEXT_TYPE: Record<JointType, JointType> = { root: 'root', ball: 'hinge', hinge: 'ball' };
const TYPE_LABEL: Record<JointType, string> = { root: 'Root', ball: 'Ball joint', hinge: 'Hinge joint' };
const TYPE_CLASS: Record<JointType, string> = { root: 'badge-root', ball: 'badge-ball', hinge: 'badge-hinge' };

export function RigEditor() {
  const rig = useAppStore((s) => s.rig);
  const updateBone = useAppStore((s) => s.updateBone);
  const stage = useAppStore((s) => s.stage);
  const selectedBoneId = useAppStore((s) => s.selectedBoneId);
  const setSelectedBoneId = useAppStore((s) => s.setSelectedBoneId);
  const showSkeleton = useAppStore((s) => s.showSkeleton);
  const setShowSkeleton = useAppStore((s) => s.setShowSkeleton);
  const showWireframe = useAppStore((s) => s.showWireframe);
  const setShowWireframe = useAppStore((s) => s.setShowWireframe);

  if (stage !== 'ready' || !rig) return null;

  const ballCount = rig.bones.filter((b) => b.jointType === 'ball').length;
  const hingeCount = rig.bones.filter((b) => b.jointType === 'hinge').length;

  return (
    <div className="panel">
      <h2>Rig</h2>
      <p className="hint">
        {rig.bones.length} bones auto-detected — {ballCount} ball, {hingeCount} hinge. Auto-classification is a best guess; click a
        badge to relabel a joint if it's wrong.
      </p>
      <div className="row">
        <button className={`btn btn-secondary ${showSkeleton ? 'btn-active' : ''}`} onClick={() => setShowSkeleton(!showSkeleton)}>
          {showSkeleton ? 'Hide' : 'Show'} skeleton
        </button>
        <button className={`btn btn-secondary ${showWireframe ? 'btn-active' : ''}`} onClick={() => setShowWireframe(!showWireframe)}>
          {showWireframe ? 'Hide' : 'Show'} wireframe
        </button>
      </div>
      <p className="hint small">
        Select a ball or hinge joint below, then use the Gamepad panel to drive it directly with an analog stick - useful for checking a
        joint's real range of motion from any camera angle rather than only whatever a scripted action happens to do.
      </p>
      <div className="bone-list">
        {rig.bones.map((bone) => (
          <div className={`bone-row ${selectedBoneId === bone.id ? 'bone-row-selected' : ''}`} key={bone.id}>
            <button
              className="bone-name bone-select"
              disabled={bone.jointType === 'root'}
              onClick={() => setSelectedBoneId(selectedBoneId === bone.id ? null : bone.id)}
              title={bone.jointType === 'root' ? 'Root bone is not directly posable' : 'Select for gamepad control'}
            >
              {selectedBoneId === bone.id ? '● ' : ''}
              {bone.name}
            </button>
            <button
              className={`badge ${TYPE_CLASS[bone.jointType]}`}
              disabled={bone.jointType === 'root'}
              onClick={() => updateBone(bone.id, { jointType: NEXT_TYPE[bone.jointType] })}
              title={bone.jointType === 'root' ? 'Root bone (unconstrained)' : 'Click to toggle ball / hinge'}
            >
              {TYPE_LABEL[bone.jointType]}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
