/*
 * Rapor bölümleri (saf, ağ YOK): ReportInput → ReportSections. Düz metin (text.ts) ile aynı girdi ve aynı kurallar
 * (rules.ts); fark yalnız biçim: uygulama kartları, rozetleri, zaman çizelgesini ve duvar merdivenini bu veriyle çizer.
 * Eksik veri null / boş liste olarak kalır; görünüm "veri alınamadı" yazar, rapor düşmez.
 */
import { fmt } from '../format.ts';
import { contractLabel } from '../flow/model.ts';
import { etMs, istHmOf, type MacroLite } from '../calendar/releases.ts';
import { istHm } from './schedule.ts';
import { biasOf, intraDirection, openBias, pctTr } from './rules.ts';
import type {
  Bias, Chip, CalItem, FlowSection, FlowTop, Impact, KeyLevel, Move, NewsCard, NewsLite, ReportInput, ReportSections,
  ShiftRow, Tone, WallRow,
} from './types.ts';

/** Seviye metni: tam sayıysa tam, değilse 2 ondalık (Türkçe virgül). Yok → null */
export const levelText = (x: number | null | undefined): string | null =>
  x == null || !Number.isFinite(x) ? null : fmt(x, x % 1 ? 2 : 0);

/** Renk tonu: yüzde değişimin işaretine göre (±0,005 altı nötr) */
export const toneOf = (pct: number | null | undefined): Tone =>
  pct == null || !Number.isFinite(pct) ? 'muted' : pct > 0.005 ? 'pos' : pct < -0.005 ? 'neg' : 'text';

/** Duvar kayması oku: önceki → şimdi. Veri eksikse null (ok gösterilmez). */
export function shiftArrow(from: number | null | undefined, to: number | null | undefined): '↑' | '↓' | '=' | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const d = to - from;
  if (Math.abs(d) < 1e-9) return '=';
  return d > 0 ? '↑' : '↓';
}

/** Haber etki sınıfı (kural): makro anahtar kelime → yüksek; izleme tickerı → orta; diğer → düşük */
const HIGH_NEWS = /\b(fed|fomc|powell|cpi|ppi|pce|nfp|payrolls?|jobs report|tariffs?|recession|rate (?:cut|hike)|inflation|gdp|war|default|shutdown)\b|faiz|enflasyon|tarife|resesyon|savaş/i;
export function newsImpact(n: Pick<NewsLite, 'title' | 'tickers'>, watch: string[]): { impact: Impact; tag: string } {
  if (HIGH_NEWS.test(n.title)) return { impact: 'high', tag: 'Makro' };
  if (n.tickers.some(t => watch.includes(t))) return { impact: 'med', tag: 'İzleme' };
  return { impact: 'low', tag: 'Genel' };
}

/** Takvim etkisi: FOMC/CPI/NFP sınıfı yüksek; orta; diğer düşük */
const tierImpact = (m: MacroLite): Impact => (m.tier === 'high' ? 'high' : m.tier === 'medium' ? 'med' : 'low');

/** Bölüm 1: eğilim kararı. Piyasa öncesi: vadeli+Asya/Avrupa skoru; diğer: izleme listesi ortalaması (açılıştan beri / gün). */
export function decideBias(input: ReportInput): { bias: Bias; dataOk: boolean } {
  if (input.kind === 'premarket') return biasOf(openBias(input.futures, [...input.asia, ...input.europe])?.score ?? null);
  return biasOf(intraDirection(input.moves).avg);
}

/** Beklenti için kullanılacak CALL/PUT/BEKLE (veri yoksa null): piyasa öncesi raporun sonucu gün sonu karşılaştırmasında kullanılır */
export function expectationOf(s: Pick<ReportSections, 'summary'>): Bias | null {
  return s.summary.dataOk ? s.summary.bias : null;
}

/** Duvar satırları: canlı (açılış → şimdi) ya da önceki kapanış zinciri (basis) */
export function wallRows(input: ReportInput): WallRow[] {
  const source = input.basis?.source ?? 'canlı zincir (akış tarayıcısı)';
  return input.walls.map(({ ticker, open, now }) => ({
    ticker,
    spot: now?.spot ?? open?.spot ?? null,
    callWall: now?.callWall ?? null,
    putWall: now?.putWall ?? null,
    gammaFlip: now?.flip ?? null,
    maxPain: now?.maxPain ?? null,
    prev: open ? { callWall: open.callWall, putWall: open.putWall, gammaFlip: open.flip } : null,
    prevLabel: open ? (input.basis?.openLabel ?? 'açılış') : null,
    source,
  }));
}

