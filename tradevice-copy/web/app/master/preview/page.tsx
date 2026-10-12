import { redirect } from 'next/navigation';

// Synthetic preview has been retired. Use the authenticated staging console.
// No fabricated equity, trades, signals, or events are ever rendered here.
export const metadata = {
  title: 'Master Trader | Tradevice',
  robots: { index: false, follow: false },
};
export default function RetiredMasterPreview() {
  redirect('/master');
}
