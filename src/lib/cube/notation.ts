/**
 * Singmaster move notation: parsing, serializing, inverting, and turning a move
 * into a plain-English description for the step-by-step player.
 */

import { FACES, FACE_NAMES, type Face, type Move, type Turns } from './types';

/** Parse a move sequence such as "R U2 R' F'" into moves. */
export function parseMoves(sequence: string): Move[] {
  const tokens = sequence.trim().split(/\s+/).filter(Boolean);
  return tokens.map(parseMove);
}

/** Parse one token, e.g. "R", "U2", "F'". */
export function parseMove(token: string): Move {
  const match = /^([URFDLB])(2|'|3)?$/.exec(token.trim());
  if (!match) {
    throw new Error(`Unrecognized move: "${token}"`);
  }
  const face = match[1] as Face;
  const suffix = match[2];

  let turns: Turns = 1;
  if (suffix === '2') turns = 2;
  else if (suffix === "'" || suffix === '3') turns = 3;

  return { face, turns };
}

/** Serialize one move back to notation. */
export function moveToString(move: Move): string {
  if (move.turns === 2) return `${move.face}2`;
  if (move.turns === 3) return `${move.face}'`;
  return move.face;
}

/** Serialize a sequence back to notation. */
export function movesToString(moves: Move[]): string {
  return moves.map(moveToString).join(' ');
}

/** The move that undoes the given move. */
export function invertMove(move: Move): Move {
  const turns: Turns = move.turns === 2 ? 2 : move.turns === 1 ? 3 : 1;
  return { face: move.face, turns };
}

/** The sequence that undoes the given sequence. */
export function invertMoves(moves: Move[]): Move[] {
  return [...moves].reverse().map(invertMove);
}

/**
 * Plain-English description of a move, shown beneath the 3D cube so the player
 * does not have to already know cube notation.
 */
export function humanizeMove(move: Move): string {
  const face = FACE_NAMES[move.face].toLowerCase();
  if (move.turns === 2) {
    return `Turn the ${face} face a half turn (180°)`;
  }
  const direction = move.turns === 1 ? 'clockwise' : 'counter-clockwise';
  return `Turn the ${face} face ${direction} (90°)`;
}

/**
 * Short label for the move, e.g. "Right · 180°". Used in the timeline
 * where there is no room for a sentence.
 */
export function shortLabelForMove(move: Move): string {
  const face = FACE_NAMES[move.face];
  if (move.turns === 2) return `${face} · 180°`;
  return `${face} · ${move.turns === 1 ? 'CW' : 'CCW'}`;
}

/** True if the token is a legal move. Used to validate hand-typed sequences. */
export function isValidMoveToken(token: string): boolean {
  try {
    parseMove(token);
    return true;
  } catch {
    return false;
  }
}

/** All 18 possible face turns, handy for tests and random scrambles. */
export function allMoves(): Move[] {
  const moves: Move[] = [];
  for (const face of FACES) {
    for (const turns of [1, 2, 3] as Turns[]) {
      moves.push({ face, turns });
    }
  }
  return moves;
}
