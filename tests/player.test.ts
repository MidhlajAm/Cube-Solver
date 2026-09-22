/**
 * Playback must not depend on the 3D canvas.
 *
 * The turn animation used to be completed from inside the render loop, which
 * meant a suspended tab or a device that could not get a WebGL context would
 * strand the player on move one forever. These tests run with no renderer at
 * all — if they pass, stepping is driven purely by state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectCurrentFacelets, selectIsComplete, useCubeStore } from '@/store/cubeStore';
import { applyMoves, isSolved, solvedFacelets } from '@/lib/cube/state';
import { invertMoves, parseMoves } from '@/lib/cube/notation';
import { faceletsToString, type Move } from '@/lib/cube/types';

const SCRAMBLE_NOTATION = "R U R' U' F2 L D B2 R' U2";

function setUpSolvableCube(): { scramble: ReturnType<typeof solvedFacelets>; solution: Move[] } {
  const moves = parseMoves(SCRAMBLE_NOTATION);
  const scramble = applyMoves(solvedFacelets(), moves);
  // Undoing the scramble is, by construction, a correct solution.
  const solution = invertMoves(moves);
  return { scramble, solution };
}

describe('solution playback (no renderer)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    const { scramble, solution } = setUpSolvableCube();
    useCubeStore.setState({
      scramble,
      solution,
      moveIndex: 0,
      animation: null,
      playing: false,
      speed: 1,
      phase: 'solve',
    });
  });

  afterEach(() => {
    useCubeStore.getState().reset();
    vi.useRealTimers();
  });

  it('advances one move per step, without any frame loop', () => {
    const { next } = useCubeStore.getState();

    next();
    // Mid-animation the move has not landed yet.
    expect(useCubeStore.getState().moveIndex).toBe(0);
    expect(useCubeStore.getState().animation).not.toBeNull();

    vi.advanceTimersByTime(1000);

    expect(useCubeStore.getState().moveIndex).toBe(1);
    expect(useCubeStore.getState().animation).toBeNull();
  });

  it('plays the whole solution through to a solved cube', () => {
    const solutionLength = useCubeStore.getState().solution!.length;

    for (let i = 0; i < solutionLength; i++) {
      useCubeStore.getState().next();
      vi.advanceTimersByTime(1000);
    }

    const state = useCubeStore.getState();
    expect(state.moveIndex).toBe(solutionLength);
    expect(selectIsComplete(state)).toBe(true);
    expect(isSolved(selectCurrentFacelets(state))).toBe(true);
  });

  it('steps backward to exactly the previous position', () => {
    const before = faceletsToString(selectCurrentFacelets(useCubeStore.getState()));

    useCubeStore.getState().next();
    vi.advanceTimersByTime(1000);
    const afterOne = faceletsToString(selectCurrentFacelets(useCubeStore.getState()));
    expect(afterOne).not.toBe(before);

    useCubeStore.getState().previous();
    vi.advanceTimersByTime(1000);

    expect(useCubeStore.getState().moveIndex).toBe(0);
    expect(faceletsToString(selectCurrentFacelets(useCubeStore.getState()))).toBe(before);
  });

  it('ignores a second step while one is still animating', () => {
    const { next } = useCubeStore.getState();
    next();
    next(); // should be a no-op
    vi.advanceTimersByTime(1000);
    expect(useCubeStore.getState().moveIndex).toBe(1);
  });

  it('jumping cancels a pending turn instead of letting it land late', () => {
    useCubeStore.getState().next();
    useCubeStore.getState().jumpTo(5);

    // The cancelled turn must not advance the index on top of the jump.
    vi.advanceTimersByTime(2000);

    expect(useCubeStore.getState().moveIndex).toBe(5);
    expect(useCubeStore.getState().animation).toBeNull();
  });

  it('resetting cancels a pending turn', () => {
    useCubeStore.getState().next();
    useCubeStore.getState().reset();
    vi.advanceTimersByTime(2000);

    expect(useCubeStore.getState().moveIndex).toBe(0);
    expect(useCubeStore.getState().animation).toBeNull();
  });

  it('scrubbing to any index shows the cube after exactly that many moves', () => {
    const { scramble, solution } = setUpSolvableCube();

    for (let index = 0; index <= solution.length; index++) {
      useCubeStore.getState().jumpTo(index);
      const shown = selectCurrentFacelets(useCubeStore.getState());
      const expected = applyMoves(scramble, solution.slice(0, index));
      expect(faceletsToString(shown), `at index ${index}`).toBe(faceletsToString(expected));
    }
  });

  it('stops playing once the last move lands', () => {
    const solutionLength = useCubeStore.getState().solution!.length;
    useCubeStore.getState().setPlaying(true);

    for (let i = 0; i < solutionLength; i++) {
      useCubeStore.getState().next();
      vi.advanceTimersByTime(1000);
    }

    expect(useCubeStore.getState().playing).toBe(false);
  });

  // Regression: this selector used to allocate a fresh array on every read.
  // Zustand compares snapshots by identity, so every read looked like a state
  // change and the component re-rendered until the tab crashed — and only once
  // moveIndex passed 0, so the app appeared to work right up until the first
  // step of the solution.
  it('returns a referentially stable result for unchanged state', () => {
    useCubeStore.getState().jumpTo(3);
    const state = useCubeStore.getState();

    const first = selectCurrentFacelets(state);
    const second = selectCurrentFacelets(state);
    const third = selectCurrentFacelets(useCubeStore.getState());

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('returns a new result once the move index actually changes', () => {
    useCubeStore.getState().jumpTo(2);
    const atTwo = selectCurrentFacelets(useCubeStore.getState());

    useCubeStore.getState().jumpTo(3);
    const atThree = selectCurrentFacelets(useCubeStore.getState());

    expect(atThree).not.toBe(atTwo);
    expect(faceletsToString(atThree)).not.toBe(faceletsToString(atTwo));
  });

  it('is stable at move zero too', () => {
    useCubeStore.getState().jumpTo(0);
    const state = useCubeStore.getState();
    expect(selectCurrentFacelets(state)).toBe(selectCurrentFacelets(state));
  });

  it('runs a half turn for longer than a quarter turn', () => {
    useCubeStore.setState({ moveIndex: 0, animation: null });
    useCubeStore.setState({ solution: [{ face: 'R', turns: 1 }] });
    useCubeStore.getState().next();
    const quarter = useCubeStore.getState().animation!.duration;

    useCubeStore.getState().reset();
    useCubeStore.setState({ solution: [{ face: 'R', turns: 2 }] });
    useCubeStore.getState().next();
    const half = useCubeStore.getState().animation!.duration;

    expect(half).toBeGreaterThan(quarter);
  });
});
