import { useAppStore } from '../store';
import type { JointType } from '../types';

const NEXT_TYPE: Record<JointType, JointType> = { root: 'root', ball: 'hinge', hinge: 'ball' };
const TYPE_LABEL: Record<JointType, string> = { root: 'Root', ball: 'Ball joint', hinge: 'Hinge joint' };
const TYPE_CLASS: Record<JointType, string> = { root: 'badge-root', ball: 'badge-ball', hinge: 'badge-hinge' };

export function RigEditor() {
  const rig = useAppStore((s) => s.rig);
  const updateBone = useAppStore((s) => s.updateBone);
  const stage = useAppStore((s) => s.stage);

  if (stage !== 'ready' || !rig) return null;

  const ballCount = rig.bones.filter((b) => b.jointType === 'ball').length;
  const hingeCount = rig.bones.filter((b) => b.jointType === 'hinge').length;

  return (
    <div className="panel">
      <h2>2. Rig</h2>
      <p className="hint">
        {rig.bones.length} bones auto-detected — {ballCount} ball, {hingeCount} hinge. Auto-classification is a best guess; click a
        badge to relabel a joint if it's wrong.
      </p>
      <div className="bone-list">
        {rig.bones.map((bone) => (
          <div className="bone-row" key={bone.id}>
            <span className="bone-name">{bone.name}</span>
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
