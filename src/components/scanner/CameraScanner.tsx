'use client';

/**
 * Camera capture of the six faces.
 *
 * There is no shutter button. The hand that would press it is the hand holding
 * the cube, and reaching for the screen moves the thing being photographed, so
 * the scanner watches the viewfinder and takes each face once the picture has
 * settled. The judgements behind that live in lib/vision/autoCapture.ts, which
 * is where they are tested; this file is the plumbing and the feedback.
 *
 * Notes that are easy to get wrong and expensive to debug on a phone:
 *  - getUserMedia only works in a secure context, so a plain http:// LAN
 *    address silently has no camera. We detect that and say so rather than
 *    showing a dead viewfinder.
 *  - iOS Safari will force a <video> fullscreen unless it is muted and
 *    playsInline.
 *  - The preview is deliberately not mirrored. Mirroring would flip left and
 *    right, which would transpose every sticker in a row.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FACES, type Color, type Face } from '@/lib/cube/types';
import { applyQuarters, mapIndices, repairOrientation } from '@/lib/cube/orient';
import { rgbToCss, type Rgb } from '@/lib/vision/color';
import { sampleVideoFrame, type StickerSample } from '@/lib/vision/sampler';
import { classifyFacelets } from '@/lib/vision/classify';
import { paletteFromCenters } from '@/lib/vision/palette';
import { isLitWellEnough, isSteady, matchCapturedFace, steadiness } from '@/lib/vision/autoCapture';
import { SCAN_STEPS } from './scanSteps';

/** How often the viewfinder is read. Five settled reads take the shot. */
const TICK_MS = 120;

/** Pause after a capture, so the result is visible before the next face. */
const CAPTURE_PAUSE_MS = 700;

/** Plain-English summary of any faces the scan had to straighten. */
function describeRepair(corrected: Face[]): string | null {
  if (corrected.length === 0) return null;
  const count = corrected.length;
  return `${count === 1 ? 'One face was' : `${count} faces were`} held a quarter turn out, so ${
    count === 1 ? 'it has' : 'they have'
  } been straightened. Check the net still matches your cube.`;
}

type CameraState =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'live' }
  | { status: 'denied' }
  | { status: 'insecure' }
  | { status: 'unavailable'; reason: string };

/** What the scanner is currently waiting for. */
type Guidance =
  | { kind: 'dark' }
  | { kind: 'moving'; progress: number }
  | { kind: 'repeat'; stepNumber: number }
  | { kind: 'holding'; progress: number }
  | { kind: 'captured' };

interface CameraScannerProps {
  onComplete: (result: {
    facelets: Color[];
    confidence: number[];
    uncertain: number[];
    faceColors: Record<Face, string>;
    notice: string | null;
  }) => void;
  onCancel: () => void;
}

