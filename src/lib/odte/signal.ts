/*
 * Kural tabanlı kısa vade sinyal motoru (şeffaf gerekçeli). Yatırım tavsiyesi değildir.
 * Fiyat hareketi (VWAP, açılış aralığı kırılımı, momentum) ana yönü belirler; opsiyon akışı (GEX/flip, OI duvarları,
 * max pain, P/C, sıra dışı hacim) puanı güçlendirir/zayıflatır. Yön hizalı ve puan eşiği aşılırsa kontrat seçilir.
 */
import { mid, spreadPct, type Chain, type OptQuote } from '../market/types.ts';
import { closeMs, etDate, etToIst, marketOpen } from '../usmarket.ts';
import * as An from './analytics.ts';
import type { Bar } from './analytics.ts';

export interface Reason { text: string; w: number }     // w: + yükseliş / − düşüş katkısı
export interface Levels {
  S: number; vwap: number | null; orHigh: number | null; orLow: number | null; callWall: number | null; putWall: number | null;
  maxPain: number | null; flip: number | null; netGex: number; em: number | null; pcVol: number | null; pcOI: number | null;
}
export interface Signal {
  ticker: string; dir: 'call' | 'put'; expiry: string; dte: number; strike: number;
  entry: number; target: number; stop: number; rr: number; exitBy: string;          // exitBy: "15:30 ET"
  bid: number; ask: number; mid: number; delta: number; volume: number; oi: number;
  undTarget: number; undStop: number; score: number; time: number;
}
export interface Result {
  ticker: string; score: number; reasons: Reason[]; levels: Levels;
  signal: Signal | null; noSignal: string | null; unusual: ReturnType<typeof An.unusual>;
}
/** Motor ağırlıkları (puan katkıları). Varsayılanlar backtest ile ayarlandı (backtest/ klasörü). */
export interface EngineWeights {
  vwap: number; orb: number; mom: number;            // fiyat hareketi oyları
  flip: number; wall: number; maxPain: number; pc: number; unusual: number; // opsiyon akışı
  negGexBoost: number;                               // net GEX < 0 iken fiyat hareketi çarpanı
}
export interface EngineOpts {
  minScore: number; minRR: number; maxSpread: number; minVol: number; minOI: number; orMinutes: number;
  /** Yeni giriş için son dakika (09:30'dan itibaren; 330 = 15:00 ET) */
  endMin?: number;
  /** Açılıştan sonra ilk giriş dakikası (en az orMinutes) */
  startMin?: number;
  w?: Partial<EngineWeights>;
  /** Dayanak hedef = S ± tgtEm × beklenen hareket */
  tgtEm?: number;
  /** Stop mesafesi sınırları (beklenen hareketin katı) */
  stopMinEm?: number; stopMaxEm?: number;
  /** Hedef kontrat deltası */
  targetDelta?: number;
}
export const DEFAULT_WEIGHTS: EngineWeights = { vwap: 1, orb: 1.5, mom: 1, flip: 0.5, wall: 0.5, maxPain: 0.5, pc: 0.5, unusual: 0.5, negGexBoost: 1.2 };
/** v1 (backtest öncesi) kurallar — karşılaştırma için saklanıyor */
export const V1_OPTS: EngineOpts = { minScore: 3, minRR: 1.5, maxSpread: 0.12, minVol: 100, minOI: 300, orMinutes: 15,
  endMin: 330, startMin: 15, w: DEFAULT_WEIGHTS, tgtEm: 0.5, stopMinEm: 0.1, stopMaxEm: 0.35, targetDelta: 0.45 };
/**
 * v2 varsayılanları — backtest/optimize.mts (MarketData geçmiş verisi, 6 Tem–10 Kas 2026, 19 sembol, eğitim %70 / test %30).
 * Daha seçici: yüksek puan eşiği, dar spread, 12:30 ET sonrası yeni giriş yok, daha yakın hedef/stop, ~0,6 delta.
 * Backtestte işlem başı beklenti v1'e göre belirgin iyileşti ama hâlâ sıfırın altında: kanıtlanmış avantaj YOK, yalnızca kâğıt üzerinde test.
 */
export const DEFAULT_OPTS: EngineOpts = { minScore: 5, minRR: 1.5, maxSpread: 0.08, minVol: 100, minOI: 300, orMinutes: 15,
  startMin: 15, endMin: 180, tgtEm: 0.4, stopMinEm: 0.05, stopMaxEm: 0.2, targetDelta: 0.6,
  w: { vwap: 0.5, orb: 1, mom: 0.5, flip: 1, wall: 1, maxPain: 0.5, pc: 0.5, unusual: 1, negGexBoost: 1.5 } };

