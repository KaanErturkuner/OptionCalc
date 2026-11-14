/*
 * Seans rejimi ve erken dönüş tespiti (saf, ağ YOK). Girdi: 1 dk barlar (QQQ/SPY; t = bar başlangıcı, ms).
 * Rejimler: erken (veri yetersiz) · konsolidasyon (bant içinde sıkışma) · trend_up/trend_down · donus_up/donus_down
 * (ONAYLI erken dönüş) · karisik. Kullanan: raporlar (src/lib/reports/intra.ts) ve Sonuç / Fırsat kartları (verdict.ts).
 *
 * Tüm eşikler REGIME_K içinde adlandırılmıştır; kalibrasyon: 13/11/2026 QQQ/SPY 1 dk verisi (CHANGELOG).
 * Konsolidasyon = (1) pencere aralığı ≤ CONS_RANGE_ATR × ATR14(5 dk) VE (2) pencere aralığı ≤ CONS_SESSION_FRAC × seans aralığı
 *   VE (3a) pencere hacmi ≤ CONS_VOL_RATIO × önceki seans hacmi VEYA (3b) pencerede ≥ CONS_VWAP_CROSSES VWAP geçişi.
 * Pencere = son WINDOW_MIN dk (seans daha kısaysa seansın tamamı; < WINDOW_MIN_OK dk ise rejim "erken").
 * Trend = pencerede kapanışların ≥ TREND_SIDE_FRAC'i VWAP'ın aynı tarafında VE |net hareket| ≥ TREND_MOVE_ATR × ATR14 (yön uyumlu).
 * Dönüş (onaylı) = seans uç noktasından ters hareket ≥ REV_COUNTER_PCT % VE son REV_LOOKBACK_MIN dk içinde ≥ REV_CONFIRM teyit
 *   (VWAP geri alma/kaybı, yüksek hacimli ters mum, 5 dk'da yüksek dip / alçak tepe yapısı). Tek teyit = "aday" (rejimi değiştirmez).
 * Hiçbiri değilse "karisik". Öncelik: onaylı dönüş > konsolidasyon > trend.
 */
import { closeMs, etDate } from '../usmarket.ts';

export interface TapeBar { t: number; o: number; h: number; l: number; c: number; v: number }
export type RegimeKind = 'erken' | 'konsolidasyon' | 'trend_up' | 'trend_down' | 'donus_up' | 'donus_down' | 'karisik';
export type Dir = 'up' | 'down';
export interface Band { high: number; low: number }
export interface Reversal { dir: Dir; status: 'aday' | 'onayli'; signals: string[]; extreme: number; extremeT: number; counterPct: number }
export interface RegimeMetrics { rangeAtr: number | null; sessFrac: number | null; volRatio: number | null; vwapCrosses: number; sideFrac: number | null; netAtr: number | null }
export interface RegimeResult {
  kind: RegimeKind; label: string; dir: Dir | null; band: Band | null;
  vwap: number | null; atr5: number | null; last: number | null; open: number | null;
  sessHigh: number | null; sessLow: number | null; windowMin: number;
  metrics: RegimeMetrics; reversal: Reversal | null; reason: string;
}

export const MIN_MS = 60000;
const FIVE_MS = 5 * MIN_MS;
const SESSION_MIN = 390;

