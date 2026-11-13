/*
 * İLERİYE DÖNÜK GERÇEK GÜN İÇİ OPSİYON KAYDI. MarketData geçmişte yalnızca EOD opsiyon verisi veriyor; gerçek gün içi bid/ask ile
 * backtest için kotları biz kaydederiz. Seans boyunca her REC_EVERY dakikada bir, her sembolün en yakın vadeli zinciri →
 *   /workspace/backtest/snaps/<D>/<T>.jsonl   satır: {t, rt, S, E, rows:[[0=call|1=put, K, bid, ask, iv, delta, gamma, vol, oi]]}
 * t = kotun kendi zaman damgası (updated, ileriye bakış yok), rt = alındığı an. Sonra: `--source hybrid` ile backtest.
 *
 *   MARKETDATA_TOKEN=... node backtest/record.mts          (box'ta nohup/pm2 ile seans boyunca çalışır, 16:00 ET'de kendisi durur)
 * Ortam: REC_TICKERS (vars. SPY,QQQ,IWM) · REC_EVERY (dk, vars. 2) · REC_MODE cached|live (vars. cached: istek başına 1 kredi)
 *        REC_MAXAGE (cached için kabul edilen yaş, vars. 3min) · REC_STRIKES (strikeLimit, vars. 30) · REC_FALLBACK_LIVE=1 (cached boşsa canlı)
 *        BT_MAX_CREDITS (bu süreç için üst sınır, vars. 15000) · BT_RESERVE
 * Kredi (yaklaşık, seans 390 dk): cached → sembol × 390/REC_EVERY (3 sembol × 2 dk ≈ 585/gün; 19 sembol ≈ 3.700/gün)
 *                                 live   → sembol × 2×strikeLimit × 390/REC_EVERY (3 × 60 × 78 (5 dk) ≈ 14.000/gün)
 * TEK CİHAZ KURALI: kayıt çalışırken aynı token telefonda kullanılırsa hesap 5 dk bloklanır → uygulamada CBOE seçin.
 */
process.env.BT_MAX_CREDITS ||= '15000';
const { get, close, summary, stats, BudgetError } = await import('./md.mts');
import fs from 'node:fs';
import path from 'node:path';
import { closeMs, etDate, marketOpen } from '../src/lib/usmarket.ts';
import { SNAPS } from './sources.mts';

const TICKERS = (process.env.REC_TICKERS || 'SPY,QQQ,IWM').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const EVERY = +(process.env.REC_EVERY || 2), MODE = process.env.REC_MODE || 'cached', MAXAGE = process.env.REC_MAXAGE || '3min';
const STRIKES = +(process.env.REC_STRIKES || 30), FALLBACK = !!process.env.REC_FALLBACK_LIVE;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const day = etDate(Date.now()), end = closeMs(day), dir = path.join(SNAPS, day); fs.mkdirSync(dir, { recursive: true });
const expiry = new Map<string, string>(), age: number[] = [];
async function nearestExpiry(t: string) {
  if (expiry.has(t)) return expiry.get(t)!;
  const j = await get(`/options/expirations/${t}/`, { noCache: true });
  const e = (j?.expirations ?? []).map((x: any) => typeof x === 'number' ? etDate(x * 1000) : String(x).slice(0, 10)).filter((x: string) => x >= day).sort()[0];
  if (e) expiry.set(t, e); return e as string | undefined;
}
async function snap(t: string) {
  const E = await nearestExpiry(t); if (!E) return;
  const base = `/options/chain/${t}/?expiration=${E}&strikeLimit=${STRIKES}`;
  let j = await get(MODE === 'cached' ? `${base}&mode=cached&maxage=${MAXAGE}` : base, { noCache: true });
  if (MODE === 'cached' && j?.s !== 'ok' && FALLBACK) j = await get(base, { noCache: true });
  if (j?.s !== 'ok' || !Array.isArray(j.optionSymbol)) return;
  const n = j.optionSymbol.length, rows: number[][] = []; let upd = 0, S = 0;
  for (let i = 0; i < n; i++) {
    rows.push([j.side[i] === 'put' ? 1 : 0, j.strike[i], j.bid[i] ?? 0, j.ask[i] ?? 0, j.iv?.[i] ?? 0, j.delta?.[i] ?? 0, j.gamma?.[i] ?? 0, j.volume?.[i] ?? 0, j.openInterest?.[i] ?? 0]);
    upd = Math.max(upd, j.updated?.[i] ?? 0); S = S || j.underlyingPrice?.[i] || 0;
  }
  const rt = Date.now(), tq = upd ? upd * 1000 : rt; age.push(rt - tq);
  fs.appendFileSync(path.join(dir, `${t}.jsonl`), JSON.stringify({ t: tq, rt, S, E, rows }) + '\n');
}
console.error(`kayıt ${day}: ${TICKERS.join(',')} her ${EVERY} dk, mod ${MODE}${MODE === 'cached' ? ' maxage ' + MAXAGE : ''}, strikeLimit ${STRIKES} → ${dir}`);
try {
  while (Date.now() < end) {
    if (!marketOpen()) { await sleep(30000); continue; }
    const t0 = Date.now();
    for (const t of TICKERS) { try { await snap(t); } catch (e) { if (e instanceof BudgetError) throw e; console.error(t, (e as Error).message); } }
    const a = [...age].sort((x, y) => x - y);
    console.error(new Date().toISOString().slice(11, 19), summary(), a.length ? `kot yaşı medyan ${(a[a.length >> 1] / 1000).toFixed(0)} sn` : '');
    await sleep(Math.max(1000, EVERY * 60000 - (Date.now() - t0)));
  }
} catch (e) { console.error(String((e as Error).message)); }
fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify({ day, tickers: TICKERS, every: EVERY, mode: MODE, maxage: MAXAGE, strikes: STRIKES, credits: stats.credits, requests: stats.requests,
  quoteAgeMedSec: age.length ? [...age].sort((x, y) => x - y)[age.length >> 1] / 1000 : null }));
console.error('bitti', summary()); close();
