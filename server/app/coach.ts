/*
 * Koç (işlem koçu) — sunucu tarafı (v2: toplu). Akış:
 *  1) POST /coach: görüntü → sha256 (aynıysa önbellek, Haiku yok) → Haiku #1 (dolum çıkarma, kısa JSON, max 400 token)
 *     → dolumlar SQLite'a (aynı dolum tekrar gelirse yok) → eşleştirme (src/lib/coach/fills.ts, FIFO) → yeni eşleşen
 *     işlemler için en çok 3 koçluk (Haiku #2, yalnız metin: sayılar kodda) → rapor SQLite.
 *  2) POST /coach/process: bekleyen koçlukları işler (en çok 5). 3) GET /coach?day=: görünüm. 4) POST /coach/karne.
 * Anahtar: /etc/optioncalc-flow/anthropic_key (systemd LoadCredential). Asla loglanmaz/yanıtlanmaz; hata metninden de temizlenir.
 * Model: COACH_MODEL (varsayılan claude-haiku-5-5). Yedek: COACH_FALLBACK_MODEL YALNIZ tanımlıysa ve birincil model
 * reddedilirse; kullanım loglanır ve kayda `fallback=1` yazılır.
 */
import { createHash } from 'node:crypto';
import { etDate } from '../../src/lib/usmarket.ts';
import { isTradingDay, sessionCloseMs } from '../../src/lib/usmarket.ts';
import { ANTHROPIC_URL, ANTHROPIC_VERSION, buildMessagesBody, parseMessagesReply, type ContentBlock, type ToolDef } from '../../src/lib/coach/anthropic.ts';
import { checkImage } from '../../src/lib/coach/image.ts';
import { canCoach } from '../../src/lib/coach/limits.ts';
import { buildTradeContext, type FlowLite, type WallsLite } from '../../src/lib/coach/context.ts';
import { parseYahooBars, type Bar } from '../../src/lib/coach/bars.ts';
import { COACH_SYSTEM, coachUserText, EXTRACT_SYSTEM, EXTRACT_TOOL, extractUserText, KARNE_SYSTEM, karneUserText } from '../../src/lib/coach/prompt.ts';
import { parseJsonLoose, parseModelJson, sampleText, validateCoach, validateFills, validateKarne } from '../../src/lib/coach/validate.ts';
import type { CoachDayView, CoachOpenView, CoachTradeView, Fill, Karne, TradeReport } from '../../src/lib/coach/types.ts';
import { buildReport } from '../../src/lib/coach/report.ts';
import { pairFills, type PairedTrade } from '../../src/lib/coach/fills.ts';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import { errText } from './poller.ts';

export type Fetch = typeof fetch;
const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; OptionCalcCoach/1.0)' };
const DAY_MS = 86400000;
const RETAIN_MS = 30 * DAY_MS;
const MAX_TOKENS = { extract: 1024, coach: 3500, karne: 900 } as const;   // extract: 400 çok düşüktü (6 satır JSON ≈ 450 token); coach: 2000 kesti, 3500
const EXTRACT_MAX_DAYS_BACK = 7;   // Yahoo 1 dk verisi son 7 gün
const WINDOW_DAYS = 30;           // eşleştirme ve saklama penceresi
const INLINE_COACH = 3;           // yükleme isteği başına en çok koçluk (kalanı /coach/process)
const PROCESS_MAX = 5;            // /coach/process isteği başına en çok koçluk
const FAIL_COOLDOWN_MS = 3600000; // aynı işlemde başarısız koçluk: 1 sa bekle (maliyet koruması)

export type CoachKind = keyof typeof MAX_TOKENS;
/** Anthropic yanıtının sunucuda kullanılan özeti (toolInput: zorunlu araç girdisi, varsa) */
export interface CallOut { text: string; toolInput: Record<string, unknown> | null; model: string; inTok: number; outTok: number; fallback: boolean; stopReason: string | null }

export interface CoachDeps { cfg: Config; store: Store; f?: Fetch; now?: () => number; log?: (m: string) => void }

export class CoachError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) { super(message); this.status = status; this.extra = extra; }
}

