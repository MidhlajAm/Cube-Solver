/**
 * Choosing the swatches the net and the 3D cube are drawn in.
 *
 * The app no longer asks the user to start on a particular face, so the face it
 * calls "front" is simply whichever one they happened to point at the camera
 * first. That makes the built-in colour scheme wrong as a display palette: the
 * front face might really be blue, and drawing it green would mean the net the
 * user is asked to check against their cube does not match it.
 *
 * So the palette is taken from the scan. Each face's centre *is* its colour, so
 * the six scanned centres are mapped one-to-one onto six clean display colours.
 * Snapping to clean colours rather than painting the raw camera values keeps
 * the net readable under poor light, where a real reading can come out muddy
 * enough that two faces look alike.
 */

import { FACES, FACE_COLORS, type Face } from '@/lib/cube/types';
import { labDistance, rgbToLab, type Lab, type Rgb } from './color';

/** The clean colours available to draw with: the classic cube scheme. */
const SWATCHES: readonly string[] = FACES.map((face) => FACE_COLORS[face]);

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

const SWATCH_LABS: readonly Lab[] = SWATCHES.map((hex) => rgbToLab(hexToRgb(hex)));

/** Every way to hand out the six swatches, generated once. */
function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const out: number[][] = [];
  for (const rest of permutations(n - 1)) {
    for (let position = 0; position <= rest.length; position++) {
      out.push([...rest.slice(0, position), n - 1, ...rest.slice(position)]);
    }
  }
  return out;
}

const ASSIGNMENTS = permutations(FACES.length);

/**
 * Map each face to a display colour, using its scanned centre.
 *
 * The assignment is one-to-one — two faces can never be given the same swatch,
 * however similar the camera made them look — and is chosen to minimise the
 * total perceptual distance from what was actually scanned.
 */
export function paletteFromCenters(centers: Partial<Record<Face, Rgb>>): Record<Face, string> {
  const labs = FACES.map((face) => {
    const rgb = centers[face];
    return rgb ? rgbToLab(rgb) : null;
  });

  // Nothing scanned: fall back to the built-in scheme.
  if (labs.every((lab) => lab === null)) return { ...FACE_COLORS };

  let best: number[] = ASSIGNMENTS[0];
  let bestCost = Infinity;

  for (const assignment of ASSIGNMENTS) {
    let cost = 0;
    for (let i = 0; i < FACES.length; i++) {
      const lab = labs[i];
      // An unscanned face costs nothing, so it takes whatever swatch is left.
      if (lab) cost += labDistance(lab, SWATCH_LABS[assignment[i]]);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = assignment;
    }
  }

  return Object.fromEntries(
    FACES.map((face, i) => [face, SWATCHES[best[i]]]),
  ) as Record<Face, string>;
}
