/*
 * Koç (işlem koçu) — sunucu tarafı. Akış: görüntü → Haiku (işlem çıkarma) → bağlam (Yahoo 1 dk, duvar, akış)
 * → Haiku (koçluk, görüntü + bağlam) → SQLite. Karne: günün koçluk kayıtlarından Haiku ile (elle veya kapanıştan sonra otomatik).
 * Anahtar: /etc/optioncalc-flow/anthropic_key (systemd LoadCredential). Asla loglanmaz/yanıtlanmaz; hata metninden de temizlenir.
 * Model: COACH_MODEL (varsayılan claude-haiku-5-5). Yedek: COACH_FALLBACK_MODEL YALNIZ tanımlıysa ve birincil model
 * reddedilirse; kullanım loglanır ve kayda `fallback=1` yazılır.
 */
import { etDate } from '../../src/lib/usmarket.ts';
import { isTradingDay, sessionCloseMs } from '../../src/lib/usmarket.ts';
import { ANTHROPIC_URL, ANTHROPIC_VERSION, buildMessagesBody, parseMessagesReply, type ContentBlock } from '../../src/lib/coach/anthropic.ts';
import { checkImage } from '../../src/lib/coach/image.ts';
import { canCoach } from '../../src/lib/coach/limits.ts';
import { buildTradeContext, type FlowLite, type WallsLite } from '../../src/lib/coach/context.ts';
import { parseYahooBars, type Bar } from '../../src/lib/coach/bars.ts';
import { COACH_SYSTEM, coachUserText, EXTRACT_SYSTEM, extractUserText, KARNE_SYSTEM, karneUserText } from '../../src/lib/coach/prompt.ts';
import { parseJsonLoose, validateCoach, validateExtract, validateKarne } from '../../src/lib/coach/validate.ts';
import type { ExtractedTrade, TradeFeedback } from '../../src/lib/coach/types.ts';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import { errText } from './poller.ts';

export type Fetch = typeof fetch;
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionCalcCoach/1.0)' };
const DAY_MS = 86400000;
const RETAIN_MS = 30 * DAY_MS;
const MAX_TOKENS = { extract: 900, coach: 2000, karne: 900 } as const;
const EXTRACT_MAX_DAYS_BACK = 7;   // Yahoo 1 dk verisi son 7 gün

export type CoachKind = keyof typeof MAX_TOKENS;

export interface CoachDeps { cfg: Config; store: Store; f?: Fetch; now?: () => number; log?: (m: string) => void }

export class CoachError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Anthropic'e tek çağrı. Birincil model reddedilirse (404 / not_found / model hatası) ve yedek tanımlıysa yedekle dener. */
export class CoachClient {
  private readonly f: Fetch; private readonly now: () => number; private readonly log: (m: string) => void;
  private readonly d: CoachDeps;
  constructor(d: CoachDeps) {
    this.d = d;
    this.f = d.f ?? fetch; this.now = d.now ?? (() => Date.now()); this.log = d.log ?? (m => console.log(m));
  }

  async call(kind: CoachKind, day: string, system: string, content: ContentBlock[]): Promise<{ text: string; model: string; inTok: number; outTok: number; fallback: boolean }> {
    const key = this.d.cfg.anthropicKey;
    if (!key) throw new CoachError(503, 'Koç yapılandırılmadı: sunucuda Anthropic anahtarı yok');
    const primary = this.d.cfg.coachModel, fb = this.d.cfg.coachFallbackModel;
    const t0 = this.now();
    try {
      const r = await this.send(key, primary, system, content, MAX_TOKENS[kind]);
      this.logCall(kind, day, primary, r, false, t0, null);
      return { ...r, model: primary, fallback: false };
    } catch (e) {
      const err = e as CoachError & { modelRejected?: boolean; type?: string };
      if (!err.modelRejected || !fb || fb === primary) { this.logCall(kind, day, primary, null, false, t0, err.message); throw err; }
      this.log(`KOÇ UYARI: birincil model reddedildi (${err.type ?? 'hata'}); yedek kullanılıyor: ${fb}`);
      const t1 = this.now();
      try {
        const r = await this.send(key, fb, system, content, MAX_TOKENS[kind]);
        this.logCall(kind, day, fb, r, true, t1, null);
        return { ...r, model: fb, fallback: true };
      } catch (e2) {
        this.logCall(kind, day, fb, null, true, t1, (e2 as Error).message);
        throw e2;
      }
    }
  }

