/*
 * HTTP katmanı (yalnız 127.0.0.1; dışarıya Caddy üzerinden HTTPS ile çıkar).
 *  GET  /health                 — herkese açık, sırsız durum
 *  GET  /status                 — (anahtar) yapılandırma özeti, kredi geçmişi, son tarama
 *  GET  /flow?days=&sinceId=&limit= — (anahtar) son N işlem günü (varsayılan 3, en çok 5) olayları, yeni → eski
 *  GET  /flow/summary           — (anahtar) bugün ticker bazında teyitli prim dengesi
 *  POST /push/register {token}  — (anahtar) Expo push tokenı kaydı
 *  POST /push/unregister {token}— (anahtar)
 *  GET  /reports?limit=         — (anahtar) son raporlar, yeni → eski, tam metin (en çok 50, varsayılan 10)
 *  GET  /reports/<id>           — (anahtar) tek rapor
 *  GET  /api/md/<yol>?<sorgu>   — (anahtar) MarketData proxy'si; yalnız src/lib/flow/proxy.ts izinli listesi
 *  POST /coach {image,mime,day?} — (anahtar) ekran görüntüsü → dolum çıkarma, eşleştirme, koçluk (Haiku; 4 MB; 100/24 sa, 2 sn)
 *  POST /coach/process?day=      — (anahtar) bekleyen koçlukları işle (en çok 5)
 *  GET  /coach?day=              — (anahtar) günün dolumları, eşleşmiş işlemleri, açık pozisyonlar, karnesi
 *  POST /coach/karne?day=        — (anahtar) günün karnesini üret (Haiku)
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
import { Coach, CoachError } from './coach.ts';

export interface Deps { cfg: Config; store: Store; md: MdClient; poller: Poller; now?: () => number; coach?: Coach }

const MAX_BODY = 4096;
const MAX_COACH_BODY = 6 * 1024 * 1024;   // base64 (4 MB görüntü ≈ 5,6 MB) + JSON
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
  /** Gövde okuma. Sınır aşılırsa null döner ve bağlantı KOPARILMAZ (akış boşaltılır): 413 JSON yanıtı istemciye ulaşır. */
  const readBody = (req: IncomingMessage, max = MAX_BODY): Promise<string | null> => new Promise(resolve => {
    let size = 0, over = false; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > max) { over = true; chunks.length = 0; resolve(null); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', () => { if (!over) { over = true; resolve(null); } });
  });

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const t = now();
    const url = new URL(req.url ?? '/', 'http://local');
    const path = url.pathname;
    const method = req.method ?? 'GET';
    try {
      if (method === 'GET' && path === '/health') return health(res, t);
      const coachReq = path === '/coach' || path.startsWith('/coach/');
      if (!keyOk(headerStr(req, APP_KEY_HEADER), d.cfg.appKey)) {
        if (coachReq) coachLog(method, path, 401, t, req, '', 'yetkisiz');
        return send(res, 401, { error: 'yetkisiz' });
      }
      if (!rl.take(t)) {
        if (coachReq) coachLog(method, path, 429, t, req, '', 'istek sınırı');
        return send(res, 429, { error: 'istek sınırı — biraz sonra dene' }, { 'Retry-After': '30' });
      }

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
      if (method === 'GET' && path === '/reports') {
        const limit = Number(url.searchParams.get('limit') ?? 10) || 10;
        return send(res, 200, { reports: d.store.listReports(limit), serverTime: t });
      }
      if (method === 'GET' && /^\/reports\/\d+$/.test(path)) {
        const r = d.store.getReport(Number(path.slice('/reports/'.length)));
        return r ? send(res, 200, { report: r }) : send(res, 404, { error: 'rapor bulunamadı' });
      }
      if (method === 'GET' && path.startsWith(MD_PROXY_PREFIX + '/')) return mdProxy(req, res, url, t);
      if (path === '/coach' || path.startsWith('/coach/')) return coachRoute(req, res, url, method, path);
      return send(res, 404, { error: 'bulunamadı' });
    } catch (e) {
      console.error('istek hatası: ' + errText(e));
      if (!res.headersSent) send(res, 500, { error: 'sunucu hatası' });
    }
  };

  /** /coach*: her isteğin sonucu tek satırda loglanır (durum, süre, gövde boyutu, mime, kısa hata). Görüntü verisi/anahtar YOK. */
  async function coachRoute(req: IncomingMessage, res: ServerResponse, url: URL, method: string, path: string) {
    const t0 = Date.now();
    let info = '', note = '';
    res.once('finish', () => coachLog(method, path, res.statusCode, t0, req, info, note));
    const reply = (status: number, body: unknown, extra?: Record<string, string>) => {
      if (body && typeof body === 'object' && 'error' in body) note = String((body as { error: unknown }).error);
      return send(res, status, body, extra);
    };
    if (!d.coach) return reply(503, { error: 'koç kapalı' });
    try {
      if (method === 'GET' && path === '/coach') {
        const day = url.searchParams.get('day') ?? '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply(400, { error: 'day=YYYY-MM-DD gerekli' });
        return reply(200, d.coach.view(day));
      }
      if (method === 'POST' && path === '/coach') {
        const raw = await readBody(req, MAX_COACH_BODY);
        if (raw == null) return reply(413, { error: 'görüntü çok büyük (en çok ~4 MB görüntü)' });
        let body: { image?: unknown; mime?: unknown; day?: unknown };
        try { body = JSON.parse(raw); } catch { return reply(400, { error: 'geçersiz JSON' }); }
        const mime = body?.mime === 'image/jpeg' || body?.mime === 'image/png' ? body.mime : 'diğer';
        info = ` mime=${mime} görüntü=${typeof body?.image === 'string' ? body.image.length : 0}ch`;
        const out = await d.coach.coachImage(body ?? {});
        info += ` gün=${out.day} dolum=${out.fills.length} yeni=${out.added}${out.duplicate ? ' (önbellek)' : ''} koçluk=${out.coached}`;
        return reply(200, out);
      }
      if (method === 'POST' && path === '/coach/process') {
        const day = url.searchParams.get('day') ?? undefined;
        if (day != null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply(400, { error: 'day=YYYY-MM-DD gerekli' });
        return reply(200, await d.coach.process(day));
      }
      if (method === 'POST' && path === '/coach/karne') {
        const day = url.searchParams.get('day') ?? '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return reply(400, { error: 'day=YYYY-MM-DD gerekli' });
        return reply(200, await d.coach.karne(day));
      }
      return reply(405, { error: 'yöntem desteklenmiyor' });
    } catch (e) {
      if (e instanceof CoachError) return reply(e.status, { error: e.message, ...e.extra });
      console.error('koç hatası: ' + errText(e));
      return reply(502, { error: 'koç geçici olarak kullanılamıyor' });
    }
  }

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

/** /coach istek sonucu: tek satır (durum, süre, gövde boyutu, kısa not). Görüntü verisi, anahtar ve başlıklar YAZILMAZ. */
function coachLog(method: string, path: string, status: number, t0: number, req: IncomingMessage, info: string, note: string): void {
  const len = Number(headerStr(req, 'content-length') ?? 0) || 0;
  const tail = note ? ` — ${note.replace(/\s+/g, ' ').slice(0, 120)}` : '';
  console.log(`koç istek ${method} ${path} ${status} ${Date.now() - t0}ms gövde=${len}B${info}${tail}`);
}

function headerStr(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}
