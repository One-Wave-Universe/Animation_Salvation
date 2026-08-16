import * as THREE from 'three';

export interface MeshBuildResult {
  geometry: THREE.BufferGeometry;
  /** Model-space size the image maps to; used to keep skeleton/mesh in the same space. */
  modelWidth: number;
  modelHeight: number;
  /** Maps an image pixel (px,py) to model-space (x,y,zFront). Used by the skeleton builder. */
  sampleFront: (px: number, py: number) => { x: number; y: number; z: number } | null;
}

const GRID_RES = 96;
export const FRONT_DEPTH_SCALE = 0.35;
const BACK_DEPTH_SCALE = 0.22;
const BASE_THICKNESS = 0.05;
/** Target height (model units) the image's tallest mask dimension maps to. */
const TARGET_HEIGHT = 2;

export interface ImageToModelTransform {
  toModelXY(px: number, py: number): [number, number];
  depthAt(px: number, py: number): number;
  scale: number;
}

/**
 * The single source of truth for image-pixel -> model-space mapping. Both the main
 * relief mesh (this file) and the Mode B per-bone layer planes (layerBuilder.ts) must
 * agree on this transform, or layers and mesh/rig would drift apart in the scene.
 */
export function computeImageToModelTransform(mask: Uint8Array, depth: Float32Array, width: number, height: number): ImageToModelTransform {
  const bbox = maskBoundingBox(mask, width, height);
  if (!bbox) throw new Error('No foreground pixels found in the uploaded image.');
  const { minX, minY, maxX, maxY } = bbox;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const scale = TARGET_HEIGHT / Math.max(bboxW, bboxH);

  return {
    scale,
    toModelXY: (px, py) => [(px - (minX + bboxW / 2)) * scale, -(py - (minY + bboxH / 2)) * scale],
    depthAt: (px, py) => bilinearSample(depth, width, height, px, py),
  };
}

