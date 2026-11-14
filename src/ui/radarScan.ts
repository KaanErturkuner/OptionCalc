/* Radar tarama turu: veri (CBOE → Yahoo; MarketData'ya HİÇ gitmez) → anlık görüntü → dedektörler → haber → uyarı → bildirim → isabet. */
import { loadSymbol, loadChain } from '@/lib/market';
import { loadState } from '@/lib/state';
import { flowKeyOf } from '@/lib/flow/client';
import { loadBars } from '@/lib/market/bars';
import type { Chain } from '@/lib/market/types';
import type { Bar } from '@/lib/odte/analytics';
import { trimChain } from '@/lib/odte/scan';
import { buildSnapshot, oiMap } from '@/lib/radar/snapshot';
import { buildBaseline, ivRankOf } from '@/lib/radar/baseline';
import { runDetectors } from '@/lib/radar/detectors';
import { applyCooldown, buildAlerts, type Alert } from '@/lib/radar/engine';
import { priceAt, nextSessionOpen, eodOf, barrierOf, H30, H2 } from '@/lib/radar/track';
import { isEtf, SECTOR } from '@/lib/radar/universe';
import type { DayRecord, Snapshot, Signal } from '@/lib/radar/types';
import { NewsHub, type NewsItem } from '@/lib/news';
import { etDate } from '@/lib/usmarket';
import { radar } from './radarStore';
import { notifyRadar } from './notify';

const hub = new NewsHub();
let running = false;
let recentNews: NewsItem[] = [];
const NEWS_KEEP_MS = 24 * 3600000;

interface Collected { ticker: string; price: number; changePct: number; chain: Chain; expiry: string; bars: Bar[]; source: string; delayedMin: number; dataTime: number }
/** Radar verisi: spot Yahoo kotasyonundan (gecikme alanı kotasyondan), zincir MarketData `cached` (sunucu proxy'si, ~1 sn taze);
 *  anahtar yoksa ya da MarketData düşerse CBOE zinciri (15 dk gecikmeli) — o durumda gecikme 15 dk olarak işaretlenir. */
async function collect(t: string): Promise<Collected | null> {
  try {
    const st = await loadState().catch(() => null);
    const mdKey = flowKeyOf(st?.flowKey) || undefined;
    const Y = await loadSymbol(t, 'yahoo', {});
    const exp = Y.expirations[0]; if (!exp) return null;
    let chainRaw: Chain | null = null, chainSrc = 'MarketData', chainDelay = 0;
    if (mdKey) chainRaw = await loadChain('marketdata', t, exp, { marketdata: mdKey }, 40, { mdMode: 'cached', mdMaxAge: '2min' }).catch(() => null);
    if (!chainRaw) { chainRaw = await loadChain('cboe', t, exp, {}, 40).catch(() => null); chainSrc = 'CBOE'; chainDelay = 15; }
    if (!chainRaw) return null;
    const B = await loadBars(t);
    return { ticker: t, price: Y.quote.price, changePct: Y.quote.changePct, chain: trimChain(chainRaw, Y.quote.price), expiry: exp,
      bars: B.bars, source: `Yahoo + ${chainSrc}`, delayedMin: Math.max(Y.quote.delayedMin, chainDelay), dataTime: Y.quote.time };
  } catch { return null; }
}
async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const x = xs[i++]; out.push(await f(x)); } }));
  return out;
}

