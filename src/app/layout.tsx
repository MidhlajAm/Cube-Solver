import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Cube Solver',
  description:
    "Show your Rubik's cube to the camera and get the solution, played back move by move on a 3D cube.",
};

export const viewport: Viewport = {
  themeColor: '#020617',
  // The scanner and player sit against the bottom edge, so the page needs to
  // reach under the phone's home indicator and read the safe-area insets.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
  // The cube canvas handles its own pinch-zoom; page zoom on top of it makes
  // dragging the cube unreliable.
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
