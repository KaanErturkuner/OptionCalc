/*
 * İşlem bağlamı (saf): dayanak mumları (Yahoo 1 dk), VWAP, tutma/çıkış sonrası hareket, OTM / beklenen hareket oranı,
 * opsiyon P/L tahmini (Black-Scholes, kalibre: gerçek giriş primi + model değişimi). Tüm sayılar burada hesaplanır;
 * model yalnız yorum yazar. Pencereleme ve veri eksiği listesi de burada.
 */
import { aggregate, afterExitMove, barAt, openOf, sessionBars, vwapAt, type Bar } from './bars.ts';
import { istHm, istToMs, etMinutesOf } from './time.ts';
import { ruleFacts, premiumPct } from './rules.ts';
import type { ExtractedTrade, RuleFact } from './types.ts';
import { price as bsPrice } from '../bs.ts';
import { closeMs } from '../usmarket.ts';

export const MAX_CANDLES = 40;
export const PRE_MIN = 60, POST_MIN = 120;
export const BS_SIGMA = 0.45;   // varsayılan IV (tahmin; gerçek IV yok)
export const BS_RATE = 0.04;
export const MIN_T_YEARS = 1 / (365 * 24 * 60); // ~1 dk

export interface FlowLite { ts: number; side: 'call' | 'put'; strike: number; expiry: string; prem: number; dv: number; confirmed: boolean }
export interface WallsLite { callWall?: number | null; putWall?: number | null; gammaFlip?: number | null; maxPain?: number | null; spot?: number | null; expiry?: string | null }

/** Sayısal bağlam: rapor kartları bunu doğrudan kullanır (model değil) */
export interface TradeNumbers {
  sBefore: number | null; sEntry: number | null; sExit: number | null;
  holdHigh: number | null; holdLow: number | null; holdFavPct: number | null; holdFavAt: string | null;
  afterFavPct: number | null; afterAgainstPct: number | null; afterAt15: number | null; afterAt30: number | null; afterAt60: number | null;
  vwapEntry: number | null; vwapDistPct: number | null;
  otmPct: number | null; otmPerEm: number | null; sigma1mPct: number | null;
  /** Opsiyon primi tahmini (BS kalibreli), brüt, komisyonsuz; etiket: tahmini */
  optHoldFav: number | null; optAfterFav: number | null;
}

export interface TradeContext {
  rules: RuleFact[];
  facts: Record<string, unknown>;
  nums: TradeNumbers;
  noData: string[];
}

const pct = (a: number, b: number) => +((a / b - 1) * 100).toFixed(3);
const r2 = (x: number) => +x.toFixed(2);

/** BS fiyatı (dolar): t anında underlying S, kalan süre T (yıl) */
function bsAt(side: 'CALL' | 'PUT', S: number, K: number, T: number): number {
  return bsPrice(side === 'CALL' ? 'call' : 'put', S, K, Math.max(T, MIN_T_YEARS), BS_RATE, 0, BS_SIGMA);
}

/** Kalibre opsiyon tahmini: gerçek giriş primi + (BS(S_ext,T_ext) − BS(S_giriş,T_giriş)) */
export function optionEstimate(a: { side: 'CALL' | 'PUT'; K: number; entryPrice: number; sEntry: number; tEntryMin: number; sExt: number; tExtMin: number }): number {
  const yr = (m: number) => Math.max(m, 1) / (365 * 24 * 60);
  const base = bsAt(a.side, a.sEntry, a.K, yr(a.tEntryMin));
  const ext = bsAt(a.side, a.sExt, a.K, yr(a.tExtMin));
  return +(a.entryPrice + (ext - base)).toFixed(2);
}

/** 1 dk log-getirilerinin std'si (%) */
export function sigma1mPct(bars: Bar[]): number | null {
  if (bars.length < 10) return null;
  const r: number[] = [];
  for (let i = 1; i < bars.length; i++) if (bars[i - 1].c > 0) r.push(Math.log(bars[i].c / bars[i - 1].c));
  const m = r.reduce((a, b) => a + b, 0) / r.length;
  const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(r.length - 1, 1);
  return +(Math.sqrt(v) * 100).toFixed(4);
}

