/*
 * Kural tabanlı rapor metni (LLM yok). Saf: girdi = ReportInput, çıktı = Report.
 * Her bölüm veri yoksa "veri alınamadı" yazar; eksik veri raporu düşürmez. Yatırım tavsiyesi değildir.
 */
import { fmt } from '../format.ts';
import { contractLabel, fmtUsdShort } from '../flow/model.ts';
import { closeMs } from '../usmarket.ts';
import { istHm, KIND_LABEL, type ReportKind } from './schedule.ts';
import type { FlowAgg, Move, NewsLite, Report, ReportInput, WallSnap } from './types.ts';

const NA = 'veri alınamadı';
export const pctTr = (x: number | null | undefined): string =>
  x == null || !Number.isFinite(x) ? NA : `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), 2)}%`;
const levelTr = (x: number | null | undefined): string => (x == null || !Number.isFinite(x) ? '—' : fmt(x, x % 1 ? 2 : 0));
const dayTr = (day: string) => { const [y, m, d] = day.split('-'); return `${d}.${m}.${y}`; };
const sign = (x: number) => (x >= 0 ? '+' : '');

/** Eğilim eşiği (%): bunun altındaki hareket "yatay" sayılır */
export const BIAS_BAND = 0.25;

/** Açılış eğilimi (kural): vadeliler ağırlıklı (%70), Asya/Avrupa ortalaması (%30). Veri yoksa null. */
export function openBias(futures: Move[], asiaEu: Move[]): { label: string; score: number } | null {
  const avg = (ms: Move[]) => { const xs = ms.map(m => m.pct).filter((x): x is number => x != null); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; };
  const f = avg(futures), a = avg(asiaEu);
  if (f == null && a == null) return null;
  const score = f != null && a != null ? 0.7 * f + 0.3 * a : (f ?? a)!;
  return { score: +score.toFixed(2), label: score >= BIAS_BAND ? 'yukarı açılış eğilimi' : score <= -BIAS_BAND ? 'aşağı açılış eğilimi' : 'yatay / karışık açılış' };
}

/** Seans içi yön (SPY/QQQ açılıştan beri ortalaması) */
export function intraDirection(moves: Move[]): { label: string; avg: number | null } {
  const xs = moves.map(m => m.pct).filter((x): x is number => x != null);
  if (!xs.length) return { label: NA, avg: null };
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
  return { avg: +avg.toFixed(2), label: avg >= BIAS_BAND ? 'yukarı' : avg <= -BIAS_BAND ? 'aşağı' : 'yatay' };
}

/** Duvar kayması satırı: "QQQ · call duvarı 585 (açılış 580, ↑5) · put duvarı 570 (=) · flip 578 · max pain 580" */
export function wallLine(ticker: string, open: WallSnap | null, now: WallSnap | null): string {
  if (!now) return `${ticker}: ${NA}`;
  const shift = (a: number | null, b: number | null) => {
    if (a == null || b == null) return '';
    const d = b - a;
    if (Math.abs(d) < 1e-9) return ' (=)';
    return ` (${d > 0 ? '↑' : '↓'}${fmt(Math.abs(d), Math.abs(d) % 1 ? 2 : 0)})`;
  };
  const ref = (v: number | null, o: number | null | undefined) => `${levelTr(v)}${o != null ? ` [açılış ${levelTr(o)}${shift(o, v)}]` : ''}`;
  return `${ticker}: call duvarı ${ref(now.callWall, open?.callWall)} · put duvarı ${ref(now.putWall, open?.putWall)} · gamma flip ${levelTr(now.flip)}${open?.flip != null ? ` (açılış ${levelTr(open.flip)})` : ''} · max pain ${levelTr(now.maxPain)}`;
}

