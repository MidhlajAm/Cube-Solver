/**
 * Cube validity checking.
 *
 * The vendored solver's `Cube.fromString` performs no validation whatsoever:
 * when a sticker pattern does not correspond to a real cube it silently leaves
 * pieces at stale values and hands back a plausible-looking but wrong cube,
 * which the solver may then fail on or churn through. So nothing reaches the
 * solver until it passes every check here.
 *
 * A scanned cube can be wrong in two very different ways, and we report both:
 *   - structurally (a color appears ten times, a corner has two reds)
 *   - mathematically (all pieces exist, but the cube cannot be reached by
 *     turning a solved cube: a twisted corner, a flipped edge, swapped pieces)
 */

import {
  CENTER_INDEX,
  FACES,
  FACE_COLOR_NAMES,
  type Color,
  type Face,
  type Facelets,
} from './types';

/** Facelet index triples for the 8 corners, in solver order (URF, UFL, ...). */
export const CORNER_FACELETS: readonly (readonly [number, number, number])[] = [
  [8, 9, 20], // URF
  [6, 18, 38], // UFL
  [0, 36, 47], // ULB
  [2, 45, 11], // UBR
  [29, 26, 15], // DFR
  [27, 44, 24], // DLF
  [33, 53, 42], // DBL
  [35, 17, 51], // DRB
];

/** The face colors that make up each corner, in the same order as the facelets. */
export const CORNER_COLORS: readonly (readonly [Face, Face, Face])[] = [
  ['U', 'R', 'F'],
  ['U', 'F', 'L'],
  ['U', 'L', 'B'],
  ['U', 'B', 'R'],
  ['D', 'F', 'R'],
  ['D', 'L', 'F'],
  ['D', 'B', 'L'],
  ['D', 'R', 'B'],
];

/** Facelet index pairs for the 12 edges, in solver order (UR, UF, UL, ...). */
export const EDGE_FACELETS: readonly (readonly [number, number])[] = [
  [5, 10], // UR
  [7, 19], // UF
  [3, 37], // UL
  [1, 46], // UB
  [32, 16], // DR
  [28, 25], // DF
  [30, 43], // DL
  [34, 52], // DB
  [23, 12], // FR
  [21, 41], // FL
  [50, 39], // BL
  [48, 14], // BR
];

/** The face colors that make up each edge, in the same order as the facelets. */
export const EDGE_COLORS: readonly (readonly [Face, Face])[] = [
  ['U', 'R'],
  ['U', 'F'],
  ['U', 'L'],
  ['U', 'B'],
  ['D', 'R'],
  ['D', 'F'],
  ['D', 'L'],
  ['D', 'B'],
  ['F', 'R'],
  ['F', 'L'],
  ['B', 'L'],
  ['B', 'R'],
];

export type ValidationIssueKind =
  | 'color-count'
  | 'center-duplicate'
  | 'impossible-corner'
  | 'impossible-edge'
  | 'repeated-corner'
  | 'repeated-edge'
  | 'corner-twist'
  | 'edge-flip'
  | 'permutation-parity';

export interface ValidationIssue {
  kind: ValidationIssueKind;
  /** Short sentence suitable for showing directly to the user. */
  message: string;
  /** Facelet indices implicated, so the net editor can highlight them. */
  indices: number[];
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
  /** Union of every implicated facelet index, deduplicated. */
  badIndices: number[];
}

function colorName(color: Color): string {
  return FACE_COLOR_NAMES[color] ?? color;
}

/** Parity of a permutation: 0 for even, 1 for odd. */
function permutationParity(perm: number[]): number {
  const seen = new Array<boolean>(perm.length).fill(false);
  let transpositions = 0;
  for (let i = 0; i < perm.length; i++) {
    if (seen[i]) continue;
    let length = 0;
    let j = i;
    while (!seen[j]) {
      seen[j] = true;
      j = perm[j];
      length++;
    }
    transpositions += length - 1;
  }
  return transpositions % 2;
}

/**
 * Validate a sticker pattern. Returns every problem found, ordered from the
 * most concrete (a miscounted color) to the most abstract (parity), because
 * the concrete ones are what a user can actually act on.
 */
