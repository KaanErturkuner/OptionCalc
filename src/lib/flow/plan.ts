/*
 * Tarama planı ve kredi tahmini (FLOW.md §2, §4). Saf: ağ çağrısı yok.
 * Kural: ticker başına cached zincir isteği = 1 kredi (dte listesiyle tek istek); canlı teyit kontrat başına 1 kredi.
 */
import { DEFAULT_TICKERS, MARKET_MINUTES } from './model.ts';
import { dteParam, flowExpiries, type FlowTarget } from './expiry.ts';

export interface PlannedRequest {
  kind: 'chain';
  ticker: string;
  path: string;                                  // MarketData yolu (sunucu API'sine göre)
  query: { dte: string; mode: 'cached'; maxage: string };
}
export interface PollPlan { targets: FlowTarget[]; requests: PlannedRequest[]; creditsCached: number }

/** Tek poll için planlanan istekler (tickers × tek cached istek) */
export function planPoll(nowMs: number, tickers: string[] = DEFAULT_TICKERS, intervalMin = 2): PollPlan {
  const targets = flowExpiries(nowMs);
  const dte = dteParam(targets);
  const requests: PlannedRequest[] = tickers.map(t => ({
    kind: 'chain', ticker: t, path: `/options/chain/${t}/`, query: { dte, mode: 'cached', maxage: `${intervalMin}min` },
  }));
  return { targets, requests, creditsCached: requests.length };
}

export interface CreditInput { tickers: number; intervalMin: number; confirmsPerPoll: number }
export interface CreditEstimate { polls: number; cachedPerDay: number; confirmMaxPerDay: number; totalMaxPerDay: number }

/** Günlük kredi tavanı: cached (ticker × poll) + en çok canlı teyit (poll × K). Gerçek kullanım bunun altında kalır. */
export function estimateCredits(i: CreditInput): CreditEstimate {
  const polls = Math.floor(MARKET_MINUTES / Math.max(1, i.intervalMin));
  const cachedPerDay = polls * i.tickers;
  const confirmMaxPerDay = polls * i.confirmsPerPoll;
  return { polls, cachedPerDay, confirmMaxPerDay, totalMaxPerDay: cachedPerDay + confirmMaxPerDay };
}
