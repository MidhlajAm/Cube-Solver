/**
 * Core cube types.
 *
 * Facelet indexing follows the Kociemba convention used by the vendored solver
 * (public/solver): six faces of nine stickers each, in the order U R F D L B,
 * every face read row-major as it appears in the standard unfolded net.
 *
 *              U0 U1 U2
 *              U3 U4 U5
 *              U6 U7 U8
 *   L0 L1 L2   F0 F1 F2   R0 R1 R2   B0 B1 B2
 *   L3 L4 L5   F3 F4 F5   R3 R4 R5   B3 B4 B5
 *   L6 L7 L8   F6 F7 F8   R6 R7 R8   B6 B7 B8
 *              D0 D1 D2
 *              D3 D4 D5
 *              D6 D7 D8
 */

/** The six faces, in solver order. Index into this array is the face number. */
export const FACES = ['U', 'R', 'F', 'D', 'L', 'B'] as const;
export type Face = (typeof FACES)[number];

/**
 * Sticker colors. These double as the solver's facelet characters: the solver
 * identifies a sticker by which face it belongs to, so the canonical "color"
 * alphabet is the face letters themselves.
 */
export type Color = Face;

/** Number of stickers on a 3x3x3 cube. */
export const FACELET_COUNT = 54;

/** First facelet index of each face. */
export const FACE_OFFSET: Record<Face, number> = {
  U: 0,
  R: 9,
  F: 18,
  D: 27,
  L: 36,
  B: 45,
};

/** Index of each face's center sticker. */
export const CENTER_INDEX: Record<Face, number> = {
  U: 4,
  R: 13,
  F: 22,
  D: 31,
  L: 40,
  B: 49,
};

/**
 * A full cube state as 54 sticker colors, in facelet index order.
 * Kept as an array (not a string) so it is cheap to mutate during animation.
 */
export type Facelets = Color[];

/** The solved cube: every sticker matches its own face. */
export function solvedFacelets(): Facelets {
  return FACES.flatMap((f) => Array<Color>(9).fill(f));
}

/** Serialize to the 54-character string the vendored solver expects. */
export function faceletsToString(facelets: Facelets): string {
  return facelets.join('');
}

/** Parse a 54-character facelet string. Throws only on malformed input. */
export function faceletsFromString(str: string): Facelets {
  const trimmed = str.trim().toUpperCase();
  if (trimmed.length !== FACELET_COUNT) {
    throw new Error(`Expected ${FACELET_COUNT} facelets, got ${trimmed.length}`);
  }
  const out: Facelets = [];
  for (const ch of trimmed) {
    if (!(FACES as readonly string[]).includes(ch)) {
      throw new Error(`Unknown facelet character: ${ch}`);
    }
    out.push(ch as Color);
  }
  return out;
}

/** A quarter-turn count: 1 = clockwise, 2 = half turn, 3 = counter-clockwise. */
export type Turns = 1 | 2 | 3;

/** A single face turn. */
export interface Move {
  face: Face;
  turns: Turns;
}

/**
 * Display colors for each face. The classic Western color scheme:
 * white up, yellow down, green front, blue back, red right, orange left.
 */
export const FACE_COLORS: Record<Face, string> = {
  U: '#f8fafc', // white
  R: '#dc2626', // red
  F: '#16a34a', // green
  D: '#facc15', // yellow
  L: '#f97316', // orange
  B: '#2563eb', // blue
};

/** Human-readable color names, used in scanning instructions and a11y labels. */
export const FACE_COLOR_NAMES: Record<Face, string> = {
  U: 'white',
  R: 'red',
  F: 'green',
  D: 'yellow',
  L: 'orange',
  B: 'blue',
};

/** Full face names, for prose. */
export const FACE_NAMES: Record<Face, string> = {
  U: 'Up',
  R: 'Right',
  F: 'Front',
  D: 'Down',
  L: 'Left',
  B: 'Back',
};