/** Anthropic'e tek çağrı. Birincil model reddedilirse (404 / not_found / model hatası) ve yedek tanımlıysa yedekle dener. */
export class CoachClient {
  private readonly f: Fetch; private readonly now: () => number; private readonly log: (m: string) => void;
  private readonly d: CoachDeps;
  constructor(d: CoachDeps) {
    this.d = d;
    this.f = d.f ?? fetch; this.now = d.now ?? (() => Date.now()); this.log = d.log ?? (m => console.log(m));
  }

  async call(kind: CoachKind, day: string, system: string, content: ContentBlock[], tool?: ToolDef): Promise<CallOut> {
    const key = this.d.cfg.anthropicKey;
    if (!key) throw new CoachError(503, 'Koç yapılandırılmadı: sunucuda Anthropic anahtarı yok');
    const primary = this.d.cfg.coachModel, fb = this.d.cfg.coachFallbackModel;
    const t0 = this.now();
    try {
      const r = await this.send(key, primary, system, content, MAX_TOKENS[kind], tool);
      this.logCall(kind, day, primary, r, false, t0, null);
      return { ...r, model: primary, fallback: false };
    } catch (e) {
      const err = e as CoachError & { modelRejected?: boolean; type?: string };
      if (!err.modelRejected || !fb || fb === primary) { this.logCall(kind, day, primary, null, false, t0, err.message); throw err; }
      this.log(`KOÇ UYARI: birincil model reddedildi (${err.type ?? 'hata'}); yedek kullanılıyor: ${fb}`);
      const t1 = this.now();
      try {
        const r = await this.send(key, fb, system, content, MAX_TOKENS[kind], tool);
        this.logCall(kind, day, fb, r, true, t1, null);
        return { ...r, model: fb, fallback: true };
      } catch (e2) {
        this.logCall(kind, day, fb, null, true, t1, (e2 as Error).message);
        throw e2;
      }
    }
  }

  private async send(key: string, model: string, system: string, content: ContentBlock[], maxTokens: number, tool?: ToolDef): Promise<CallOut> {
    const body = buildMessagesBody({ model, system, content, maxTokens, tool });
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
    return { text: p.text, toolInput: p.toolInput, inTok: p.inTokens, outTok: p.outTokens, stopReason: p.stopReason };
  }