/** Eşikler (adlandırılmış sabitler). Değiştirirken: test/regime.test.ts ve CHANGELOG güncellenir. */
export const REGIME_K = {
  ATR_N: 14,                // 5 dk ATR periyodu
  WINDOW_MIN: 75,           // pencere uzunluğu (dk)
  WINDOW_MIN_OK: 45,        // bu kadar seans dakikası yoksa rejim "erken"
  MIN_SESSION_BARS: 5,      // seans için en az 1 dk bar sayısı
  CONS_RANGE_ATR: 3.5,      // pencere aralığı / ATR14 üst sınırı
  CONS_SESSION_FRAC: 0.5,   // pencere aralığı / seans aralığı üst sınırı
  CONS_VOL_RATIO: 0.8,      // pencere hacmi / önceki seans hacmi (dk başına) üst sınırı
  CONS_VWAP_CROSSES: 3,     // pencerede minimum VWAP geçişi (alternatif hacim koşulu)
  TREND_SIDE_FRAC: 0.8,     // pencerede VWAP'ın aynı tarafında kapanış oranı
  TREND_MOVE_ATR: 1.5,      // pencere net hareketi / ATR14 alt sınırı
  REV_COUNTER_PCT: 0.3,     // seans uç noktasından ters hareket (%)
  REV_LOOKBACK_MIN: 30,     // teyitlerin aranacağı son dakika
  REV_CONFIRM: 2,           // onaylı dönüş için gereken teyit sayısı
  REV_VOL_MULT: 1.5,        // yüksek hacim: 5 dk hacim / önceki 20 mum ortalaması
  REV_VOL_AVG_N: 20,
  REV_WICK_FRAC: 0.5,       // ters fitil / mum aralığı alt sınırı
  VWAP_HOLD_MIN: 15,        // VWAP geri alımından önce altta (üstte) kalma süresi (dk)
} as const;

const r2 = (x: number) => Math.round(x * 100) / 100;

/** 1 dk barları 5 dk'ya topla (zaman hizalı: 5 dk sınırları) */
export function resample5(bars: TapeBar[]): TapeBar[] {
  const out: TapeBar[] = [];
  let cur: TapeBar | null = null;
  for (const b of bars) {
    const k = Math.floor(b.t / FIVE_MS) * FIVE_MS;
    if (cur && cur.t === k) {
      cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v;
    } else {
      if (cur) out.push(cur);
      cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** ATR (basit ortalama, son n gerçek aralık). En az 5 aralık yoksa null. */
export function atrOf(bars: TapeBar[], n = REGIME_K.ATR_N): number | null {
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1].c, b = bars[i];
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - p), Math.abs(b.l - p)));
  }
  const xs = trs.slice(-n);
  return xs.length >= 5 ? xs.reduce((a, x) => a + x, 0) / xs.length : null;
}

/** Seans VWAP serisi (kümülatif tipik fiyat × hacim). Hacim 0 ise son değer korunur. */
export function vwapSeries(session: TapeBar[]): number[] {
  let pv = 0, v = 0, last = session[0]?.c ?? 0;
  return session.map(b => {
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * b.v; v += b.v;
    if (v > 0) last = pv / v;
    return last;
  });
}

/** Seansın başlangıcı (09:30 ET). Ortam: ET takvimi (usmarket); erken kapanış günleri için 6,5 saat varsayılır. */
export function sessionStartOf(nowMs: number): number {
  return closeMs(etDate(nowMs)) - 6.5 * 3600000;
}

/**
 * Erken dönüş (saf). session: bugünkü 1 dk barlar (tamamlanmış). En az bir ters yönlü uç nokta + ters hareket ≥ REV_COUNTER_PCT.
 * Teyitler yalnız son REV_LOOKBACK_MIN dk içinde aranır. Hangi yön daha çok teyit alırsa o döner; aday/onaylı durumu ayrılır.
 */