/** Akış birikimi (ticker'a göre en büyük 5 kontrat-grubu, prime göre) */
export function flowLines(flow: FlowAgg[], limit = 5): string[] {
  return [...flow].sort((a, b) => b.premium - a.premium).slice(0, limit).map(f => {
    const label = contractLabel({ ticker: f.ticker, expiry: f.expiry, strike: f.strike, side: f.side });
    return `${f.ticker}: ${fmt(f.contracts, 0)} kontrat · ${label.replace(f.ticker + ' ', '')} · ~${fmtUsdShort(f.premium)} prim`;
  });
}

/** Gözlem (kural): fiyat gamma flip'in üstünde mi, duvarlara yakın mı */
export function spotNote(s: WallSnap | null): string | null {
  if (!s || s.spot == null) return null;
  const parts: string[] = [];
  if (s.flip != null) parts.push(s.spot > s.flip ? 'gamma flip üstünde (ortalamaya dönüş eğilimi)' : 'gamma flip altında (hareket büyüyebilir)');
  if (s.callWall != null && s.spot < s.callWall && (s.callWall - s.spot) / s.spot < 0.005) parts.push(`call duvarına (${levelTr(s.callWall)}) yakın`);
  if (s.putWall != null && s.spot > s.putWall && (s.spot - s.putWall) / s.spot < 0.005) parts.push(`put duvarına (${levelTr(s.putWall)}) yakın`);
  return parts.join('; ') || null;
}

const macroLabel = (kind: string) => kind === 'FOMC' ? 'FOMC kararı (14:00 ET)' : kind === 'CPI' ? 'CPI enflasyon (08:30 ET)' : 'İstihdam (NFP, 08:30 ET)';
const MACRO_NOTE: Record<string, string> = { FOMC: 'faiz kararı günü: oynaklık artabilir', CPI: 'enflasyon verisi: oynaklık artabilir', NFP: 'istihdam verisi: oynaklık artabilir' };
const newsLines = (news: NewsLite[], limit = 6) => [...news].sort((a, b) => b.at - a.at).slice(0, limit)
  .map(n => `• ${n.title} — ${n.source} (${istHm(n.at)} İst${n.tickers.length ? ', ' + n.tickers.join('/') : ''})`);

function header(kind: ReportKind, input: ReportInput): string {
  return `${KIND_LABEL[kind]} raporu · ${istHm(input.nowMs)} İst · ${dayTr(input.day)}`;
}
const moveRows = (ms: Move[]) => ms.length ? ms.map(m => `  ${m.name}: ${pctTr(m.pct)}${m.price != null ? ` (${levelTr(m.price)})` : ''}`) : [`  ${NA}`];
const earningsLine = (e: ReportInput['earnings'], watch: string[]) => {
  if (e == null) return `  Bilanço bilgisi ${NA}`;
  const rows = e.filter(x => x.date && watch.includes(x.ticker)).sort((a, b) => (a.date! < b.date! ? -1 : 1));
  return rows.length ? rows.map(x => `  ${x.ticker}: ${dayTr(x.date!)}`).join('\n') : '  İzleme listesinde yakın bilanço yok';
};

export function buildReport(input: ReportInput): Report {
  const ts = input.nowMs;
  const fails = input.failures.length ? ['Veri sorunları:', ...input.failures.map(f => `  • ${f}`)] : [];
  if (input.kind === 'premarket') return premarket(input, ts, fails);
  if (input.kind === 'eod') return eod(input, ts, fails);
  return intra(input, ts, fails);
}

