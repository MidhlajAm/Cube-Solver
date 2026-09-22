'use client';

/**
 * Application state.
 *
 * The cube is stored once, as the scanned/edited scramble, plus how far through
 * the solution we have played. Everything shown on screen derives from those
 * two facts, so stepping, scrubbing and resetting can never drift out of sync
 * with each other — replaying the first N moves always gives the same cube.
 */

import { create } from 'zustand';
import { applyMoves, isSolved, solvedFacelets } from '@/lib/cube/state';
import { parseMoves } from '@/lib/cube/notation';
import { invertMove } from '@/lib/cube/notation';
import {
  DEFAULT_SIZE,
  faceletsFromString,
  faceletCountFor,
  faceOffsetFor,
  stickersPerFace,
  FACES,
  FACE_COLORS,
  type CubeSize,
  type Color,
  type Face,
  type Facelets,
  type Move,
} from '@/lib/cube/types';
import { validateFacelets, type ValidationResult } from '@/lib/cube/validate';
import { initSolver, randomCube, solveCube } from '@/lib/solver/client';

export type Phase = 'scan' | 'verify' | 'solve';
export type SolverStatus = 'idle' | 'warming' | 'ready' | 'solving' | 'error';

/** A turn currently being animated on the 3D cube. */
export interface Animation {
  move: Move;
  /** Whether this is a step forward through the solution or a step back. */
  direction: 'forward' | 'backward';
  startedAt: number;
  duration: number;
}

interface CubeState {
  phase: Phase;

  /** Which cube is being solved. Changing it starts over. */
  size: CubeSize;
  /**
   * Whether the scanner takes each face by itself. Kept here rather than in the
   * scanner so the choice survives closing and reopening the camera.
   */
  autoCapture: boolean;

  /** The cube as scanned or hand-edited: the starting position. */
  scramble: Facelets;
  /** Per-sticker detection confidence, when the cube came from the camera. */
  confidence: number[] | null;
  /** Stickers the scanner was unsure about. */
  uncertain: number[];
  /** Which faces the camera has captured so far. */
  captured: Partial<Record<Face, boolean>>;

  /**
   * The colour to draw each face in. Scanning starts on whichever face the
   * user points at the camera, so the face called "front" is not necessarily
   * the green one — the palette comes from the scanned centres instead of the
   * built-in scheme, or the net would not match the cube in their hands.
   */
  faceColors: Record<Face, string>;
  /** Anything the scan quietly corrected, worth telling the user about. */
  scanNotice: string | null;

  validation: ValidationResult;

  solution: Move[] | null;
  /** How many moves of the solution have been applied. */
  moveIndex: number;
  animation: Animation | null;
  playing: boolean;
  /** Playback rate; 1 is one move roughly every 600ms. */
  speed: number;

  solverStatus: SolverStatus;
  error: string | null;

  // Actions
  setPhase: (phase: Phase) => void;
  setSize: (size: CubeSize) => void;
  setAutoCapture: (on: boolean) => void;
  setScramble: (
    facelets: Facelets,
    meta?: {
      confidence?: number[];
      uncertain?: number[];
      faceColors?: Record<Face, string>;
      notice?: string | null;
    },
  ) => void;
  setSticker: (index: number, color: Color) => void;
  captureFace: (face: Face, colors: Color[], confidence: number[]) => void;
  resetScan: () => void;

  warmUpSolver: () => Promise<void>;
  solve: () => Promise<void>;
  loadRandomCube: () => Promise<void>;

  next: () => void;
  previous: () => void;
  jumpTo: (index: number) => void;
  completeAnimation: () => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  reset: () => void;
  clearError: () => void;
  clearScanNotice: () => void;
}

/** Base duration of one quarter turn, before the speed multiplier. */
const BASE_TURN_MS = 420;

function durationFor(move: Move, speed: number): number {
  // A half turn travels twice as far, so give it a little more time — but not
  // double, or the playback feels like it stalls.
  const scale = move.turns === 2 ? 1.45 : 1;
  return (BASE_TURN_MS * scale) / speed;
}

