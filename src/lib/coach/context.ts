/*
 * İşlem bağlamı (saf): dayanak mumları, VWAP, giriş/çıkış anındaki fiyat, çıkış sonrası hareket, hacim patlaması,
 * duvar anlık görüntüsü ve akış olayları → modele giden küçük, sınırlı bir JSON (pencereleme burada).
 */
import { aggregate, afterExitMove, barAt, openOf, sessionBars, vwapAt, volumeSpikeAfter, type Bar } from './bars.ts';
import { istHm, istToMs } from './time.ts';
import { ruleFacts, premiumPct } from './rules.ts';
import type { ExtractedTrade, RuleFact } from './types.ts';

export const MAX_CANDLES = 40;          // modele giden 5 dk mumu üst sınırı
export const PRE_MIN = 60, POST_MIN = 120;  // giriş öncesi / çıkış sonrası pencere (dk)

export interface FlowLite { ts: number; side: 'call' | 'put'; strike: number; expiry: string; prem: number; dv: number; confirmed: boolean }
export interface WallsLite { callWall?: number | null; putWall?: number | null; gammaFlip?: number | null; maxPain?: number | null; spot?: number | null; expiry?: string | null }

export interface TradeContext {
  rules: RuleFact[];
  facts: Record<string, unknown>;
  noData: string[];   // veri olmayan kalemler (model "bilinmiyor" diyebilsin diye açıkça listelenir)
}

export function buildTradeContext(a: {
  trade: ExtractedTrade; bars: Bar[]; day: string; walls?: WallsLite | null; flow?: FlowLite[]; nowMs: number;
}): TradeContext {
  const { trade, bars, day } = a;
  const rules = ruleFacts(trade, a.nowMs);
  const facts: Record<string, unknown> = {
    ticker: trade.ticker, side: trade.side, strike: trade.strike, expiry: trade.expiry, qty: trade.qty,
    entryIst: trade.entryTime, exitIst: trade.exitTime, entryPrice: trade.entryPrice, exitPrice: trade.exitPrice,
    status: trade.status, okuma: trade.confidence,
  };
  const noData: string[] = [];
  const entryMs = istToMs(trade.entryTime), exitMs = istToMs(trade.exitTime);
  if (trade.entryPrice && trade.exitPrice != null && trade.status === 'kapali') facts.premiumChangePct = premiumPct(trade.entryPrice, trade.exitPrice);

  const session = sessionBars(bars, day);
  if (!session.length) noData.push('dayanak seans mumları (Yahoo)');
  const u = (ms: number | null) => (ms == null ? null : barAt(session, ms));
  const entryBar = u(entryMs), exitBar = u(exitMs);
  if (entryMs != null && entryBar) facts.underlyingAtEntry = +entryBar.c.toFixed(2);
  if (exitMs != null && exitBar) facts.underlyingAtExit = +exitBar.c.toFixed(2);
  if (session.length) {
    facts.sessionOpen = openOf(session);
    if (entryMs != null) facts.vwapAtEntry = vwapAt(session, entryMs);
    if (exitMs != null) facts.vwapAtExit = vwapAt(session, exitMs);
  }

  // Giriş/çıkış çevresi 5 dk mumları (en fazla MAX_CANDLES), saat İstanbul
  if (entryMs != null || exitMs != null) {
    const from = (entryMs ?? exitMs!) - PRE_MIN * 60000;
    const to = (exitMs ?? entryMs!) + POST_MIN * 60000;
    const cs = aggregate(session, from, to, 5).slice(-MAX_CANDLES);
    facts.candles5m = cs.map(c => ({ t: istHm(c.t), o: +c.o.toFixed(2), h: +c.h.toFixed(2), l: +c.l.toFixed(2), c: +c.c.toFixed(2), v: Math.round(c.v) }));
    if (!cs.length) noData.push('giriş/çıkış çevresi mumları');
  }

  if (exitMs != null && exitBar && trade.status === 'kapali') {
    const after = afterExitMove(session, exitMs, exitBar.c, trade.side, POST_MIN);
    if (after) facts.afterExit = { ...after, minutesToBestFavLabel: after.minutesToBestFav == null ? null : `${after.minutesToBestFav} dk sonra` };
    else noData.push('çıkış sonrası dayanak hareketi (seans sonu veya veri eksik)');
    const spike = volumeSpikeAfter(session, exitMs, 30);
    if (spike) facts.volumeSpikeAfterExit = spike;
  }

  if (a.walls) facts.walls = a.walls; else noData.push('duvar anlık görüntüsü (sunucu tarayıcısı kapalıysa yok)');
  const fl = (a.flow ?? []).slice(0, 8).map(e => ({ t: istHm(e.ts), side: e.side, strike: e.strike, expiry: e.expiry, prem: Math.round(e.prem), dv: Math.round(e.dv), teyit: e.confirmed }));
  facts.flowNearby = fl;
  if (!fl.length) noData.push('akış olayları (aynı ticker, işlem penceresi)');

  return { rules, facts, noData };
}

/** Kaan'ın kurallarının özeti (sabit): hem koçluk hem karne prompt'una girer */
export const KAAN_RULES_TR = [
  'Giriş penceresi: İstanbul 16:30–20:00 arası.',
  'Vade: 0–3 gün (DTE). Strike: oynaklığa göre OTM.',
  'Risk/ödül: brüt 1:5 (yedek 1:4). Prim stopu: girişin %67\'si kaybedilince çık (kalan %33).',
  'Kademe: 50/40/30 (kazandıkça adım adım).',
  'Çıkış: yüksek hacimli ters dönüş mumunda çık.',
].join('\n');
