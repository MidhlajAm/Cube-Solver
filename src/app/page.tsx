'use client';

/**
 * The app shell: scan -> verify -> solve.
 *
 * Mobile is the primary layout (single column, controls within thumb reach);
 * at md and up it becomes two columns with the cube pinned beside the controls.
 */

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import CameraScanner from '@/components/scanner/CameraScanner';
import FaceletNet from '@/components/scanner/FaceletNet';
import MovePlayer from '@/components/player/MovePlayer';
import { selectCurrentFacelets, useCubeStore } from '@/store/cubeStore';

// Three.js is a large dependency and needs the DOM, so it is loaded on the
// client only and never blocks the first paint.
const Cube3D = dynamic(() => import('@/components/cube3d/Cube3D'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-slate-600">
      Loading 3D cube…
    </div>
  ),
});

export default function Page() {
  const phase = useCubeStore((s) => s.phase);
  const setPhase = useCubeStore((s) => s.setPhase);
  const scramble = useCubeStore((s) => s.scramble);
  const uncertain = useCubeStore((s) => s.uncertain);
  const validation = useCubeStore((s) => s.validation);
  const setSticker = useCubeStore((s) => s.setSticker);
  const setScramble = useCubeStore((s) => s.setScramble);
  const resetScan = useCubeStore((s) => s.resetScan);
  const solve = useCubeStore((s) => s.solve);
  const loadRandomCube = useCubeStore((s) => s.loadRandomCube);
  const solverStatus = useCubeStore((s) => s.solverStatus);
  const warmUpSolver = useCubeStore((s) => s.warmUpSolver);
  const error = useCubeStore((s) => s.error);
  const clearError = useCubeStore((s) => s.clearError);
  const currentFacelets = useCubeStore(selectCurrentFacelets);

  const [scanning, setScanning] = useState(false);

  // Start building the solver's lookup tables immediately: by the time the user
  // has scanned six faces it is warm, and solving feels instant.
  useEffect(() => {
    void warmUpSolver();
  }, [warmUpSolver]);

  if (scanning) {
    return (
      <main className="fixed inset-0 z-50 bg-black">
        <CameraScanner
          onCancel={() => {
            setScanning(false);
            setPhase('verify');
          }}
          onComplete={({ facelets, confidence, uncertain: unsure }) => {
            setScramble(facelets, { confidence, uncertain: unsure });
            setScanning(false);
            setPhase('verify');
          }}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5">
      <header className="flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Cube Solver</h1>
        <SolverBadge status={solverStatus} />
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-xl border border-red-900 bg-red-950/60 p-3"
        >
          <p className="text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={clearError}
            aria-label="Dismiss"
            className="shrink-0 text-red-300"
          >
            ✕
          </button>
        </div>
      )}

      {phase === 'scan' && (
        <Intro
          onScan={() => setScanning(true)}
          onManual={() => setPhase('verify')}
          onRandom={() => void loadRandomCube()}
        />
      )}

      {phase !== 'scan' && (
        <div className="flex flex-1 flex-col gap-5 md:flex-row md:items-start">
          {/* Cube: full-width on mobile, sticky beside the controls on desktop */}
          <section className="md:sticky md:top-5 md:flex-1">
            <div className="h-[46vh] min-h-[260px] w-full rounded-2xl border border-slate-800 bg-slate-900/40 md:h-[62vh]">
              <Cube3D className="h-full w-full" />
            </div>
            <p className="mt-2 text-center text-xs text-slate-600">
              Drag to rotate · pinch to zoom
            </p>
          </section>

          <section className="flex flex-col gap-5 md:w-[22rem] md:shrink-0">
            {phase === 'verify' && (
              <>
                <div>
                  <h2 className="text-base font-semibold">Check the colors</h2>
                  <p className="mt-1 text-sm text-slate-400">
                    {uncertain.length > 0
                      ? `${uncertain.length} sticker${uncertain.length === 1 ? '' : 's'} were hard to read — they're ringed in amber. Fix anything wrong before solving.`
                      : 'Tap any sticker that does not match your cube. Centers are fixed.'}
                  </p>
                </div>

                <FaceletNet
                  facelets={scramble}
                  uncertain={uncertain}
                  invalid={validation.badIndices}
                  onChange={setSticker}
                />

                {!validation.ok && (
                  <div
                    role="alert"
                    className="rounded-xl border border-amber-900 bg-amber-950/50 p-3"
                  >
                    <p className="text-sm font-medium text-amber-200">
                      {validation.issues[0]?.message}
                    </p>
                    {validation.issues.length > 1 && (
                      <p className="mt-1 text-xs text-amber-300/70">
                        and {validation.issues.length - 1} other problem
                        {validation.issues.length - 1 === 1 ? '' : 's'}
                      </p>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setScanning(true)}
                    className="min-h-12 rounded-xl border border-slate-700 px-4 text-sm font-medium text-slate-200"
                  >
                    Rescan
                  </button>
                  <button
                    type="button"
                    onClick={() => void solve()}
                    disabled={!validation.ok || solverStatus === 'solving'}
                    className="min-h-12 flex-1 rounded-xl bg-emerald-400 text-base font-semibold text-slate-950 disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    {solverStatus === 'solving' ? 'Solving…' : 'Solve'}
                  </button>
                </div>
              </>
            )}

            {phase === 'solve' && (
              <>
                <MovePlayer />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPhase('verify')}
                    className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm font-medium text-slate-200"
                  >
                    Edit colors
                  </button>
                  <button
                    type="button"
                    onClick={resetScan}
                    className="min-h-11 flex-1 rounded-xl border border-slate-700 text-sm font-medium text-slate-200"
                  >
                    New cube
                  </button>
                </div>

                <details className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                  <summary className="cursor-pointer text-sm font-medium text-slate-300">
                    Cube right now
                  </summary>
                  <div className="mt-3">
                    <FaceletNet facelets={currentFacelets} editable={false} />
                  </div>
                </details>
              </>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function SolverBadge({ status }: { status: string }) {
  const label =
    status === 'warming'
      ? 'Warming up solver…'
      : status === 'ready'
        ? 'Solver ready'
        : status === 'solving'
          ? 'Solving…'
          : status === 'error'
            ? 'Solver unavailable'
            : 'Starting…';

  const tone =
    status === 'ready'
      ? 'text-emerald-400'
      : status === 'error'
        ? 'text-red-400'
        : 'text-slate-500';

  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${tone}`}>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          status === 'ready'
            ? 'bg-emerald-400'
            : status === 'error'
              ? 'bg-red-400'
              : 'animate-pulse bg-slate-500'
        }`}
      />
      {label}
    </span>
  );
}

function Intro({
  onScan,
  onManual,
  onRandom,
}: {
  onScan: () => void;
  onManual: () => void;
  onRandom: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-6 py-6">
      <div>
        <h2 className="text-2xl font-bold leading-tight sm:text-3xl">
          Show your cube.
          <br />
          <span className="text-emerald-400">Get the solution.</span>
        </h2>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400">
          Hold each of the six faces up to your camera. You&apos;ll get a chance to fix
          anything it misreads, then watch the solution play out move by move on a 3D
          cube.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={onScan}
          className="min-h-14 rounded-xl bg-white text-base font-semibold text-slate-900 active:bg-slate-200"
        >
          Scan with camera
        </button>
        <button
          type="button"
          onClick={onManual}
          className="min-h-12 rounded-xl border border-slate-700 text-sm font-medium text-slate-200"
        >
          Enter colors by hand
        </button>
        <button
          type="button"
          onClick={onRandom}
          className="min-h-12 rounded-xl text-sm font-medium text-slate-400"
        >
          Try a random cube
        </button>
      </div>

      <p className="text-xs leading-relaxed text-slate-600">
        The camera only works over a secure (https) connection, and nothing leaves your
        device — scanning and solving both run entirely in your browser.
      </p>
    </div>
  );
}
