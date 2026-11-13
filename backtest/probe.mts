/*
 * OPRA onayından sonra İLK çalıştırılacak doğrulama (~25 kredi): gerçek zamanlılık + gecikme + cached tazeliği + gün içi geçmiş opsiyon
 * verisi var mı. Çıktı: konsol + /workspace/backtest/probe-<tarih>.json. Seans AÇIKKEN çalıştırın (kapalıyken gecikme ölçülemez).
 *   MARKETDATA_TOKEN=... node backtest/probe.mts [SPY]
 * Telefon uygulamasında MarketData açıksa önce kapatın (tek cihaz kuralı).
 */
process.env.BT_MAX_CREDITS ||= '200';
const { get, close, stats } = await import('./md.mts');
import fs from 'node:fs';
import { etDate, marketOpen, addDaysStr, prevTradingDay } from '../src/lib/usmarket.ts';

const T = (process.argv[2] || 'SPY').toUpperCase(), now = () => Date.now(), out: Record<string, unknown> = { at: new Date().toISOString(), ticker: T, marketOpen: marketOpen() };
const ageSec = (sec?: number) => sec ? Math.round((now() - sec * 1000) / 1000) : null;
const step = async (name: string, p: string, f: (j: any) => unknown) => {
  const c0 = stats.credits, t0 = now();
  try { const j = await get(p, { noCache: true }); out[name] = { ok: j?.s === 'ok', s: j?.s, ms: now() - t0, credits: stats.credits - c0, ...(f(j) as object) }; }
  catch (e) { out[name] = { ok: false, error: (e as Error).message }; }
  console.log(name.padEnd(16), JSON.stringify(out[name]));
};
await step('status', `/markets/status/`, () => ({ remaining: stats.remaining }));
await step('stockQuote', `/stocks/quotes/${T}/`, j => ({ last: j?.last?.[0], ageSec: ageSec(j?.updated?.[0]) }));
let E = '';
await step('expirations', `/options/expirations/${T}/`, j => { E = (j?.expirations ?? []).map((x: any) => typeof x === 'number' ? etDate(x * 1000) : String(x).slice(0, 10)).filter((x: string) => x >= etDate(now())).sort()[0] ?? ''; return { nearest: E }; });
let sym = '';
await step('chainLive', `/options/chain/${T}/?expiration=${E}&strikeLimit=2`, j => { sym = j?.optionSymbol?.[0] ?? ''; return { n: j?.optionSymbol?.length, ageSec: ageSec(Math.max(...(j?.updated ?? [0]))), hasGreeks: j?.delta?.[0] != null }; });
await step('chainCached', `/options/chain/${T}/?expiration=${E}&strikeLimit=30&mode=cached&maxage=5min`, j => ({ n: j?.optionSymbol?.length, ageSec: ageSec(Math.max(...(j?.updated ?? [0]))) }));
await step('candles1m', `/stocks/candles/1/${T}/?from=${etDate(now())}&to=${addDaysStr(etDate(now()), 1)}`, j => ({ n: j?.t?.length, lastAgeSec: ageSec(j?.t?.[j.t.length - 1]) }));
const y = prevTradingDay(addDaysStr(etDate(now()), -1));
if (sym) {
  await step('optQuotesHist', `/options/quotes/${sym}/?from=${addDaysStr(y, -7)}&to=${etDate(now())}`, j => ({ rows: j?.updated?.length, note: 'gün başına 1 satır = yalnızca EOD' }));
  await step('optCandlesProbe', `/options/candles/1/${sym}/?from=${y}&to=${etDate(now())}`, j => ({ note: 'belgelenmemiş uç; 404 beklenir (gün içi geçmiş opsiyon yok)', s: j?.s }));
}
const v = (k: string) => out[k] as any;
out.verdict = {
  realtimeStock: v('stockQuote')?.ageSec != null && v('stockQuote').ageSec < 20,
  realtimeOptions: v('chainLive')?.ageSec != null && v('chainLive').ageSec < 20,
  cachedFreshSec: v('chainCached')?.ageSec ?? null,
  candlesDelayedMin: v('candles1m')?.lastAgeSec != null ? Math.round(v('candles1m').lastAgeSec / 60) : null,
  intradayOptionHistory: v('optCandlesProbe')?.ok === true,
  creditsUsed: stats.credits, remaining: stats.remaining,
};
console.log('SONUÇ', JSON.stringify(out.verdict));
fs.writeFileSync(`/workspace/backtest/probe-${etDate(now())}.json`, JSON.stringify(out, null, 1)); close();
