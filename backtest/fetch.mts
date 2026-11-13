/* Veri indirme: 1 dk mumlar (aylık parçalar) + her gün için EOD zincir (date=D, vade D..D+10, strike ±%16 önceki kapanış).
 * Aralık: BT_START / BT_END (YYYY-MM-DD), semboller: BT_TICKERS. Önce tahmin: BT_DRYRUN=1 node backtest/fetch.mts
 * Kesilirse aynı komutla devam eder (önbellekte olanlar tekrar istenmez). */
import { get, stats, close, isDry, countDry, summary, BudgetError } from './md.mts';
import { TICKERS, tradingDays, addDaysStr, START, END } from './common.mts';
const tickers = (process.env.BT_TICKERS?.split(',') ?? TICKERS);
process.on('unhandledRejection', e => { if (e instanceof BudgetError) { console.error(String(e.message), '|', summary(), '\nAynı komutla yarın devam edin (önbellek korunur).'); close(); process.exit(2); } throw e; });
const days = tradingDays(addDaysStr(START, -5), END);
const months: [string, string][] = [];
for (let m = START.slice(0, 7); m <= END.slice(0, 7);) { const a = m + '-01'; const n = new Date(Date.parse(a) + 32 * 864e5).toISOString().slice(0, 7); months.push([a, n + '-01']); m = n; }
const closes = new Map<string, Map<string, number>>(); // ticker → gün → kapanış
// 1) mumlar
for (const t of tickers) {
  const mp = new Map<string, number>(); closes.set(t, mp);
  for (const [a, b] of months) {
    const j = await get(`/stocks/candles/1/${t}/?from=${a}&to=${b}`);
    if (Array.isArray(j?.t)) for (let i = 0; i < j.t.length; i++) { const d = new Date((j.t[i] - 5 * 3600) * 1000).toISOString().slice(0, 10); mp.set(d, j.c[i]); }
  }
  // kapanış öncesi gün için günlük mum (START−5..)
  const dj = await get(`/stocks/candles/D/${t}/?from=${addDaysStr(START, -10)}&to=${END}`);
  if (Array.isArray(dj?.t)) for (let i = 0; i < dj.t.length; i++) { const d = new Date((dj.t[i] + 12 * 3600) * 1000).toISOString().slice(0, 10); if (!mp.has(d)) mp.set(d, dj.c[i]); }
  console.log('mum', t, mp.size, JSON.stringify(stats));
}
// 2) zincirler (yeniden eskiye)
const chainDays = tradingDays(addDaysStr(START, -4), END).reverse();
let n = 0;
for (const d of chainDays) {
  for (const t of tickers) {
    const mp = closes.get(t)!; const prevDays = [...mp.keys()].filter(x => x < d).sort(); const pc = mp.get(prevDays[prevDays.length - 1]!);
    if (!pc) { if (isDry()) countDry(1); continue; }
    const lo = (pc * 0.84).toFixed(2), hi = (pc * 1.16).toFixed(2);
    let j = await get(`/options/chain/${t}/?date=${d}&from=${d}&to=${addDaysStr(d, 10)}&strike=${lo}-${hi}`);
    if (j?.s !== 'ok') j = await get(`/options/chain/${t}/?date=${d}&from=${d}&to=${addDaysStr(d, 45)}&strike=${lo}-${hi}`);
    if (++n % 50 === 0) console.log('zincir', d, t, j?.s, j?.optionSymbol?.length, JSON.stringify(stats));
  }
}
console.log('BİTTİ', summary()); close();
