/*
 * Akış AI yorumu (Haiku) — sunucu tarafı. POST /flow/yorum?ticker=&day= → payload SUNUCUDA kurulur (istemci tablo göndermez):
 * akış deposundaki olaylar + varsa kayıtlı duvar anlık görüntüsü → tek Haiku çağrısı (düz metin, max 1200 token) → SQLite.
 * Saklama kuralı (Kaan): ticker+gün başına EN FAZLA bir satır. Yenilemede üzerine yazılır; geçmiş, sürüm ya da liste yok.
 * Satır yalnızca o ET günü boyunca tutulur; bugünden önceki satırlar her istekte silinir (gece tutulmaz).
 * Anahtar: cfg.anthropicKey (systemd LoadCredential). Asla loglanmaz, yanıtta ve hata metninde yer almaz.
 */
import { ANTHROPIC_URL, ANTHROPIC_VERSION, buildMessagesBody, parseMessagesReply } from '../../src/lib/coach/anthropic.ts';
import { buildFlowYorumPayload, FLOW_YORUM_SYSTEM, flowYorumUserText, type FlowYorumPayload, type YorumWalls } from '../../src/lib/flow/aiyorum.ts';
import type { WallSnap } from '../../src/lib/reports/types.ts';
import { etDate } from '../../src/lib/usmarket.ts';
import type { Config } from './config.ts';
import type { Store } from './store.ts';

export type Fetch = typeof fetch;
export const YORUM_MAX_TOKENS = 1200;
export const YORUM_TIMEOUT_MS = 90000;
const YORUM_MAX_CHARS = 2000;
const EVENT_LIMIT = 2000;

export class YorumError extends Error {
  readonly status: number;
  modelRejected = false;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export interface FlowYorumDeps { cfg: Config; store: Store; f?: Fetch; now?: () => number; log?: (m: string) => void }
export interface YorumOut { text: string; ticker: string; day: string; createdAt: number; model: string; stored: boolean }

export class FlowYorum {
  private readonly f: Fetch; private readonly now: () => number; private readonly log: (m: string) => void;
  private readonly d: FlowYorumDeps;
  constructor(d: FlowYorumDeps) {
    this.d = d;
    this.f = d.f ?? fetch; this.now = d.now ?? (() => Date.now()); this.log = d.log ?? (m => console.log(m));
  }

  /** GET: kayıtlı yorum (yoksa null). Önce süresi dolanlar silinir. */
  get(ticker: string, day: string): YorumOut | null {
    this.purge();
    const r = this.d.store.flowYorumGet(ticker, day);
    return r ? { text: r.text, ticker, day, createdAt: r.ts, model: r.model, stored: true } : null;
  }

  /** POST: yeni yorum üretir; aynı ticker+gün satırının yerine yazar. Bugünden eski gün için saklanmaz (yalnız yanıt döner). */
  async generate(ticker: string, day: string): Promise<YorumOut> {
    this.purge();
    const key = this.d.cfg.anthropicKey;
    if (!key) throw new YorumError(503, 'AI yorum yapılandırılmadı: sunucuda Anthropic anahtarı yok');
    const events = this.d.store.listEvents({ day, limit: EVENT_LIMIT });
    const payload = buildFlowYorumPayload(ticker, day, events, wallsOf(this.d.store.snapGet<WallSnap>(day, ticker, 'last')));
    if (!payload) throw new YorumError(404, 'Bu gün için akış yok.');
    const { text, model } = await this.ask(key, payload);
    const ts = this.now();
    const stored = day >= etDate(ts);
    if (stored) this.d.store.flowYorumPut({ ticker, day, ts, model, text });
    return { text, ticker, day, createdAt: ts, model, stored };
  }

  /** Birincil model reddedilirse ve yedek tanımlıysa yedekle dener (coach.ts ile aynı kural). */
  private async ask(key: string, p: FlowYorumPayload): Promise<{ text: string; model: string }> {
    const primary = this.d.cfg.coachModel, fb = this.d.cfg.coachFallbackModel;
    try {
      return await this.send(key, primary, p);
    } catch (e) {
      if (e instanceof YorumError && e.modelRejected && fb && fb !== primary) {
        this.log(`akış yorumu: birincil model reddedildi, yedek kullanılıyor: ${fb}`);
        return await this.send(key, fb, p);
      }
      throw e;
    }
  }

  private async send(key: string, model: string, p: FlowYorumPayload): Promise<{ text: string; model: string }> {
    const t0 = this.now();
    const body = buildMessagesBody({ model, system: FLOW_YORUM_SYSTEM, content: [{ type: 'text', text: flowYorumUserText(p) }], maxTokens: YORUM_MAX_TOKENS });
    let r: Response;
    try {
      r = await this.f(ANTHROPIC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(YORUM_TIMEOUT_MS),
      });
    } catch (e) {
      const timeout = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
      this.log(`akış yorumu ${p.ticker} ${p.day} model=${model} HATA: ${timeout ? 'zaman aşımı' : 'bağlantı'}`);
      throw new YorumError(timeout ? 504 : 502, timeout ? 'AI yorum zaman aşımına uğradı' : 'AI yorum geçici olarak kullanılamıyor');
    }
    const raw = await r.text();
    if (!r.ok) {
      let type = 'hata';
      try { type = String(JSON.parse(raw)?.error?.type ?? 'hata'); } catch { /* yapısal olmayan gövde */ }
      // Hata mesajı (olası yankı) loglanmaz; yalnız durum ve tür
      this.log(`akış yorumu ${p.ticker} ${p.day} model=${model} Anthropic ${r.status} (${type})`);
      const e = new YorumError(
        r.status === 401 ? 503 : r.status === 429 ? 503 : 502,
        r.status === 401 ? 'Anthropic anahtarı geçersiz (sunucu)'
          : r.status === 429 ? 'AI yorum: Anthropic istek sınırı, biraz sonra dene'
            : 'AI yorum geçici olarak kullanılamıyor');
      e.modelRejected = r.status === 404 || type === 'not_found_error';
      throw e;
    }
    let j: unknown;
    try { j = JSON.parse(raw); } catch { throw new YorumError(502, 'AI yanıtı okunamadı'); }
    const parsed = parseMessagesReply(j);
    const text = parsed.text.trim().slice(0, YORUM_MAX_CHARS);
    if (!text) throw new YorumError(502, 'AI yorum boş döndü');
    this.log(`akış yorumu ${p.ticker} ${p.day} model=${model} in=${parsed.inTokens} out=${parsed.outTokens} ${this.now() - t0}ms`);
    return { text, model };
  }

  /** Bugünden (ET) önceki günlerin satırlarını siler. */
  private purge(): void {
    const n = this.d.store.flowYorumPurge(etDate(this.now()));
    if (n > 0) this.log(`akış yorumu: ${n} eski satır silindi`);
  }
}

/** Kayıtlı duvar anlık görüntüsü → yorum girdisi (yoksa null) */
export function wallsOf(w: WallSnap | null): YorumWalls | null {
  if (!w || w.spot == null || !(w.spot > 0)) return null;
  return { spot: w.spot, callWall: w.callWall ?? null, putWall: w.putWall ?? null, flip: w.flip ?? null, maxPain: w.maxPain ?? null, expiry: w.expiry ?? '' };
}
