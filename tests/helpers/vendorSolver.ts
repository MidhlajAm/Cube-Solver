/**
 * Loads the vendored Kociemba solver (public/solver) under Node for tests.
 *
 * The vendored files are CoffeeScript-compiled IIFEs: cube.js assigns to
 * module.exports when it sees a CommonJS module, and solve.js then augments
 * that same object with initSolver/solve. In the browser they are loaded via
 * importScripts inside the worker instead; here we just require them.
 */

import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const solverDir = path.resolve(process.cwd(), 'public/solver');

export interface VendorCube {
  asString(): string;
  isSolved(): boolean;
  solve(maxDepth?: number): string;
  move(sequence: string): VendorCube;
  clone(): VendorCube;
}

export interface VendorCubeStatic {
  new (): VendorCube;
  fromString(str: string): VendorCube;
  random(): VendorCube;
  scramble(): string;
  inverse(sequence: string): string;
  initSolver(): void;
}

const Cube = require(path.join(solverDir, 'cube.js')) as VendorCubeStatic;
require(path.join(solverDir, 'solve.js'));

let initialized = false;

/** Build the solver's lookup tables once per test process. */
export function initSolver(): void {
  if (initialized) return;
  Cube.initSolver();
  initialized = true;
}

export { Cube };