const etMin = (now: number) => { // 09:30'dan bu yana dakika
  const open = closeMs(etDate(now)) - 6.5 * 3600000; return (now - open) / 60000;
};
const f2 = (x: number) => x.toFixed(2);

/** Parametreden bağımsız göstergeler (backtest bunları önbelleğe alır) */
export interface Features {
  bars: Bar[]; vw: number | null; orng: ReturnType<typeof An.openingRange>; mo: ReturnType<typeof An.momentum>;
  w: ReturnType<typeof An.oiWalls>; mp: number | null; gx: ReturnType<typeof An.gex>; ra: ReturnType<typeof An.ratios>;
  em: ReturnType<typeof An.expectedMove>; unus: ReturnType<typeof An.unusual>; orMinutes: number;
}
export function features(S: number, ch: Chain, barsAll: Bar[], now: number, orMinutes: number): Features {
  const bars = An.sessionBars(barsAll, now);
  return { bars, vw: An.vwap(bars), orng: An.openingRange(bars, orMinutes), mo: An.momentum(bars), w: An.oiWalls(ch), mp: An.maxPain(ch),
    gx: An.gex(ch, S, now), ra: An.ratios(ch), em: An.expectedMove(ch, S), unus: An.unusual(ch), orMinutes };
}
export function analyze(ticker: string, S: number, ch: Chain, barsAll: Bar[], now: number, o: EngineOpts = DEFAULT_OPTS,
  opts: { requireOpen?: boolean } = { requireOpen: true }): Result {
  return decide(ticker, S, ch, features(S, ch, barsAll, now, o.orMinutes), now, o, opts);
}
/** Puanlama + eleme + kontrat seçimi (göstergeler hazır) */
export function decide(ticker: string, S: number, ch: Chain, F: Features, now: number, o: EngineOpts = DEFAULT_OPTS,
  opts: { requireOpen?: boolean } = { requireOpen: true }): Result {
  const W: EngineWeights = { ...DEFAULT_WEIGHTS, ...(o.w || {}) };
  const reasons: Reason[] = [];
  const { bars, vw, orng, mo, w, mp, gx, ra, em, unus } = F, orMin = F.orMinutes;
  const levels: Levels = { S, vwap: vw, orHigh: orng?.complete ? orng.high : null, orLow: orng?.complete ? orng.low : null,
    callWall: w.callWall, putWall: w.putWall, maxPain: mp, flip: gx.flip, netGex: gx.net, em: em?.move ?? null, pcVol: ra.pcVol, pcOI: ra.pcOI };
  const res = (score: number, noSignal: string | null, signal: Signal | null = null): Result => ({ ticker, score, reasons, levels, signal, noSignal, unusual: unus });

  // ——— fiyat hareketi ———
  let pa = 0, paVotes = 0;
  if (vw != null) { const d = S > vw ? 1 : -1; pa += d * W.vwap; paVotes++; reasons.push({ text: `Fiyat VWAP’in ${d > 0 ? 'üstünde' : 'altında'} (${f2(vw)})`, w: d * W.vwap }); }
  if (orng?.complete) {
    if (S > orng.high) { pa += W.orb; paVotes++; reasons.push({ text: `${orMin} dk açılış aralığı yukarı kırıldı (> ${f2(orng.high)})`, w: W.orb }); }
    else if (S < orng.low) { pa -= W.orb; paVotes++; reasons.push({ text: `${orMin} dk açılış aralığı aşağı kırıldı (< ${f2(orng.low)})`, w: -W.orb }); }
    else reasons.push({ text: `Fiyat açılış aralığı içinde (${f2(orng.low)}–${f2(orng.high)})`, w: 0 });
  }
  if (mo) {
    const d = mo.ema9 > mo.ema21 && mo.r5 > 0 ? 1 : mo.ema9 < mo.ema21 && mo.r5 < 0 ? -1 : 0;
    pa += d * W.mom; if (d) paVotes++;
    reasons.push({ text: d ? `1 dk momentum ${d > 0 ? 'yukarı' : 'aşağı'} (EMA9 ${d > 0 ? '>' : '<'} EMA21, 5 dk ${(mo.r5 * 100).toFixed(2)}%)` : 'Momentum kararsız', w: d * W.mom });
  }
  // ——— opsiyon akışı ———
  let fl = 0;
  if (gx.flip != null) { const d = S > gx.flip ? W.flip : -W.flip; fl += d; reasons.push({ text: `Gamma flip ${f2(gx.flip)} — fiyat ${d > 0 ? 'üstünde (dengeleyici bölge)' : 'altında (oynak bölge)'}`, w: d }); }
  reasons.push({ text: `Net GEX ${gx.net >= 0 ? 'pozitif' : 'negatif'} (${(gx.net / 1e6).toFixed(1)} M$/%1) → ${gx.net >= 0 ? 'ortalamaya dönüş eğilimi' : 'trend/hareket güçlenir'}`, w: 0 });
  if (w.callWall != null && em) {
    const room = (w.callWall - S) / em.move;
    if (room > 0 && room < 0.35) { fl -= W.wall; reasons.push({ text: `Call duvarı yakın: ${w.callWall} (direnç)`, w: -W.wall }); }
  }
  if (w.putWall != null && em) {
    const room = (S - w.putWall) / em.move;
    if (room > 0 && room < 0.35) { fl += W.wall; reasons.push({ text: `Put duvarı yakın: ${w.putWall} (destek)`, w: W.wall }); }
  }
  if (mp != null && etMin(now) > 270 && em && Math.abs(S - mp) > 0.25 * em.move) { // 14:00 ET sonrası pin etkisi
    const d = S > mp ? -W.maxPain : W.maxPain; fl += d; reasons.push({ text: `Max pain ${mp} mıknatısı (öğleden sonra)`, w: d });
  } else if (mp != null) reasons.push({ text: `Max pain ${mp}`, w: 0 });
  if (ra.pcVol != null) {
    const d = ra.pcVol < 0.7 ? W.pc : ra.pcVol > 1.3 ? -W.pc : 0; fl += d;
    reasons.push({ text: `Put/Call hacim ${ra.pcVol.toFixed(2)}${ra.pcOI != null ? ` · OI ${ra.pcOI.toFixed(2)}` : ''}`, w: d });
  }
  if (unus.length) {
    const net = unus.reduce((a, u) => a + (u.type === 'call' ? u.vol : -u.vol), 0), d = net > 0 ? W.unusual : net < 0 ? -W.unusual : 0; fl += d;
    reasons.push({ text: `Sıra dışı hacim: ${unus.slice(0, 2).map(u => `${u.k}${u.type === 'call' ? 'C' : 'P'} ${u.vol}/${u.oi}`).join(', ')}`, w: d });
  }
  // negatif GEX'te fiyat hareketi sinyalini güçlendir
  const score = +(pa * (gx.net < 0 ? W.negGexBoost : 1) + fl).toFixed(2);

  // ——— eleme ———
  const m = etMin(now), startMin = Math.max(o.startMin ?? orMin, orMin), endMin = o.endMin ?? 330;
  if (opts.requireOpen !== false) {
    if (!marketOpen(now)) return res(score, 'Piyasa kapalı');
    if (m < orMin) return res(score, `Açılış aralığı oluşuyor (ilk ${orMin} dk)`);
    if (m < startMin) return res(score, `İlk giriş ${startMin} dk sonra`);
    if (m > endMin) return res(score, `${etToIst(Math.floor((570 + endMin) / 60), (570 + endMin) % 60)} TR sonrası yeni giriş yok`);
  }
  if (!bars.length) return res(score, 'Gün içi bar verisi yok');
  const dir = score > 0 ? 1 : -1;
  if (Math.abs(score) < o.minScore) return res(score, `Puan zayıf (${score.toFixed(1)}; eşik ±${o.minScore})`);
  if (paVotes < 2 || Math.sign(pa) !== dir) return res(score, 'Fiyat göstergeleri hizalı değil');
  const opp = reasons.filter(r => Math.sign(r.w) === -dir && Math.abs(r.w) >= 1);
  if (opp.length) return res(score, 'Çelişen güçlü gösterge: ' + opp[0].text);

  // ——— kontrat seçimi: likit, delta ~hedef ———
  const tD = o.targetDelta ?? 0.45;
  const list = dir > 0 ? ch.calls : ch.puts;
  const cands = list.filter(q => q.bid > 0 && q.ask > 0 && spreadPct(q) <= o.maxSpread && (q.volume >= o.minVol || q.oi >= o.minOI));
  if (!cands.length) return res(score, 'Likidite yetersiz (spread/hacim)');
  const dOf = (q: OptQuote) => q.delta != null && q.delta !== 0 ? Math.abs(q.delta) : Math.max(0.05, Math.min(0.95, 0.5 - dir * (q.strike - S) / (S * 0.02) * 0.15));
  const pick = cands.reduce((a, b) => Math.abs(dOf(b) - tD) < Math.abs(dOf(a) - tD) ? b : a);
  const delta = dOf(pick), gamma = pick.gamma ?? 0, mm = mid(pick);

  // ——— dayanak hedef / stop ———
  const tgtEm = o.tgtEm ?? 0.5, sMin = o.stopMinEm ?? 0.1, sMax = o.stopMaxEm ?? 0.35;
  const emv = em?.move ?? S * 0.008;
  const wallT = dir > 0 ? (w.callWall != null && w.callWall > S ? w.callWall : null) : (w.putWall != null && w.putWall < S ? w.putWall : null);
  let undTarget = S + dir * tgtEm * emv;
  if (wallT != null && Math.abs(wallT - S) < Math.abs(undTarget - S) && Math.abs(wallT - S) > 0.2 * emv) undTarget = wallT;
  const stopRef = [vw, orng?.complete ? (orng.high + orng.low) / 2 : null].filter((x): x is number => x != null && (dir > 0 ? x < S : x > S));
  let undStop = stopRef.length ? (dir > 0 ? Math.max(...stopRef) : Math.min(...stopRef)) : S - dir * Math.min(0.25, sMax) * emv;
  if (Math.abs(S - undStop) < sMin * emv) undStop = S - dir * Math.min(Math.max(0.15, sMin), sMax) * emv;
  if (Math.abs(S - undStop) > sMax * emv) undStop = S - dir * sMax * emv;
  const dP = (dS: number) => delta * Math.abs(dS) + 0.5 * gamma * dS * dS;
  const entry = +Math.min(pick.ask, mm + 0.25 * (pick.ask - pick.bid)).toFixed(2);
  const target = +(entry + dP(undTarget - S)).toFixed(2);
  const stop = +Math.max(0.01, entry - (delta * Math.abs(S - undStop) - 0.5 * gamma * (S - undStop) ** 2)).toFixed(2);
  const rr = (target - entry) / Math.max(entry - stop, 0.01);
  if (!(rr >= o.minRR)) return res(score, `R/R düşük (${rr.toFixed(2)} < ${o.minRR})`);
  const dte = Math.max(0, Math.round((Date.parse(ch.expiry) - Date.parse(etDate(now))) / 86400000));
  return res(score, null, {
    ticker, dir: dir > 0 ? 'call' : 'put', expiry: ch.expiry, dte, strike: pick.strike, entry, target, stop, rr: +rr.toFixed(2),
    exitBy: dte === 0 ? `${etToIst(15, 30)} TR` : `${etToIst(15, 45)} TR (gün içi)`, bid: pick.bid, ask: pick.ask, mid: mm, delta, volume: pick.volume, oi: pick.oi,
    undTarget: +undTarget.toFixed(2), undStop: +undStop.toFixed(2), score, time: now,
  });
}
/** "SPY 0DTE 590C AL — giriş ≤ $x, kâr al $y, stop $z, en geç 15:30 ET çık" */
export function signalText(s: Signal): string {
  const k = (s.strike % 1 ? s.strike.toFixed(1) : String(s.strike)) + (s.dir === 'call' ? 'C' : 'P');
  return `${s.ticker} ${s.dte === 0 ? '0DTE' : s.dte + 'DTE'} ${k} AL — giriş ≤ $${s.entry.toFixed(2)}, kâr al $${s.target.toFixed(2)}, stop $${s.stop.toFixed(2)}, en geç ${s.exitBy} çık`;
}
/** Sinyal sonucu: barlarda dayanak hedef/stop hangisi önce? (aynı barda ikisi → stop, muhafazakâr) */
export function outcome(s: Signal, bars: Bar[], now: number): { status: 'open' | 'target' | 'stop' | 'expired'; at?: number } {
  const exitT = closeMs(etDate(s.time)) - (s.dte === 0 ? 30 : 15) * 60000;
  for (const b of bars) {
    if (b.t < s.time) continue;
    if (b.t > exitT) return { status: 'expired', at: exitT };
    const hitT = s.dir === 'call' ? b.h >= s.undTarget : b.l <= s.undTarget;
    const hitS = s.dir === 'call' ? b.l <= s.undStop : b.h >= s.undStop;
    if (hitS) return { status: 'stop', at: b.t };
    if (hitT) return { status: 'target', at: b.t };
  }
  return now > exitT ? { status: 'expired', at: exitT } : { status: 'open' };
}
