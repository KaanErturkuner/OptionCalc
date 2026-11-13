/*
 * Akış (FLOW) — ortak tipler, varsayılanlar ve biçimlendirme. Saf: React / Node yerleşik modülü YOK.
 * Sunucu (server/) ve uygulama aynı tanımları kullanır. Ayrıntılı spec: docs/tasks/FLOW.md
 */
export const FLOW_BASE_URL = 'https://162-243-88-42.sslip.io';
export const DEFAULT_TICKERS = ['QQQ', 'SPY', 'NVDA', 'GLD', 'SLV', 'MU', 'INTC'];
export const MARKET_MINUTES = 390; // 09:30–16:00 ET

/** Olağandışılık eşikleri (sunucu env ile ayarlanır; burada varsayılanlar) */
export interface FlowThresholds {
  minPremium: number;    // USD: dV × mid × 100 alt sınırı
  minVolume: number;     // dV (kontrat) alt sınırı
  minVolOi: number;      // dV ≥ oran × OI (yeni pozisyon sezgisi)
  minMid: number;        // altındaki kontratlar gürültü sayılır
  maxSpreadPct: number;  // (ask−bid)/mid üstü → "geniş spread": güven düşük, push yok
}
export const DEFAULT_THRESHOLDS: FlowThresholds = { minPremium: 25000, minVolume: 200, minVolOi: 0.5, minMid: 0.05, maxSpreadPct: 0.3 };

export interface FlowEvent {
  id: number; ts: number; day: string; ticker: string; occ: string; expiry: string;
  side: 'call' | 'put'; strike: number;
  dv: number;          // poll aralığındaki hacim artışı (kontrat)
  volume: number;      // günlük kümülatif hacim
  oi: number; bid: number; ask: number; mid: number;
  prem: number;        // tahmini prim, USD
  volOi: number;       // dV / OI
  confirmed: boolean;  // canlı (live) quote ile teyit edildi mi
  wide: boolean;       // geniş spread → düşük güven
  pushed: boolean;
  underlying: number | null;
}
export interface FlowSummaryRow { ticker: string; callPrem: number; putPrem: number; events: number }

/** İstanbul saati (UTC+3, yaz saati yok): GG.AA SS:DD */
export function fmtIst(ms: number): string {
  const d = new Date(ms + 3 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** Yalnız saat, İstanbul: SS:DD (gün başlığı altında kullanılır) */
export function fmtIstTime(ms: number): string {
  const d = new Date(ms + 3 * 3600000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
/** Kısa USD: 12.500 $ / 1,25 M$ (tr-TR ondalık virgül) */
export function fmtUsdShort(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2).replace('.', ',')} M$`;
  if (a >= 1e3) return `${sign}${Math.round(a / 1e3)} bin $`;
  return `${sign}${Math.round(a)} $`;
}
const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
/** Okunabilir kontrat etiketi: QQQ 14 Kas 585 C */
export function contractLabel(e: Pick<FlowEvent, 'ticker' | 'expiry' | 'strike' | 'side'>): string {
  const [, m, d] = e.expiry.split('-').map(Number);
  return `${e.ticker} ${d} ${MON[m - 1] ?? ''} ${e.strike} ${e.side === 'call' ? 'C' : 'P'}`;
}
