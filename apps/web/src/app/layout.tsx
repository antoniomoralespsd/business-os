import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import { THEME_BOOT_SCRIPT } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: 'Business OS',
  description: 'Sistema interno de Iris Design',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.ico', apple: '/apple-icon.png' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f3f1' },
    { media: '(prefers-color-scheme: dark)', color: '#0d0d0e' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: '!rounded-[10px] !border !border-line !bg-surface !text-ink !shadow-[var(--shadow-pop)] !font-sans',
              description: '!text-ink-2',
              actionButton: '!bg-ink !text-on-ink !rounded-[4px]',
            },
          }}
        />
      </body>
    </html>
  );
}