function premarket(input: ReportInput, ts: number, fails: string[]): Report {
  const bias = openBias(input.futures, [...input.asia, ...input.europe]);
  const todayMacro = input.macro.today.map(m => `  ${macroLabel(m.kind)} — ${MACRO_NOTE[m.kind]}`);
  const lines = [
    header('premarket', input), '',
    'Asya', ...moveRows(input.asia), 'Avrupa', ...moveRows(input.europe),
    'Vadeliler (ES / NQ)', ...moveRows(input.futures),
    'İzleme listesi — ön piyasa', ...input.preMarket.length
      ? input.preMarket.map(m => `  ${m.name}: ${pctTr(m.pct)}${m.price != null ? ` (${levelTr(m.price)} $)` : ''}`) : [`  ${NA}`],
    '', 'Takvim', ...(todayMacro.length ? todayMacro : ['  Bugün ana makro veri yok']),
    'Bilanço (izleme listesi)', earningsLine(input.earnings, input.watch),
    '', 'Haberler (son 24 saat)', ...(input.newsOk ? (input.news.length ? newsLines(input.news).map(x => '  ' + x) : ['  Önemli haber yok']) : [`  ${NA}`]),
    '', 'Beklenti (kural tabanlı)',
    bias ? `  Vadeliler ve Asya/Avrupa ortalaması: skor ${sign(bias.score)}${fmt(bias.score, 2)} → ${bias.label}` : `  Vadeli/Asya/Avrupa verisi ${NA}; beklenti üretilemedi`,
    todayMacro.length ? '  Bugün makro veri var: açılış ilk 30 dk oynak olabilir.' : '  Bugün makro veri yok.',
    ...fails,
    '', 'Kural tabanlı bir özettir; yatırım tavsiyesi değildir.',
  ];
  const pushLine = bias ? `ES ${pctTr(input.futures.find(f => f.name.includes('ES'))?.pct ?? null)} · NQ ${pctTr(input.futures.find(f => f.name.includes('NQ'))?.pct ?? null)} → ${bias.label}`
    : 'Vadeli verisi alınamadı';
  return { kind: 'premarket', day: input.day, ts, title: `Piyasa öncesi · ${istHm(ts)} İst`, body: lines.join('\n'),
    pushTitle: `Piyasa öncesi raporu hazır`, pushBody: pushLine };
}

function intra(input: ReportInput, ts: number, fails: string[]): Report {
  const dir = intraDirection(input.moves);
  const wallRows = input.walls.length ? input.walls.map(w => '  ' + wallLine(w.ticker, w.open, w.now)) : [`  ${NA}`];
  const notes = input.walls.map(w => spotNote(w.now) && `  ${w.ticker}: ${spotNote(w.now)}`).filter((x): x is string => !!x);
  const fl = flowLines(input.flow);
  const minsLeft = Math.max(0, Math.round((closeMs(input.day) - ts) / 60000));
  const lines = [
    header(input.kind, input), '',
    'Açılıştan beri', ...moveRows(input.moves),
    `  Yön: ${dir.label}${dir.avg != null ? ` (ortalama ${sign(dir.avg)}${fmt(dir.avg, 2)}%)` : ''}`,
    '', 'Duvarlar (açılış → şimdi)', ...wallRows,
    ...(notes.length ? ['', 'Gözlem', ...notes] : []),
    '', 'Opsiyon birikimi (bugün, en büyük)', ...(fl.length ? fl.map(x => '  ' + x) : ['  Eşik üstü birikim yok']),
    '', 'Haberler', ...(input.newsOk ? (input.news.length ? newsLines(input.news, 3).map(x => '  ' + x) : ['  Önemli yeni haber yok']) : [`  ${NA}`]),
    '', 'Beklenti (kural tabanlı)',
    `  Kalan seans (~${minsLeft} dk): ${dir.label === NA ? 'yön verisi yok' : dir.label === 'yatay' ? 'yatay seyir, duvarlar arasında kalma eğilimi' : `${dir.label} yönlü devam ihtimali; ters yön için gamma flip ve duvar seviyeleri izlenir`}`,
    ...fails,
    '', 'Kural tabanlı bir özettir; yatırım tavsiyesi değildir.',
  ];
  const spy = input.moves.find(m => m.name === 'SPY'), qqq = input.moves.find(m => m.name === 'QQQ');
  return { kind: input.kind, day: input.day, ts, title: `${KIND_LABEL[input.kind]} · ${istHm(ts)} İst`, body: lines.join('\n'),
    pushTitle: `${KIND_LABEL[input.kind]}: ${dir.label === NA ? 'yön verisi yok' : `piyasa ${dir.label}`}`,
    pushBody: `SPY ${pctTr(spy?.pct ?? null)} · QQQ ${pctTr(qqq?.pct ?? null)}${fl[0] ? ' · ' + fl[0].split(' · ')[0] : ''}` };
}

