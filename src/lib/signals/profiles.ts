/* Ticker profilleri: piyasa rejimi, sektör/akış, OTM kuralı, DTE, giriş penceresi. Saf.
 * Eşikler (minOi, minVol, maxSpreadPct, macro, earnings) varsayılandır; Aşama 6 kalibrasyonuyla değişir. */
import type { OtmRule } from './otm.ts';

export type Kind = 'endeks-etf' | 'hisse' | 'emtia-etf' | 'diger-etf';
export interface Link { sym: string; sign: 1 | -1 }
export interface TickerProfile {
  ticker: string; kind: Kind; regime: Link[]; sector: Link[]; otm: OtmRule;
  dte: [number, number]; window: [number, number];
  minOi: number; minVol: number; maxSpreadPct: number; macro: boolean; earnings: boolean;
}

export const ETF_SET = new Set(['QQQ', 'SPY', 'IWM', 'GLD', 'SLV', 'SMH', 'IGV', 'ARKX', 'UFO', 'DRAM', 'UUP', 'TLT', 'GDX', 'SIL']);
/** Hisse → sektör ETF'leri. NBIS ve GLW: SMH + QQQ (Kaan 2026-11-13: ikisine de bakılsın). Radar'ın kendi tablosu değişmedi. */
export const SECTOR: Record<string, string[]> = {
  MU: ['SMH'], INTC: ['SMH'], AMD: ['SMH'], AXTI: ['SMH'], AAOI: ['SMH'], MRVL: ['SMH'], NVDA: ['SMH'], DRAM: ['SMH'],
  NBIS: ['SMH', 'QQQ'], GLW: ['SMH', 'QQQ'], CRWV: ['QQQ'], TSLA: ['QQQ'], RKLB: ['UFO'], SPCX: ['UFO'],
};
const BASE = { minOi: 100, minVol: 50, maxSpreadPct: 8, macro: false, earnings: false };
const W03: [number, number] = [0, 3];
const WIN: [number, number] = [585, 780]; // 09:45–13:00 ET, dakika

const PROFILES: Record<string, TickerProfile> = {
  QQQ: { ticker: 'QQQ', kind: 'endeks-etf', regime: [{ sym: 'SPY', sign: 1 }, { sym: 'QQQ', sign: 1 }], sector: [{ sym: 'SMH', sign: 1 }, { sym: '^VIX', sign: -1 }],
    otm: { mode: 'sabit', k: 0.45 }, dte: [0, 1], window: WIN, ...BASE, macro: true },
  NVDA: { ticker: 'NVDA', kind: 'hisse', regime: [{ sym: 'QQQ', sign: 1 }, { sym: 'SPY', sign: 1 }], sector: [{ sym: 'SMH', sign: 1 }],
    otm: { mode: 'oto', k0: 1.0, kMin: 0.4, kMax: 2.0 }, dte: W03, window: WIN, ...BASE, earnings: true },
  GLD: { ticker: 'GLD', kind: 'emtia-etf', regime: [{ sym: 'UUP', sign: -1 }, { sym: 'TLT', sign: 1 }], sector: [{ sym: 'GDX', sign: 1 }],
    otm: { mode: 'oto', k0: 0.6, kMin: 0.3, kMax: 1.2 }, dte: W03, window: WIN, ...BASE, macro: true },
  SLV: { ticker: 'SLV', kind: 'emtia-etf', regime: [{ sym: 'UUP', sign: -1 }, { sym: 'GLD', sign: 1 }], sector: [{ sym: 'SIL', sign: 1 }],
    otm: { mode: 'oto', k0: 0.7, kMin: 0.3, kMax: 1.4 }, dte: W03, window: WIN, ...BASE, maxSpreadPct: 12, macro: true },
};
const STOCK_OTM: Record<string, OtmRule> = { MU: { mode: 'sabit', k: 1.8 }, INTC: { mode: 'sabit', k: 1.8 } };

/** Bir ticker için profil. Tanımsız hisse/ETF'ler için genel kurallar. */
export function profileFor(t: string): TickerProfile {
  const p = PROFILES[t];
  if (p) return p;
  if (ETF_SET.has(t)) return { ticker: t, kind: 'diger-etf', regime: [{ sym: 'SPY', sign: 1 }], sector: [],
    otm: { mode: 'oto', k0: 0.5, kMin: 0.3, kMax: 1.2 }, dte: W03, window: WIN, ...BASE };
  const sec = SECTOR[t] ?? [];
  return { ticker: t, kind: 'hisse', regime: [{ sym: 'QQQ', sign: 1 }, { sym: 'SPY', sign: 1 }], sector: sec.map(sym => ({ sym, sign: 1 as const })),
    otm: STOCK_OTM[t] ?? { mode: 'oto', k0: 1.0, kMin: 0.4, kMax: 2.0 }, dte: W03, window: WIN, ...BASE, earnings: true };
}

/** Listedeki tickerların ihtiyaç duyduğu yardımcı semboller (kendileri hariç, tekil) */
export function auxSymbols(tickers: string[]): string[] {
  const out = new Set<string>();
  for (const t of tickers) {
    const p = profileFor(t);
    for (const l of [...p.regime, ...p.sector]) if (l.sym !== t) out.add(l.sym);
  }
  return [...out];
}
