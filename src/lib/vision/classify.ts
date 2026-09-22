/**
 * Turns 54 sampled colors into a cube state.
 *
 * The naive approach — classify each sticker independently against fixed color
 * thresholds — fails constantly in real rooms, because red and orange are close
 * together and every light source moves them around. Two things make this
 * robust instead:
 *
 *  1. The six center stickers are ground truth. A center *defines* its face's
 *     color, so we use the scanned centers as reference seeds rather than any
 *     hard-coded palette. Whatever the lighting did to the cube, it did to the
 *     centers too. An even-sized cube has no centres, so it instead picks six
 *     mutually distant stickers to start from and anchors the result to a
 *     corner afterwards.
 *
 *  2. A cube has exactly nine stickers of each color. Classifying stickers
 *     independently throws that away; here it is a hard constraint. Getting one
 *     orange sticker slightly wrong can no longer cascade, because taking a
 *     tenth orange would mean leaving a red slot unfilled.
 *
 * What comes out still is not trusted blindly — every sticker carries a
 * confidence, and the user confirms the whole thing in the net editor before it
 * reaches the solver.
 */

import {
  DEFAULT_SIZE,
  FACES,
  centerIndexFor,
  faceletCountFor,
  stickersPerFace,
  type Color,
  type CubeSize,
  type Facelets,
} from '@/lib/cube/types';
import { canonicalizeByAnchorCorner } from '@/lib/cube/canonical';
import { labDistance, type Lab } from './color';
import type { StickerSample } from './sampler';

export interface ClassificationResult {
  /** The detected cube state. */
  facelets: Facelets;
  /** Per-sticker confidence in 0..1; low values are worth a second look. */
  confidence: number[];
  /** Indices whose reading was ambiguous, worst first. */
  uncertain: number[];
}

/** Below this, a sticker is flagged for review in the net editor. */
export const CONFIDENCE_THRESHOLD = 0.25;

function meanLab(samples: Lab[]): Lab {
  if (samples.length === 0) return { l: 0, a: 0, b: 0 };
  const total = samples.reduce(
    (acc, s) => ({ l: acc.l + s.l, a: acc.a + s.a, b: acc.b + s.b }),
    { l: 0, a: 0, b: 0 },
  );
  return {
    l: total.l / samples.length,
    a: total.a / samples.length,
    b: total.b / samples.length,
  };
}

/**
 * Assign each free sticker to a color so that every color is used exactly
 * `capacity` times, minimizing total distance.
 *
 * Greedy by ascending cost, then pairwise swaps until no swap reduces the total.
 * With only 48 free stickers and six well-separated seeds this lands on the
 * optimum in practice, and it is far simpler than a min-cost flow.
 */