  private async send(key: string, model: string, system: string, content: ContentBlock[], maxTokens: number) {
    const body = buildMessagesBody({ model, system, content, maxTokens });
    const r = await this.f(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    const raw = await r.text();
    if (!r.ok) {
      let type = 'hata', msg = '';
      try { const j = JSON.parse(raw); type = String(j?.error?.type ?? 'hata'); msg = String(j?.error?.message ?? ''); } catch { /* yapısal olmayan gövde */ }
      const modelRejected = r.status === 404 || type === 'not_found_error' || (/model/i.test(msg) && (r.status === 400 || r.status === 404));
      const safe = `Anthropic ${r.status} (${type})`;
      const e = new CoachError(r.status === 401 ? 503 : 502, r.status === 401 ? 'Koç anahtarı geçersiz (sunucu)' : safe + (modelRejected ? ' — model reddedildi' : ''));
      Object.assign(e, { modelRejected, type });
      throw e;
    }
    let j: unknown;
    try { j = JSON.parse(raw); } catch { throw new CoachError(502, 'Anthropic yanıtı okunamadı'); }
    const p = parseMessagesReply(j);
    return { text: p.text, inTok: p.inTokens, outTok: p.outTokens };
  }

  private logCall(kind: CoachKind, day: string, model: string, r: { inTok: number; outTok: number } | null, fallback: boolean, t0: number, err: string | null) {
    const ms = this.now() - t0;
    this.d.store.coachLog({ ts: this.now(), day, kind, model, inTok: r?.inTok ?? 0, outTok: r?.outTok ?? 0, ok: !!r && !err, fallback, ms, err: err ? err.slice(0, 200) : null });
    this.log(`koç ${kind} model=${model}${fallback ? ' (yedek)' : ''} in=${r?.inTok ?? 0} out=${r?.outTok ?? 0} ${ms}ms${err ? ' HATA: ' + err.slice(0, 120) : ''}`);
  }
}

/** Yahoo 1 dk barları (son 5 gün; tek istek, ~bir kredi yok). Hata → [] (bağlam "veri yok" işaretler). */
export async function fetchBars1m(sym: string, f: Fetch = fetch): Promise<Bar[]> {
  try {
    const r = await f(`${YAHOO}/${encodeURIComponent(sym)}?range=5d&interval=1m`, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    return parseYahooBars(await r.json());
  } catch { return []; }
}

export interface CoachedOut {
  day: string; model: string; fallback: boolean; okuNamadi: string | null; warning: string | null; usage: { inTok: number; outTok: number };
  trades: { id: number; trade: ExtractedTrade; rules: unknown; feedback: TradeFeedback | null; noData: string[] }[];
}

export class Coach {
  readonly client: CoachClient;
  private readonly f: Fetch; private readonly now: () => number; private readonly log: (m: string) => void;
  private readonly karneRetryAt = new Map<string, number>();
  private readonly d: CoachDeps;
  constructor(d: CoachDeps) {
    this.d = d;
    this.f = d.f ?? fetch; this.now = d.now ?? (() => Date.now()); this.log = d.log ?? (m => console.log(m));
    this.client = new CoachClient(d);
  }

  /** POST /coach: görüntüyü işle. Hız sınırı + görüntü denetimi burada. */
  async coachImage(input: { image: unknown; mime: unknown; day?: unknown }): Promise<CoachedOut> {
    const t = this.now();
    const img = checkImage(input.mime, input.image);
    if (!img.ok) throw new CoachError(400, img.error);
    const day = typeof input.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : etDate(t);
    if (day > etDate(t) || day < etDate(t - EXTRACT_MAX_DAYS_BACK * DAY_MS)) throw new CoachError(400, 'İşlem günü geçersiz (son 7 gün)');
    const recent = this.d.store.coachRecent(t - DAY_MS);
    const gate = canCoach({ nowMs: t, countToday: recent.n, lastAtMs: recent.lastTs, dailyCap: this.d.cfg.coachDailyCap, minGapSec: this.d.cfg.coachMinGapSec });
    if (!gate.ok) throw new CoachError(429, gate.error);

    const b64 = input.image as string;
    const imgBlock: ContentBlock = { type: 'image', source: { type: 'base64', media_type: img.mime, data: b64 } };
    // (1) Görüntüden işlem çıkarma
    const ex = await this.client.call('extract', day, EXTRACT_SYSTEM, [imgBlock, { type: 'text', text: extractUserText(day) }]);
    const exJson = parseJsonLoose(ex.text);
    const exV = exJson.ok ? validateExtract(exJson.value) : { ok: false as const, error: exJson.error };
    if (!exV.ok) throw new CoachError(422, exV.error);
    const trades = exV.value.trades;

    // (2) Bağlam: Yahoo 1 dk (tek istek / ticker), duvar anlık görüntüsü, akış olayları
    const barsBySym = new Map<string, Bar[]>();
    for (const tr of trades) if (!barsBySym.has(tr.ticker)) barsBySym.set(tr.ticker, await fetchBars1m(tr.ticker, this.f));
    const ctxs = trades.map(tr => {
      const walls = this.wallsFor(day, tr.ticker);
      const flow = this.flowFor(day, tr.ticker, tr.entryTime);
      return buildTradeContext({ trade: tr, bars: barsBySym.get(tr.ticker) ?? [], day, walls, flow, nowMs: t });
    });

    // (3) Koçluk: görüntü + bağlam (tek çağrı, tüm işlemler)
    const items = trades.map((tr, i) => ({ index: i, trade: tr, rules: ctxs[i].rules, facts: ctxs[i].facts, noData: ctxs[i].noData }));
    const co = await this.client.call('coach', day, COACH_SYSTEM, [imgBlock, { type: 'text', text: coachUserText(items) }]);
    const coJson = parseJsonLoose(co.text);
    const coV = coJson.ok ? validateCoach(coJson.value, trades.length) : { ok: false as const, error: coJson.error };
    const feedbacks: (TradeFeedback | null)[] = coV.ok ? coV.value : trades.map(() => null);
    const warning = coV.ok ? null : `Koçluk yanıtı doğrulanamadı: ${coV.error}`;
    if (!coV.ok) this.log('KOÇ UYARI: koçluk çıktısı doğrulanamadı: ' + coV.error);

    // (4) Kayıt
    const out: CoachedOut['trades'] = [];
    for (let i = 0; i < trades.length; i++) {
      const id = this.d.store.coachAddTrade({ ts: t, day, trade: trades[i], rules: ctxs[i].rules, feedback: feedbacks[i], context: ctxs[i].facts, model: co.model });
      out.push({ id, trade: trades[i], rules: ctxs[i].rules, feedback: feedbacks[i], noData: ctxs[i].noData });
    }
    this.d.store.coachPrune(t - RETAIN_MS, etDate(t - RETAIN_MS));
    return {
      day, model: co.model, fallback: ex.fallback || co.fallback, okuNamadi: exV.value.okuNamadi, warning,
      usage: { inTok: ex.inTok + co.inTok, outTok: ex.outTok + co.outTok }, trades: out,
    };
  }

  /** Günün karnesi: koçluk kayıtlarından Haiku ile. Kayıt yoksa CoachError(404). */
  async karne(day: string): Promise<{ day: string; model: string; karne: unknown; ts: number }> {
    const rows = this.d.store.coachTradesOn(day);
    if (!rows.length) throw new CoachError(404, 'Bu gün için koçluk kaydı yok');
    const payload = rows.map(r => ({ trade: r.trade, feedback: r.feedback }));
    const r = await this.client.call('karne', day, KARNE_SYSTEM, [{ type: 'text', text: karneUserText(day, payload) }]);
    const j = parseJsonLoose(r.text);
    const v = j.ok ? validateKarne(j.value) : { ok: false as const, error: j.error };
    if (!v.ok) throw new CoachError(502, 'Karne doğrulanamadı: ' + v.error);
    const ts = this.now();
    this.d.store.coachSaveKarne(day, ts, r.model, v.value);
    return { day, model: r.model, karne: v.value, ts };
  }

  /** Kapanıştan 20 dk sonra, işlemi olan bugünün karnesi yoksa üretir (saatte bir denemeye kadar). Tek sefer/gün. */
  async autoKarneTick(): Promise<void> {
    if (!this.d.cfg.coachAuto || !this.d.cfg.anthropicKey) return;
    const t = this.now();
    const day = etDate(t);
    if (!isTradingDay(day)) return;
    const close = sessionCloseMs(day);
    if (close == null || t < close + 20 * 60000) return;
    if (this.d.store.coachKarneOn(day)) return;
    if (!this.d.store.coachTradesOn(day).length) return;
    const retry = this.karneRetryAt.get(day) ?? 0;
    if (t < retry) return;
    try {
      await this.karne(day);
      this.log(`koç karne (oto) ${day} üretildi`);
    } catch (e) {
      this.karneRetryAt.set(day, t + 3600000);
      this.log('koç karne (oto) hatası: ' + errText(e));
    }
  }

  /** GET /coach?day= */
  view(day: string) {
    return {
      day, trades: this.d.store.coachTradesOn(day).map(r => ({ id: r.id, ts: r.ts, trade: r.trade, rules: r.rules, feedback: r.feedback, model: r.model })),
      karne: this.d.store.coachKarneOn(day), usage: this.d.store.coachUsageOn(day),
    };
  }

  private wallsFor(day: string, ticker: string): WallsLite | null {
    const w = this.d.store.snapGet<Record<string, unknown>>(day, ticker, 'last');
    if (!w) return null;
    const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    return { callWall: num(w.callWall), putWall: num(w.putWall), gammaFlip: num(w.flip ?? w.gammaFlip), maxPain: num(w.maxPain), spot: num(w.spot), expiry: typeof w.expiry === 'string' ? w.expiry : null };
  }

  private flowFor(day: string, ticker: string, entryIst: string | null): FlowLite[] {
    const ev = this.d.store.listEvents({ day, limit: 500 }).filter(e => e.ticker === ticker);
    const center = entryIst ? Date.parse(entryIst + ':00+03:00') : null;
    const near = center == null ? ev : ev.filter(e => Math.abs(e.ts - center) <= 60 * 60000);
    return near.slice(0, 20).map(e => ({ ts: e.ts, side: e.side, strike: e.strike, expiry: e.expiry, prem: e.prem, dv: e.dv, confirmed: e.confirmed }));
  }
}

