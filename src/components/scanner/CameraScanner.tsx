'use client';

/**
 * Camera capture of the six faces.
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
import { rgbToCss } from '@/lib/vision/color';
import { sampleVideoFrame, type StickerSample } from '@/lib/vision/sampler';
import { classifyFacelets } from '@/lib/vision/classify';
import { paletteFromCenters } from '@/lib/vision/palette';
import { SCAN_STEPS } from './scanSteps';

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

  // Starts as 'starting' because the effect below opens the camera on mount.
  const [camera, setCamera] = useState<CameraState>({ status: 'starting' });
  const [stepIndex, setStepIndex] = useState(0);
  const [captures, setCaptures] = useState<Partial<Record<Face, StickerSample[]>>>({});
  const [preview, setPreview] = useState<StickerSample[] | null>(null);
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

  // Live preview of what the sampler is reading, so the user can see the guide
  // is lined up before committing a face.
  useEffect(() => {
    if (camera.status !== 'live') return;
    const timer = window.setInterval(() => {
      if (!videoRef.current || !canvasRef.current) return;
      setPreview(sampleVideoFrame(videoRef.current, canvasRef.current));
    }, 180);
    return () => window.clearInterval(timer);
  }, [camera.status]);

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

  const capture = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const samples = sampleVideoFrame(videoRef.current, canvasRef.current);
    if (!samples) return;

    const next = { ...captures, [step.face]: samples };
    setCaptures(next);

    if (stepIndex < SCAN_STEPS.length - 1) {
      setStepIndex(stepIndex + 1);
      return;
    }

    // All six faces captured. Classification needs them together: the centers
    // act as reference colors and the nine-of-each-color rule is applied across
    // the whole cube at once.
    const ordered = FACES.flatMap((face) => next[face] ?? []);
    if (ordered.length !== 54) return;

    const result = classifyFacelets(ordered);

    // The face the user started on is arbitrary, so the built-in colour scheme
    // is not the right thing to draw with. Take the palette from what was
    // actually scanned, or the net will not match the cube in their hands.
    const faceColors = paletteFromCenters(
      Object.fromEntries(FACES.map((face) => [face, next[face]![4].rgb])),
    );

    // A face held a quarter turn out does not look wrong — it makes the cube
    // impossible, and the resulting complaint is about corners, not about grip.
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
  }, [captures, step, stepIndex, onComplete, stop]);

  const retakeAll = useCallback(() => {
    setCaptures({});
    setStepIndex(0);
  }, []);

  if (camera.status !== 'live') {
    return (
      <CameraFallback
        state={camera}
        onRetry={() => void start()}
        onCancel={onCancel}
      />
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-full w-full object-cover"
        />
        <canvas ref={canvasRef} className="hidden" />

        {/* 3x3 alignment guide, sized to match the sampler's region. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="relative grid aspect-square grid-cols-3 grid-rows-3 gap-[2px] rounded-lg"
            style={{ width: 'min(72vw, 72vh, 420px)' }}
          >
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

        {/* Instruction band */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <p className="text-center text-sm font-semibold text-white sm:text-base">
            {step.instruction}
          </p>
          <p className="mt-1 text-center text-xs text-white/75">{step.detail}</p>
          <p className="mt-1 text-center text-[11px] font-medium uppercase tracking-wide text-white/50">
            Face {stepIndex + 1} of {SCAN_STEPS.length}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-3 bg-slate-950 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex items-center justify-center gap-2">
          {SCAN_STEPS.map((s, i) => {
            // Fill each dot with the centre colour actually seen, so progress
            // reflects the user's cube rather than a scheme it may not use.
            const centre = captures[s.face]?.[4];
            return (
              <span
                key={s.face}
                aria-label={`Face ${i + 1} ${captures[s.face] ? 'captured' : 'not captured'}`}
                className={`h-2.5 rounded-full transition-all ${
                  i === stepIndex ? 'w-6' : 'w-2.5'
                }`}
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
            className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-300 active:bg-slate-800"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={capture}
            className="min-h-14 flex-1 rounded-xl bg-white text-base font-semibold text-slate-900 active:bg-slate-200"
          >
            Capture
          </button>

          {torchAvailable ? (
            <button
              type="button"
              onClick={() => void toggleTorch()}
              aria-pressed={torchOn}
              className={`min-h-11 rounded-xl px-4 text-sm font-medium ${
                torchOn ? 'bg-amber-400 text-slate-900' : 'text-slate-300 active:bg-slate-800'
              }`}
            >
              Light
            </button>
          ) : (
            <button
              type="button"
              onClick={retakeAll}
              className="min-h-11 rounded-xl px-4 text-sm font-medium text-slate-300 active:bg-slate-800"
            >
              Restart
            </button>
          )}
        </div>
      </div>
    </div>
  );
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
