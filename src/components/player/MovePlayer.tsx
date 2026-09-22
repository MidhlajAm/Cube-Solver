'use client';

/**
 * Step-by-step playback of the solution.
 *
 * The timeline is the source of navigation: every move is a tap target, so the
 * user can jump anywhere rather than only stepping. Scrubbing sets the move
 * index directly and the cube re-derives from the scramble, so it is always
 * consistent no matter how erratically the user navigates.
 */

import { useEffect, useRef } from 'react';
import { humanizeMove, moveToString } from '@/lib/cube/notation';
import { FACE_COLORS } from '@/lib/cube/types';
import { selectIsComplete, useCubeStore } from '@/store/cubeStore';

const SPEEDS = [0.5, 1, 1.5, 2.5];

export default function MovePlayer() {
  const solution = useCubeStore((s) => s.solution);
  const moveIndex = useCubeStore((s) => s.moveIndex);
  const playing = useCubeStore((s) => s.playing);
  const speed = useCubeStore((s) => s.speed);
  const animation = useCubeStore((s) => s.animation);
  const isComplete = useCubeStore(selectIsComplete);

  const next = useCubeStore((s) => s.next);
  const previous = useCubeStore((s) => s.previous);
  const jumpTo = useCubeStore((s) => s.jumpTo);
  const setPlaying = useCubeStore((s) => s.setPlaying);
  const setSpeed = useCubeStore((s) => s.setSpeed);
  const reset = useCubeStore((s) => s.reset);

  const timelineRef = useRef<HTMLDivElement>(null);

  // Drive automatic playback: whenever nothing is animating and we are still
  // playing, start the next turn.
  useEffect(() => {
    if (!playing || animation || !solution) return;
    if (moveIndex >= solution.length) {
      setPlaying(false);
      return;
    }
    // A brief gap between turns so consecutive moves stay readable.
    const timer = window.setTimeout(() => next(), 90 / speed);
    return () => window.clearTimeout(timer);
  }, [playing, animation, moveIndex, solution, speed, next, setPlaying]);

  // Keep the active move in view as playback advances.
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const active = container.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [moveIndex]);

  if (!solution) return null;

  if (solution.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-4 text-center">
        <p className="font-semibold text-emerald-300">This cube is already solved.</p>
      </div>
    );
  }

  const currentMove = moveIndex < solution.length ? solution[moveIndex] : null;
  const progress = (moveIndex / solution.length) * 100;

  return (
    <div className="flex flex-col gap-4">
      {/* Current move explanation */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {isComplete ? 'Done' : `Move ${moveIndex + 1} of ${solution.length}`}
          </span>
          <span className="text-xs text-slate-500">{solution.length} moves total</span>
        </div>

        <p className="mt-2 text-lg font-semibold text-white">
          {currentMove ? (
            <>
              <span
                className="mr-2 inline-block rounded px-2 py-0.5 font-mono text-slate-900"
                style={{ backgroundColor: FACE_COLORS[currentMove.face] }}
              >
                {moveToString(currentMove)}
              </span>
              {humanizeMove(currentMove)}
            </>
          ) : (
            'Solved — every face is a single color.'
          )}
        </p>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Scrubbable timeline */}
      <div
        ref={timelineRef}
        className="flex gap-1.5 overflow-x-auto pb-2"
        role="list"
        aria-label="Solution moves"
      >
        {solution.map((move, index) => {
          const done = index < moveIndex;
          const active = index === moveIndex;
          return (
            <button
              key={index}
              type="button"
              role="listitem"
              data-active={active}
              onClick={() => jumpTo(index)}
              aria-label={`Jump to move ${index + 1}: ${humanizeMove(move)}`}
              aria-current={active ? 'step' : undefined}
              className={`min-h-11 min-w-11 shrink-0 rounded-lg px-3 font-mono text-sm font-semibold transition ${
                active
                  ? 'bg-white text-slate-900'
                  : done
                    ? 'bg-slate-800 text-slate-500'
                    : 'bg-slate-800/60 text-slate-300'
              }`}
            >
              {moveToString(move)}
            </button>
          );
        })}
      </div>

      {/* Transport */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={reset}
          disabled={moveIndex === 0}
          aria-label="Back to the start"
          className="min-h-12 min-w-12 rounded-xl border border-slate-700 text-slate-200 disabled:opacity-40"
        >
          ⏮
        </button>
        <button
          type="button"
          onClick={previous}
          disabled={moveIndex === 0}
          aria-label="Previous move"
          className="min-h-12 min-w-12 rounded-xl border border-slate-700 text-slate-200 disabled:opacity-40"
        >
          ◀
        </button>

        <button
          type="button"
          onClick={() => (isComplete ? (reset(), setPlaying(true)) : setPlaying(!playing))}
          aria-label={playing ? 'Pause' : isComplete ? 'Play again' : 'Play'}
          className="min-h-12 flex-1 rounded-xl bg-white text-base font-semibold text-slate-900 active:bg-slate-200"
        >
          {playing ? 'Pause' : isComplete ? 'Play again' : 'Play'}
        </button>

        <button
          type="button"
          onClick={next}
          disabled={isComplete}
          aria-label="Next move"
          className="min-h-12 min-w-12 rounded-xl border border-slate-700 text-slate-200 disabled:opacity-40"
        >
          ▶
        </button>
      </div>

      {/* Speed */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Speed</span>
        <div className="flex flex-1 gap-1.5">
          {SPEEDS.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setSpeed(value)}
              aria-pressed={speed === value}
              className={`min-h-10 flex-1 rounded-lg text-sm font-medium transition ${
                speed === value
                  ? 'bg-slate-200 text-slate-900'
                  : 'border border-slate-700 text-slate-300'
              }`}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
