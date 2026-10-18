# Cube Solver

A browser-based Rubik's cube solver for **2×2 and 3×3 cubes**. Scan all six faces with your camera or enter the colors by hand, check the detected stickers, and follow an animated solution on an interactive 3D cube.

## Features

- Guided six-face camera scanning, starting on any face.
- Automatic capture when the view settles, with a manual capture option.
- Color classification that adapts to the scanned cube, with uncertain stickers highlighted for review.
- Editable facelet net and validity checks before solving.
- Local 2×2 search and a Kociemba two-phase solver for 3×3 cubes.
- Animated playback with play/pause, forward/backward steps, move selection, reset, and speed controls.
- Drag-to-rotate and pinch-to-zoom 3D view, with a mobile-first layout.
- Random cube demos for trying the solver without a physical cube or camera.

Camera image processing and cube solving run on your device in the browser. No image upload or external solver API is required.

## Getting started

Install **Node.js 24.x** and npm. The test runner supports Node.js `^22.12.0 || ^24.0.0 || >=26.0.0`. Use a modern browser with WebGL support; scanning also requires a camera and camera permission.

```bash
git clone https://github.com/MidhlajAm/Cube-Solver.git
cd Cube-Solver
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). No environment variables, database, or API keys are required.

### Camera access on a phone

Browsers require a secure context for camera access. Localhost works for local development, but a plain HTTP address on your LAN generally does not.

For an HTTPS development server bound to your network interfaces:

```bash
npm run dev:https
```

Next.js generates a development certificate; your device must trust it for reliable secure-context camera access.

Alternatively, start the app and a temporary Cloudflare HTTPS tunnel together:

```bash
npm run dev:tunnel
```

Open the HTTPS URL printed by Cloudflare on your phone. This exposes the development server publicly while the tunnel runs. If the app is already running, use `npm run tunnel` to start only the tunnel. The tunnel requires internet access and the bundled `cloudflared` executable.

## Using the solver

1. Select **2×2** or **3×3**.
2. Choose **Scan with camera**, **Enter colors by hand**, or **Try a random cube**.
3. When scanning, align the face with the grid and follow the rotation prompts through all six faces. Turn the whole cube between captures without twisting individual layers. Use even lighting and avoid glare.
4. Review the flat cube net. Tap incorrect stickers to change their colors; amber rings mark uncertain readings. Resolve any validation errors before solving.
5. Select **Solve**, then follow the move list and 3D animation. Pause, step backward or forward, change speed, or jump to a move as needed.

Moves use standard face notation: `U`, `R`, `F`, `D`, `L`, and `B`. A plain letter is a clockwise quarter turn when looking directly at that face; `'` means counterclockwise, and `2` means a half turn.

Scanning quality depends on lighting, alignment, and consistent cube orientation. The solver supports standard six-color 2×2 and 3×3 cubes; other puzzle sizes and shapes are not supported.

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run dev:https` | Start HTTPS development on all network interfaces |
| `npm run dev:tunnel` | Start development and a Cloudflare tunnel |
| `npm run tunnel` | Tunnel an existing server on port 3000 |
| `npm run build` | Create a production build |
| `npm start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |

For production, run `npm run build` followed by `npm start`, and serve the app over HTTPS for camera access. The build uses `next/font/google` for Geist fonts, so it needs access to Google's font service.

### Stack and architecture

- **Next.js 16 App Router**, **React 19**, and **TypeScript** provide the application shell.
- **Tailwind CSS 4** styles the responsive interface.
- **Three.js**, **React Three Fiber**, and **Drei** render the interactive cube.
- **Zustand** holds the scanned state, validation, solution, and playback position.
- **Vitest** covers cube geometry and moves, validity, color classification, scanning guidance, playback, and solvers.

```text
src/app/                  Application shell and global styles
src/components/scanner/   Camera flow, scanning prompts, and facelet editor
src/components/cube3d/    Interactive cube rendering and move animation
src/components/player/    Solution playback controls
src/lib/cube/             Facelets, moves, orientation, and validity checks
src/lib/vision/           Sampling, color classification, and auto-capture logic
src/lib/solver/           Solver client and 2×2 meet-in-the-middle search
src/store/                Shared application and playback state
public/solver/            Vendored 3×3 solver and its Web Worker
tests/                    Automated test suite
```

The 3×3 solver builds lookup tables in a Web Worker to keep the interface responsive. The 2×2 solver runs a local meet-in-the-middle search, using a fixed corner as its orientation reference. Playback derives each displayed state from the original cube and the moves already applied.

## License

Copyright (C) 2026 Cube Solver contributors.

Except for separately licensed third-party material, Cube Solver is free software licensed under the **GNU General Public License, version 3 or (at your option) any later version** (`GPL-3.0-or-later`). You may redistribute and modify it under those terms. It is provided without any warranty. See [LICENSE](LICENSE) for the complete license text.

The vendored 3×3 solver files, `public/solver/cube.js` and `public/solver/solve.js`, retain their **MIT license**, credited to Petri Lehtinen and Ludovic Fernandez. See [public/solver/LICENSE](public/solver/LICENSE). Other dependencies retain their respective licenses.
