/**
 * Deciding what "solved" means on a cube with no centres.
 *
 * On a 3x3 the centres settle it: the white centre never moves relative to the
 * others, so the white face is the white face and a scanned sticker can be
 * labelled by which centre it matches. A 2x2 has no centres at all. Every
 * piece is a corner and every corner moves, so nothing says which colour
 * "belongs" on which face — a 2x2 with all six faces uniform is solved no
 * matter which way round the colours ended up.
 *
 * The usual convention resolves it: pick one corner and call it home. Whatever
 * three colours that corner shows become the three faces it touches, and the
 * remaining three follow, because two colours are opposite exactly when they
 * never share a corner. Everything downstream — the validator, the solver, the
 * 3D view — can then work in the ordinary labelled frame.
 */

import { cornerFaceletsFor, CORNER_FACES } from './corners';
import { FACES, type Color, type CubeSize, type Face, type Facelets } from './types';

/** The corner treated as home. Its stickers name the D, B and L faces. */
const ANCHOR = 6; // DBL

/**
 * Which face is across the cube from which. This is geometry and never
 * changes, unlike which *colour* is opposite which, which is read off the cube
 * itself. Keeping the two apart matters: the colour labelled D on an unanchored
 * scan is just a group id, and has nothing to do with the D face.
 */
const OPPOSITE_FACE: Record<Face, Face> = {
  U: 'D',
  D: 'U',
  R: 'L',
  L: 'R',
  F: 'B',
  B: 'F',
};

/**
 * Pair up opposite colours from the corners they appear on.
 *
 * Two faces of a cube are opposite precisely when no corner touches both, so
 * this needs no knowledge of any particular colour scheme.
 */
function oppositeColors(facelets: Facelets, size: CubeSize): Map<Color, Color> | null {
  const together = new Map<Color, Set<Color>>(FACES.map((face) => [face, new Set<Color>()]));

  for (const indices of cornerFaceletsFor(size)) {
    const colors = indices.map((index) => facelets[index]);
    for (const a of colors) {
      for (const b of colors) {
        if (a !== b) together.get(a)?.add(b);
      }
    }
  }

  const opposites = new Map<Color, Color>();
  for (const face of FACES) {
    const seen = together.get(face);
    if (!seen) return null;
    const candidates = FACES.filter((other) => other !== face && !seen.has(other));
    // Exactly one colour never shares a corner with this one.
    if (candidates.length !== 1) return null;
    opposites.set(face, candidates[0]);
  }

  // The relation has to be symmetric, or the reading was not a real cube.
  for (const [a, b] of opposites) {
    if (opposites.get(b) !== a) return null;
  }

  return opposites;
}

/**
 * Relabel a scanned even-sized cube so the anchor corner is home.
 *
 * Returns null when the stickers cannot be a cube at all — the opposite-colour
 * pairing is the first thing to fall apart on a bad scan, and failing here is
 * more useful than handing the solver a frame built on nonsense.
 */
export function canonicalizeByAnchorCorner(facelets: Facelets, size: CubeSize): Facelets | null {
  const opposites = oppositeColors(facelets, size);
  if (!opposites) return null;

  const anchorFacelets = cornerFaceletsFor(size)[ANCHOR];
  const anchorFaces = CORNER_FACES[ANCHOR];

  // The anchor's own stickers name the three faces it touches...
  const anchorColors = anchorFacelets.map((index) => facelets[index]);
  if (new Set(anchorColors).size !== anchorColors.length) return null;

  const label = new Map<Color, Face>();
  anchorFaces.forEach((face, i) => {
    label.set(anchorColors[i], face);
  });

  // ...and the other three are their opposites, each going to the face across
  // the cube from the one its partner just took.
  for (const [color, face] of [...label]) {
    const oppositeColor = opposites.get(color);
    if (!oppositeColor) return null;
    label.set(oppositeColor, OPPOSITE_FACE[face]);
  }
  if (label.size !== 6) return null;

  // Two colours landing on the same face would silently produce a cube with
  // eight of one colour and none of another.
  if (new Set(label.values()).size !== 6) return null;

  const relabelled = facelets.map((color) => label.get(color));
  if (relabelled.some((color) => color === undefined)) return null;
  return relabelled as Facelets;
}

/**
 * Put a cube into the frame everything else assumes.
 *
 * Odd sizes already arrive that way, because their centres did the job during
 * classification; even sizes are anchored to a corner here.
 */
export function canonicalize(facelets: Facelets, size: CubeSize): Facelets | null {
  if (size % 2 === 1) return facelets;
  return canonicalizeByAnchorCorner(facelets, size);
}
