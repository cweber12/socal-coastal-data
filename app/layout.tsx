import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tide windows — Oceanside to Border Field',
  description:
    'Daylight low-tide windows for reef and tidepool spots in the San Diego corridor, computed from NOAA CO-OPS predictions and gated on NDBC swell.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-[var(--surface-raised)] focus:px-3 focus:py-2 focus:text-sm"
        >
          Skip to content
        </a>

        <header className="border-b border-[var(--border)] bg-[var(--surface-sunken)]">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-3 wide:px-5">
            <Link
              href="/"
              className="text-[0.95rem] font-semibold tracking-tight no-underline"
            >
              Tide windows
            </Link>
            <span className="text-xs text-[var(--text-dimmer)]">
              Oceanside Harbor → Border Field
            </span>
          </div>
        </header>

        <main id="content" className="mx-auto max-w-[1400px] px-3 py-4 wide:px-5 wide:py-6">
          {children}
        </main>

        <footer className="mx-auto max-w-[1400px] px-3 pt-2 pb-10 text-xs leading-relaxed text-[var(--text-dimmer)] wide:px-5">
          <p>
            Tide predictions: NOAA CO-OPS, datum MLLW, feet. Swell: NDBC realtime2,
            significant wave height. Predictions are astronomical and do not
            include weather-driven surge.
          </p>
          <p className="mt-1">
            Reef floors and swell ceilings are <strong>uncalibrated author
            estimates</strong>. They have not been field-checked. Do not use this
            page to decide whether a cliff-access ledge is safe.
          </p>
        </footer>
      </body>
    </html>
  );
}
