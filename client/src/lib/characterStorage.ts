import type { RigDescription } from '../types';
import type { RenderMode } from '../store';
import type { CharacterLayer } from './layerBuilder';

const DB_NAME = 'character-animator';
const DB_VERSION = 1;
const STORE = 'characters';

export interface SerializedLayer {
  boneId: string;
  imageBlob: Blob;
  centerOffset: [number, number, number];
  width: number;
  height: number;
  avgDepth01: number;
  pixelBBox: { minX: number; minY: number; maxX: number; maxY: number };
}

export interface SavedCharacterRecord {
  id: string;
  name: string;
  createdAt: number;
  mode: RenderMode;
  /** Small preview shown in the gallery — cheap to keep as a plain data URL. */
  thumbnailDataUrl: string;
  /** Full source image, needed to rebuild mesh/layer textures. */
  sourceImageBlob: Blob;
  mask: Uint8Array;
  depth: Float32Array;
  imgWidth: number;
  imgHeight: number;
  rig: RigDescription;
  /** Mode B only. Includes any inpainted fills — those pixels can't be
   *  regenerated from mask/depth/image alone, so the layers must be saved as-is. */
  layers?: SerializedLayer[];
  inpaintDone?: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveCharacter(record: SavedCharacterRecord): Promise<void> {
  await withStore('readwrite', (store) => store.put(record));
}

/** Metadata-only listing (no mask/depth/layers) — cheap enough for a gallery view. */
export interface SavedCharacterSummary {
  id: string;
  name: string;
  createdAt: number;
  mode: RenderMode;
  thumbnailDataUrl: string;
}

export async function listCharacters(): Promise<SavedCharacterSummary[]> {
  const all = await withStore<SavedCharacterRecord[]>('readonly', (store) => store.getAll());
  return all
    .map((r) => ({ id: r.id, name: r.name, createdAt: r.createdAt, mode: r.mode, thumbnailDataUrl: r.thumbnailDataUrl }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadCharacter(id: string): Promise<SavedCharacterRecord | undefined> {
  return withStore('readonly', (store) => store.get(id));
}

export async function deleteCharacter(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id));
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/png');
  });
}

export async function serializeLayers(layers: CharacterLayer[]): Promise<SerializedLayer[]> {
  return Promise.all(
    layers.map(async (l) => ({
      boneId: l.boneId,
      imageBlob: await canvasToBlob(l.canvas),
      centerOffset: l.centerOffset,
      width: l.width,
      height: l.height,
      avgDepth01: l.avgDepth01,
      pixelBBox: l.pixelBBox,
    })),
  );
}

export async function deserializeLayers(serialized: SerializedLayer[]): Promise<CharacterLayer[]> {
  return Promise.all(
    serialized.map(async (s) => {
      const bitmap = await createImageBitmap(s.imageBlob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      return {
        boneId: s.boneId,
        canvas,
        centerOffset: s.centerOffset,
        width: s.width,
        height: s.height,
        avgDepth01: s.avgDepth01,
        pixelBBox: s.pixelBBox,
      };
    }),
  );
}

export async function blobToCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export function makeThumbnail(canvas: HTMLCanvasElement, maxSize = 160): string {
  const scale = Math.min(1, maxSize / Math.max(canvas.width, canvas.height));
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(canvas, 0, 0, w, h);
  return out.toDataURL('image/png');
}
