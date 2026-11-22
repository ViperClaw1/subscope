import type { Item } from './types';

/** Integer-only: 15199 → "151.99". No float, no Intl (Hermes Intl varies by build). */
export function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export const monthlyTotalMinor = (items: Item[]) =>
  items.filter((i) => i.cadence === 'monthly').reduce((sum, i) => sum + i.amountMinor, 0);

// lastSeen stays the server's "YYYY-MM-DD" string: new Date('2026-10-01') shows Sep 30 west of UTC.
