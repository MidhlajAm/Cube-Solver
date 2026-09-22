/**
 * Reads the nine sticker colors out of a camera frame.
 *
 * The scanner draws a square 3x3 guide over the video; this samples a patch at
 * the middle of each cell rather than the whole cell, so the dark grid lines
 * between stickers and the rounded sticker corners never pollute the reading.
 */

import { medianRgb, rgbToLab, type Lab, type Rgb } from './color';

export interface StickerSample {
  /** Median color of the sampled patch. */
  rgb: Rgb;
  /** The same color in Lab, which is what the classifier compares. */
  lab: Lab;
}

/** The square region of the video frame the 3x3 guide covers, in pixels. */
export interface SampleRegion {
  x: number;
  y: number;
  size: number;
}

/**
 * The largest centered square that fits in the frame, inset a little so the
 * user is not asked to fill the display edge to edge.
 */
export function centeredRegion(width: number, height: number, inset = 0.72): SampleRegion {
  const size = Math.min(width, height) * inset;
  return {
    x: (width - size) / 2,
    y: (height - size) / 2,
    size,
  };
}

/**
 * Sample the nine stickers from an already-drawn canvas context.
 *
 * Returns them in the face's reading order (top-left to bottom-right), which is
 * the order the facelet indices use.
 */
export function sampleStickers(
  context: CanvasRenderingContext2D,
  region: SampleRegion,
  /** Fraction of each cell to read from the middle. */
  patchRatio = 0.5,
): StickerSample[] {
  const cell = region.size / 3;
  const patch = Math.max(2, Math.floor(cell * patchRatio));
  const samples: StickerSample[] = [];

  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const cx = region.x + cell * (column + 0.5);
      const cy = region.y + cell * (row + 0.5);
      const sx = Math.floor(cx - patch / 2);
      const sy = Math.floor(cy - patch / 2);

      const { data } = context.getImageData(sx, sy, patch, patch);
      const pixels: Rgb[] = [];
      // Every 4th pixel is plenty and keeps this cheap enough to run per frame
      // for the live preview.
      for (let i = 0; i < data.length; i += 16) {
        pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      }

      const rgb = medianRgb(pixels);
      samples.push({ rgb, lab: rgbToLab(rgb) });
    }
  }

  return samples;
}

/**
 * Draw the current video frame to a canvas and sample it.
 *
 * The canvas is sized to the video's intrinsic resolution, not its displayed
 * size, so sampling is unaffected by CSS layout or device pixel ratio.
 */
export function sampleVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): StickerSample[] | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(video, 0, 0, width, height);
  return sampleStickers(context, centeredRegion(width, height));
}
