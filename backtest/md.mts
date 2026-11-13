/* MarketData istemcisi (backtest/kayıt): tek süreç, TEK keep-alive soket, sıralı + aralıklı istek (hız sınırı), her yanıt diske önbellek,
 * kredi bütçe koruması ve kuru çalıştırma (tahmin). Token yalnızca MARKETDATA_TOKEN ortam değişkeninden okunur; asla yazdırılmaz/kaydedilmez.
 *
 * Ortam: BT_CACHE (önbellek dizini) · BT_GAP_MS (istekler arası min. ms, vars. 250) · BT_MAX_CREDITS (bu süreçte harcanacak üst sınır, vars. 30000)
 *        BT_RESERVE (hesapta kalması gereken min. kredi — uygulama için pay, vars. 15000) · BT_DRYRUN=1 (istek atma, yalnızca say/tahmin et)
 *        BT_OFFLINE=1 (yalnızca önbellek)
 * NOT: Tek cihaz kuralı — token aynı anda telefondan da kullanılıyorsa hesap 5 dk bloklanır. Toplu indirme sırasında uygulamada
 *      MarketData yerine CBOE seçin ya da uygulamayı kapatın.
 */
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const CACHE = process.env.BT_CACHE || '/workspace/backtest/cache';
fs.mkdirSync(CACHE, { recursive: true });
const agent = new https.Agent({ keepAlive: true, maxSockets: 1, maxFreeSockets: 1, keepAliveMsecs: 30000 });
const MIN_GAP_MS = +(process.env.BT_GAP_MS || 250);
export const BUDGET = { maxCredits: +(process.env.BT_MAX_CREDITS || 30000), reserve: +(process.env.BT_RESERVE || 15000) };
const DRY = !!process.env.BT_DRYRUN;
let last = 0, chainP: Promise<unknown> = Promise.resolve();
export const stats = { requests: 0, cacheHits: 0, credits: 0, remaining: null as number | null, dryRequests: 0, dryCredits: 0, lastLatencyMs: 0 };
const LEDGER = path.join(CACHE, '_credits.jsonl');
export class BudgetError extends Error {}

