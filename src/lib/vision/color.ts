/**
 * Color space helpers for sticker detection.
 *
 * Classification happens in CIE L*a*b* rather than RGB or HSV. Under real room
 * lighting the troublesome pair is red vs orange: they sit only a few degrees
 * apart in hue and shift with white balance, so fixed hue thresholds are
 * fragile. Lab distances are far closer to how different two colors actually
 * look, which matters because the whole classifier is nearest-seed based.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

/** Undo the sRGB transfer function. */
function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function pivot(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** Convert sRGB to CIE L*a*b* under a D65 white point. */
export function rgbToLab({ r, g, b }: Rgb): Lab {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  // sRGB -> XYZ (D65)
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722) / 1.0;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;

  const fx = pivot(x);
  const fy = pivot(y);
  const fz = pivot(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

/**
 * Perceptual distance between two colors (CIE76).
 *
 * Lightness is down-weighted: a sticker in shadow and the same sticker in
 * direct light differ mostly in L*, and we care about which color it is, not
 * how brightly lit it was. Chroma carries the identity.
 */
export function labDistance(p: Lab, q: Lab): number {
  const dl = (p.l - q.l) * 0.5;
  const da = p.a - q.a;
  const db = p.b - q.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Per-channel median, which shrugs off specular highlights on the plastic. */
export function medianRgb(samples: Rgb[]): Rgb {
  if (samples.length === 0) return { r: 0, g: 0, b: 0 };
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };
  return {
    r: median(samples.map((s) => s.r)),
    g: median(samples.map((s) => s.g)),
    b: median(samples.map((s) => s.b)),
  };
}

/** CSS color string, for previewing what the camera actually saw. */
export function rgbToCss({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}
