import { useAppStore } from '../store';

export function GamepadStatus() {
  const stage = useAppStore((s) => s.stage);
  const gamepadConnected = useAppStore((s) => s.gamepadConnected);
  const selectedBoneId = useAppStore((s) => s.selectedBoneId);
  const rig = useAppStore((s) => s.rig);

  if (stage !== 'ready') return null;

  const selectedName = selectedBoneId ? rig?.bones.find((b) => b.id === selectedBoneId)?.name : null;

  return (
    <div className="panel">
      <h2>Gamepad</h2>
      {gamepadConnected ? (
        <p className="hint">
          Connected: {gamepadConnected}. Left stick bends/swings the selected joint, right stick X twists it.
          {selectedName ? ` Controlling "${selectedName}".` : ' Select a joint in the Rig panel to control it.'}
        </p>
      ) : (
        <p className="hint">
          No gamepad detected. Connect one and press any button on it - browsers only report a gamepad after it's seen input.
        </p>
      )}
    </div>
  );
}
