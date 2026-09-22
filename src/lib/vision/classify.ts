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
 *     centers too.
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

import { CENTER_INDEX, FACELET_COUNT, FACES, type Color, type Facelets } from '@/lib/cube/types';
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
 * Classify all 54 samples at once.
 *
 * `samples` must be in facelet index order: the nine stickers of U, then R, F,
 * D, L and B, each face read top-left to bottom-right.
 */
export function classifyFacelets(samples: StickerSample[]): ClassificationResult {
  if (samples.length !== FACELET_COUNT) {
    throw new Error(`Expected ${FACELET_COUNT} samples, got ${samples.length}`);
  }

  // Seeds start as the scanned centers: a face's center is its color, by
  // definition, so these are the one set of labels we know are correct.
  let seeds: Lab[] = FACES.map((face) => samples[CENTER_INDEX[face]].lab);

  const centerIndices = FACES.map((face) => CENTER_INDEX[face]);
  const freeIndices = Array.from({ length: FACELET_COUNT }, (_, i) => i).filter(
    (i) => !centerIndices.includes(i),
  );

  let assignment: number[] = [];

  // Two rounds: classify, re-centre the seeds on what was assigned, classify
  // again. This lets a face lit differently from its centre pull its own seed
  // toward its true colour.
  for (let round = 0; round < 2; round++) {
    const costs = samples.map((sample) => seeds.map((seed) => labDistance(sample.lab, seed)));

    assignment = assignWithCapacity(
      costs,
      freeIndices,
      // Each colour needs nine stickers; its centre already accounts for one.
      new Array(FACES.length).fill(8),
    );
    // Centres are pinned to their own face.
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

  const facelets = assignment.map((color) => FACES[color] as Color);

  const uncertain = confidence
    .map((value, index) => ({ value, index }))
    .filter(({ value, index }) => value < CONFIDENCE_THRESHOLD && !centerIndices.includes(index))
    .sort((a, b) => a.value - b.value)
    .map(({ index }) => index);

  return { facelets, confidence, uncertain };
}