export function buildTradeContext(a: {
  trade: ExtractedTrade; bars: Bar[]; day: string; walls?: WallsLite | null; flow?: FlowLite[]; nowMs: number;
}): TradeContext {
  const { trade, bars, day } = a;
  const rules = ruleFacts(trade, a.nowMs);
  const noData: string[] = [];
  const entryMs = istToMs(trade.entryTime), exitMs = istToMs(trade.exitTime);
  const closed = trade.status === 'kapali' && exitMs != null;
  const session = sessionBars(bars, day);
  if (!session.length) noData.push('dayanak seans mumları (Yahoo)');
  const at = (ms: number | null) => (ms == null ? null : barAt(session, ms));
  const nums: TradeNumbers = {
    sBefore: null, sEntry: null, sExit: null, holdHigh: null, holdLow: null, holdFavPct: null, holdFavAt: null,
    afterFavPct: null, afterAgainstPct: null, afterAt15: null, afterAt30: null, afterAt60: null,
    vwapEntry: null, vwapDistPct: null, otmPct: null, otmPerEm: null, sigma1mPct: null, optHoldFav: null, optAfterFav: null,
  };
  const eBar = at(entryMs);
  if (eBar) nums.sEntry = r2(eBar.c);
  if (entryMs != null) { const b = at(entryMs - 15 * 60000); if (b) nums.sBefore = r2(b.c); }
  if (closed) { const x = at(exitMs); if (x) nums.sExit = r2(x.c); }

  if (session.length && entryMs != null) {
    nums.vwapEntry = vwapAt(session, entryMs);
    if (nums.vwapEntry && nums.sEntry) nums.vwapDistPct = +pct(nums.sEntry, nums.vwapEntry).toFixed(3);
    nums.sigma1mPct = sigma1mPct(session.filter(b => b.t <= entryMs));
  }

  // OTM ve beklenen hareket: otm% = |K/S − 1|; EM = σ_1dk × √(girişten kapanışa dk)
  if (nums.sEntry && entryMs != null) {
    const otm = Math.abs(pct(trade.strike, nums.sEntry));
    nums.otmPct = +otm.toFixed(3);
    const closeM = closeMs(trade.expiry);
    const minsLeft = closeM ? Math.max((closeM - entryMs) / 60000, 1) : null;
    if (nums.sigma1mPct && minsLeft) nums.otmPerEm = +(otm / (nums.sigma1mPct * Math.sqrt(minsLeft))).toFixed(2);
  }

  // Tutma süresi (giriş–çıkış): en lehe uç (CALL: en yüksek, PUT: en düşük) ve zamanı
  const sign = trade.side === 'CALL' ? 1 : -1;
  const hold = entryMs != null && closed ? session.filter(b => b.t >= entryMs && b.t <= (exitMs as number)) : [];
  if (hold.length && nums.sEntry) {
    let best: Bar | null = null, bestPx = 0;
    let hi = -Infinity, lo = Infinity;
    for (const b of hold) {
      hi = Math.max(hi, b.h); lo = Math.min(lo, b.l);
      const px = sign > 0 ? b.h : b.l;
      if (!best || (sign > 0 ? px > bestPx : px < bestPx)) { best = b; bestPx = px; }
    }
    nums.holdHigh = r2(hi); nums.holdLow = r2(lo);
    nums.holdFavPct = +(sign * pct(bestPx, nums.sEntry)).toFixed(3);
    nums.holdFavAt = best ? istHm(best.t) : null;
    if (best && trade.entryPrice && entryMs != null) {
      const tE = closeMs(trade.expiry);
      const tEntryMin = tE ? (tE - entryMs) / 60000 : 60;
      const tExtMin = tE ? (tE - best.t) / 60000 : 60;
      nums.optHoldFav = optionEstimate({ side: trade.side, K: trade.strike, entryPrice: trade.entryPrice, sEntry: nums.sEntry, tEntryMin, sExt: bestPx, tExtMin }) - trade.entryPrice;
      nums.optHoldFav = +(nums.optHoldFav * 100 * (trade.qty ?? 1)).toFixed(2);
    }
  }

  // Çıkış sonrası: 60 dk içinde lehe / aleyhe uç ve 15/30/60 dk
  if (closed && exitMs != null && sign && nums.sExit) {
    const after = afterExitMove(session, exitMs, nums.sExit, trade.side, POST_MIN);
    if (after) {
      nums.afterFavPct = after.bestFavPct; nums.afterAgainstPct = after.worstAgainstPct;
      nums.afterAt15 = after.at15; nums.afterAt30 = after.at30; nums.afterAt60 = after.at60;
      if (after.minutesToBestFav != null && trade.entryPrice) {
        const extMs = exitMs + after.minutesToBestFav * 60000;
        const sExt = sign > 0 ? nums.sExit * (1 + after.bestFavPct / 100) : nums.sExit * (1 - after.bestFavPct / 100);
        const tE = closeMs(trade.expiry);
        const tExtMin = tE ? (tE - extMs) / 60000 : 60;
        const exitPrice = trade.exitPrice ?? trade.entryPrice;
        const optAfter = optionEstimate({ side: trade.side, K: trade.strike, entryPrice: exitPrice, sEntry: nums.sExit, tEntryMin: tE ? (tE - exitMs) / 60000 : 60, sExt, tExtMin });
        nums.optAfterFav = +((optAfter - exitPrice) * 100 * (trade.qty ?? 1)).toFixed(2);
      }
    } else noData.push('çıkış sonrası dayanak hareketi (seans sonu veya veri eksik)');
  }

  const candleFrom = (entryMs ?? exitMs ?? 0) - PRE_MIN * 60000;
  const candleTo = (closed && exitMs != null ? exitMs : entryMs ?? 0) + POST_MIN * 60000;
  const cs = entryMs != null || exitMs != null ? aggregate(session, candleFrom, candleTo, 5).slice(-MAX_CANDLES) : [];
  if (!cs.length && (entryMs != null || exitMs != null)) noData.push('giriş/çıkış çevresi mumları');

  if (!a.walls) noData.push('duvar anlık görüntüsü (sunucu tarayıcısı kapalıysa yok)');
  const fl = (a.flow ?? []).slice(0, 8).map(e => ({ t: istHm(e.ts), side: e.side, strike: e.strike, expiry: e.expiry, prem: Math.round(e.prem), dv: Math.round(e.dv), teyit: e.confirmed }));
  if (!fl.length) noData.push('akış olayları (aynı ticker, işlem penceresi)');

  const facts: Record<string, unknown> = {
    ticker: trade.ticker, side: trade.side, strike: trade.strike, expiry: trade.expiry, qty: trade.qty,
    entryIst: trade.entryTime, exitIst: trade.exitTime, entryPrice: trade.entryPrice, exitPrice: trade.exitPrice,
    status: trade.status, okuma: trade.confidence, dakikaKapanisaKadar: entryMs != null ? etMinutesOf(entryMs) : null,
    primDegisimiPct: trade.entryPrice && trade.exitPrice != null && closed ? premiumPct(trade.entryPrice, trade.exitPrice) : null,
    sayilar: nums,
    not: 'optHoldFav / optAfterFav: BS tahmini (σ=%45, r=%4), dolar, komisyonsuz; "tahmini" olarak anlat.',
    mumlar5dk: cs.map(c => ({ t: istHm(c.t), o: +c.o.toFixed(2), h: +c.h.toFixed(2), l: +c.l.toFixed(2), c: +c.c.toFixed(2), v: Math.round(c.v) })),
    seansAcilis: session.length ? openOf(session) : null,
    akis: fl,
    duvarlar: a.walls ?? null,
  };
  return { rules, facts, nums, noData };
}

/** Kaan'ın kurallarının özeti (sabit) */
export const KAAN_RULES_TR = [
  'Giriş penceresi: İstanbul 16:30–20:00 arası.',
  'Vade: 0–3 gün (DTE). Strike: oynaklığa göre OTM (≈ 0,5 × beklenen hareket; sayılar: sayilar.otmPerEm).',
  'Risk/ödül: brüt 1:5 (yedek 1:4). Prim stopu: girişin %67\'si kaybedilince çık (kalan %33).',
  'Kademe: 50/40/30 (kazandıkça adım adım).',
  'Çıkış: yüksek hacimli ters dönüş mumunda çık.',
].join('\n');
