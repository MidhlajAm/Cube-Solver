/**
 * Main-thread client for the solver worker.
 *
 * Exposes promise-based calls over the worker's message protocol and keeps a
 * single worker alive for the page, since building the lookup tables is the
 * expensive part and we only ever want to pay it once.
 */

import {
  DEFAULT_SIZE,
  FACES,
  faceletsToString,
  sizeOf,
  solvedFacelets,
  type CubeSize,
  type Facelets,
  type Turns,
} from '@/lib/cube/types';
import { validateFacelets } from '@/lib/cube/validate';
import { canonicalize } from '@/lib/cube/canonical';
import { applyMoves } from '@/lib/cube/state';
import { movesToString } from '@/lib/cube/notation';
import { solveTwoByTwo, warmUpTwoByTwo } from './twoByTwo';

export type SolverStatus = 'idle' | 'loading' | 'ready' | 'error';

interface PendingRequest {
  resolve: (value: never) => void;
  reject: (reason: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();
let readyPromise: Promise<void> | null = null;

function getWorker(): Worker {
  if (worker) return worker;

  if (typeof window === 'undefined') {
    throw new Error('The solver worker is only available in the browser.');
  }

  // Classic worker served straight from public/ — see the note in
  // solver.worker.js for why the vendored solver is not bundled.
  worker = new Worker('/solver/solver.worker.js');

  worker.onmessage = (event: MessageEvent) => {
    const { id, type, payload } = event.data ?? {};
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id);

    if (type === 'error') {
      request.reject(new Error(payload?.message ?? 'Solver failed.'));
    } else {
      (request.resolve as (value: unknown) => void)(payload);
    }
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || 'The solver worker failed to load.');
    for (const [, request] of pending) request.reject(error);
    pending.clear();
    readyPromise = null;
  };

  return worker;
}

function request<T>(type: string, payload?: unknown): Promise<T> {
  const id = nextId++;
  const instance = getWorker();
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as never, reject });
    instance.postMessage({ id, type, payload });
  });
}

/**
 * Build the solver's lookup tables. Safe to call repeatedly — the work happens
 * once. Call this early (on mount) so the tables are warm before the user has
 * finished scanning.
 */
export function initSolver(): Promise<void> {
  // The 2x2 tables are small enough to build inline and are needed whichever
  // size the user picks next, so they are never worth waiting on separately.
  warmUpTwoByTwo();

  if (!readyPromise) {
    readyPromise = request<{ ms: number }>('init').then(() => undefined);
  }
  return readyPromise;
}

/**
 * Solve a cube. Validates first: the vendored solver does no validity checking
 * of its own and will happily grind away on an impossible cube, so an invalid
 * pattern must never reach it.
 */
export async function solveCube(facelets: Facelets): Promise<string> {
  const validation = validateFacelets(facelets);
  if (!validation.ok) {
    throw new Error(validation.issues[0]?.message ?? 'This is not a valid cube.');
  }

  // A 2x2 is solved here on the main thread. Its whole search costs a few tens
  // of milliseconds, so shipping it to the worker would add more latency in
  // message passing than it saves.
  if (sizeOf(facelets) === 2) {
    const anchored = canonicalize(facelets, 2);
    if (!anchored) throw new Error('These colors cannot sit on a cube together.');
    return movesToString(solveTwoByTwo(anchored));
  }

  await initSolver();
  const result = await request<{ solution: string }>('solve', {
    facelets: faceletsToString(facelets),
  });
  return result.solution;
}

/** A random solvable cube state, for the demo scramble button. */
export async function randomCube(size: CubeSize = DEFAULT_SIZE): Promise<string> {
  if (size === 2) {
    // Twenty random turns is far past the eleven needed to reach anywhere, so
    // this covers the whole state space well enough for a demo.
    const moves = Array.from({ length: 20 }, () => ({
      face: FACES[Math.floor(Math.random() * FACES.length)],
      turns: (Math.floor(Math.random() * 3) + 1) as Turns,
    }));
    return faceletsToString(applyMoves(solvedFacelets(2), moves));
  }

  const result = await request<{ facelets: string }>('scramble');
  return result.facelets;
}

/** Tear the worker down. Used when the page unmounts in development. */
export function disposeSolver(): void {
  worker?.terminate();
  worker = null;
  readyPromise = null;
  pending.clear();
}
