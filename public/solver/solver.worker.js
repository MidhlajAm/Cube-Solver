/**
 * Solver worker (classic worker, loaded from /solver/solver.worker.js).
 *
 * The vendored solver files are CoffeeScript-compiled IIFEs that expect plain
 * script semantics: cube.js assigns `this.Cube` when there is no CommonJS
 * `module`, and solve.js then picks that up off the global. Loading them with
 * importScripts gives them exactly that environment, which is why they live in
 * public/ rather than being bundled — no ESM/CJS interop to get wrong.
 *
 * Building the pruning tables takes a second or two on a laptop and longer on a
 * phone, which is the whole reason this runs off the main thread.
 */

/* eslint-disable no-undef */

importScripts('./cube.js', './solve.js');

let ready = false;

function ensureReady() {
  if (ready) return;
  Cube.initSolver();
  ready = true;
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};

  try {
    switch (type) {
      case 'init': {
        const started = Date.now();
        ensureReady();
        self.postMessage({ id, type: 'ready', payload: { ms: Date.now() - started } });
        break;
      }

      case 'solve': {
        ensureReady();
        const cube = Cube.fromString(payload.facelets);
        const solution = cube.solve(payload.maxDepth ?? 22);

        if (solution === null || solution === undefined) {
          self.postMessage({
            id,
            type: 'error',
            payload: { message: 'No solution found for this cube.' },
          });
          break;
        }

        self.postMessage({ id, type: 'solved', payload: { solution } });
        break;
      }

      case 'scramble': {
        // A random *state* scramble, so the demo covers the full cube space
        // rather than just short move sequences.
        const cube = Cube.random();
        self.postMessage({
          id,
          type: 'scrambled',
          payload: { facelets: cube.asString() },
        });
        break;
      }

      default:
        self.postMessage({
          id,
          type: 'error',
          payload: { message: `Unknown request: ${type}` },
        });
    }
  } catch (error) {
    self.postMessage({
      id,
      type: 'error',
      payload: { message: error && error.message ? error.message : String(error) },
    });
  }
};