function assignWithCapacity(
  costs: number[][],
  freeIndices: number[],
  capacity: number[],
): number[] {
  const assignment = new Array<number>(costs.length).fill(-1);
  const remaining = [...capacity];

  // Greedy pass: take the most confident (sticker, color) pairings first.
  const candidates: { index: number; color: number; cost: number }[] = [];
  for (const index of freeIndices) {
    for (let color = 0; color < remaining.length; color++) {
      candidates.push({ index, color, cost: costs[index][color] });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);

  for (const { index, color } of candidates) {
    if (assignment[index] !== -1 || remaining[color] === 0) continue;
    assignment[index] = color;
    remaining[color]--;
  }

  // Refinement: swap two stickers' colors whenever it lowers the total cost.
  // Swapping preserves the counts, so the constraint can never be violated.
  for (let pass = 0; pass < 8; pass++) {
    let improved = false;
    for (let a = 0; a < freeIndices.length; a++) {
      for (let b = a + 1; b < freeIndices.length; b++) {
        const i = freeIndices[a];
        const j = freeIndices[b];
        const ci = assignment[i];
        const cj = assignment[j];
        if (ci === cj) continue;

        const current = costs[i][ci] + costs[j][cj];
        const swapped = costs[i][cj] + costs[j][ci];
        if (swapped < current - 1e-9) {
          assignment[i] = cj;
          assignment[j] = ci;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  return assignment;
}

/**
 * Pick starting colours by spreading out: begin at one sticker, then keep
 * taking whichever is furthest from everything chosen so far.
 */
function farthestPointSeeds(samples: StickerSample[], count: number, first: number): Lab[] {
  const seeds: Lab[] = [samples[first].lab];
  while (seeds.length < count) {
    let bestIndex = 0;
    let bestDistance = -1;
    samples.forEach((sample, index) => {
      const distance = Math.min(...seeds.map((seed) => labDistance(sample.lab, seed)));
      if (distance > bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    seeds.push(samples[bestIndex].lab);
  }
  return seeds;
}

interface Attempt {
  assignment: number[];
  seeds: Lab[];
  /** Total distance from every sticker to the colour it was given. */
  cost: number;
}

/**
 * Classify from a given set of starting colours, refining them as it goes:
 * assign, re-centre each colour on what it was given, assign again.
 */
function classifyFromSeeds(
  samples: StickerSample[],
  initialSeeds: Lab[],
  freeIndices: number[],
  centerIndices: number[],
  capacity: number,
  rounds: number,
): Attempt {
  let seeds = initialSeeds;
  let assignment: number[] = [];

  for (let round = 0; round < rounds; round++) {
    const costs = samples.map((sample) => seeds.map((seed) => labDistance(sample.lab, seed)));

    assignment = assignWithCapacity(costs, freeIndices, new Array(FACES.length).fill(capacity));
    // Centres, where they exist, are pinned to their own face.
    centerIndices.forEach((index, face) => {
      assignment[index] = face;
    });

    seeds = FACES.map((_, face) =>
      meanLab(
        assignment
          .map((assigned, index) => (assigned === face ? samples[index].lab : null))
          .filter((lab): lab is Lab => lab !== null),
      ),
    );
  }

  const cost = samples.reduce(
    (total, sample, index) => total + labDistance(sample.lab, seeds[assignment[index]]),
    0,
  );

  return { assignment, seeds, cost };
}

/**
 * Classify a whole cube's samples at once.
 *
 * `samples` must be in facelet index order: the nine stickers of U, then R, F,
 * D, L and B, each face read top-left to bottom-right.
 */
export function classifyFacelets(
  samples: StickerSample[],
  size: CubeSize = DEFAULT_SIZE,
): ClassificationResult {
  const expected = faceletCountFor(size);
  if (samples.length !== expected) {
    throw new Error(`Expected ${expected} samples, got ${samples.length}`);
  }

  // Seeds start as the scanned centers: a face's center is its color, by
  // definition, so these are the one set of labels we know are correct. With
  // no centres to lean on, six mutually distant stickers stand in.
  const centerIndices = FACES.map((face) => centerIndexFor(face, size)).filter(
    (index): index is number => index !== null,
  );
  let seeds: Lab[] =
    centerIndices.length === FACES.length
      ? centerIndices.map((index) => samples[index].lab)
      : [];

  const freeIndices = Array.from({ length: expected }, (_, i) => i).filter(
    (i) => !centerIndices.includes(i),
  );
  // Each colour needs one sticker per face position; a centre already took one.
  const capacity = stickersPerFace(size) - (centerIndices.length ? 1 : 0);

  let best: Attempt;

  if (centerIndices.length === FACES.length) {
    // Two rounds: classify, re-centre the seeds on what was assigned, classify
    // again. This lets a face lit differently from its centre pull its own seed
    // toward its true colour.
    best = classifyFromSeeds(samples, seeds, freeIndices, centerIndices, capacity, 2);
  } else {
    // With no centres there is nothing trustworthy to start from, and a bad
    // start is not recoverable: two seeds landing on the same real colour under
    // different lighting splits that colour in half and drags a second one with
    // it. So try starting from every sticker in turn and keep whichever
    // grouping ends up tightest — each attempt is a few thousand operations on
    // twenty-four samples, which is nothing next to being wrong.
    best = samples
      .map((_, first) =>
        classifyFromSeeds(
          samples,
          farthestPointSeeds(samples, FACES.length, first),
          freeIndices,
          centerIndices,
          capacity,
          4,
        ),
      )
      .reduce((a, b) => (b.cost < a.cost ? b : a));
  }

  const assignment = best.assignment;
  seeds = best.seeds;

  // Score each sticker by how much closer it is to its own colour than to the
  // nearest rival. Ties — the red/orange case — score near zero.
  const confidence = samples.map((sample, index) => {
    const assigned = assignment[index];
    const distances = seeds.map((seed) => labDistance(sample.lab, seed));
    const own = distances[assigned];
    const rival = Math.min(...distances.filter((_, i) => i !== assigned));
    if (own + rival === 0) return 1;
    return Math.max(0, Math.min(1, (rival - own) / (rival + own)));
  });

  let facelets = assignment.map((color) => FACES[color] as Color) as Facelets;

  // With no centres the six groups are just groups — nothing yet says which is
  // the "up" colour. Anchoring to a corner settles it. A reading too garbled to
  // anchor is left as-is, so the validator can explain it rather than this
  // throwing in the middle of a scan.
  if (size % 2 === 0) {
    facelets = canonicalizeByAnchorCorner(facelets, size) ?? facelets;
  }

  const uncertain = confidence
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value < CONFIDENCE_THRESHOLD && !centerIndices.includes(index))
    .sort((a, b) => a.value - b.value)
    .map(({ index }) => index);

  return { facelets, confidence, uncertain };
}
