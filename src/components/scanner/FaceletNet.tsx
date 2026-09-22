'use client';

/**
 * The unfolded cube, as an editable net.
 *
 * This is the safety net for camera scanning: detection is never perfect under
 * real lighting, so rather than dead-ending on a bad read, the user sees what
 * was detected and fixes it. It doubles as full manual entry when there is no
 * camera available.
 */

import { useState } from 'react';
import {
  FACES,
  FACE_COLORS,
  FACE_COLOR_NAMES,
  FACE_NAMES,
  FACE_OFFSET,
  type Color,
  type Face,
  type Facelets,
} from '@/lib/cube/types';

interface FaceletNetProps {
  facelets: Facelets;
  /** Stickers the scanner was unsure of. */
  uncertain?: number[];
  /** Stickers the validator blamed for the cube being impossible. */
  invalid?: number[];
  onChange?: (index: number, color: Color) => void;
  /** Read-only mode, used for the small summary view. */
  editable?: boolean;
}

/** Position of each face in the 4x3 net grid. */
const NET_POSITION: Record<Face, { column: number; row: number }> = {
  U: { column: 2, row: 1 },
  L: { column: 1, row: 2 },
  F: { column: 2, row: 2 },
  R: { column: 3, row: 2 },
  B: { column: 4, row: 2 },
  D: { column: 2, row: 3 },
};

export default function FaceletNet({
  facelets,
  uncertain = [],
  invalid = [],
  onChange,
  editable = true,
}: FaceletNetProps) {
  const [brush, setBrush] = useState<Color>('U');

  const uncertainSet = new Set(uncertain);
  const invalidSet = new Set(invalid);

  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid w-full gap-[3px] sm:gap-1.5"
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(3, auto)',
        }}
      >
        {FACES.map((face) => {
          const { column, row } = NET_POSITION[face];
          return (
            <div
              key={face}
              className="grid grid-cols-3 gap-[2px] sm:gap-[3px]"
              style={{ gridColumn: column, gridRow: row }}
              aria-label={`${FACE_NAMES[face]} face`}
            >
              {Array.from({ length: 9 }, (_, i) => {
                const index = FACE_OFFSET[face] + i;
                const color = facelets[index];
                const isCenter = i === 4;
                const isUncertain = uncertainSet.has(index);
                const isInvalid = invalidSet.has(index);

                const ring = isInvalid
                  ? 'ring-2 ring-red-500 ring-offset-1 ring-offset-slate-950'
                  : isUncertain
                    ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-slate-950'
                    : '';

                const label = `${FACE_NAMES[face]} face, ${
                  isCenter ? 'center' : `position ${i + 1}`
                }, ${FACE_COLOR_NAMES[color]}${isUncertain ? ', uncertain' : ''}`;

                return (
                  <button
                    key={index}
                    type="button"
                    // Centers define their face's color, so they are fixed.
                    disabled={!editable || isCenter}
                    onClick={() => onChange?.(index, brush)}
                    aria-label={label}
                    title={label}
                    className={`aspect-square rounded-[3px] transition-transform sm:rounded ${ring} ${
                      editable && !isCenter
                        ? 'cursor-pointer active:scale-90'
                        : 'cursor-default'
                    } ${isCenter ? 'opacity-100' : ''}`}
                    style={{
                      backgroundColor: FACE_COLORS[color],
                      boxShadow: isCenter ? 'inset 0 0 0 2px rgba(0,0,0,0.45)' : undefined,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>

      {editable && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-slate-400">
            Pick a color, then tap any sticker to correct it
          </span>
          <div className="flex flex-wrap gap-2">
            {FACES.map((face) => (
              <button
                key={face}
                type="button"
                onClick={() => setBrush(face)}
                aria-pressed={brush === face}
                aria-label={FACE_COLOR_NAMES[face]}
                className={`h-11 w-11 rounded-lg transition ${
                  brush === face
                    ? 'ring-2 ring-white ring-offset-2 ring-offset-slate-950'
                    : 'ring-1 ring-white/20'
                }`}
                style={{ backgroundColor: FACE_COLORS[face] }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
