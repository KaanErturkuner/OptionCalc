/* Sembol + şirket adı sözlüğü: haber metninden ticker eşleme */
export const NAMES: Record<string, string[]> = {
  MU: ['Micron'], AMD: ['Advanced Micro'], INTC: ['Intel'], AXTI: ['AXT Inc'], AAOI: ['Applied Optoelectronics'],
  MRVL: ['Marvell'], NVDA: ['Nvidia'], DRAM: ['Roundhill Memory'], GLW: ['Corning'], NBIS: ['Nebius'], CRWV: ['CoreWeave'],
  TSLA: ['Tesla'], RKLB: ['Rocket Lab'], SPCX: [], QQQ: ['Nasdaq-100'], SPY: ['S&P 500'], IWM: ['Russell 2000'],
  SMH: ['semiconductor ETF'], GLD: [], SLV: [], IGV: ['software ETF'], ARKX: [], UFO: [],
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Metinde geçen evren tickerları. Sembol büyük harfle (AMD gibi), şirket adı büyük/küçük harf duyarsız eşleşir. */
export function tickersIn(text: string, universe: string[]): string[] {
  const out: string[] = [];
  for (const t of universe) {
    const bySym = new RegExp(`(^|[^A-Za-z])${esc(t)}([^A-Za-z]|$)`).test(text);
    const byName = (NAMES[t] ?? []).some(n => new RegExp(`\\b${esc(n.replace(/,$/, ''))}\\b`, 'i').test(text));
    if (bySym || byName) out.push(t);
  }
  return out;
}