export function detectReversal(session: TapeBar[], vw: number[], nowMs: number): Reversal | null {
  if (session.length < 10) return null;
  const K = REGIME_K, last = session[session.length - 1], open = session[0].o;
  const winStart = nowMs - K.REV_LOOKBACK_MIN * MIN_MS;
  const five = resample5(session);
  let lo = session[0], hi = session[0];
  for (const b of session) { if (b.l < lo.l) lo = b; if (b.h > hi.h) hi = b; }
  const lastVw = vw[vw.length - 1];
  const cands: Reversal[] = [];

  for (const dir of ['up', 'down'] as Dir[]) {
    const up = dir === 'up';
    const ext = up ? lo : hi;
    // Önceki hareket ters yönde ve uç nokta son mumdan önce
    const priorOk = up ? ext.l <= open * (1 - K.REV_COUNTER_PCT / 100) : ext.h >= open * (1 + K.REV_COUNTER_PCT / 100);
    if (!priorOk || ext.t >= last.t) continue;
    const counterPct = up ? (last.c - ext.l) / ext.l * 100 : (ext.h - last.c) / ext.h * 100;
    if (counterPct < K.REV_COUNTER_PCT) continue;
    const signals: string[] = [];

    // 1) VWAP geri alma / kaybı: son pencerede geçiş + öncesinde yeterince uzun ters taraf
    if (lastVw != null && (up ? last.c > lastVw : last.c < lastVw)) {
      for (let i = 1; i < session.length; i++) {
        if (session[i].t < winStart) continue;
        const prevSide = up ? session[i - 1].c < vw[i - 1] : session[i - 1].c > vw[i - 1];
        const side = up ? session[i].c > vw[i] : session[i].c < vw[i];
        if (!(prevSide && side)) continue;
        let held = 0;
        for (let j = i - 1; j >= 0 && (up ? session[j].c < vw[j] : session[j].c > vw[j]); j--) held++;
        if (held >= K.VWAP_HOLD_MIN) { signals.push(up ? 'VWAP geri alındı' : 'VWAP kaybedildi'); break; }
      }
    }

    // 2) Yüksek hacimli ters mum (5 dk): hacim ≥ REV_VOL_MULT × önceki ortalama ve fitil ya da yutan mum
    for (let i = 1; i < five.length && !signals.some(s => s.includes('hacimli')); i++) {
      const b = five[i], p = five[i - 1];
      if (b.t < winStart) continue;
      const prior = five.slice(Math.max(0, i - K.REV_VOL_AVG_N), i);
      const avgV = prior.reduce((a, x) => a + x.v, 0) / Math.max(1, prior.length);
      if (avgV <= 0 || b.v < K.REV_VOL_MULT * avgV) continue;
      const range = b.h - b.l;
      if (range <= 0) continue;
      const wick = up ? Math.min(b.o, b.c) - b.l : b.h - Math.max(b.o, b.c);
      const bodyOk = up ? b.c > b.o : b.c < b.o;
      const prevOpp = up ? p.c < p.o : p.c > p.o;
      const engulf = up ? prevOpp && b.c > p.o && b.o < p.c : prevOpp && b.c < p.o && b.o > p.c;
      if (bodyOk && (wick / range >= K.REV_WICK_FRAC || engulf)) signals.push(up ? 'yüksek hacimli yükseliş mumu' : 'yüksek hacimli düşüş mumu');
    }

    // 3) 5 dk yapı: yükselen dip (+ son tepe kırılımı) veya alçalan tepe (+ son dip kırılımı), uç noktadan sonra
    const piv = (i: number, hiP: boolean) => hiP
      ? five[i].h > five[i - 1].h && five[i].h > five[i + 1].h
      : five[i].l < five[i - 1].l && five[i].l < five[i + 1].l;
    const pivots: number[] = [];
    for (let i = 1; i < five.length - 1; i++) if (piv(i, !up) && five[i].t >= ext.t) pivots.push(i);
    const highs: number[] = [];
    for (let i = 1; i < five.length - 1; i++) if (piv(i, up) && five[i].t >= ext.t) highs.push(i);
    if (pivots.length >= 2 && highs.length >= 1) {
      const a = five[pivots[pivots.length - 2]], b = five[pivots[pivots.length - 1]], h = five[highs[highs.length - 1]];
      if (up && b.l > a.l && last.c > h.h) signals.push('5 dk yükselen dip, tepe kırıldı');
      if (!up && b.h < a.h && last.c < h.l) signals.push('5 dk alçalan tepe, dip kırıldı');
    }

    if (signals.length >= 1) {
      cands.push({ dir, status: signals.length >= K.REV_CONFIRM ? 'onayli' : 'aday', signals, extreme: r2(up ? ext.l : ext.h), extremeT: ext.t, counterPct: r2(counterPct) });
    }
  }
  if (!cands.length) return null;
  return cands.sort((a, b) => (b.signals.length - a.signals.length) || (b.counterPct - a.counterPct))[0];
}

