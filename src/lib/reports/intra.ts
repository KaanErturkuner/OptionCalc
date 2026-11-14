/*
 * Ara rapor görünümü (saf): "Şu ana kadar ne oldu" (seans özeti, rejim değişimleri, en sert 15 dk hareket) ve
 * "Bundan sonra ne bekleniyor" (devam / dönüş / yatay olasılıkları, tetikleyici seviyeler). Kural tabanlı tahmindir;
 * olasılıklar tam sayı ve toplamı 100. Girdi: QQQ (yoksa SPY) 1 dk barları; ağ YOK. Rejim: src/lib/market/regime.ts.
 *
 * Senaryo tanımı (rejim yönüne göre, "yön" = rejimin yönü; yön yoksa seansın yönü):
 *   devam  = fiyat yön tarafında devam eder (konsolidasyonda: bant yön tarafında kırılır)
 *   dönüş  = fiyat ters yöne döner (konsolidasyonda: bant ters tarafta kırılır)
 *   yatay  = bant / pencere içinde kalır
 * Taban olasılıklar BASE (rejime göre), VWAP tarafı ±SIDE_SHIFT puan oynatır; sonuç normalize100 ile toplamı 100 olur.
 */
import { fmt } from '../format.ts';
import { exDivMs } from '../usmarket.ts';
import { confirmedRegimeAt, regimeChanges, REGIME_K, MIN_MS, type Dir, type RegimeKind, type RegimeResult, type TapeBar } from '../market/regime.ts';
import { istHm } from './schedule.ts';
import { pctTr } from './rules.ts';
import type { Bias, IntraScenario, IntraView, ReportInput } from './types.ts';

export const INTRA_METHOD = 'kural tabanlı tahiminler — yatırım tavsiyesi değildir';
/** Taban olasılıklar [devam, dönüş, yatay] (toplam 100) */
export const BASE: Record<RegimeKind, [number, number, number]> = {
  konsolidasyon: [25, 20, 55], trend_up: [50, 25, 25], trend_down: [50, 25, 25],
  donus_up: [45, 20, 35], donus_down: [45, 20, 35], karisik: [30, 30, 40], erken: [33, 33, 34],
};
/** VWAP tarafı kayması (puan): yön tarafındaysa devam +, değilse dönüş + (yataydan alınır) */
export const SIDE_SHIFT = 5;
/** En sert hareket penceresi (dk) */
export const MOVE_WINDOW = 15;

const lv = (x: number) => fmt(x, x % 1 ? 2 : 0);
const SHORT: Record<RegimeKind, string> = {
  erken: 'erken seans', konsolidasyon: 'konsolidasyon', trend_up: 'yükseliş trendi', trend_down: 'düşüş trendi',
  donus_up: 'yukarı dönüş (onaylı)', donus_down: 'aşağı dönüş (onaylı)', karisik: 'karışık',
};
const BIAS_OF: Record<RegimeKind, Bias | null> = {
  erken: null, konsolidasyon: 'BEKLE', trend_up: 'CALL', trend_down: 'PUT', donus_up: 'CALL', donus_down: 'PUT', karisik: 'BEKLE',
};

/** Tam sayı olasılıklar (en büyük kalan yöntemi): toplam tam 100 */
export function normalize100(xs: number[]): number[] {
  const total = xs.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return xs.map((_, i) => Math.floor(100 / xs.length) + (i < 100 % xs.length ? 1 : 0));
  const raw = xs.map(x => (x * 100) / total);
  const out = raw.map(Math.floor);
  let rem = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f).forEach(({ i }) => { if (rem > 0) { out[i]++; rem--; } });
  return out;
}

