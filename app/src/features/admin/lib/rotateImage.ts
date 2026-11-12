/*
 * Turns a photo of a notes page the right way up before it is sent
 * (ADM-M-Notes "Rotate"). The contract has no rotation field, so the pixels
 * themselves are turned, on a canvas, one photo at a time.
 *
 * Only photos the facilitator rotated go through here; every other file is
 * sent untouched. The canvas is capped at 2000px on its long side: a 12
 * megapixel photo needs about 48 MB as a bitmap, which a low-memory phone
 * may not have, and 2000px is plenty for reading handwriting.
 */
export type Rotation = 0 | 90 | 180 | 270;

export const MAX_SIDE = 2000;

export function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 90) % 360) as Rotation;
}

/** Width and height of the canvas for a picture of w × h turned by `rotation`, scaled to fit `maxSide`. */
export function rotatedSize(width: number, height: number, rotation: Rotation, maxSide = MAX_SIDE): { width: number; height: number; scale: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height, 1));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  return rotation === 90 || rotation === 270 ? { width: h, height: w, scale } : { width: w, height: h, scale };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This photo could not be opened.'));
    image.src = url;
  });
}

/** Resolves with a JPEG of the photo turned clockwise by `rotation`. Rejects when the phone cannot do it. */
export async function rotateImage(file: Blob, rotation: Rotation): Promise<Blob> {
  if (rotation === 0) return file;
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const size = rotatedSize(image.naturalWidth, image.naturalHeight, rotation);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.toBlob !== 'function') throw new Error('This phone cannot turn photos.');
    context.translate(size.width / 2, size.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    const drawW = image.naturalWidth * size.scale;
    const drawH = image.naturalHeight * size.scale;
    context.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    // Give the bitmap memory back straight away.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('This phone cannot turn photos.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** "notes.png" → "notes.jpg": a turned photo is always a JPEG. */
export function rotatedName(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
}