/** Rejim (saf). tape: 1 dk barlar (bu andan önce tamamlanmış olanlar kullanılır); nowMs: rapor/karar anı. */
export function regimeAt(tape: TapeBar[], nowMs: number, sessionStartMs: number): RegimeResult {
  const K = REGIME_K;
  const bars = tape.filter(b => b.t + MIN_MS <= nowMs);
  const session = bars.filter(b => b.t >= sessionStartMs);
  const atr5 = atrOf(resample5(bars));
  const vw = vwapSeries(session);
  const elapsed = Math.min(SESSION_MIN, Math.max(0, (nowMs - sessionStartMs) / MIN_MS));
  const windowMin = Math.min(K.WINDOW_MIN, elapsed);
  const last = session[session.length - 1] ?? null;
  const open = session[0]?.o ?? null;
  const vwNow = vw.length ? vw[vw.length - 1] : null;
  const sessHigh = session.length ? Math.max(...session.map(b => b.h)) : null;
  const sessLow = session.length ? Math.min(...session.map(b => b.l)) : null;
  const reversal = session.length >= K.MIN_SESSION_BARS ? detectReversal(session, vw, nowMs) : null;
  const metrics: RegimeMetrics = { rangeAtr: null, sessFrac: null, volRatio: null, vwapCrosses: 0, sideFrac: null, netAtr: null };
  const base = { windowMin, vwap: vwNow != null ? r2(vwNow) : null, atr5: atr5 != null ? r2(atr5) : null, last: last ? r2(last.c) : null,
    open: open != null ? r2(open) : null, sessHigh: sessHigh != null ? r2(sessHigh) : null, sessLow: sessLow != null ? r2(sessLow) : null, reversal };
  const sessDir: Dir = last && open != null && last.c >= open ? 'up' : 'down';

  if (!last || session.length < K.MIN_SESSION_BARS) {
    return { kind: 'erken', label: 'Erken seans (veri yetersiz)', dir: null, band: null, metrics, reason: 'seans verisi yetersiz', ...base };
  }
  // Onaylı dönüş her şeyin önündedir (eski yön geçersiz)
  if (reversal?.status === 'onayli') {
    const up = reversal.dir === 'up';
    return { kind: up ? 'donus_up' : 'donus_down', label: up ? 'Yukarı dönüş (onaylı)' : 'Aşağı dönüş (onaylı)', dir: reversal.dir, band: null, metrics,
      reason: `${reversal.signals.join(', ')}; uç nokta ${r2(reversal.extreme)}, ters hareket %${reversal.counterPct.toFixed(2).replace('.', ',')}`, ...base };
  }
  const win = session.filter(b => b.t >= nowMs - windowMin * MIN_MS);
  if (windowMin < K.WINDOW_MIN_OK || win.length < 5) {
    const r = reversal ? ` · dönüş adayı (${reversal.dir === 'up' ? 'yukarı' : 'aşağı'}, teyit ${reversal.signals.length}/${K.REV_CONFIRM}; onay bekleniyor)` : '';
    return { kind: 'erken', label: 'Erken seans (veri yetersiz)', dir: null, band: null, metrics, reason: `${Math.round(elapsed)} dk seans${r}`, ...base };
  }

  const wHi = Math.max(...win.map(b => b.h)), wLo = Math.min(...win.map(b => b.l));
  const rangeW = wHi - wLo;
  const sessRange = (sessHigh ?? 0) - (sessLow ?? 0);
  metrics.rangeAtr = atr5 ? rangeW / atr5 : null;
  metrics.sessFrac = sessRange > 0 ? rangeW / sessRange : null;
  const off = session.length - win.length;
  const earlier = session.slice(0, off);
  const winVol = win.reduce((a, b) => a + b.v, 0) / win.length;
  const baseVol = earlier.length >= 10 ? earlier.reduce((a, b) => a + b.v, 0) / earlier.length : null;
  metrics.volRatio = baseVol && baseVol > 0 ? winVol / baseVol : null;
  let prevSide = 0, above = 0;
  win.forEach((b, i) => {
    const side = b.c > vw[off + i] ? 1 : b.c < vw[off + i] ? -1 : 0;
    if (side && prevSide && side !== prevSide) metrics.vwapCrosses++;
    if (side) prevSide = side;
    if (b.c > vw[off + i]) above++;
  });
  metrics.sideFrac = Math.max(above, win.length - above) / win.length;
  const netMove = last.c - win[0].o;
  metrics.netAtr = atr5 ? netMove / atr5 : null;

  const narrow = metrics.rangeAtr != null && metrics.rangeAtr <= K.CONS_RANGE_ATR;
  const tight = metrics.sessFrac != null && metrics.sessFrac <= K.CONS_SESSION_FRAC;
  const falling = metrics.volRatio != null && metrics.volRatio <= K.CONS_VOL_RATIO;
  const chop = metrics.vwapCrosses >= K.CONS_VWAP_CROSSES;
  const fmt1 = (x: number | null, d = 1) => (x == null ? '—' : x.toFixed(d).replace('.', ','));
  const stats = `pencere ${Math.round(windowMin)} dk · aralık ${fmt1(metrics.rangeAtr)} ATR · seansın %${metrics.sessFrac == null ? '—' : Math.round(metrics.sessFrac * 100)} · hacim ${fmt1(metrics.volRatio, 2)}× · VWAP geçişi ${metrics.vwapCrosses}`;
  const rev = reversal ? ` · dönüş adayı (${reversal.dir === 'up' ? 'yukarı' : 'aşağı'}, teyit ${reversal.signals.length}/${K.REV_CONFIRM})` : '';

  if (narrow && tight && (falling || chop)) {
    return { kind: 'konsolidasyon', label: 'KONSOLİDASYON – bant kırılımını bekle', dir: sessDir, band: { high: r2(wHi), low: r2(wLo) }, metrics,
      reason: stats + rev, ...base };
  }
  const side = metrics.sideFrac != null && metrics.sideFrac >= K.TREND_SIDE_FRAC;
  const trendUp = side && last.c > (vwNow ?? last.c) && netMove > 0;
  const trendDn = side && last.c < (vwNow ?? last.c) && netMove < 0;
  if ((trendUp || trendDn) && metrics.netAtr != null && Math.abs(metrics.netAtr) >= K.TREND_MOVE_ATR) {
    const dir: Dir = trendUp ? 'up' : 'down';
    return { kind: dir === 'up' ? 'trend_up' : 'trend_down', label: dir === 'up' ? 'Yükseliş trendi' : 'Düşüş trendi', dir, band: { high: r2(wHi), low: r2(wLo) },
      metrics, reason: stats + rev, ...base };
  }
  return { kind: 'karisik', label: 'Karışık / belirsiz', dir: null, band: { high: r2(wHi), low: r2(wLo) }, metrics, reason: stats + rev, ...base };
}

/** Rejim değişimleri (5 dk adım; yalnız değişen noktalar). Her nokta yalnız o ana kadar tamamlanmış barları görür. */
export function regimeChanges(tape: TapeBar[], sessionStartMs: number, nowMs: number, stepMin = 5): { t: number; kind: RegimeKind }[] {
  const out: { t: number; kind: RegimeKind }[] = [];
  let prev: RegimeKind | null = null;
  for (let t = sessionStartMs + REGIME_K.WINDOW_MIN_OK * MIN_MS; t <= nowMs; t += stepMin * MIN_MS) {
    const kind = regimeAt(tape, t, sessionStartMs).kind;
    if (kind !== prev) out.push({ t, kind });
    prev = kind;
  }
  return out;
}

/** Sonuç / Fırsat kartları için rejim özeti (saf). Bar yoksa null. */
export function regimeSummary(bars: TapeBar[], nowMs: number): { kind: RegimeKind; dir: Dir | null; band: Band | null } | null {
  if (!bars.length) return null;
  const r = regimeAt(bars, nowMs, sessionStartOf(nowMs));
  return { kind: r.kind, dir: r.dir, band: r.band };
}