/** Senaryo olasılıkları: taban + VWAP tarafı kayması; toplam 100 */
export function scenarioPcts(kind: RegimeKind, dir: Dir, last: number | null, vwap: number | null): [number, number, number] {
  const [d, r, y] = BASE[kind];
  let dev = d, rev = r, yat = y;
  if (last != null && vwap != null && last !== vwap) {
    const onDirSide = dir === 'up' ? last > vwap : last < vwap;
    const shift = Math.min(SIDE_SHIFT, Math.max(0, yat - 5));   // yatay en az %5 kalır
    if (onDirSide) dev += shift; else rev += shift;
    yat -= shift;
  }
  const [a, b, c] = normalize100([dev, rev, yat]);
  return [a, b, c];
}

/** Tetikleyiciler: bant (yoksa seans) üst/alt; yön tarafında kırılım = devam, ters kırılım = dönüş */
export function triggersOf(band: { high: number; low: number } | null, sessHigh: number | null, sessLow: number | null, vwap: number | null, dir: Dir): { devam: string; donus: string; yatay: string } {
  const H = band?.high ?? sessHigh, L = band?.low ?? sessLow;
  const vt = vwap != null ? ` · VWAP ${lv(vwap)}` : '';
  if (H == null || L == null) return { devam: 'seviye verisi yok', donus: 'seviye verisi yok', yatay: 'seviye verisi yok' };
  if (dir === 'up') return {
    devam: `${lv(H)} üstü kapanış → CALL devamı`,
    donus: `${lv(L)} altı kapanış → PUT (dönüş)`,
    yatay: `${lv(L)}–${lv(H)} arasında kalırsa${vt}`,
  };
  return {
    devam: `${lv(L)} altı kapanış → PUT devamı`,
    donus: `${lv(H)} üstü kapanış → CALL (dönüş)`,
    yatay: `${lv(L)}–${lv(H)} arasında kalırsa${vt}`,
  };
}

/** Rejime göre plan cümlesi (tek cümle). Band yoksa "seviye verisi yok" der. */
export function intraPlan(r: RegimeResult): string {
  const H = r.band?.high ?? null, L = r.band?.low ?? null;
  const bandTxt = H != null && L != null ? `${lv(H)}–${lv(L)}` : null;
  switch (r.kind) {
    case 'konsolidasyon':
      return bandTxt ? `Bant üstü ${lv(H!)} → CALL, bant altı ${lv(L!)} → PUT; bant içinde işlem beklenir${r.vwap != null ? ` (VWAP ${lv(r.vwap)})` : ''}.` : 'Konsolidasyon; bant seviyesi yok, kırılım beklenir.';
    case 'trend_up': return `Yükseliş rejimi: ${L != null ? lv(L) + ' altı kapanış' : 'VWAP altı kapanış'} tezi bozar${H != null ? `; hedef yeni zirve ${lv(H)} üstü` : ''}.`;
    case 'trend_down': return `Düşüş rejimi: ${H != null ? lv(H) + ' üstü kapanış' : 'VWAP üstü kapanış'} tezi bozar${L != null ? `; hedef yeni dip ${lv(L)} altı` : ''}.`;
    case 'donus_up': return `Onaylı yukarı dönüş: eski düşüş yönü geçersiz; ${L != null ? lv(L) + ' altı kapanış' : 'VWAP altı kapanış'} dönüşü bozar.`;
    case 'donus_down': return `Onaylı aşağı dönüş: eski yükseliş yönü geçersiz; ${H != null ? lv(H) + ' üstü kapanış' : 'VWAP üstü kapanış'} dönüşü bozar.`;
    case 'karisik': return bandTxt ? `Net rejim yok; ${bandTxt} kırılımı beklenir.` : 'Net rejim yok; kırılımlar izlenir.';
    default: return 'Seans henüz yeterince oluşmadı; yön yorumu için bekle.';
  }
}

