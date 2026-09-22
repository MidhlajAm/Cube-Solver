/**
 * The 3D view and the facelet engine have to agree, or stickers will land on
 * the wrong cubies mid-animation. Rather than eyeball the render, we check the
 * geometry against the move engine directly: turning a face in 3D space must
 * move every sticker to exactly the facelet the permutation says it does.
 */

import { describe, expect, it } from 'vitest';
import {
  CUBIE_POSITIONS,
  FACELETS_BY_CUBIE,
  FACELET_GEOMETRY,
  cubieKey,
  cubiesInLayer,
  isInLayer,
  rotateAboutFace,
  type Vec3,
} from '@/lib/cube/geometry';
import { destinationIndicesFor } from '@/lib/cube/state';
import { CENTER_INDEX, FACES, FACE_OFFSET } from '@/lib/cube/types';

describe('cube geometry', () => {
  it('has 26 drawn cubies', () => {
    expect(CUBIE_POSITIONS).toHaveLength(26);
    expect(CUBIE_POSITIONS.some((p) => p[0] === 0 && p[1] === 0 && p[2] === 0)).toBe(false);
  });

  it('places all 54 stickers on the outer shell', () => {
    expect(FACELET_GEOMETRY).toHaveLength(54);
    for (const { index, position, normal } of FACELET_GEOMETRY) {
      // A sticker's normal must point along the axis where its cubie is at the
      // surface, i.e. the dot product with its own position is 1.
      const dot = position[0] * normal[0] + position[1] * normal[1] + position[2] * normal[2];
      expect(dot, `facelet ${index} is not on the cube's surface`).toBe(1);
    }
  });

  it('gives every cubie the right number of stickers', () => {
    let corners = 0;
    let edges = 0;
    let centers = 0;

    for (const position of CUBIE_POSITIONS) {
      const stickers = FACELETS_BY_CUBIE.get(cubieKey(position)) ?? [];
      const nonZero = position.filter((c) => c !== 0).length;
      expect(stickers.length, `cubie ${cubieKey(position)}`).toBe(nonZero);
      if (nonZero === 3) corners++;
      else if (nonZero === 2) edges++;
      else centers++;
    }

    expect(corners).toBe(8);
    expect(edges).toBe(12);
    expect(centers).toBe(6);
  });

  it('puts each face center on the cubie that face turns around', () => {
    for (const face of FACES) {
      const center = FACELET_GEOMETRY[CENTER_INDEX[face]];
      expect(center.face).toBe(face);
      // The center sticker sits on a cubie with exactly one non-zero axis.
      expect(center.position.filter((c) => c !== 0)).toHaveLength(1);
    }
  });

  it('rotates each layer exactly as the move engine permutes it', () => {
    for (const face of FACES) {
      const dest = destinationIndicesFor(face);

      for (const geometry of FACELET_GEOMETRY) {
        if (!isInLayer(geometry.position, face)) {
          // Stickers outside the layer must not move at all.
          expect(dest[geometry.index], `facelet ${geometry.index} moved on ${face}`).toBe(
            geometry.index,
          );
          continue;
        }

        const landedAt = FACELET_GEOMETRY[dest[geometry.index]];
        const expectedPosition = rotateAboutFace(geometry.position, face);
        const expectedNormal = rotateAboutFace(geometry.normal, face);

        expect(
          landedAt.position,
          `${face}: facelet ${geometry.index} landed on the wrong cubie`,
        ).toEqual(expectedPosition);
        expect(
          landedAt.normal,
          `${face}: facelet ${geometry.index} landed facing the wrong way`,
        ).toEqual(expectedNormal);
      }
    }
  });

  it('turns 9 cubies per face', () => {
    for (const face of FACES) {
      expect(cubiesInLayer(face)).toHaveLength(9);
    }
  });

  it('returns to the start after four rotations about any face', () => {
    const start: Vec3 = [1, 1, 1];
    for (const face of FACES) {
      let v: Vec3 = start;
      for (let i = 0; i < 4; i++) v = rotateAboutFace(v, face);
      expect(v).toEqual(start);
    }
  });

  it('keeps each face’s nine stickers contiguous in the index space', () => {
    for (const face of FACES) {
      const base = FACE_OFFSET[face];
      for (let i = 0; i < 9; i++) {
        expect(FACELET_GEOMETRY[base + i].face).toBe(face);
      }
    }
  });
});