/** Duvar kayması satırları (önceki → şimdi). Her iki değer de varsa. */
export function wallShifts(rows: WallRow[]): ShiftRow[] {
  const out: ShiftRow[] = [];
  for (const r of rows) {
    if (!r.prev) continue;
    const pairs: [string, number | null | undefined, number | null][] = [
      ['call duvarı', r.prev.callWall, r.callWall], ['put duvarı', r.prev.putWall, r.putWall], ['gamma flip', r.prev.gammaFlip, r.gammaFlip],
    ];
    for (const [what, from, to] of pairs) {
      const arrow = shiftArrow(from, to);
      if (arrow && from != null && to != null) out.push({ ticker: r.ticker, what, from, to, arrow });
    }
  }
  return out;
}

/** Ana ticker: QQQ, yoksa SPY, yoksa ilk seviyesi olan satır */
export function primaryWall(rows: WallRow[]): WallRow | null {
  const has = (r: WallRow) => r.callWall != null || r.putWall != null || r.gammaFlip != null;
  return rows.find(r => r.ticker === 'QQQ' && has(r)) ?? rows.find(r => r.ticker === 'SPY' && has(r)) ?? rows.find(has) ?? null;
}

/** Ana seviyeler (kart): ana tickerın duvarları, flip ve max pain (yoksa atlanır) */
export function keyLevelsOf(w: WallRow | null): KeyLevel[] {
  if (!w) return [];
  const out: KeyLevel[] = [];
  const add = (label: string, v: number | null) => { const t = levelText(v); if (t) out.push({ label, value: t }); };
  add(`${w.ticker} call duvarı`, w.callWall);
  add(`${w.ticker} put duvarı`, w.putWall);
  add('Gamma flip', w.gammaFlip);
  add('Max pain', w.maxPain);
  return out;
}

/**
 * Eylem planı: TEK cümle, kurala göre. Yön veri yoksa "veri alınamadı" der; seviye yoksa yalnız yön izlenir.
 * CALL: flip üstü + call duvarı hedef + put altı kırılımı tez bozar. PUT: tersi. BEKLE: put–call aralığında bekle.
 */
export function planText(bias: Bias, dataOk: boolean, w: WallRow | null): string {
  if (!dataOk) return 'Yön verisi alınamadı; plan üretilemedi, yalnız seviyeler izlenir.';
  const c = levelText(w?.callWall), p = levelText(w?.putWall), f = levelText(w?.gammaFlip);
  if (bias === 'CALL') {
    const parts = [
      f && `${f} üzerinde kaldıkça yükseliş tezi geçerli`,
      c && `hedef call duvarı ${c}`,
      p && `${p} altına kapanış tezi bozar`,
    ].filter(Boolean);
    return parts.length ? `${parts.join('; ')}.` : 'Yükseliş eğilimi var; seviye verisi yok, yalnız yön izlenir.';
  }
  if (bias === 'PUT') {
    const parts = [
      f && `${f} altında kaldıkça aşağı tez geçerli`,
      p && `hedef put duvarı ${p}`,
      c && `${c} üzerine kapanış tezi bozar`,
    ].filter(Boolean);
    return parts.length ? `${parts.join('; ')}.` : 'Aşağı eğilim var; seviye verisi yok, yalnız yön izlenir.';
  }
  if (p && c) return `${p}–${c} aralığında kalındıkça bekle; ${f ? `${f} kırılımı yeni yönü gösterir` : 'kırılımlar izlenir'}.`;
  return 'Net yön yok; seviye verisi yok, bekle.';
}