/** İstek başına tahmini kredi (MarketData fiyatlandırması, 2026-11): geçmiş zincir 1/1000 sembol, mum 1/1000 mum, canlı zincir sembol başına 1, cached 1/istek */
export function estimateCredits(p: string): number {
  const q = new URLSearchParams(p.split('?')[1] || ''), days = (a?: string | null, b?: string | null) => a && b ? Math.max(1, (Date.parse(b) - Date.parse(a)) / 864e5) : 1;
  if (q.get('mode') === 'cached') return 1;
  if (/^\/stocks\/candles\/\d+\//.test(p)) return Math.max(1, Math.ceil(days(q.get('from'), q.get('to')) * 5 / 7 * 390 / 1000));
  if (/^\/stocks\/candles\//.test(p)) return 1;
  if (/^\/options\/chain\//.test(p)) return q.get('date') ? 1 : 2 * +(q.get('strikeLimit') || 30);
  if (/^\/options\/quotes\//.test(p)) return q.get('from') || q.get('date') ? 1 : 1;
  if (/^\/stocks\/quotes\//.test(p)) return (p.split('/')[3] || '').split(',').length;
  return 1;
}
function raw(p: string): Promise<{ status: number; body: string; consumed: number; remaining: number | null; ms: number }> {
  const token = process.env.MARKETDATA_TOKEN; if (!token) throw new Error('MARKETDATA_TOKEN yok (ortam değişkeni)');
  const t0 = Date.now();
  return new Promise((res, rej) => {
    const req = https.request({ host: 'api.marketdata.app', path: '/v1' + p, method: 'GET', agent,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', Connection: 'keep-alive' }, timeout: 60000 }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', d => b += d);
      r.on('end', () => res({ status: r.statusCode || 0, body: b, consumed: +(r.headers['x-api-ratelimit-consumed'] || 0),
        remaining: r.headers['x-api-ratelimit-remaining'] != null ? +r.headers['x-api-ratelimit-remaining']! : null, ms: Date.now() - t0 }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', rej); req.end();
  });
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
function guard() {
  if (stats.credits >= BUDGET.maxCredits) throw new BudgetError(`BÜTÇE: bu süreçte ${stats.credits} kredi harcandı (BT_MAX_CREDITS=${BUDGET.maxCredits})`);
  if (stats.remaining != null && stats.remaining < BUDGET.reserve) throw new BudgetError(`BÜTÇE: hesapta ${stats.remaining} kredi kaldı (BT_RESERVE=${BUDGET.reserve}); yarın 09:30 ET'de yenilenir`);
}
export interface GetOpts { noCache?: boolean }
/** Önbellekli GET. 200/203 → JSON; 204/404 no_data → {s:'no_data'} (o da önbelleğe yazılır). noCache: canlı veri (kayıt/prob) — önbellek okunmaz/yazılmaz. */
export function get(p: string, o: GetOpts = {}): Promise<any> {
  const f = path.join(CACHE, crypto.createHash('sha1').update(p).digest('hex') + '.json');
  if (!o.noCache && fs.existsSync(f)) { stats.cacheHits++; return Promise.resolve(JSON.parse(fs.readFileSync(f, 'utf8')).json); }
  if (process.env.BT_OFFLINE) return Promise.resolve(null);
  if (DRY) { stats.dryRequests++; stats.dryCredits += estimateCredits(p); return Promise.resolve(null); }
  const run = async () => {
    if (!o.noCache && fs.existsSync(f)) { stats.cacheHits++; return JSON.parse(fs.readFileSync(f, 'utf8')).json; }
    for (let attempt = 0; ; attempt++) {
      guard();
      const w = last + MIN_GAP_MS - Date.now(); if (w > 0) await sleep(w);
      last = Date.now();
      let r; try { r = await raw(p); } catch (e) { if (attempt < 4) { await sleep(3000 * (attempt + 1)); continue; } throw e; }
      stats.requests++; stats.credits += r.consumed; stats.remaining = r.remaining; stats.lastLatencyMs = r.ms;
      fs.appendFileSync(LEDGER, JSON.stringify({ t: new Date().toISOString(), p: p.replace(/\?.*$/, ''), c: r.consumed, rem: r.remaining, st: r.status, ms: r.ms }) + '\n');
      let j: any = null; try { j = r.body ? JSON.parse(r.body) : null; } catch {}
      if (r.status === 429 || /one device/i.test(String(j?.errmsg || ''))) {
        const msg = String(j?.errmsg || 'HTTP ' + r.status);
        if (/credit|limit/i.test(msg) && r.status === 429 && !/one device|concurrent/i.test(msg)) throw new BudgetError('KREDİ/LİMİT: ' + msg);
        console.error('[md] bekleniyor (' + r.status + '): ' + msg.slice(0, 120)); await sleep(/one device/i.test(msg) ? 330000 : 20000); continue;
      }
      if (r.status >= 500 && attempt < 4) { await sleep(5000 * (attempt + 1)); continue; }
      const out = r.status === 204 ? { s: 'no_data' } : j ?? { s: 'error', errmsg: 'HTTP ' + r.status };
      if (out.s === 'error' && r.status !== 400 && r.status !== 402 && r.status !== 404) throw new Error(`MD ${r.status}: ${out.errmsg}`);
      if (!o.noCache) fs.writeFileSync(f, JSON.stringify({ p, status: r.status, json: out }));
      return out;
    }
  };
  const pr = chainP.then(run, run); chainP = pr.catch(() => {}); return pr;
}
export const close = () => agent.destroy();
export const isDry = () => DRY;
/** Kuru çalıştırmada yolu kurulamayan (ör. önceki kapanış bilinmeyen) istekleri de say */
export const countDry = (credits = 1) => { stats.dryRequests++; stats.dryCredits += credits; };
export const summary = () => DRY ? `KURU ÇALIŞTIRMA: ${stats.dryRequests} istek, ~${stats.dryCredits} kredi (önbellekte ${stats.cacheHits})` :
  `istek ${stats.requests}, kredi ${stats.credits}, önbellek ${stats.cacheHits}, kalan ${stats.remaining ?? '?'}`;