export function buildCharacterMesh(
  mask: Uint8Array,
  depth: Float32Array,
  imgWidth: number,
  imgHeight: number,
): MeshBuildResult {
  const bbox = maskBoundingBox(mask, imgWidth, imgHeight);
  if (!bbox) throw new Error('No foreground pixels found in the uploaded image.');
  const { minX, minY, maxX, maxY } = bbox;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;

  const transform = computeImageToModelTransform(mask, depth, imgWidth, imgHeight);
  const gridW = Math.max(8, Math.round((bboxW / Math.max(bboxW, bboxH)) * GRID_RES));
  const gridH = Math.max(8, Math.round((bboxH / Math.max(bboxW, bboxH)) * GRID_RES));

  const isInside = (px: number, py: number) =>
    px >= 0 && py >= 0 && px < imgWidth && py < imgHeight && mask[py * imgWidth + px] > 0;

  const pxAt = (gx: number) => minX + Math.round((gx / (gridW - 1)) * (bboxW - 1));
  const pyAt = (gy: number) => minY + Math.round((gy / (gridH - 1)) * (bboxH - 1));

  const insideGrid = new Uint8Array(gridW * gridH);
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      insideGrid[gy * gridW + gx] = isInside(pxAt(gx), pyAt(gy)) ? 1 : 0;
    }
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const frontIndex = new Int32Array(gridW * gridH).fill(-1);
  const backIndex = new Int32Array(gridW * gridH).fill(-1);

  let vCount = 0;
  const pushVertex = (x: number, y: number, z: number, u: number, v: number) => {
    positions.push(x, y, z);
    uvs.push(u, v);
    return vCount++;
  };

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!insideGrid[gy * gridW + gx]) continue;
      const px = pxAt(gx);
      const py = pyAt(gy);
      const [x, y] = transform.toModelXY(px, py);
      const d = transform.depthAt(px, py);
      const u = px / (imgWidth - 1);
      const v = 1 - py / (imgHeight - 1);

      const zFront = d * FRONT_DEPTH_SCALE;
      frontIndex[gy * gridW + gx] = pushVertex(x, y, zFront, u, v);

      const zBack = -d * BACK_DEPTH_SCALE - BASE_THICKNESS;
      // Mirror U so the reused texture reads as a plausible (not accurate) back view.
      backIndex[gy * gridW + gx] = pushVertex(x, y, zBack, 1 - u, v);
    }
  }

  const indices: number[] = [];
  const at = (grid: Int32Array, gx: number, gy: number) => (gx < 0 || gy < 0 || gx >= gridW || gy >= gridH ? -1 : grid[gy * gridW + gx]);

  for (let gy = 0; gy < gridH - 1; gy++) {
    for (let gx = 0; gx < gridW - 1; gx++) {
      const f00 = at(frontIndex, gx, gy);
      const f10 = at(frontIndex, gx + 1, gy);
      const f01 = at(frontIndex, gx, gy + 1);
      const f11 = at(frontIndex, gx + 1, gy + 1);
      if (f00 >= 0 && f10 >= 0 && f01 >= 0 && f11 >= 0) {
        indices.push(f00, f10, f11, f00, f11, f01);
      }

      const b00 = at(backIndex, gx, gy);
      const b10 = at(backIndex, gx + 1, gy);
      const b01 = at(backIndex, gx, gy + 1);
      const b11 = at(backIndex, gx + 1, gy + 1);
      if (b00 >= 0 && b10 >= 0 && b01 >= 0 && b11 >= 0) {
        // Reversed winding so the back cap's normal faces -Z (outward, away from front).
        indices.push(b00, b11, b10, b00, b01, b11);
      }
    }
  }

  // Silhouette walls: for every inside->inside edge that borders an outside (or grid-edge)
  // cell on either side, stitch a quad between the front and back vertex at that edge.
  const addWallIfBoundary = (gxA: number, gyA: number, gxB: number, gyB: number, outsideChecks: [number, number][]) => {
    const fA = at(frontIndex, gxA, gyA);
    const fB = at(frontIndex, gxB, gyB);
    const bA = at(backIndex, gxA, gyA);
    const bB = at(backIndex, gxB, gyB);
    if (fA < 0 || fB < 0 || bA < 0 || bB < 0) return;
    const isBoundary = outsideChecks.some(([gx, gy]) => at(frontIndex, gx, gy) < 0);
    if (!isBoundary) return;
    indices.push(fA, fB, bB, fA, bB, bA);
  };

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW - 1; gx++) {
      addWallIfBoundary(gx, gy, gx + 1, gy, [
        [gx, gy - 1],
        [gx + 1, gy - 1],
        [gx, gy + 1],
        [gx + 1, gy + 1],
      ]);
    }
  }
  for (let gy = 0; gy < gridH - 1; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      addWallIfBoundary(gx, gy, gx, gy + 1, [
        [gx - 1, gy],
        [gx - 1, gy + 1],
        [gx + 1, gy],
        [gx + 1, gy + 1],
      ]);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const sampleFront = (px: number, py: number) => {
    if (!isInside(Math.round(px), Math.round(py))) return null;
    const [x, y] = transform.toModelXY(px, py);
    const z = transform.depthAt(px, py) * FRONT_DEPTH_SCALE;
    return { x, y, z };
  };

  return { geometry, modelWidth: bboxW * transform.scale, modelHeight: bboxH * transform.scale, sampleFront };
}

export function maskBoundingBox(mask: Uint8Array, width: number, height: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (minX === Infinity) return null;
  return { minX, minY, maxX, maxY };
}

function bilinearSample(data: Float32Array, width: number, height: number, px: number, py: number): number {
  const x = Math.min(width - 1.001, Math.max(0, px));
  const y = Math.min(height - 1.001, Math.max(0, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const fx = x - x0;
  const fy = y - y0;
  const v00 = data[y0 * width + x0];
  const v10 = data[y0 * width + x1];
  const v01 = data[y1 * width + x0];
  const v11 = data[y1 * width + x1];
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}
