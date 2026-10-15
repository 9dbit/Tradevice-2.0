import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
export const metadata: Metadata = {
  title: 'Tradevice Copy | Paper Research',
  description: 'Portal riset copy trading. Tidak menerima dana atau mengeksekusi transaksi live.',
  robots: { index: false, follow: false },
  applicationName: 'Tradevice',
  manifest: '/manifest.webmanifest',
  openGraph: { images: [{ url: 'https://copy-web-staging.up.railway.app/icons/tradevice-512-v3.png', width: 512, height: 512, alt: 'Tradevice' }] },
  appleWebApp: { capable: true, title: 'Tradevice', statusBarStyle: 'black-translucent' },
  icons: {
    icon: [{ url: '/icons/tradevice-48-v3.png', sizes: '48x48', type: 'image/png' }, { url: '/icons/tradevice-192-v3.png', sizes: '192x192', type: 'image/png' }],
    shortcut: '/icons/tradevice-48-v3.png',
    apple: [{ url: '/icons/tradevice-180-v3.png', sizes: '180x180', type: 'image/png' }],
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
