/*
 * HTTP katmanı (yalnız 127.0.0.1; dışarıya Caddy üzerinden HTTPS ile çıkar).
 *  GET  /health                 — herkese açık, sırsız durum
 *  GET  /status                 — (anahtar) yapılandırma özeti, kredi geçmişi, son tarama
 *  GET  /flow?days=&sinceId=&limit= — (anahtar) son N işlem günü (varsayılan 3, en çok 5) olayları, yeni → eski
 *  GET  /flow/summary           — (anahtar) bugün ticker bazında teyitli prim dengesi
 *  POST /push/register {token}  — (anahtar) Expo push tokenı kaydı
 *  POST /push/unregister {token}— (anahtar)
 *  GET  /api/md/<yol>?<sorgu>   — (anahtar) MarketData proxy'si; yalnız src/lib/flow/proxy.ts izinli listesi
 * Anahtar: başlık x-app-key (sabit zamanlı karşılaştırma). Anahtar/token asla loglanmaz.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { APP_KEY_HEADER, checkMdRequest, isExpoPushToken, MD_PROXY_PREFIX } from '../../src/lib/flow/proxy.ts';
import { fmtIst } from '../../src/lib/flow/model.ts';
import { clampFlowDays, oldestTradingDay, tradingDaysBack } from '../../src/lib/flow/days.ts';
import { marketOpen, etDate } from '../../src/lib/usmarket.ts';
import type { Config } from './config.ts';
import { publicConfig } from './config.ts';
import type { Store } from './store.ts';
import { BudgetError, creditDay, type MdClient } from './md.ts';
import type { Poller } from './poller.ts';
import { errText } from './poller.ts';

export interface Deps { cfg: Config; store: Store; md: MdClient; poller: Poller; now?: () => number }

const MAX_BODY = 4096;
const MAX_PUSH_TOKENS = 50;

/** Sabit zamanlı anahtar karşılaştırması (özet üzerinden: uzunluk sızıntısı yok) */
export function keyOk(given: string | undefined, expected: string): boolean {
  if (!expected || !given) return false;
  const a = createHash('sha256').update(given).digest(), b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Dakika başına istek sınırı (tek kova; tek anahtar için yeterli) */
export class RateLimit {
  private win = 0; private n = 0;
  private readonly perMin: number;
  constructor(perMin: number) { this.perMin = perMin; }
  take(nowMs: number): boolean {
    const w = Math.floor(nowMs / 60000);
    if (w !== this.win) { this.win = w; this.n = 0; }
    if (this.n >= this.perMin) return false;
    this.n++; return true;
  }
}

interface CacheEntry { at: number; status: number; text: string; consumed: number; remaining: number | null }

export function createHandler(d: Deps) {
  const now = d.now ?? (() => Date.now());
  const rl = new RateLimit(d.cfg.rateLimitPerMin);
  const cache = new Map<string, CacheEntry>();

  const send = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'application/json' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
    res.end(text);
  };
  const readBody = (req: IncomingMessage): Promise<string | null> => new Promise(resolve => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > MAX_BODY) { resolve(null); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const t = now();
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path === '/health') return health(res, t);
      if (!keyOk(headerStr(req, APP_KEY_HEADER), d.cfg.appKey)) return send(res, 401, { error: 'yetkisiz' });
      if (!rl.take(t)) return send(res, 429, { error: 'istek sınırı — biraz sonra dene' }, { 'Retry-After': '30' });

      if (method === 'GET' && path === '/status') return status(res, t);
      if (method === 'GET' && path === '/flow') {
        const sinceId = Number(url.searchParams.get('sinceId') ?? 0) || 0;
        const limit = Number(url.searchParams.get('limit') ?? 100) || 100;
        const days = clampFlowDays(url.searchParams.get('days') ?? undefined);
        const fromDay = oldestTradingDay(t, days);
        const events = d.store.listEvents({ sinceId, limit, fromDay });
        return send(res, 200, {
          events, serverTime: t, days, fromDay, tradingDays: tradingDaysBack(t, days),
          creditsToday: d.store.creditsOn(creditDay(t)), polling: d.cfg.pollEnabled && marketOpen(t),
        });
      }
      if (method === 'GET' && path === '/flow/summary') {
        return send(res, 200, { day: etDate(t), rows: d.store.summary(etDate(t)) });
      }
      if (method === 'POST' && (path === '/push/register' || path === '/push/unregister')) {
        const raw = await readBody(req);
        if (raw == null) return send(res, 413, { error: 'istek çok büyük' });
        let token = '';
        try { token = String(JSON.parse(raw)?.token ?? ''); } catch { return send(res, 400, { error: 'geçersiz JSON' }); }
        if (!isExpoPushToken(token)) return send(res, 400, { error: 'geçersiz push tokenı' });
        if (path === '/push/register') {
          if (d.store.pushTokens().length >= MAX_PUSH_TOKENS && !d.store.pushTokens().includes(token)) return send(res, 409, { error: 'kayıt sınırı' });
          d.store.addPushToken(token, t);
          return send(res, 200, { ok: true });
        }
        return send(res, 200, { ok: true, removed: d.store.removePushToken(token) });
      }
      if (method === 'GET' && path.startsWith(MD_PROXY_PREFIX + '/')) return mdProxy(req, res, url, t);
      return send(res, 404, { error: 'bulunamadı' });
    } catch (e) {
      console.error('istek hatası: ' + errText(e));
      if (!res.headersSent) send(res, 500, { error: 'sunucu hatası' });
    }
  };

  function health(res: ServerResponse, t: number) {
    const day = creditDay(t);
    const p = d.poller;
    send(res, 200, {
      ok: true, time: t, timeIst: fmtIst(t), marketOpen: marketOpen(t), polling: d.cfg.pollEnabled,
      lastPollAt: p.lastPollAt || null, lastOkAt: p.lastOkAt || null, polls: p.polls,
      lastError: p.lastError ? p.lastError.replace(/\s+/g, ' ').slice(0, 120) : null,
      creditsToday: { day, flow: d.store.creditsOn(day, 'flow'), total: d.store.creditsOn(day), mdRemaining: d.md.lastRemaining },
    });
  }
  function status(res: ServerResponse, t: number) {
    send(res, 200, { config: publicConfig(d.cfg), creditHistory: d.store.creditsByDay(7), last: d.poller.last, serverTime: t });
  }

  async function mdProxy(req: IncomingMessage, res: ServerResponse, url: URL, t: number) {
    const mdPath = url.pathname.slice(MD_PROXY_PREFIX.length);
    const pathOnly = mdPath;
    const err = checkMdRequest(pathOnly, url.searchParams);
    if (err) return send(res, 403, { s: 'error', errmsg: err });
    const key = `${pathOnly}?${url.searchParams.toString()}`;
    const hit = cache.get(key);
    if (hit && t - hit.at < d.cfg.cacheSec * 1000) return sendMd(res, hit, true);
    try {
      const r = await d.md.get(pathOnly + (url.search || ''), 'proxy', { nowMs: t });
      const entry: CacheEntry = { at: t, status: r.status, text: r.text, consumed: r.consumed, remaining: r.remaining };
      if (r.status === 200 || r.status === 203 || r.status === 204) cache.set(key, entry);
      if (cache.size > 500) cache.clear();
      return sendMd(res, entry, false);
    } catch (e) {
      if (e instanceof BudgetError) return send(res, 429, { s: 'error', errmsg: e.message });
      return send(res, 502, { s: 'error', errmsg: errText(e) });
    }
  }
  function sendMd(res: ServerResponse, e: CacheEntry, cached: boolean) {
    const h: Record<string, string> = { 'X-Flow-Cache': cached ? 'HIT' : 'MISS', 'X-Api-Ratelimit-Consumed': cached ? '0' : String(e.consumed) };
    if (e.remaining != null) h['X-Api-Ratelimit-Remaining'] = String(e.remaining);
    if (e.status === 204 || !e.text) { res.writeHead(e.status === 204 ? 204 : e.status, { ...h, 'Cache-Control': 'no-store' }); return res.end(); }
    res.writeHead(e.status, { ...h, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(e.text);
  }
}

function headerStr(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