export function validateFacelets(facelets: Facelets): ValidationResult {
  const issues: ValidationIssue[] = [];

  const fail = (): ValidationResult => {
    const badIndices = [...new Set(issues.flatMap((i) => i.indices))].sort((a, b) => a - b);
    return { ok: false, issues, badIndices };
  };

  // 1. Every color must appear exactly nine times.
  const positionsByColor = new Map<Color, number[]>();
  for (const face of FACES) positionsByColor.set(face, []);
  facelets.forEach((color, index) => {
    positionsByColor.get(color)?.push(index);
  });

  for (const face of FACES) {
    const positions = positionsByColor.get(face) ?? [];
    if (positions.length !== 9) {
      issues.push({
        kind: 'color-count',
        message: `There are ${positions.length} ${colorName(face)} stickers — a cube has exactly 9 of each color.`,
        indices: positions,
      });
    }
  }
  if (issues.length > 0) return fail();

  // 2. Centers never move relative to each other, so they define which color
  //    belongs to which face. We work in a canonical form where a face's color
  //    *is* its letter (the scanner normalizes to this by reading each face's
  //    center first), so every center must show its own face's color. This is
  //    stricter than merely requiring the six to differ, and it also catches a
  //    cube scanned with two faces transposed.
  const misplacedCenters = FACES.filter((face) => facelets[CENTER_INDEX[face]] !== face);
  if (misplacedCenters.length > 0) {
    const centerColors = FACES.map((face) => facelets[CENTER_INDEX[face]]);
    const duplicates = [
      ...new Set(centerColors.filter((color, i) => centerColors.indexOf(color) !== i)),
    ];
    issues.push({
      kind: 'center-duplicate',
      message:
        duplicates.length > 0
          ? `Two faces have the same center color (${duplicates.map(colorName).join(', ')}). Each face must have a different center.`
          : `The centers don't line up with their faces (${misplacedCenters
              .map((f) => `${colorName(f)} face shows ${colorName(facelets[CENTER_INDEX[f]])}`)
              .join(', ')}). Check that the faces were scanned in the order asked for.`,
      indices: misplacedCenters.map((face) => CENTER_INDEX[face]),
    });
    return fail();
  }

  // 3. Each corner must be a real corner, and each must appear exactly once.
  const cornerPermutation: number[] = [];
  const cornerOrientations: number[] = [];

  for (let i = 0; i < CORNER_FACELETS.length; i++) {
    const slot = CORNER_FACELETS[i];
    const colors = slot.map((index) => facelets[index]) as [Color, Color, Color];

    // Exactly one sticker of a corner is U or D coloured; its position within
    // the triple is the corner's orientation.
    const orientation = colors.findIndex((c) => c === 'U' || c === 'D');
    if (orientation === -1 || colors.filter((c) => c === 'U' || c === 'D').length !== 1) {
      issues.push({
        kind: 'impossible-corner',
        message: `The ${colors.map(colorName).join('/')} corner can't exist — every corner has exactly one ${colorName('U')} or ${colorName('D')} sticker.`,
        indices: [...slot],
      });
      continue;
    }

    const first = colors[(orientation + 1) % 3];
    const second = colors[(orientation + 2) % 3];
    const piece = CORNER_COLORS.findIndex((c) => c[1] === first && c[2] === second);

    if (piece === -1) {
      issues.push({
        kind: 'impossible-corner',
        message: `There is no ${colors.map(colorName).join('/')} corner on a Rubik's cube.`,
        indices: [...slot],
      });
      continue;
    }

    // The other two colors identify which corner this is, but we must also
    // confirm its up/down sticker is the right one: a piece showing yellow
    // alongside red and green is not the white/red/green corner, it is no
    // corner at all. (The vendored solver skips this check and would happily
    // build a nonsense cube from it.)
    if (colors[orientation] !== CORNER_COLORS[piece][0]) {
      issues.push({
        kind: 'impossible-corner',
        message: `There is no ${colors.map(colorName).join('/')} corner on a Rubik's cube — the ${colorName(
          CORNER_COLORS[piece][1],
        )}/${colorName(CORNER_COLORS[piece][2])} corner is ${colorName(CORNER_COLORS[piece][0])}, not ${colorName(colors[orientation])}.`,
        indices: [...slot],
      });
      continue;
    }

    cornerPermutation.push(piece);
    cornerOrientations.push(orientation);
  }
  if (issues.length > 0) return fail();

  const seenCorners = new Set(cornerPermutation);
  if (seenCorners.size !== 8) {
    const repeated = cornerPermutation.filter((p, i) => cornerPermutation.indexOf(p) !== i);
    issues.push({
      kind: 'repeated-corner',
      message: `The same corner piece appears more than once (${[...new Set(repeated)]
        .map((p) => CORNER_COLORS[p].map(colorName).join('/'))
        .join(', ')}). Check for a mis-read sticker.`,
      indices: [...new Set(repeated)].flatMap((p) =>
        cornerPermutation.flatMap((q, slot) => (q === p ? [...CORNER_FACELETS[slot]] : [])),
      ),
    });
    return fail();
  }

  // 4. Each edge must be a real edge, and each must appear exactly once.
  const edgePermutation: number[] = [];
  const edgeOrientations: number[] = [];

  for (let i = 0; i < EDGE_FACELETS.length; i++) {
    const slot = EDGE_FACELETS[i];
    const colors = slot.map((index) => facelets[index]) as [Color, Color];

    let piece = EDGE_COLORS.findIndex((c) => c[0] === colors[0] && c[1] === colors[1]);
    let orientation = 0;
    if (piece === -1) {
      piece = EDGE_COLORS.findIndex((c) => c[1] === colors[0] && c[0] === colors[1]);
      orientation = 1;
    }

    if (piece === -1) {
      issues.push({
        kind: 'impossible-edge',
        message: `There is no ${colors.map(colorName).join('/')} edge on a Rubik's cube.`,
        indices: [...slot],
      });
      continue;
    }

    edgePermutation.push(piece);
    edgeOrientations.push(orientation);
  }
  if (issues.length > 0) return fail();

  const seenEdges = new Set(edgePermutation);
  if (seenEdges.size !== 12) {
    const repeated = edgePermutation.filter((p, i) => edgePermutation.indexOf(p) !== i);
    issues.push({
      kind: 'repeated-edge',
      message: `The same edge piece appears more than once (${[...new Set(repeated)]
        .map((p) => EDGE_COLORS[p].map(colorName).join('/'))
        .join(', ')}). Check for a mis-read sticker.`,
      indices: [...new Set(repeated)].flatMap((p) =>
        edgePermutation.flatMap((q, slot) => (q === p ? [...EDGE_FACELETS[slot]] : [])),
      ),
    });
    return fail();
  }

  // At this point every piece exists exactly once, so the cube is a legal
  // *assembly*. The remaining three checks decide whether it is reachable by
  // turning — i.e. whether it was assembled correctly or forced together.

  // 5. Corner twists must cancel out (sum of orientations divisible by 3).
  const twist = cornerOrientations.reduce((a, b) => a + b, 0) % 3;
  if (twist !== 0) {
    issues.push({
      kind: 'corner-twist',
      message:
        'One corner is twisted in place. That is impossible by turning alone, so a corner sticker is probably mis-read.',
      indices: CORNER_FACELETS.flatMap((slot) => [...slot]),
    });
  }

  // 6. Edge flips must cancel out (sum of orientations even).
  const flip = edgeOrientations.reduce((a, b) => a + b, 0) % 2;
  if (flip !== 0) {
    issues.push({
      kind: 'edge-flip',
      message:
        'One edge is flipped in place. That is impossible by turning alone, so an edge sticker is probably mis-read.',
      indices: EDGE_FACELETS.flatMap((slot) => [...slot]),
    });
  }

  // 7. Corner and edge permutations must have matching parity: a single turn
  //    permutes both by a 4-cycle, so they always move in lockstep. Mismatched
  //    parity means exactly two pieces look swapped.
  if (permutationParity(cornerPermutation) !== permutationParity(edgePermutation)) {
    issues.push({
      kind: 'permutation-parity',
      message:
        'Two pieces appear swapped. That is impossible by turning alone — check the faces you scanned last.',
      indices: [],
    });
  }

  if (issues.length > 0) return fail();
  return { ok: true, issues: [], badIndices: [] };
}

/** Convenience wrapper: true when the pattern is a solvable cube. */
export function isValidCube(facelets: Facelets): boolean {
  return validateFacelets(facelets).ok;
}
