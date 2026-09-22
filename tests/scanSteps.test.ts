/**
 * The scanning instructions tell the user how to hold the cube. If they drift
 * out of step with the net layout, nine stickers land in the wrong facelets and
 * the cube silently becomes unsolvable — with nothing on screen to explain why.
 * So the instructions are derived from the geometry here rather than trusted.
 *
 * The prose is checked too, in two ways: that it never names a colour (a
 * scrambled cube has no visible "white face", and half of all cubes use the
 * mirrored colour scheme), and that the motions it describes really do put the
 * face it claims in front of the camera.
 */

import { describe, expect, it } from 'vitest';
import { SCAN_STEPS, instructionFor } from '@/components/scanner/scanSteps';
import { FACELET_GEOMETRY, type Vec3 } from '@/lib/cube/geometry';
import { FACES, FACE_OFFSET, type Face } from '@/lib/cube/types';

const NORMALS: Record<Face, Vec3> = {
  U: [0, 1, 0],
  R: [1, 0, 0],
  F: [0, 0, 1],
  D: [0, -1, 0],
  L: [-1, 0, 0],
  B: [0, 0, -1],
};

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  // `|| 0` collapses -0, which compares unequal to 0 under deep equality.
  return [
    a[1] * b[2] - a[2] * b[1] || 0,
    a[2] * b[0] - a[0] * b[2] || 0,
    a[0] * b[1] - a[1] * b[0] || 0,
  ];
}

/** Position of a sticker at (row, column) on a face. */
function at(face: Face, row: number, column: number): Vec3 {
  return FACELET_GEOMETRY[FACE_OFFSET[face] + row * 3 + column].position;
}

// --- Rigid rotations of the cube in the user's hands ------------------------
// World frame: the camera looks from +z, screen up is +y, screen right is +x.

type Matrix = readonly [Vec3, Vec3, Vec3];

const IDENTITY: Matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Tip the cube about the horizontal screen axis; +90 brings the top forward. */
function rotateX(quarters: number): Matrix {
  const c = Math.round(Math.cos((quarters * Math.PI) / 2));
  const s = Math.round(Math.sin((quarters * Math.PI) / 2));
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}

/** Spin the cube about the vertical screen axis; -90 brings its right side forward. */
function rotateY(quarters: number): Matrix {
  const c = Math.round(Math.cos((quarters * Math.PI) / 2));
  const s = Math.round(Math.sin((quarters * Math.PI) / 2));
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}

function apply(m: Matrix, v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2] || 0,
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2] || 0,
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2] || 0,
  ];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  const row = (i: number): Vec3 => [
    a[i][0] * b[0][0] + a[i][1] * b[1][0] + a[i][2] * b[2][0] || 0,
    a[i][0] * b[0][1] + a[i][1] * b[1][1] + a[i][2] * b[2][1] || 0,
    a[i][0] * b[0][2] + a[i][1] * b[1][2] + a[i][2] * b[2][2] || 0,
  ];
  return [row(0), row(1), row(2)];
}

const TOWARD_CAMERA: Vec3 = [0, 0, 1];
const SCREEN_UP: Vec3 = [0, 1, 0];

/**
 * The orientation each written instruction leaves the cube in, transcribed
 * independently from the prose in scanSteps.ts.
 */
const MOTIONS: readonly Matrix[] = [
  // "Point any face at the camera" — whatever they pick is the front.
  IDENTITY,
  // "Spin the cube so its right-hand side faces the camera"
  rotateY(-1),
  // "Spin it the same way again"
  multiply(rotateY(-1), rotateY(-1)),
  // "Spin it the same way once more"
  multiply(rotateY(-1), multiply(rotateY(-1), rotateY(-1))),
  // "Spin back to the face you started on, then tip its top toward the camera"
  rotateX(1),
  // "Tip it back upright, then tip its bottom toward the camera"
  rotateX(-1),
];

const COLOR_WORDS = /\b(white|yellow|red|orange|green|blue|colou?r)\b/i;

describe('scan steps', () => {
  it('captures each of the six faces exactly once', () => {
    expect([...SCAN_STEPS].map((s) => s.face).sort()).toEqual([...FACES].sort());
  });

  it('names the face that really is at the top of the camera view', () => {
    for (const step of SCAN_STEPS) {
      // Moving from the second row up to the first row is "up" on screen.
      const screenUp = subtract(at(step.face, 0, 0), at(step.face, 1, 0));
      expect(screenUp, `${step.face}: wrong top face in the instructions`).toEqual(
        NORMALS[step.topFace],
      );
    }
  });

  it('keeps left-to-right consistent with viewing the face from outside', () => {
    for (const step of SCAN_STEPS) {
      const screenUp = subtract(at(step.face, 0, 0), at(step.face, 1, 0));
      const screenRight = subtract(at(step.face, 0, 1), at(step.face, 0, 0));

      // A camera looking at the face from outside has view direction -normal;
      // screen right is then (view direction) x (up).
      const normal = NORMALS[step.face];
      const viewDirection: Vec3 = [-normal[0], -normal[1], -normal[2]];
      const expected = cross(viewDirection, screenUp);

      expect(screenRight, `${step.face}: the net is mirrored relative to the camera`).toEqual(
        expected,
      );
    }
  });

  it('describes motions that actually show the face being captured', () => {
    SCAN_STEPS.forEach((step, i) => {
      const orientation = MOTIONS[i];
      expect(
        apply(orientation, NORMALS[step.face]),
        `step ${i + 1} ("${step.instruction}") does not point ${step.face} at the camera`,
      ).toEqual(TOWARD_CAMERA);
      expect(
        apply(orientation, NORMALS[step.topFace]),
        `step ${i + 1} ("${step.instruction}") does not leave ${step.topFace} at the top`,
      ).toEqual(SCREEN_UP);
    });
  });

  it('never asks the user to identify a colour', () => {
    for (const step of SCAN_STEPS) {
      expect(step.instruction, `"${step.instruction}" names a colour`).not.toMatch(COLOR_WORDS);
      expect(step.detail, `"${step.detail}" names a colour`).not.toMatch(COLOR_WORDS);
    }
  });

  it('keeps cube notation out of user-facing copy', () => {
    for (const step of SCAN_STEPS) {
      expect(instructionFor(step)).not.toMatch(/\b[URFDLB]\b/);
      expect(step.detail).not.toMatch(/\b[URFDLB]\b/);
    }
  });
});