export default function CameraScanner({ onComplete, onCancel }: CameraScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /** Recent viewfinder reads, newest last. Never rendered, so it stays a ref. */
  const framesRef = useRef<StickerSample[][]>([]);
  /** Ignore the viewfinder until this moment, just after a capture. */
  const pausedUntilRef = useRef(0);

  // Starts as 'starting' because the effect below opens the camera on mount.
  const [camera, setCamera] = useState<CameraState>({ status: 'starting' });
  const [stepIndex, setStepIndex] = useState(0);
  const [captures, setCaptures] = useState<Partial<Record<Face, StickerSample[]>>>({});
  const [preview, setPreview] = useState<StickerSample[] | null>(null);
  const [guidance, setGuidance] = useState<Guidance>({ kind: 'moving', progress: 0 });
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);

  const step = SCAN_STEPS[stepIndex];

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (typeof navigator === 'undefined') return;

    setCamera({ status: 'starting' });

    if (!window.isSecureContext) {
      setCamera({ status: 'insecure' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera({ status: 'unavailable', reason: 'This browser has no camera API.' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() as
        | (MediaTrackCapabilities & { torch?: boolean })
        | undefined;
      setTorchAvailable(Boolean(capabilities?.torch));

      setCamera({ status: 'live' });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setCamera({ status: 'denied' });
      } else {
        setCamera({
          status: 'unavailable',
          reason: error instanceof Error ? error.message : 'The camera could not be opened.',
        });
      }
    }
  }, []);

  useEffect(() => {
    // Opening the camera is exactly the "synchronize with an external system"
    // case effects are for, and its result has to land in state. The lint rule
    // flags any effect that transitively sets state, so it cannot be satisfied
    // here without moving capture behind a second tap — and this component is
    // already only mounted in response to the user tapping "Scan".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start();
    return stop;
  }, [start, stop]);

  /** Record one face and move on, finishing the scan after the sixth. */
  const commit = useCallback(
    (samples: StickerSample[]) => {
      const next = { ...captures, [step.face]: samples };
      setCaptures(next);
      framesRef.current = [];
      pausedUntilRef.current = performance.now() + CAPTURE_PAUSE_MS;
      setGuidance({ kind: 'captured' });

      if (stepIndex < SCAN_STEPS.length - 1) {
        setStepIndex(stepIndex + 1);
        return;
      }

      // All six faces captured. Classification needs them together: the centers
      // act as reference colors and the nine-of-each-color rule is applied
      // across the whole cube at once.
      const ordered = FACES.flatMap((face) => next[face] ?? []);
      if (ordered.length !== 54) return;

      const result = classifyFacelets(ordered);

      // The face the user started on is arbitrary, so the built-in colour
      // scheme is not the right thing to draw with. Take the palette from what
      // was actually scanned, or the net will not match the cube in their hands.
      const centers: Partial<Record<Face, Rgb>> = {};
      for (const face of FACES) {
        const centre = next[face]?.[4];
        if (centre) centers[face] = centre.rgb;
      }
      const faceColors = paletteFromCenters(centers);

      // A face held a quarter turn out does not look wrong — it makes the cube
      // impossible, and the resulting complaint is about corners, not grip.
      // Nobody could reasonably work back from that, so undo it here.
      const repair = repairOrientation(result.facelets);
      const quarters = repair?.quarters;
      const moved = quarters ? mapIndices(quarters) : null;

      stop();
      onComplete({
        facelets: repair ? repair.facelets : result.facelets,
        confidence: quarters ? applyQuarters(result.confidence, quarters) : result.confidence,
        uncertain: moved ? result.uncertain.map((index) => moved[index]) : result.uncertain,
        faceColors,
        notice: describeRepair(repair?.corrected ?? []),
      });
    },
    [captures, step, stepIndex, onComplete, stop],
  );

  /**
   * One look at the viewfinder.
   *
   * Held in a ref so the polling interval never has to be torn down and rebuilt
   * as state changes — restarting it would throw away the run of settled frames
   * that the capture depends on.
   */
  const inspect = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const samples = sampleVideoFrame(videoRef.current, canvasRef.current);
    if (!samples) return;

    setPreview(samples);

    if (performance.now() < pausedUntilRef.current) return;

    const frames = [...framesRef.current, samples].slice(-8);
    framesRef.current = frames;

    if (!isLitWellEnough(samples)) {
      setGuidance({ kind: 'dark' });
      return;
    }

    // Checked before steadiness, so a user resting on a face they have already
    // done is told to move on rather than watching a countdown that never fires.
    const alreadyHave = matchCapturedFace(samples, captures);
    if (alreadyHave) {
      setGuidance({
        kind: 'repeat',
        stepNumber: SCAN_STEPS.findIndex((s) => s.face === alreadyHave) + 1,
      });
      return;
    }

    const settled = steadiness(frames);
    if (!isSteady(frames)) {
      setGuidance({ kind: settled > 0 ? 'holding' : 'moving', progress: settled });
      return;
    }

    commit(samples);
  }, [captures, commit]);

  const inspectRef = useRef(inspect);
  useEffect(() => {
    inspectRef.current = inspect;
  });

  useEffect(() => {
    if (camera.status !== 'live') return;
    const timer = window.setInterval(() => inspectRef.current(), TICK_MS);
    return () => window.clearInterval(timer);
  }, [camera.status]);

  const captureNow = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const samples = sampleVideoFrame(videoRef.current, canvasRef.current);
    if (samples) commit(samples);
  }, [commit]);

  const toggleTorch = useCallback(async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ torch: !torchOn } as MediaTrackConstraintSet & { torch: boolean }],
      });
      setTorchOn((on) => !on);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const retakeAll = useCallback(() => {
    setCaptures({});
    setStepIndex(0);
    framesRef.current = [];
    pausedUntilRef.current = 0;
  }, []);

  if (camera.status !== 'live') {
    return <CameraFallback state={camera} onRetry={() => void start()} onCancel={onCancel} />;
  }

  const status = describeGuidance(guidance);

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted autoPlay className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {/* Tapping anywhere takes the shot immediately: an escape hatch for a
            cube the auto-capture cannot settle on, such as one held against a
            busy background. */}
        <button
          type="button"
          onClick={captureNow}
          aria-label="Capture this face now"
          className="absolute inset-0 z-10 cursor-pointer"
        />

        {/* 3x3 alignment guide, sized to match the sampler's region. */}
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div
            className="relative rounded-xl p-1 transition-colors duration-150"
            style={{ width: 'min(72vw, 72vh, 420px)', boxShadow: `0 0 0 3px ${status.frame}` }}
          >
            <div className="grid aspect-square grid-cols-3 grid-rows-3 gap-[2px]">
              {Array.from({ length: 9 }, (_, i) => (
                <div
                  key={i}
                  className="rounded-sm border-2 border-white/70"
                  style={{
                    backgroundColor: preview ? rgbToCss(preview[i].rgb) : 'transparent',
                    opacity: preview ? 0.55 : 1,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Instruction band */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <p className="text-center text-sm font-semibold text-white sm:text-base">
            {step.instruction}
          </p>
          <p className="mt-1 text-center text-xs text-white/75">{step.detail}</p>
          <p className="mt-1 text-center text-[11px] font-medium uppercase tracking-wide text-white/50">
            Face {stepIndex + 1} of {SCAN_STEPS.length}
          </p>
        </div>

        {/* Live status, just below the guide where the eye already is. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex flex-col items-center gap-2 px-4">
          <p
            aria-live="polite"
            className={`rounded-full px-4 py-1.5 text-center text-sm font-semibold ${status.pill}`}
          >
            {status.message}
          </p>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-100"
              style={{ width: `${Math.round(status.progress * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-white/50">Shoots by itself · tap to shoot now</p>
        </div>
      </div>

      {/* Controls */}
      <div className="z-20 flex flex-col gap-3 bg-slate-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center justify-center gap-2">
          {SCAN_STEPS.map((s, i) => {
            // Fill each dot with the centre colour actually seen, so progress
            // reflects the user's cube rather than a scheme it may not use.
            const centre = captures[s.face]?.[4];
            return (
              <span
                key={s.face}
                aria-label={`Face ${i + 1} ${captures[s.face] ? 'captured' : 'not captured'}`}
                className={`h-2.5 rounded-full transition-all ${i === stepIndex ? 'w-6' : 'w-2.5'}`}
                style={{
                  backgroundColor: centre
                    ? rgbToCss(centre.rgb)
                    : i === stepIndex
                      ? '#ffffff'
                      : '#334155',
                }}
              />
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl px-4 text-sm font-medium text-slate-300 active:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={retakeAll}
            className="min-h-11 flex-1 rounded-xl px-4 text-sm font-medium text-slate-300 active:bg-slate-800"
          >
            Start over
          </button>

          {torchAvailable && (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-medium ${
                torchOn ? 'bg-amber-400 text-slate-900' : 'text-slate-300 active:bg-slate-800'
              }`}
            >
              Light
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Turn the scanner's internal state into something worth reading. */
function describeGuidance(guidance: Guidance): {
  message: string;
  progress: number;
  pill: string;
  frame: string;
} {
  switch (guidance.kind) {
    case 'dark':
      return {
        message: 'Too dark to read the colors',
        progress: 0,
        pill: 'bg-slate-900/85 text-slate-200',
        frame: 'rgba(148,163,184,0.7)',
      };
    case 'repeat':
      return {
        message: `Face ${guidance.stepNumber} again — turn to one you haven't done`,
        progress: 0,
        pill: 'bg-amber-400 text-slate-950',
        frame: 'rgba(251,191,36,0.95)',
      };
    case 'moving':
      return {
        message: 'Line the cube up with the square',
        progress: guidance.progress,
        pill: 'bg-slate-900/85 text-slate-200',
        frame: 'rgba(255,255,255,0.6)',
      };
    case 'holding':
      return {
        message: 'Hold it there…',
        progress: guidance.progress,
        pill: 'bg-slate-900/85 text-white',
        frame: 'rgba(52,211,153,0.8)',
      };
    case 'captured':
      return {
        message: 'Got it',
        progress: 1,
        pill: 'bg-emerald-400 text-slate-950',
        frame: 'rgba(52,211,153,1)',
      };
  }
}

function CameraFallback({
  state,
  onRetry,
  onCancel,
}: {
  state: CameraState;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const content = (() => {
    switch (state.status) {
      case 'starting':
        return { title: 'Starting the camera…', body: null, retry: false };
      case 'denied':
        return {
          title: 'Camera permission denied',
          body: 'Allow camera access for this site in your browser settings, then try again. You can also enter the colors by hand.',
          retry: true,
        };
      case 'insecure':
        return {
          title: 'Camera needs a secure connection',
          body: 'Browsers only allow camera access over HTTPS. Open this page via its https:// address, or enter the colors by hand.',
          retry: false,
        };
      case 'unavailable':
        return { title: 'No camera available', body: state.reason, retry: true };
      default:
        return { title: 'Preparing…', body: null, retry: false };
    }
  })();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-lg font-semibold text-white">{content.title}</h2>
      {content.body && <p className="max-w-sm text-sm text-slate-400">{content.body}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {content.retry && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-xl bg-white px-5 text-sm font-semibold text-slate-900"
          >
            Try again
          </button>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 rounded-xl border border-slate-700 px-5 text-sm font-medium text-slate-200"
        >
          Enter colors by hand
        </button>
      </div>
    </div>
  );
}