/** Metrik kartları: izleme listesi (QQQ/SPY önce) → VIX → vadeliler → Asya/Avrupa → ön piyasa */
export function metricChips(input: ReportInput): Chip[] {
  const chip = (label: string, m: Move | null | undefined, sub?: string | null): Chip => ({
    label, value: m?.pct == null ? '—' : pctTr(m.pct), sub: sub ?? (m?.price != null ? (levelText(m.price) ?? undefined) : undefined),
    tone: toneOf(m?.pct ?? null),
  });
  const rank = (m: Move) => (m.name === 'QQQ' ? 0 : m.name === 'SPY' ? 1 : 2);
  const out: Chip[] = [];
  for (const m of [...input.moves].sort((a, b) => rank(a) - rank(b))) out.push(chip(m.name, m));
  if (input.vix) out.push({ ...chip('VIX', input.vix), tone: 'text' });
  for (const m of input.futures) out.push(chip(m.name.split(' ')[0], m));
  for (const m of [...input.asia, ...input.europe]) out.push(chip(m.name, m));
  for (const m of input.preMarket) out.push(chip(`${m.name} ön`, m));
  return out;
}

/** Takvim: bugünkü olaylar + (gün sonunda) yarınkiler; saat ET + İstanbul; açıklandı/bekleniyor */
export function calendarItems(input: ReportInput): CalItem[] {
  const item = (m: MacroLite, tomorrow: boolean): CalItem => {
    const ms = etMs(m.day, m.time);
    return { time: `${m.time} ET`, istTime: istHmOf(ms), name: m.label, impact: tierImpact(m), released: ms <= input.nowMs, verified: m.verified, tomorrow };
  };
  return [...input.macro.today.map(m => item(m, false)), ...input.macro.tomorrow.map(m => item(m, true))];
}

/** Haberler: yeni → eski; etki sınıfı ile */
export function newsCards(input: ReportInput): NewsCard[] {
  const limit = input.kind === 'premarket' || input.kind === 'eod' ? 6 : 3;
  if (!input.newsOk) return [];
  return [...input.news].sort((a, b) => b.at - a.at).slice(0, limit).map(n => {
    const { impact, tag } = newsImpact(n, input.watch);
    return { headline: n.title, source: n.source, time: istHm(n.at), impact, tag };
  });
}

/** Birikim (akış): call/put prim toplamı (stacking) ve en büyük 5 kontrat */
export function flowSection(input: ReportInput): FlowSection {
  const call = input.flow.filter(f => f.side === 'call').reduce((a, f) => a + f.premium, 0);
  const put = input.flow.filter(f => f.side === 'put').reduce((a, f) => a + f.premium, 0);
  const top: FlowTop[] = [...input.flow].sort((a, b) => b.premium - a.premium).slice(0, 5).map(f => ({
    label: contractLabel({ ticker: f.ticker, expiry: f.expiry, strike: f.strike, side: f.side }),
    side: f.side, contracts: f.contracts, premium: f.premium,
  }));
  return {
    known: input.flowKnown !== false,
    callPremium: call, putPremium: put,
    callShare: call + put > 0 ? call / (call + put) : null,
    source: input.basis?.flowHead ?? 'Eşik üstü birikim (bugün, canlı)',
    top,
  };
}

/** Gün sonu incelemesi: sabah beklentisi – gün sonu eğilimi; duvar kaymaları; yarın planı */
export function eodReview(input: ReportInput, actual: Bias, dataOk: boolean, rows: WallRow[], plan: string): NonNullable<ReportSections['eod']> {
  const expected = input.morningBias ?? null;
  const dir = intraDirection(input.moves);
  return {
    expected,
    actual,
    result: expected == null || !dataOk ? 'veri yok' : expected === actual ? 'hit' : 'miss',
    outcome: dir.avg == null ? 'veri alınamadı' : `izleme ort. ${pctTr(dir.avg)} (${dir.label})`,
    shifts: wallShifts(rows),
    plan,
  };
}

/** Tüm bölümler (tek giriş noktası). Saf: aynı girdi → aynı çıktı. */
export function buildSections(input: ReportInput): ReportSections {
  const { bias, dataOk } = decideBias(input);
  const walls = wallRows(input);
  const primary = primaryWall(walls);
  const plan = planText(bias, dataOk, primary);   // gün sonunda bu plan "yarın" planıdır (kapanış seviyeleri ile)
  return {
    v: 1,
    summary: { bias, dataOk, keyLevels: keyLevelsOf(primary), plan },
    metrics: metricChips(input),
    walls,
    calendar: calendarItems(input),
    news: newsCards(input),
    newsOk: input.newsOk,
    flow: flowSection(input),
    eod: input.kind === 'eod' ? eodReview(input, bias, dataOk, walls, plan) : null,
    failures: [...input.failures],
  };
}
