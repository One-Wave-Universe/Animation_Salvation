import { useCallback, useEffect, useState } from 'react';
import { useAppStore } from '../store';
import {
  saveCharacter,
  listCharacters,
  loadCharacter,
  deleteCharacter,
  canvasToBlob,
  serializeLayers,
  deserializeLayers,
  blobToCanvas,
  makeThumbnail,
  type SavedCharacterSummary,
} from '../lib/characterStorage';
import { getCurrentCharacterData, loadPipelineFromSaved } from '../lib/pipeline';
import { getCurrentLayeredData, loadLayeredPipelineFromSaved } from '../lib/layeredPipeline';

export function SavedCharactersPanel() {
  const [saved, setSaved] = useState<SavedCharacterSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [savingBusy, setSavingBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const mode = useAppStore((s) => s.mode);
  const stage = useAppStore((s) => s.stage);
  const rig = useAppStore((s) => s.rig);
  const setMode = useAppStore((s) => s.setMode);
  const setStage = useAppStore((s) => s.setStage);
  const setError = useAppStore((s) => s.setError);
  const setImageUrl = useAppStore((s) => s.setImageUrl);
  const setRig = useAppStore((s) => s.setRig);
  const markReady = useAppStore((s) => s.markReady);
  const setInpaintRegionsCount = useAppStore((s) => s.setInpaintRegionsCount);
  const setInpaintBusy = useAppStore((s) => s.setInpaintBusy);
  const setInpaintProgress = useAppStore((s) => s.setInpaintProgress);
  const setInpaintDone = useAppStore((s) => s.setInpaintDone);
  const setInpaintError = useAppStore((s) => s.setInpaintError);

  const refresh = useCallback(async () => {
    try {
      setSaved(await listCharacters());
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Could not load saved characters.');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const canSave = stage === 'ready' && !!rig;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSavingBusy(true);
    setSaveError(null);
    try {
      // Use the store's rig, not the pipeline's cached copy — joint-type edits made
      // in the Rig Editor only land in the store, so that's the source of truth.
      const liveRig = rig!;
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      const label = name.trim() || `Character ${new Date(createdAt).toLocaleString()}`;

      if (mode === 'photo') {
        const data = getCurrentLayeredData();
        if (!data) throw new Error('Nothing to save yet.');
        await saveCharacter({
          id,
          name: label,
          createdAt,
          mode: 'photo',
          thumbnailDataUrl: makeThumbnail(data.sourceCanvas),
          sourceImageBlob: await canvasToBlob(data.sourceCanvas),
          mask: data.mask,
          depth: data.depth,
          imgWidth: data.imgWidth,
          imgHeight: data.imgHeight,
          rig: liveRig,
          layers: await serializeLayers(data.layers),
          inpaintDone: data.inpaintDone,
        });
      } else {
        const data = getCurrentCharacterData();
        if (!data) throw new Error('Nothing to save yet.');
        await saveCharacter({
          id,
          name: label,
          createdAt,
          mode: 'rig3d',
          thumbnailDataUrl: makeThumbnail(data.sourceCanvas),
          sourceImageBlob: await canvasToBlob(data.sourceCanvas),
          mask: data.mask,
          depth: data.depth,
          imgWidth: data.width,
          imgHeight: data.height,
          rig: liveRig,
        });
      }

      setName('');
      await refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save this character.');
    } finally {
      setSavingBusy(false);
    }
  }, [canSave, mode, name, rig, refresh]);

  const handleLoad = useCallback(
    async (id: string) => {
      setBusyId(id);
      setActionError(null);
      try {
        const record = await loadCharacter(id);
        if (!record) throw new Error('That saved character is gone.');

        setInpaintBusy(false);
        setInpaintProgress(null);
        setInpaintError(null);
        setMode(record.mode);
        setStage('loading-image', 'Loading saved character…');

        const sourceCanvas = await blobToCanvas(record.sourceImageBlob);

        if (record.mode === 'photo') {
          const layers = record.layers ? await deserializeLayers(record.layers) : null;
          const result = await loadLayeredPipelineFromSaved(
            sourceCanvas,
            record.mask,
            record.depth,
            record.imgWidth,
            record.imgHeight,
            record.rig,
            layers,
          );
          setImageUrl(result.imageUrl);
          setRig(result.rig);
          setInpaintRegionsCount(result.regionsCount);
          setInpaintDone(record.inpaintDone ?? false);
        } else {
          const result = await loadPipelineFromSaved(
            sourceCanvas,
            record.mask,
            record.depth,
            record.imgWidth,
            record.imgHeight,
            record.rig,
          );
          setImageUrl(result.imageUrl);
          setRig(result.rig);
          setInpaintRegionsCount(0);
          setInpaintDone(false);
        }

        setStage('ready');
        markReady();
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : 'Could not load that character.');
      } finally {
        setBusyId(null);
      }
    },
    [
      setMode,
      setStage,
      setError,
      setImageUrl,
      setRig,
      markReady,
      setInpaintRegionsCount,
      setInpaintBusy,
      setInpaintProgress,
      setInpaintDone,
      setInpaintError,
    ],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setBusyId(id);
      setActionError(null);
      try {
        await deleteCharacter(id);
        await refresh();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Could not delete that character.');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return (
    <div className="panel">
      <h2>Saved characters</h2>
      <p className="hint">
        Save a processed character to reload it instantly later — no re-uploading, no re-running depth estimation, and any AI
        inpainting fills or joint edits are kept.
      </p>

      <div className="row">
        <input
          className="text-input"
          type="text"
          placeholder="Name this character…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canSave || savingBusy}
        />
        <button className="btn" disabled={!canSave || savingBusy} onClick={handleSave}>
          {savingBusy ? 'Saving…' : 'Save this character'}
        </button>
      </div>
      {saveError && <div className="error">{saveError}</div>}
      {!canSave && <p className="hint small">Process a character first, then it can be saved.</p>}

      {listError && <div className="error">{listError}</div>}
      {actionError && <div className="error">{actionError}</div>}

      {saved.length > 0 && (
        <div className="saved-list">
          {saved.map((s) => (
            <div className="saved-row" key={s.id}>
              <img className="saved-thumb" src={s.thumbnailDataUrl} alt={s.name} />
              <div className="saved-meta">
                <span className="saved-name">{s.name}</span>
                <span className="saved-sub">
                  {s.mode === 'photo' ? 'Photo Animation' : '3D Rig'} · {new Date(s.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="saved-actions">
                <button className="btn btn-secondary" disabled={busyId === s.id} onClick={() => handleLoad(s.id)}>
                  {busyId === s.id ? '…' : 'Load'}
                </button>
                <button className="btn btn-secondary" disabled={busyId === s.id} onClick={() => handleDelete(s.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