/** Tarama turu. Aynı anda ikinci tur başlamaz. Döner: üretilen uyarı sayısı. */
export async function runRadarScan(): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    await radar.load();
    const st = radar.get().settings, now = Date.now(), today = etDate(now);
    const got = (await pool(st.watch, 4, collect)).filter((x): x is Collected => x != null);
    const chg = new Map(got.map(g => [g.ticker, g.changePct]));
    recentNews = recentNews.filter(n => now - n.publishedAt < NEWS_KEEP_MS);
    const fresh = await hub.poll(st.watch, st.watch, now - NEWS_KEEP_MS, { secUa: st.secUa, finnhubKey: st.finnhubKey }, now).catch(() => [] as NewsItem[]);
    recentNews = [...recentNews, ...fresh];
    const snaps = new Map<string, Snapshot>(), baselines = new Map<string, ReturnType<typeof buildBaseline>>(), signals: Signal[] = [];
    for (const g of got) {
      const D = radar.get();
      const hist = (D.days[g.ticker] ?? []).filter(d => d.date < today);
      const base = buildBaseline(hist);
      const oi = D.oi[g.ticker];
      const prevOi = oi ? (oi.latestDate && oi.latestDate < today ? oi.latestMap : oi.prevMap) : null;
      const iv0 = D.ivOpen[g.ticker]?.date === today ? D.ivOpen[g.ticker].iv : null;
      const sectorTk = isEtf(g.ticker) ? null : SECTOR[g.ticker];
      const sector = sectorTk && chg.has(sectorTk) ? { ticker: sectorTk, changePct: chg.get(sectorTk)! } : null;
      const snap = buildSnapshot({ ticker: g.ticker, price: g.price, changePct: g.changePct, chain: g.chain, expiry: g.expiry, bars: g.bars, now,
        source: g.source, delayedMin: g.delayedMin, dataTime: g.dataTime, prevOi, atmIvSession0: iv0, sector });
      if (snap.atmIv != null && iv0 == null) radar.setIvOpen(g.ticker, { date: today, iv: snap.atmIv });
      signals.push(...runDetectors(snap, base));
      snaps.set(g.ticker, snap); baselines.set(g.ticker, base);
      // günlük kayıt (son tarama değeri) ve OI geçmişi
      const ra = snap.pcVol, rec: DayRecord = { date: today, ticker: g.ticker, pcVol: ra, totalVol: snap.totalVol, avgContractVol: snap.avgContractVol,
        atmIv: snap.atmIv, rr25: snap.rr25, close: g.price };
      radar.upsertDay(rec);
      const om = oiMap(g.chain);
      if (!oi) radar.setOi(g.ticker, { prevDate: null, prevMap: null, latestDate: today, latestMap: om });
      else if (oi.latestDate !== today) radar.setOi(g.ticker, { prevDate: oi.latestDate, prevMap: oi.latestMap, latestDate: today, latestMap: om });
      else radar.setOi(g.ticker, { ...oi, latestMap: om });
    }
    const alerts: Alert[] = buildAlerts(snaps, signals, recentNews);
    applyCooldown(alerts, radar.get().alerts);
    radar.addAlerts(alerts);
    for (const a of alerts) if (a.level === 'bildirim' && !a.suppressed) await notifyRadar(a.title, a.body, a.id);
    // Gösterge paneli (QQQ / SPY / SMH)
    const pulse = ['QQQ', 'SPY', 'SMH'].filter(t => snaps.has(t)).map(t => {
      const s = snaps.get(t)!, b = baselines.get(t)!, r = ivRankOf(s.atmIv, b.ivHist).rank;
      const vw = s.vwap == null ? '—' : s.spot >= s.vwap ? 'üstünde' : 'altında';
      const mood = r == null ? 'veri yetersiz' : r <= 15 ? 'rehavet' : r >= 85 ? 'panik' : 'normal';
      return { ticker: t, changePct: +s.changePct.toFixed(2), vwapSide: vw as 'üstünde' | 'altında' | '—', ivRank: r == null ? null : Math.round(r), mood };
    });
    radar.setPulse(pulse, now);
    fillOutcomes(got, now);
    return alerts.length;
  } finally { running = false; }
}

/** İsabet: 30 dk, 2 saat, gün sonu, ertesi gün açılışı — bulunabilen fiyatlarla doldurulur */
function fillOutcomes(got: Collected[], now: number) {
  const barsBy = new Map(got.map(g => [g.ticker, g.bars]));
  for (const a of radar.get().alerts) {
    const bars = barsBy.get(a.ticker); if (!bars?.length || !a.spot) continue;
    const o = a.outcome, patch: Alert['outcome'] = {};
    if (!('m30' in o) && now >= a.at + H30) patch.m30 = priceAt(bars, a.at + H30);
    if (!('h2' in o) && now >= a.at + H2) patch.h2 = priceAt(bars, a.at + H2);
    if (!('eod' in o) && now >= eodOf(a.at)) patch.eod = priceAt(bars, eodOf(a.at), 10 * 60000);
    if (!('next' in o) && etDate(now) > etDate(a.at)) patch.next = nextSessionOpen(bars, a.at);
    if (!('bar' in o) && now >= a.at + H2) patch.bar = barrierOf(a.direction, a.spot, bars, a.at, a.emPct);
    if (Object.keys(patch).length) radar.patchOutcome(a.id, patch);
  }
}
