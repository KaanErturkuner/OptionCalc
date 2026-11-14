/* Uyarı motoru (Aşama D): gruplama, puanlama, haber/sektör teyidi, eşikler, soğuma, günlük tavan. */
import { etDate } from '../usmarket.ts';
import { relatedNews } from '../news/index.ts';
import type { NewsItem } from '../news/types.ts';
import type { Direction, Signal, SignalKind, Snapshot } from './types.ts';
import { renderAlert } from './text.ts';

export const NOTIFY_MIN = 0.6, LIST_MIN = 0.35, DAILY_NOTIFY_CAP = 12, COOLDOWN_MS = 60 * 60000, GROUP_MS = 30 * 60000;
const NO_NEWS_KINDS: SignalKind[] = ['unusual', 'ivJump', 'oiBuild'];

export interface Alert {
  id: string; ticker: string; direction: Direction; score: number; at: number;
  level: 'bildirim' | 'liste'; suppressed: boolean;
  kinds: SignalKind[]; signals: Signal[];
  news: NewsItem | null; newsConfirm: boolean; sectorConfirm: boolean; noNews: boolean;
  expiry: string | null; dte: number | null; spot: number; expectedMove: number | null; emPct: number | null;
  probUp: number | null; dataAgeSec: number; source: string; delayedMin: number;
  title: string; body: string; feedback: 1 | -1 | null;
  outcome: { m30?: number | null; h2?: number | null; eod?: number | null; next?: number | null; bar?: 'win' | 'loss' | 'timeout' | null };
}

/** Aynı kaynaktan türeyen sinyaller (ör. P/C yığılması + olağan dışı kontrat + OI birikimi hepsi akış verisi) bağımsız kanıt değildir.
 *  Bu yüzden her aileden yalnız en güçlü şiddet alınır, aileler arasında 1 − Π(1 − max_aile) birleşimi uygulanır. */
export const FAMILY: Partial<Record<SignalKind, string>> = {
  pcSurge: 'akis', unusual: 'akis', oiBuild: 'akis',
  ivJump: 'vol', skew: 'vol', complacency: 'vol', panic: 'vol',
  pin: 'yapi', gamma: 'yapi', sector: 'goreli', earnings: 'olay', trend: 'trend',
};
export function combineScore(sigs: Signal[]): number {
  const best = new Map<string, number>();
  for (const x of sigs) { const f = FAMILY[x.kind] ?? x.kind; best.set(f, Math.max(best.get(f) ?? 0, x.severity)); }
  return 1 - [...best.values()].reduce((p, v) => p * (1 - v), 1);
}
/** Bildirim için en az bir teyit: iki farklı aile, haber, sektör ya da onaylı trend girişi. Tek aileden gelen akış/vol uyarısı yalnız listede kalır. */
export function isConfirmed(sigs: Signal[], newsConfirm: boolean, sectorConfirm: boolean): boolean {
  const fams = new Set(sigs.map(x => FAMILY[x.kind] ?? x.kind));
  return fams.size >= 2 || newsConfirm || sectorConfirm || sigs.some(x => x.kind === 'trend');
}

const aligned = (sent: number | undefined, dir: Direction) => dir === 'bull' ? (sent ?? 0) > 0 : dir === 'bear' ? (sent ?? 0) < 0 : true;

/** Aynı ticker + yön, 30 dk penceresinde tek grup */
export function groupSignals(signals: Signal[]): { ticker: string; direction: Direction; signals: Signal[]; start: number }[] {
  const groups: { ticker: string; direction: Direction; signals: Signal[]; start: number }[] = [];
  for (const s of [...signals].sort((a, b) => a.at - b.at)) {
    const g = groups.find(x => x.ticker === s.ticker && x.direction === s.direction && s.at - x.start <= GROUP_MS);
    if (g) g.signals.push(s); else groups.push({ ticker: s.ticker, direction: s.direction, signals: [s], start: s.at });
  }
  return groups;
}

/** Sinyallerden uyarılar: score = 1 − Π(1 − sev); haber teyidi +0,1; sektör teyidi +0,1 (üst sınır 1). Haber yokken IV/OI/sıra dışı kontrat +0,1 şiddet. */
export function buildAlerts(snaps: Map<string, Snapshot>, signals: Signal[], news: NewsItem[]): Alert[] {
  const out: Alert[] = [];
  for (const g of groupSignals(signals)) {
    const snap = snaps.get(g.ticker);
    const related = relatedNews(news, g.ticker, g.start);
    const newsConfirm = related.some(n => aligned(n.sentiment, g.direction));
    const noNews = related.length === 0;
    const sigs = g.signals.map(x => ({ ...x, severity: noNews && NO_NEWS_KINDS.includes(x.kind) ? Math.min(1, x.severity + 0.1) : x.severity }));
    let score = combineScore(sigs);
    const sectorConfirm = !!snap?.sector && (g.direction === 'bull' ? snap.sector.changePct > 0 : g.direction === 'bear' ? snap.sector.changePct < 0 : false);
    if (newsConfirm) score += 0.1;
    if (sectorConfirm) score += 0.1;
    score = Math.min(1, score);
    if (score < LIST_MIN) continue;
    const kinds = [...new Set(sigs.sort((a, b) => b.severity - a.severity).map(x => x.kind))];
    const news0 = related[0] ?? null;
    const text = renderAlert({ ticker: g.ticker, direction: g.direction, score, signals: sigs, news: news0, noNews, dataAgeSec: snap?.dataAgeSec ?? 0,
      source: snap?.source ?? '', delayedMin: snap?.delayedMin ?? 0, probUp: snap?.probUp ?? null, now: g.start, expiry: snap?.expiry, dte: snap?.dte });
    out.push({
      id: `${g.ticker}-${g.direction}-${g.start}`, ticker: g.ticker, direction: g.direction, score, at: g.start,
      level: score >= NOTIFY_MIN && isConfirmed(sigs, newsConfirm, sectorConfirm) ? 'bildirim' : 'liste', suppressed: false, kinds, signals: sigs,
      news: news0, newsConfirm, sectorConfirm, noNews,
      expiry: snap?.expiry ?? null, dte: snap?.dte ?? null, spot: snap?.spot ?? 0, expectedMove: snap?.expectedMove ?? null, emPct: snap?.emPct ?? null,
      probUp: snap?.probUp ?? null, dataAgeSec: snap?.dataAgeSec ?? 0, source: snap?.source ?? '', delayedMin: snap?.delayedMin ?? 0,
      title: text.title, body: text.body, feedback: null, outcome: {},
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Soğuma (aynı ticker + birincil tür için 60 dk; skor ≥ 0,2 artmadıkça bildirim yok) ve günlük bildirim tavanı (12). Geçmiş uyarılar history'den. */
export function applyCooldown(alerts: Alert[], history: Alert[]): Alert[] {
  const all = [...history];
  for (const a of [...alerts].sort((x, y) => x.at - y.at)) {
    const prev = all.filter(h => h.ticker === a.ticker && h.kinds[0] === a.kinds[0] && h.at < a.at && a.at - h.at < COOLDOWN_MS).sort((x, y) => y.at - x.at)[0];
    if (prev && a.score < prev.score + 0.2) a.suppressed = true;
    if (a.level === 'bildirim' && !a.suppressed) {
      const day = etDate(a.at);
      const sentToday = all.filter(h => h.level === 'bildirim' && !h.suppressed && etDate(h.at) === day).length;
      if (sentToday >= DAILY_NOTIFY_CAP) a.level = 'liste';
    }
    all.push(a);
  }
  return alerts;
}
