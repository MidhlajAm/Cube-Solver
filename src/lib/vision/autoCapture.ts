/**
 * Deciding, without being told, when a face is ready to be photographed.
 *
 * Pressing a button while holding a cube up to a phone is genuinely awkward —
 * it is the hand that is holding the cube, and reaching for the screen moves
 * the thing being scanned. So the scanner watches instead, and takes the shot
 * once the view has settled.
 *
 * That trades one problem for two. A frame can be still because the cube is
 * held steady, or because the user has lowered it and is looking at a table, so
 * stillness alone is not enough. And nothing stops the same face being taken
 * twice in a row, which produces a cube with ten stickers of one colour and
 * eight of another — a failure that surfaces much later as an unsolvable cube.
 * Both are handled here rather than in the component, so both can be tested.
 */

import { labDistance } from './color';
import type { StickerSample } from './sampler';
import { DEFAULT_SIZE, FACES, type CubeSize, type Face } from '@/lib/cube/types';

/** Position of the centre sticker within one face's samples, if it has one. */
function centreIndex(size: CubeSize): number | null {
  if (size % 2 === 0) return null;
  const middle = (size - 1) / 2;
  return middle * size + middle;
}

/**
 * How far a sticker's colour may drift between frames and still count as
 * held still. Sensor noise alone moves a patch by a few units; a cube actually
 * being turned moves it by tens.
 */
export const STEADY_TOLERANCE = 10;

/** Consecutive settled frames required before the shot is taken. */
export const STEADY_FRAMES = 5;

/** Below this mean lightness the view is too dark to be a cube face. */
export const MIN_MEAN_LIGHTNESS = 12;

/**
 * Centres are the strongest identity signal available: the six of them are six
 * different colours, and the closest confusable pair — red and orange — still
 * sit roughly 40 units apart under this metric.
 */
export const CENTRE_MATCH_DISTANCE = 18;

/** How closely the surrounding eight stickers must agree as well. */
export const RING_MATCH_DISTANCE = 16;

function matchesFrame(
  frame: readonly StickerSample[],
  latest: readonly StickerSample[],
  tolerance: number,
): boolean {
  return frame.every((sample, i) => labDistance(sample.lab, latest[i].lab) <= tolerance);
}

/**
 * How settled the view is, from 0 to 1.
 *
 * Only frames in an unbroken run ending at the newest one count, so a wobble
 * resets the progress rather than averaging away. Doubles as the value behind
 * the on-screen countdown, which is what stops the capture being a surprise.
 */
export function steadiness(
  frames: readonly (readonly StickerSample[])[],
  tolerance = STEADY_TOLERANCE,
): number {
  if (frames.length === 0) return 0;
  const recent = frames.slice(-STEADY_FRAMES);
  const latest = recent[recent.length - 1];

  let run = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (!matchesFrame(recent[i], latest, tolerance)) break;
    run++;
  }
  return Math.min(1, run / STEADY_FRAMES);
}

/** True once the view has been still long enough to photograph. */
export function isSteady(
  frames: readonly (readonly StickerSample[])[],
  tolerance = STEADY_TOLERANCE,
): boolean {
  return steadiness(frames, tolerance) >= 1;
}

/**
 * Reject a view too dark to be a cube — a pocket, a covered lens, or a phone
 * set face down while the user reads the instructions.
 */
export function isLitWellEnough(samples: readonly StickerSample[]): boolean {
  const mean = samples.reduce((total, s) => total + s.lab.l, 0) / samples.length;
  return mean >= MIN_MEAN_LIGHTNESS;
}

/** Rotate one face's samples a quarter turn clockwise. */
function rotate<T>(values: readonly T[], size: CubeSize): T[] {
  const out = [...values];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      out[row * size + column] = values[(size - 1 - column) * size + row];
    }
  }
  return out;
}

/**
 * Mean distance between two readings of a face, at whichever of the four
 * rotations fits best — the user is free to have picked the cube up differently
 * since, and a face rolled a quarter turn is still the same face.
 *
 * The centre, where there is one, is left out: it is checked separately and far
 * more strictly, because it alone identifies the face.
 */
function patternDistance(
  a: readonly StickerSample[],
  b: readonly StickerSample[],
  size: CubeSize,
): number {
  const skip = centreIndex(size);
  const positions = a.map((_, i) => i).filter((i) => i !== skip);

  let best = Infinity;
  let rotated = [...a];
  for (let turn = 0; turn < 4; turn++) {
    const total = positions.reduce(
      (sum, index) => sum + labDistance(rotated[index].lab, b[index].lab),
      0,
    );
    best = Math.min(best, total / positions.length);
    rotated = rotate(rotated, size);
  }
  return best;
}

/**
 * Which already-captured face this reading is, if any.
 *
 * Deliberately conservative: the centre *and* the ring must both agree before a
 * face is called a repeat. Wrongly blocking a new face would stall the scan
 * with no way forward, whereas wrongly allowing a repeat is caught later by the
 * validator and is correctable in the net.
 */
export function matchCapturedFace(
  samples: readonly StickerSample[],
  captured: Partial<Record<Face, readonly StickerSample[]>>,
  size: CubeSize = DEFAULT_SIZE,
): Face | null {
  const centre = centreIndex(size);
  let best: Face | null = null;
  let bestScore = Infinity;

  for (const face of FACES) {
    const previous = captured[face];
    if (!previous) continue;

    // On a cube with a centre that single sticker settles which face this is,
    // so it gets its own, tighter gate. Without one, the whole face has to
    // agree — which is weaker evidence, but erring towards letting a face
    // through is the safe direction.
    const centreDistance =
      centre === null ? 0 : labDistance(samples[centre].lab, previous[centre].lab);
    if (centreDistance > CENTRE_MATCH_DISTANCE) continue;

    const pattern = patternDistance(samples, previous, size);
    if (pattern > RING_MATCH_DISTANCE) continue;

    const score = centreDistance + pattern;
    if (score < bestScore) {
      bestScore = score;
      best = face;
    }
  }

  return best;
}
