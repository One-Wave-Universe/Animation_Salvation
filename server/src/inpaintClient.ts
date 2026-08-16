import OpenAI, { toFile } from 'openai';
import { missingKeyError } from './sceneDirectorShared.js';

const DEFAULT_PROMPT =
  'Seamlessly extend the surrounding texture, material, and lighting to fill the transparent area. ' +
  'Do not add new objects, limbs, or details that are not implied by the surrounding pixels — blend naturally.';

function stripDataUrlPrefix(b64: string): string {
  const commaIndex = b64.indexOf(',');
  return b64.startsWith('data:') && commaIndex !== -1 ? b64.slice(commaIndex + 1) : b64;
}

/**
 * Fills the transparent region of `maskBase64` (alpha=0 => fill, alpha=255 => keep,
 * matching OpenAI's images.edit mask convention) within `imageBase64`, returning a
 * data URL of the result. OpenAI-only: Anthropic has no image-generation/editing API.
 */
export async function inpaintLayer(imageBase64: string, maskBase64: string, prompt?: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw missingKeyError('OPENAI_API_KEY');

  const client = new OpenAI({ apiKey });
  const imageBuffer = Buffer.from(stripDataUrlPrefix(imageBase64), 'base64');
  const maskBuffer = Buffer.from(stripDataUrlPrefix(maskBase64), 'base64');

  const [imageFile, maskFile] = await Promise.all([
    toFile(imageBuffer, 'layer.png', { type: 'image/png' }),
    toFile(maskBuffer, 'mask.png', { type: 'image/png' }),
  ]);

  const response = await client.images.edit({
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    image: imageFile,
    mask: maskFile,
    prompt: prompt || DEFAULT_PROMPT,
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (!b64) {
    throw Object.assign(new Error('Inpainting returned no image data.'), { statusCode: 502 });
  }
  return `data:image/png;base64,${b64}`;
}
