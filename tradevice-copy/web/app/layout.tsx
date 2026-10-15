import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = {
  title: 'Tradevice Copy | Paper Research',
  description: 'Portal riset copy trading. Tidak menerima dana atau mengeksekusi transaksi live.',
  robots: { index: false, follow: false },
  applicationName: 'Tradevice',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Tradevice', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icon.svg?v=sharp-20261015', type: 'image/svg+xml' }],
    shortcut: '/icon.svg?v=sharp-20261015',
    apple: [{ url: '/icons/tradevice-180-v2.png', sizes: '180x180', type: 'image/png' }],
  },
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