  private logCall(kind: CoachKind, day: string, model: string, r: { inTok: number; outTok: number; stopReason?: string | null } | null, fallback: boolean, t0: number, err: string | null) {
    const ms = this.now() - t0;
    this.d.store.coachLog({ ts: this.now(), day, kind, model, inTok: r?.inTok ?? 0, outTok: r?.outTok ?? 0, ok: !!r && !err, fallback, ms, err: err ? err.slice(0, 200) : null });
    this.log(`koç ${kind} model=${model}${fallback ? ' (yedek)' : ''} in=${r?.inTok ?? 0} out=${r?.outTok ?? 0} stop=${r?.stopReason ?? '?'} ${ms}ms${err ? ' HATA: ' + err.slice(0, 120) : ''}`);
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


export interface UploadOut {
  day: string; duplicate: boolean; added: number;
  fills: { id: number; t: string; tk: string; exp: string; k: number; cp: 'C' | 'P'; q: number; side: 'buy' | 'sell'; px: number; conf: string }[];
  note: string | null; model: string; fallback: boolean;
  coached: number; pending: number; warnings: string[];
  usage: { inTok: number; outTok: number };
}

export class Coach {
  readonly client: CoachClient;
  private readonly f: Fetch; private readonly now: () => number; private readonly log: (m: string) => void;
  private readonly karneRetryAt = new Map<string, number>();
  private readonly failedAt = new Map<string, number>();
  private readonly d: CoachDeps;
  constructor(d: CoachDeps) {
    this.d = d;
    this.f = d.f ?? fetch; this.now = d.now ?? (() => Date.now()); this.log = d.log ?? (m => console.log(m));
    this.client = new CoachClient(d);
  }

  /** POST /coach: görüntüyü işle (dolum çıkarma → eşleştirme → en çok INLINE_COACH yeni koçluk). Aynı görüntü: önbellek. */
  async coachImage(input: { image: unknown; mime: unknown; day?: unknown }): Promise<UploadOut> {
    const t = this.now();
    const img = checkImage(input.mime, input.image);
    if (!img.ok) throw new CoachError(400, img.error);
    const day = typeof input.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.day) ? input.day : etDate(t);
    if (day > etDate(t) || day < etDate(t - EXTRACT_MAX_DAYS_BACK * DAY_MS)) throw new CoachError(400, 'İşlem günü geçersiz (son 7 gün)');
    const b64 = input.image as string;
    const hash = createHash('sha256').update(b64).digest('hex');

    // (0) Aynı görüntü: Haiku yok, sayaç yok, koçluk yok (yeni eşleşme olmadığı sürece)
    const prev = this.d.store.coachShotGet(hash);
    if (prev) {
      const pending = this.pendingCount(t);
      return { day: prev.day, duplicate: true, added: 0, fills: prev.fills as UploadOut['fills'], note: prev.note, model: prev.model, fallback: false,
        coached: 0, pending, warnings: [], usage: { inTok: 0, outTok: 0 } };
    }

    // (1) Hız sınırı: son 24 saatte çıkarma çağrısı (kayan pencere) + iki yükleme arası asgari süre
    const recent = this.d.store.coachRecent(t - DAY_MS);
    const gate = canCoach({ nowMs: t, countToday: recent.n, lastAtMs: recent.lastTs, dailyCap: this.d.cfg.coachDailyCap, minGapSec: this.d.cfg.coachMinGapSec });
    if (!gate.ok) throw new CoachError(429, gate.error, { retryAfterSec: gate.retryAfterSec, kind: gate.kind });

    // (2) Dolum çıkarma (tek Haiku çağrısı)
    const imgBlock: ContentBlock = { type: 'image', source: { type: 'base64', media_type: img.mime, data: b64 } };
    const ex = await this.client.call('extract', day, EXTRACT_SYSTEM, [imgBlock, { type: 'text', text: extractUserText(day) }], EXTRACT_TOOL);
    // Zorunlu araç (tool_use) girdisi varsa doğrudan kullanılır; yoksa metin toleranslı ayrıştırılır (önsöz/çit/dizi).
    const exJson = ex.toolInput ? { ok: true as const, value: ex.toolInput as unknown } : parseModelJson(ex.text);
    const exV = exJson.ok ? validateFills(exJson.value) : { ok: false as const, error: exJson.error };
    if (!exV.ok) {
      this.parseWarn('dolum çıkarılamadı', day, ex, exV.error);
      throw new CoachError(422, exV.error);
    }

    // (3) Dolumları kaydet (aynı dolum tekrar gelirse kimliği döner, yeni sayılmaz)
    const stored = exV.value.fills.map(f => ({ f, r: this.d.store.coachFillInsert({ day: f.t.slice(0, 10), t: f.t, tk: f.tk, exp: f.exp, k: f.k, cp: f.cp, q: f.q, side: f.side, px: f.px, conf: f.conf, shot: hash }) }));
    const added = stored.filter(x => x.r.added).length;
    const fills: UploadOut['fills'] = stored.map(({ f, r }) => ({ id: r.id, t: f.t, tk: f.tk, exp: f.exp, k: f.k, cp: f.cp, q: f.q, side: f.side, px: f.px, conf: f.conf }));
    this.d.store.coachShotPut({ hash, ts: t, day, model: ex.model, inTok: ex.inTok, outTok: ex.outTok, note: exV.value.note, fills });

    // (4) Eşleşen yeni işlemler için koçluk (en çok INLINE_COACH; kalanı /coach/process)
    const pr = await this.processPending({ limit: INLINE_COACH, nowMs: t });
    this.d.store.coachPrune(t - RETAIN_MS, etDate(t - RETAIN_MS));
    return {
      day, duplicate: false, added, fills, note: exV.value.note, model: ex.model, fallback: ex.fallback || pr.fallback,
      coached: pr.done, pending: pr.pending, warnings: pr.errors,
      usage: { inTok: ex.inTok + pr.inTok, outTok: ex.outTok + pr.outTok },
    };
  }

  /** POST /coach/process?day=: bekleyen koçlukları işler (en çok PROCESS_MAX). */
  async process(day: string | undefined): Promise<{ processed: number; pending: number; errors: string[] }> {
    const r = await this.processPending({ day, limit: PROCESS_MAX, nowMs: this.now() });
    return { processed: r.done, pending: r.pending, errors: r.errors };
  }

  /** Eşleşmiş, koçluğu olmayan (uzun) işlemleri koçlar. Her biri bağımsız: biri başarısızsa diğerleri sürer. */
  private async processPending(a: { day?: string; limit: number; nowMs: number }) {
    const t = a.nowMs;
    const fromDay = etDate(t - WINDOW_DAYS * DAY_MS);
    const pairing = pairFills(this.fillsSince(fromDay));
    this.d.store.coachReportsPrune(fromDay, new Set(pairing.trades.map(p => p.sig)));
    const todo = pairing.trades.filter(p => !this.d.store.coachReportGet(p.sig) && (!a.day || p.entryT.slice(0, 10) === a.day));
    const out = { done: 0, pending: 0, errors: [] as string[], inTok: 0, outTok: 0, fallback: false };
    for (const p of todo.slice(0, Math.max(0, a.limit))) {
      const last = this.failedAt.get(p.sig);
      if (last != null && t - last < FAIL_COOLDOWN_MS) { out.errors.push(`${p.tk} ${p.k}${p.cp}: önceki hata, bir saat sonra yeniden denenecek`); continue; }
      try {
        const r = await this.coachOne(p, t);
        out.done++; out.inTok += r.inTok; out.outTok += r.outTok; out.fallback ||= r.fallback;
        this.failedAt.delete(p.sig);
      } catch (e) {
        this.failedAt.set(p.sig, t);
        out.errors.push(`${p.tk} ${p.k}${p.cp}: ${errText(e)}`);
      }
    }
    out.pending = todo.length - out.done;
    return out;
  }

  /** Tek işlem için koçluk: bağlam (Yahoo 1 dk, duvar, akış) → Haiku (metin) → rapor (sayılar kodda) → SQLite */
  private async coachOne(p: PairedTrade, t: number): Promise<{ inTok: number; outTok: number; fallback: boolean }> {
    const day = p.entryT.slice(0, 10);
    const bars = await fetchBars1m(p.tk, this.f);
    const ctx = buildTradeContext({ trade: p.trade, bars, day, walls: this.wallsFor(day, p.tk), flow: this.flowFor(day, p.tk, p.entryT), nowMs: t });
    const items = [{ index: 0, trade: p.trade, legs: p.legs, rules: ctx.rules, facts: ctx.facts, noData: ctx.noData }];
    const co = await this.client.call('coach', day, COACH_SYSTEM, [{ type: 'text', text: coachUserText(items) }]);
    const coJson = parseJsonLoose(co.text);
    const coV = coJson.ok ? validateCoach(coJson.value, 1) : { ok: false as const, error: coJson.error };
    const fb = coV.ok ? coV.value[0] : null;
    if (!fb) {
      const why = coV.ok ? 'öğe yok' : coV.error;
      this.parseWarn(`koçluk doğrulanamadı (${p.tk} ${p.k}${p.cp})`, day, co, why);
      throw new CoachError(502, `Koçluk yanıtı doğrulanamadı: ${why}${co.stopReason === 'max_tokens' ? ' (çıktı üst sınıra takıldı)' : ''}`);
    }
    const report = buildReport({ trade: p.trade, nums: ctx.nums, rules: ctx.rules, noData: ctx.noData, model: co.model, feedback: fb });
    this.d.store.coachReportPut({ sig: p.sig, day, ts: t, model: co.model, trade: p.trade, rules: ctx.rules, feedback: report, context: ctx.facts });
    return { inTok: co.inTok, outTok: co.outTok, fallback: co.fallback };
  }

  /** Günün karnesi: koçluk raporlarından Haiku ile. Rapor yoksa CoachError(404). */
  async karne(day: string): Promise<{ day: string; model: string; karne: unknown; ts: number }> {
    const rows = this.d.store.coachReportsOn(day);
    if (!rows.length) throw new CoachError(404, 'Bu gün için koçluk kaydı yok');
    const payload = rows.map(r => {
      const rep = r.feedback as TradeReport;
      return { ticker: rep.header.ticker, side: rep.header.side, netPnl: rep.header.netPnl, cikis: rep.cikis.karar, giris: rep.giris.karar, strike: rep.strike.karar, puanlar: rep.karne, yorum: rep.cikis.neden };
    });
    const r = await this.client.call('karne', day, KARNE_SYSTEM, [{ type: 'text', text: karneUserText(day, payload) }]);
    const j = parseJsonLoose(r.text);
    const v = j.ok ? validateKarne(j.value) : { ok: false as const, error: j.error };
    if (!v.ok) { this.parseWarn('karne doğrulanamadı', day, r, v.error); throw new CoachError(502, 'Karne doğrulanamadı: ' + v.error); }
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
    if (!this.d.store.coachReportsOn(day).length) return;
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

  /** GET /coach?day=: günün dolumları, eşleşmiş işlemleri (rapor dâhil), açık pozisyonlar, eşleşmeyen kapanışlar, karne */
  view(day: string): CoachDayView {
    const t = this.now();
    const fromDay = etDate(t - WINDOW_DAYS * DAY_MS);
    const fills = this.fillsSince(fromDay);
    const pairing = pairFills(fills);
    const trades: CoachTradeView[] = pairing.trades.filter(p => p.entryT.slice(0, 10) === day).map(p => {
      const rep = this.d.store.coachReportGet(p.sig);
      return {
        sig: p.sig, tk: p.tk, exp: p.exp, k: p.k, cp: p.cp, qty: p.qty,
        entryT: p.entryT, entryPx: p.entryPx, exitT: p.exitT, exitPx: p.exitPx, legs: p.legs.length, conf: p.conf,
        status: rep ? 'hazir' : 'bekliyor', ts: rep?.ts ?? 0, report: (rep?.feedback as TradeReport | undefined) ?? null,
      };
    });
    const open: CoachOpenView[] = pairing.open.map(o => ({
      tk: o.tk, exp: o.exp, k: o.k, cp: o.cp, qty: o.qty, entryT: o.entryT, entryPx: o.entryPx,
      closedQty: o.closedQty, closedPx: o.closedPx,
    }));
    const pending = pairing.trades.filter(p => !this.d.store.coachReportGet(p.sig)).length;
    return {
      day,
      fills: fills.filter(f => f.t.slice(0, 10) === day),
      trades, open,
      orphans: pairing.orphans.filter(f => f.t.slice(0, 10) === day),
      pending,
      karne: this.d.store.coachKarneOn(day) as CoachDayView['karne'],
      usage: this.d.store.coachUsageOn(day),
    };
  }

  /** Ayrıştırma hatasında tanı: durma nedeni, token kullanımı ve model metninin ≤300 karakterlik örneği (anahtar/base64 yok). */
  private parseWarn(what: string, day: string, r: { text: string; toolInput?: Record<string, unknown> | null; stopReason: string | null; inTok: number; outTok: number }, why: string) {
    const sample = r.text ? sampleText(r.text) : r.toolInput ? sampleText(JSON.stringify(r.toolInput)) : '';
    this.log(`KOÇ UYARI: ${what} (${day}): ${why}; stop=${r.stopReason ?? '?'} in=${r.inTok} out=${r.outTok} tool=${r.toolInput ? 1 : 0} örnek="${sample}"`);
  }

  private pendingCount(t: number): number {
    const pairing = pairFills(this.fillsSince(etDate(t - WINDOW_DAYS * DAY_MS)));
    return pairing.trades.filter(p => !this.d.store.coachReportGet(p.sig)).length;
  }

  private fillsSince(fromDay: string): Fill[] {
    return this.d.store.coachFillsSince(fromDay).map(r => ({ id: r.id, t: r.t, tk: r.tk, exp: r.exp, k: r.k, cp: r.cp, q: r.q, side: r.side, px: r.px, conf: r.conf }));
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
