import type { Metadata, Viewport } from 'next';
import { Toaster } from 'sonner';
import './globals.css';

export const metadata: Metadata = {
  title: 'Business OS',
  description: 'Sistema interno de Iris Design',
  manifest: './manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#f4f3f1', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        {children}
        <Toaster
          position="bottom-right"
          toastOptions={{
            classNames: {
              toast: '!rounded-[10px] !border !border-line !bg-surface !text-ink !shadow-[var(--shadow-pop)] !font-sans',
              description: '!text-ink-2',
              actionButton: '!bg-ink !text-white !rounded-[4px]',
            },
          }}
        />
      </body>
    </html>
  );
}
