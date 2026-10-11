import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = {
  title: 'Tradevice Copy | Paper Research',
  description: 'Portal riset copy trading. Tidak menerima dana atau mengeksekusi transaksi live.',
  robots: { index: false, follow: false },
  icons: { icon: [{ url: '/icon.svg?v=orange-20261012', type: 'image/svg+xml' }], shortcut: '/icon.svg?v=orange-20261012' },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0D0F14',
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="id"><body>{children}</body></html>;
}
