/**
 * The scanning instructions tell the user how to hold the cube. If they drift
 * out of step with the net layout, nine stickers land in the wrong facelets and
 * the cube silently becomes unsolvable — with nothing on screen to explain why.
 * So the instructions are derived from the geometry here rather than trusted.
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

describe('scan steps', () => {
  it('covers all six faces in solver order', () => {
    expect(SCAN_STEPS.map((s) => s.face)).toEqual([...FACES]);
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

  it('describes each step in colors, not cube notation', () => {
    for (const step of SCAN_STEPS) {
      const text = instructionFor(step);
      expect(text).toMatch(/face, with/);
      // No bare face letters like "U" or "B" leaking into user-facing copy.
      expect(text).not.toMatch(/\b[URFDLB]\b/);
    }
  });
});
