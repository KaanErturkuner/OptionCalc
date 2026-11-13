/*
 * Kaan'ın kendi (takdire dayalı) yöntemi — trend yönünde momentum:
 *  1) Piyasa rejimi: QQQ (ve varsa SPY) VWAP'ın aynı tarafında VE açılış aralığını o yöne kırmış → boğa/ayı günü; karışıksa işlem yok.
 *  2) Sektör akışı: hissenin sektör ETF'i (yarı iletken: SMH) QQQ'ya göre göreli güçlü/zayıf ve rejimle aynı yönde olmalı (QQQ'nun kendisi için yalnızca rejim).
 *  3) Hisse: fiyat rejim yönünde VWAP'ın tarafında, yakın salınım (swing) tepesi/dibi ya da açılış aralığı kırılımı, hacim ≥ volMult × son 20 bar ortalaması,
 *     yön üstünde yakın OI duvarı yok.
 *  4) Giriş penceresi 09:45–13:00 ET (İstanbul 17:45–21:00; açılış aralığı için ilk 15 dk beklenir).
 *  5) Kontrat: işlem yönünde OTM, uzaklık = otm × günlük beklenen hareket (hisse: otmEm, ETF: otmEmEtf). Kalibrasyon (Eyl–Kas 2026 medyanları):
 *     MU em≈$23,7 → 1,8 em ≈ $43 (örnek 40–50$), INTC em≈$2,79 → ≈ $5,0 (örnek 4–5$), QQQ em≈$5,40 → 0,45 em ≈ $2,4 (örnek 2–3$).
 *  6) Çıkış: pozisyona ters, gövdesi büyük (gövde/aralık ≥ bodyFrac), hacmi ≥ revVol × ortalama olan dönüş mumu → çık; ayrıca güvenlik stopu,
 *     uzak hedef (tgtEm) ve zaman çıkışı (exitByMin).
 * DTE: dteMin..dteMax (0DTE ve 1–3DTE varyantları).
 * relaxed (deneysel, 2026-11-12): endeksler nötr (karşı yönde VWAP+OR kırılımı yok) iken sektör ETF'i kendi açılış aralığını kırıp VWAP'ın o tarafındaysa
 *   rejim = sektör yönü (yalnız sektörlü hisseler; QQQ gibi ETF'ler için katı kural geçerli).
 */
import { COMMON_DEFAULTS, inWindow, type CommonParams, type StratCtx, type Strategy } from './types.ts';
import type { Bar } from '../analytics.ts';
import { avgVol, hi, lo, openRange, vwapAt } from './util.ts';