function eod(input: ReportInput, ts: number, fails: string[]): Report {
  const smaLines = input.sma.length ? input.sma.map(s => {
    const pos = (v: number | null | undefined) => v == null || s.price == null ? '—' : s.price >= v ? 'üstünde' : 'altında';
    return `  ${s.ticker} ${levelTr(s.price)} · SMA20 ${levelTr(s.sma20)} (${pos(s.sma20)}) · SMA50 ${levelTr(s.sma50)} (${pos(s.sma50)}) · SMA200 ${levelTr(s.sma200)} (${pos(s.sma200)})`;
  }) : [`  ${NA}`];
  const tomorrow = input.macro.tomorrow;
  const trend = input.sma.find(s => s.ticker === 'QQQ') ?? input.sma.find(s => s.ticker === 'SPY');
  const trendTxt = trend && trend.price != null && trend.sma200 != null
    ? (trend.price >= trend.sma200 ? 'uzun vadede yukarı eğilim (200 günlük üstünde)' : 'uzun vadede zayıf (200 günlük altında)')
    : 'trend verisi yok';
  const lines = [
    header('eod', input), '',
    'Gün değişimi', ...moveRows(input.moves),
    '', 'Duvar kayması (açılış → kapanış)', ...(input.walls.length ? input.walls.map(w => '  ' + wallLine(w.ticker, w.open, w.now)) : [`  ${NA}`]),
    '', 'Hareketli ortalamalar (günlük)', ...smaLines,
    '', 'Opsiyon birikimi (bugün, en büyük)', ...(flowLines(input.flow).length ? flowLines(input.flow).map(x => '  ' + x) : ['  Eşik üstü birikim yok']),
    '', 'Haberler (bugün)', ...(input.newsOk ? (input.news.length ? newsLines(input.news).map(x => '  ' + x) : ['  Önemli haber yok']) : [`  ${NA}`]),
    '', 'Yarın beklentisi (kural tabanlı)',
    `  Trend: ${trendTxt}`,
    ...(tomorrow.length ? tomorrow.map(m => `  Yarın: ${macroLabel(m.kind)} — ${MACRO_NOTE[m.kind]}`) : ['  Yarın ana makro veri yok']),
    '  Bilanço (izleme listesi, 2 gün içinde):',
    ...(input.earnings == null ? [`  ${NA}`] : (() => {
      const soon = input.earnings.filter(e => e.date && input.watch.includes(e.ticker) && e.date >= input.day && e.date <= addDay(input.day, 2));
      return soon.length ? soon.map(e => `    ${e.ticker}: ${dayTr(e.date!)}`) : ['    yok'];
    })()),
    ...fails,
    '', 'Kural tabanlı bir özettir; yatırım tavsiyesi değildir.',
  ];
  const spy = input.moves.find(m => m.name === 'SPY'), qqq = input.moves.find(m => m.name === 'QQQ');
  return { kind: 'eod', day: input.day, ts, title: `Gün sonu · ${istHm(ts)} İst`, body: lines.join('\n'),
    pushTitle: 'Gün sonu raporu hazır',
    pushBody: `SPY ${pctTr(spy?.pct ?? null)} · QQQ ${pctTr(qqq?.pct ?? null)} · ${tomorrow.length ? 'yarın ' + macroLabel(tomorrow[0].kind).split(' (')[0] : 'yarın ana veri yok'}` };
}

function addDay(day: string, n: number): string { return new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10); }
