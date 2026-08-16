export interface LoadedImage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  imageData: ImageData;
}

const MAX_DIMENSION = 768;

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });

    const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return { canvas, ctx, width, height, imageData };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Returns a 0/255 mask the same size as the image. Uses the alpha channel if the
 * PNG has meaningful transparency; otherwise falls back to a corner-sampled
 * chroma/background-color key so flat-background PNGs still work.
 */
export function extractMask(img: LoadedImage): Uint8Array {
  const { data, width, height } = img.imageData;
  const mask = new Uint8Array(width * height);

  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4 * 37) {
    if (data[i] < 250) {
      hasAlpha = true;
      break;
    }
  }

  if (hasAlpha) {
    for (let p = 0, i = 3; p < mask.length; p++, i += 4) {
      mask[p] = data[i] > 16 ? 255 : 0;
    }
    return cleanupMask(mask, width, height);
  }

  // Fallback: sample the four corners as background color candidates, then
  // flood-fill from the border removing pixels close to that color.
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ];
  const bg = corners
    .map(([x, y]) => sampleRGB(data, width, x, y))
    .reduce((a, b) => [a[0] + b[0] / 4, a[1] + b[1] / 4, a[2] + b[2] / 4], [0, 0, 0]);

  const threshold = 32;
  const isBackground = (x: number, y: number) => {
    const [r, g, b] = sampleRGB(data, width, x, y);
    const d = Math.hypot(r - bg[0], g - bg[1], b - bg[2]);
    return d < threshold;
  };

  mask.fill(255);
  const stack: number[] = [];
  const visited = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    stack.push(x, 0, x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    stack.push(0, y, width - 1, y);
  }
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    visited[idx] = 1;
    if (!isBackground(x, y)) continue;
    mask[idx] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return cleanupMask(mask, width, height);
}

function sampleRGB(data: Uint8ClampedArray, width: number, x: number, y: number): [number, number, number] {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}

/** Removes isolated single-pixel noise via a 3x3 majority pass. */
function cleanupMask(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (mask[idx]) continue;
      let neighborsOn = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * width + (x + dx)]) neighborsOn++;
        }
      }
      if (neighborsOn >= 7) out[idx] = 255;
    }
  }
  // Morphological closing (dilate then erode) bridges small gaps between silhouette
  // parts that are visually touching but not pixel-connected — e.g. a head drawn a
  // couple of pixels above the neck, or antialiasing thinning a join to nothing.
  // Without this, skeletonize() sees them as separate components and only the one
  // containing the root gets a bone.
  return erode(dilate(out, width, height, 4), width, height, 4);
}

export function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(mask, width, height, radius, /* anyMode */ true);
}

function erode(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  return morph(mask, width, height, radius, /* anyMode */ false);
}

/** Shared square-kernel min/max filter. anyMode=true -> dilate (OR), false -> erode (AND). */
function morph(mask: Uint8Array, width: number, height: number, radius: number, anyMode: boolean): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let result = anyMode ? 0 : 255;
      for (let dy = -radius; dy <= radius && (anyMode ? result === 0 : result === 255); dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const on = mask[ny * width + nx] > 0;
          if (anyMode && on) {
            result = 255;
            break;
          }
          if (!anyMode && !on) {
            result = 0;
            break;
          }
        }
      }
      out[y * width + x] = result;
    }
  }
  return out;
}