/**
 * A turn finishes on a timer owned by the store, not by the 3D render loop.
 *
 * The renderer only interpolates the rotation for display. Tying the state
 * transition to it instead would mean playback stalls forever whenever the
 * canvas is not drawing — a backgrounded tab suspends rAF, and a device that
 * fails to get a WebGL context would never advance a single move.
 */
let animationTimer: ReturnType<typeof setTimeout> | null = null;

function clearAnimationTimer(): void {
  if (animationTimer !== null) {
    clearTimeout(animationTimer);
    animationTimer = null;
  }
}

export const useCubeStore = create<CubeState>((set, get) => ({
  phase: 'scan',

  size: DEFAULT_SIZE,
  autoCapture: true,

  scramble: solvedFacelets(DEFAULT_SIZE),
  confidence: null,
  uncertain: [],
  captured: {},

  faceColors: { ...FACE_COLORS },
  scanNotice: null,

  validation: validateFacelets(solvedFacelets(DEFAULT_SIZE)),

  solution: null,
  moveIndex: 0,
  animation: null,
  playing: false,
  speed: 1,

  solverStatus: 'idle',
  error: null,

  setPhase: (phase) => set({ phase }),

  setSize: (size) => {
    if (get().size === size) return;
    clearAnimationTimer();
    const fresh = solvedFacelets(size);
    set({
      size,
      scramble: fresh,
      confidence: null,
      uncertain: [],
      captured: {},
      faceColors: { ...FACE_COLORS },
      scanNotice: null,
      validation: validateFacelets(fresh),
      solution: null,
      moveIndex: 0,
      animation: null,
      playing: false,
      phase: 'scan',
      error: null,
    });
  },

  setAutoCapture: (autoCapture) => set({ autoCapture }),

  setScramble: (facelets, meta) =>
    set({
      scramble: facelets,
      confidence: meta?.confidence ?? null,
      uncertain: meta?.uncertain ?? [],
      faceColors: meta?.faceColors ?? { ...FACE_COLORS },
      scanNotice: meta?.notice ?? null,
      validation: validateFacelets(facelets),
      solution: null,
      moveIndex: 0,
      animation: null,
      playing: false,
    }),

  setSticker: (index, color) => {
    const scramble = [...get().scramble];
    scramble[index] = color;
    set({
      scramble,
      validation: validateFacelets(scramble),
      // Editing invalidates any solution computed from the old state.
      solution: null,
      moveIndex: 0,
      animation: null,
      playing: false,
      // The user has overridden the scanner here, so stop flagging it.
      uncertain: get().uncertain.filter((i) => i !== index),
    });
  },

  captureFace: (face, colors, confidence) => {
    const size = get().size;
    const perFace = stickersPerFace(size);
    const scramble = [...get().scramble];
    const base = faceOffsetFor(face, size);
    for (let i = 0; i < perFace; i++) scramble[base + i] = colors[i];

    const nextConfidence = get().confidence ?? new Array(faceletCountFor(size)).fill(1);
    const merged = [...nextConfidence];
    for (let i = 0; i < perFace; i++) merged[base + i] = confidence[i];

    set({
      scramble,
      confidence: merged,
      captured: { ...get().captured, [face]: true },
      validation: validateFacelets(scramble),
      solution: null,
      moveIndex: 0,
    });
  },

  resetScan: () => {
    clearAnimationTimer();
    const fresh = solvedFacelets(get().size);
    set({
      scramble: fresh,
      confidence: null,
      uncertain: [],
      captured: {},
      faceColors: { ...FACE_COLORS },
      scanNotice: null,
      validation: validateFacelets(fresh),
      solution: null,
      moveIndex: 0,
      animation: null,
      playing: false,
      phase: 'scan',
      error: null,
    });
  },

  warmUpSolver: async () => {
    if (get().solverStatus !== 'idle') return;
    set({ solverStatus: 'warming' });
    try {
      await initSolver();
      set({ solverStatus: 'ready' });
    } catch (error) {
      set({
        solverStatus: 'error',
        error: error instanceof Error ? error.message : 'The solver failed to start.',
      });
    }
  },

  solve: async () => {
    const { scramble } = get();
    const validation = validateFacelets(scramble);
    if (!validation.ok) {
      set({ validation, error: validation.issues[0]?.message ?? 'This is not a valid cube.' });
      return;
    }

    // The two-phase solver returns a non-empty identity sequence for a cube
    // that is already solved (e.g. "R L U2 R L F2 ..." which cancels out), so
    // short-circuit rather than showing the user a dozen pointless moves.
    if (isSolved(scramble)) {
      set({ solution: [], moveIndex: 0, animation: null, playing: false, phase: 'solve' });
      return;
    }

    set({ solverStatus: 'solving', error: null });
    try {
      const notation = await solveCube(scramble);
      const solution = notation.trim() ? parseMoves(notation) : [];
      set({
        solution,
        moveIndex: 0,
        animation: null,
        playing: false,
        phase: 'solve',
        solverStatus: 'ready',
      });
    } catch (error) {
      set({
        solverStatus: 'ready',
        error: error instanceof Error ? error.message : 'Could not solve this cube.',
      });
    }
  },

  loadRandomCube: async () => {
    set({ error: null });
    try {
      const facelets = faceletsFromString(await randomCube(get().size));
      get().setScramble(facelets);
      set({ captured: Object.fromEntries(FACES.map((f) => [f, true])), phase: 'verify' });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not generate a cube.' });
    }
  },

  next: () => {
    const { solution, moveIndex, animation, speed } = get();
    if (!solution || animation || moveIndex >= solution.length) return;
    const move = solution[moveIndex];
    const duration = durationFor(move, speed);

    set({
      animation: { move, direction: 'forward', startedAt: performance.now(), duration },
    });

    clearAnimationTimer();
    animationTimer = setTimeout(() => get().completeAnimation(), duration);
  },

  previous: () => {
    const { solution, moveIndex, animation, speed } = get();
    if (!solution || animation || moveIndex <= 0) return;
    // Step back by animating the inverse of the move we are undoing.
    const move = invertMove(solution[moveIndex - 1]);
    const duration = durationFor(move, speed);

    set({
      playing: false,
      animation: { move, direction: 'backward', startedAt: performance.now(), duration },
    });

    clearAnimationTimer();
    animationTimer = setTimeout(() => get().completeAnimation(), duration);
  },

  completeAnimation: () => {
    clearAnimationTimer();
    const { animation, moveIndex, solution, playing } = get();
    if (!animation) return;

    const nextIndex = animation.direction === 'forward' ? moveIndex + 1 : moveIndex - 1;
    const finished = solution != null && nextIndex >= solution.length;

    set({
      moveIndex: nextIndex,
      animation: null,
      playing: finished ? false : playing,
    });
  },

  jumpTo: (index) => {
    const { solution } = get();
    if (!solution) return;
    clearAnimationTimer();
    const clamped = Math.max(0, Math.min(solution.length, index));
    set({ moveIndex: clamped, animation: null, playing: false });
  },

  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),

  reset: () => {
    clearAnimationTimer();
    set({ moveIndex: 0, animation: null, playing: false });
  },

  clearError: () => set({ error: null }),
  clearScanNotice: () => set({ scanNotice: null }),
}));

/**
 * Memo for the derived cube state.
 *
 * This selector MUST return the same array reference for the same inputs.
 * Zustand compares snapshots by identity, so a selector that allocates on every
 * read looks like a state change on every read, and the component re-renders
 * forever — which crashes the tab rather than failing visibly.
 */
let faceletsCache: {
  scramble: Facelets;
  solution: Move[];
  moveIndex: number;
  result: Facelets;
} | null = null;

/** The cube as it stands after the moves played so far. */
export function selectCurrentFacelets(state: CubeState): Facelets {
  if (!state.solution || state.moveIndex === 0) return state.scramble;

  const cached = faceletsCache;
  if (
    cached &&
    cached.scramble === state.scramble &&
    cached.solution === state.solution &&
    cached.moveIndex === state.moveIndex
  ) {
    return cached.result;
  }

  const result = applyMoves(state.scramble, state.solution.slice(0, state.moveIndex));
  faceletsCache = {
    scramble: state.scramble,
    solution: state.solution,
    moveIndex: state.moveIndex,
    result,
  };
  return result;
}

/** True once the whole solution has been played out. */
export function selectIsComplete(state: CubeState): boolean {
  return state.solution !== null && state.moveIndex >= state.solution.length;
}