/** Ara rapor görünümü. tapes: öncelik sırasıyla (QQQ, SPY…). Bar yoksa null. */
export function intraView(tapes: { ticker: string; bars: TapeBar[] }[], nowMs: number, sessionStartMs: number): IntraView | null {
  const pick = tapes.find(t => t.bars.some(b => b.t >= sessionStartMs && b.t + MIN_MS <= nowMs));
  if (!pick) return null;
  const bars = pick.bars;
  const cr = confirmedRegimeAt(bars, nowMs, sessionStartMs);
  const r = cr.confirmed;   // rapor onaylı rejimi gösterir (histerezis); ham rejim yalnız aday bilgisi olarak
  if (r.last == null || r.open == null) return null;
  const session = bars.filter(b => b.t >= sessionStartMs && b.t + MIN_MS <= nowMs);
  const hi = session.reduce((a, b) => (b.h > a.h ? b : a));
  const lo = session.reduce((a, b) => (b.l < a.l ? b : a));
  const lastBar = session[session.length - 1];
  const changes = regimeChanges(bars, sessionStartMs, nowMs);

  // En sert 15 dk hareket (kapanıştan kapanışa)
  let keyMove: string | null = null, best = 0;
  for (let i = MOVE_WINDOW; i < session.length; i++) {
    const p = session[i - MOVE_WINDOW].c, c = session[i].c;
    const pct = (c - p) / p * 100;
    if (Math.abs(pct) > Math.abs(best)) {
      best = pct;
      keyMove = `En sert 15 dk hareket: ${istHm(session[i - MOVE_WINDOW].t)}–${istHm(session[i].t)} İst, ${pctTr(pct)} (${lv(p)} → ${lv(c)})`;
    }
  }

  const dir: Dir = r.dir ?? (r.last >= r.open ? 'up' : 'down');
  const trig = triggersOf(r.band, r.sessHigh, r.sessLow, r.vwap, dir);
  const [pDev, pDon, pYat] = scenarioPcts(r.kind, dir, r.last, r.vwap);
  const dirTr = dir === 'up' ? 'yukarı' : 'aşağı';
  const scenarios: IntraScenario[] = [
    { key: 'devam', label: `Devam (${dirTr})`, pct: pDev, trigger: trig.devam },
    { key: 'donus', label: `Dönüş (${dir === 'up' ? 'aşağı' : 'yukarı'})`, pct: pDon, trigger: trig.donus },
    { key: 'yatay', label: 'Yatay', pct: pYat, trigger: trig.yatay },
  ];

  const recap: string[] = [
    `Açılış ${lv(r.open)} (${istHm(sessionStartMs)} İst)`,
    `Seans yükseği ${lv(hi.h)} (${istHm(hi.t)} İst), dibi ${lv(lo.l)} (${istHm(lo.t)} İst)`,
    `VWAP ${r.vwap != null ? lv(r.vwap) : '—'}; son ${lv(r.last)} (${istHm(lastBar.t)} İst), açılışa göre ${pctTr((r.last - r.open) / r.open * 100)}`,
    changes.length
      ? `Rejim: ${changes.map(c => `${istHm(c.t)} ${SHORT[c.kind]}`).join(' → ')}`
      : `Rejim değişmedi: ${SHORT[r.kind]}`,
    ...(cr.pending ? [`Onay bekleniyor: ${SHORT[cr.pending.kind]} (${cr.pending.run}/${REGIME_K.HYST_BARS} kapanış)`] : []),
    ...(keyMove ? [keyMove] : []),
  ];

  return {
    method: INTRA_METHOD, ticker: pick.ticker, asOf: nowMs,
    kind: r.kind, label: r.label, reason: r.reason, bias: BIAS_OF[r.kind], dir: r.dir,
    band: r.band, plan: intraPlan(r), recap, scenarios, rawKind: cr.raw.kind, pending: cr.pending,
    reversal: r.reversal ? `${r.reversal.status === 'onayli' ? 'onaylı' : 'aday'} ${r.reversal.dir === 'up' ? 'yukarı' : 'aşağı'} dönüş: ${r.reversal.signals.join(', ')}` : null,
  };
}

/** Rapor girdisinden ara görünüm (yalnız intra türleri; sahte veri yok: bar yoksa null) */
export function intraOf(input: ReportInput): IntraView | null {
  if (input.kind === 'premarket' || input.kind === 'eod' || !input.tape?.length) return null;
  return intraView(input.tape, input.nowMs, exDivMs(input.day));
}