export interface KaanMomentumParams extends CommonParams {
  regimeSyms: string[]; regimeOr: 'break' | 'vwap';
  sectorMinRs: number; sectorVwap: boolean;
  brk: 'swing' | 'or' | 'either'; swingBars: number; volMult: number; wallEm: number;
  otmEm: number; otmEmEtf: number; dteMin: number; dteMax: number;
  stopEm: number; tgtEm: number; exitByMin: number;
  revBody: number; revVol: number; relaxed?: boolean;
}
export const SECTOR: Record<string, string> = { MU: 'SMH', INTC: 'SMH', AMD: 'SMH', NVDA: 'SMH', MRVL: 'SMH', AAOI: 'SMH', AXTI: 'SMH', GLW: 'SMH', NBIS: 'SMH' /* AI altyapı (neocloud) → yarı iletken talebiyle hareket eder; IGV yazılım, daha zayıf vekil */ };
export const ETFS = new Set(['QQQ', 'SPY', 'IWM', 'DIA', 'SMH', 'SOXX', 'GLD', 'SLV']);
const OR_MIN = 15;
/** +1 boğa / −1 ayı / 0 karışık ya da veri yok */
function side(bars: Bar[] | null | undefined, mode: 'break' | 'vwap'): number {
  if (!bars || bars.length < OR_MIN + 1) return 0;
  const S = bars[bars.length - 1].c, vw = vwapAt(bars); if (vw == null) return 0;
  const v = S > vw ? 1 : S < vw ? -1 : 0; if (mode === 'vwap') return v;
  const or = openRange(bars, OR_MIN)!; const o = S > or.high ? 1 : S < or.low ? -1 : 0;
  return v === o ? v : 0;
}
export function regime(c: StratCtx, p: KaanMomentumParams): number {
  const r0 = regimeStrict(c, p); if (r0 || !p.relaxed) return r0;
  const sec = SECTOR[c.ticker]; if (!sec) return 0;
  const sd = side(c.peer?.(sec), 'break'); if (!sd) return 0;
  for (const sym of p.regimeSyms) { const b = sym === c.ticker ? c.bars : c.peer?.(sym); if (side(b, 'break') === -sd) return 0; }
  return sd;
}
function regimeStrict(c: StratCtx, p: KaanMomentumParams): number {
  let r = 0, seen = 0;
  for (const sym of p.regimeSyms) {
    const b = sym === c.ticker ? c.bars : c.peer?.(sym); if (!b || !b.length) { if (sym === 'QQQ') return 0; continue; }
    const s = side(b, p.regimeOr); if (!s) return 0; if (seen && s !== r) return 0; r = s; seen++;
  }
  return r;
}
const dayRet = (b: Bar[]) => b.length ? b[b.length - 1].c / b[0].o - 1 : 0;
export const kaanMomentum: Strategy<KaanMomentumParams> = {
  id: 'kaan-momentum', name: 'Kaan momentum (rejim + sektör + kırılım, OTM)',
  description: 'Piyasa rejimi (QQQ/SPY VWAP + ORB) ve sektör (SMH) aynı yöndeyken, hacimli kırılımda trend yönünde OTM opsiyon; yüksek hacimli ters mumda çık.',
  universe: ['MU', 'QQQ', 'INTC'], peers: ['QQQ', 'SPY', 'SMH'],
  defaults: { ...COMMON_DEFAULTS, startMin: OR_MIN, endMin: 210, maxPerDay: 2, maxSpread: 0.3, minVol: 10, minOI: 100,
    regimeSyms: ['QQQ', 'SPY'], regimeOr: 'break', sectorMinRs: 0, sectorVwap: true,
    brk: 'either', swingBars: 30, volMult: 1.5, wallEm: 0.5,
    otmEm: 1.8, otmEmEtf: 0.45, dteMin: 0, dteMax: 3,
    stopEm: 0.35, tgtEm: 2, exitByMin: 360, revBody: 0.6, revVol: 1.5 },
  space: { regimeSyms: [['QQQ'], ['QQQ', 'SPY']], regimeOr: ['break', 'vwap'], sectorMinRs: [0, 0.002], brk: ['swing', 'or', 'either'], swingBars: [15, 30, 60],
    volMult: [1.5, 2, 2.5], wallEm: [0, 0.5, 1], otmEm: [0.5, 1, 1.8], otmEmEtf: [0.2, 0.45, 0.8], stopEm: [0.2, 0.35, 0.5], tgtEm: [1, 2, 4],
    exitByMin: [240, 300, 360], revBody: [0.5, 0.6, 0.75], revVol: [1.5, 2, 3], endMin: [120, 210] },
  evaluate(c, p) {
    if (!inWindow(c.m, p) || c.day.dte < p.dteMin || c.day.dte > p.dteMax || c.bars.length < Math.max(OR_MIN, 21)) return null;
    // em0 = GÜNLÜK beklenen hareket (dayInfo straddle'ı √(1+DTE) ile zaten indiriyor) → OTM kalibrasyonu (MU ~40–50$) iki varyantta aynı
    const em = c.day.em0; if (em == null) return null;
    const dir = regime(c, p); if (!dir) return null;
    // sektör
    const sec = SECTOR[c.ticker];
    if (sec) {
      const sb = c.peer?.(sec), qb = c.peer?.('QQQ'); if (!sb?.length || !qb?.length) return null;
      const rs = dayRet(sb) - dayRet(qb); if (dir * rs <= p.sectorMinRs) return null;
      if (p.sectorVwap) { const v = vwapAt(sb); if (v == null || dir * (sb[sb.length - 1].c - v) <= 0) return null; }
    } else if (!ETFS.has(c.ticker)) return null;
    // hisse: VWAP tarafı + kırılım + hacim
    const n = c.bars.length, last = c.bars[n - 1], vw = vwapAt(c.bars); if (vw == null || dir * (c.S - vw) <= 0) return null;
    const or = openRange(c.bars, OR_MIN)!;
    const swingRef = dir > 0 ? hi(c.bars, n - 1 - p.swingBars, n - 1) : lo(c.bars, n - 1 - p.swingBars, n - 1);
    const orRef = dir > 0 ? or.high : or.low;
    const brkSwing = dir * (last.c - swingRef) > 0, brkOr = dir * (last.c - orRef) > 0 && dir * (c.bars[n - 2].c - orRef) <= 0;
    if (!(p.brk === 'swing' ? brkSwing : p.brk === 'or' ? brkOr : brkSwing || brkOr)) return null;
    if (last.v < p.volMult * avgVol(c.bars, n - 21, n - 1)) return null;
    const wall = dir > 0 ? c.F.w.callWall : c.F.w.putWall;
    if (p.wallEm > 0 && wall != null && dir * (wall - c.S) > 0 && dir * (wall - c.S) < p.wallEm * em) return null;
    const otm = (ETFS.has(c.ticker) ? p.otmEmEtf : p.otmEm) * em, d = dir > 0 ? 'call' as const : 'put' as const;
    const exitCheck = (bars: Bar[], i: number) => {
      const b = bars[i], rng = b.h - b.l; if (!(rng > 0) || i < 20) return false;
      return dir * (b.c - b.o) < 0 && Math.abs(b.c - b.o) >= p.revBody * rng && b.v >= p.revVol * avgVol(bars, i - 20, i);
    };
    return { dir: d, strike: c.S + dir * otm, undTarget: c.S + dir * p.tgtEm * em, undStop: c.S - dir * p.stopEm * em,
      maxHoldMin: Math.max(5, p.exitByMin - c.m), exitCheck, note: `rejim ${dir > 0 ? 'boğa' : 'ayı'}${sec ? ' ' + sec + ' teyitli' : ''}, OTM ${otm.toFixed(2)}$` };
  },
};
export const kaanMomentum0 = { ...kaanMomentum, id: 'kaan-momentum-0dte', name: 'Kaan momentum — 0DTE', defaults: { ...kaanMomentum.defaults, dteMin: 0, dteMax: 0 } } as Strategy<KaanMomentumParams>;
export const kaanMomentum13 = { ...kaanMomentum, id: 'kaan-momentum-1to3dte', name: 'Kaan momentum — 1–3DTE', defaults: { ...kaanMomentum.defaults, dteMin: 1, dteMax: 3 } } as Strategy<KaanMomentumParams>;
export const kaanMomentumRelaxed0 = { ...kaanMomentum0, id: 'kaan-momentum-gevsek-0dte', name: 'Kaan momentum — gevşek rejim, 0DTE', defaults: { ...kaanMomentum0.defaults, relaxed: true } } as Strategy<KaanMomentumParams>;
export const kaanMomentumRelaxed13 = { ...kaanMomentum13, id: 'kaan-momentum-gevsek-1to3dte', name: 'Kaan momentum — gevşek rejim, 1–3DTE', defaults: { ...kaanMomentum13.defaults, relaxed: true } } as Strategy<KaanMomentumParams>;
