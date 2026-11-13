/*
 * Akış tarayıcısı: piyasa saatlerinde (tatil dâhil) N dakikada bir.
 *  1) ticker başına TEK önbellekli zincir isteği (dte listesi = bugünün 0DTE'si + 3 ay içindeki Cuma vadeleri)
 *  2) hacim farkı (dV) ile aday kontratlar; ilk tarama referans toplar, olay üretmez
 *  3) en yüksek primli K aday canlı kotasyonla (options/quotes) teyit edilir; kalanlar "teyitsiz" kaydedilir
 *  4) soğuma (kontrat başına) ve push eşiği; yalnız teyitli, dar spread'li, eşik üstü olaylar push edilir
 * Ağ erişimi ChainSource arayüzü üzerinden: canlı (MdClient) ya da dry-run (fixture).
 */
import { marketOpen, etDate } from '../../src/lib/usmarket.ts';
import { flowExpiries, dteParam } from '../../src/lib/flow/expiry.ts';
import { candidates, confirmLive, nextBaseline, type Baseline, type Candidate, type ChainRow, type Measure } from '../../src/lib/flow/detect.ts';
import { parseChainRows } from '../../src/lib/flow/rows.ts';
import type { FlowEvent } from '../../src/lib/flow/model.ts';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import type { MdReply } from './md.ts';
import { BudgetError } from './md.ts';

export interface ChainSource {
  chain(ticker: string, q: { dte: string; maxage: string }, nowMs: number): Promise<MdReply>;
  quote(occ: string, nowMs: number): Promise<MdReply>;
}
export interface PushSender { send(events: FlowEvent[]): Promise<{ sent: number; ids: number[] }> }

export interface PollStats {
  at: number; day: string; skipped?: string; tickers: Record<string, string>;
  candidates: number; confirmed: number; unconfirmed: number; events: number; pushed: number; note?: string;
}

const OK = (s: number) => s === 200 || s === 203;

/** Olay kaydı (saf dönüşüm) */
export function toEvent(row: ChainRow, m: Measure, confirmed: boolean, ts: number, day: string): Omit<FlowEvent, 'id'> {
  return {
    ts, day, ticker: row.ticker, occ: row.occ, expiry: row.expiry, side: row.side, strike: row.strike,
    dv: m.dv, volume: row.volume, oi: row.oi, bid: row.bid, ask: row.ask, mid: m.mid, prem: m.prem, volOi: m.volOi,
    confirmed, wide: m.wide, pushed: false, underlying: row.underlying,
  };
}

export class Poller {
  lastPollAt = 0;
  lastOkAt = 0;
  lastError: string | null = null;
  polls = 0;
  running = false;
  last: PollStats | null = null;
  private lastPruneDay = '';

  private readonly cfg: Config;
  private readonly store: Store;
  private readonly src: ChainSource;
  private readonly push: PushSender | null;
  private readonly log: (m: string) => void;
  constructor(cfg: Config, store: Store, src: ChainSource, push: PushSender | null, log: (m: string) => void = () => {}) {
    this.cfg = cfg; this.store = store; this.src = src; this.push = push; this.log = log;
  }

  get intervalMs(): number { return this.cfg.intervalMin * 60000; }

  /** Zamanlayıcı: 15 sn'de bir kontrol; vakti gelmişse ve piyasa açıksa tara */
  start(): NodeJS.Timeout {
    return setInterval(() => {
      const now = Date.now();
      if (!this.cfg.pollEnabled || this.running || !marketOpen(now)) return;
      if (now - this.lastPollAt < this.intervalMs - 5000) return;
      this.running = true;
      this.pollOnce(now).catch(e => { this.lastError = errText(e); this.log('poll hatası: ' + this.lastError); })
        .finally(() => { this.running = false; });
    }, 15000);
  }

  /** Tek tarama. force: piyasa saati kontrolünü atla (dry-run / fixture). */
  async pollOnce(nowMs: number, opts: { force?: boolean } = {}): Promise<PollStats> {
    const day = etDate(nowMs);
    const stats: PollStats = { at: nowMs, day, tickers: {}, candidates: 0, confirmed: 0, unconfirmed: 0, events: 0, pushed: 0 };
    if (!opts.force && !marketOpen(nowMs)) { stats.skipped = 'piyasa kapalı'; this.last = stats; return stats; }
    if (this.lastPruneDay !== day) { this.store.prune(day, nowMs); this.lastPruneDay = day; }
    this.lastPollAt = nowMs; this.polls++;

    const th = this.cfg.thresholds;
    const targets = flowExpiries(nowMs);
    const targetSet = new Set(targets.map(t => t.date));
    const dte = dteParam(targets);
    const first = this.store.baseCount(day) === 0;
    const base = this.store.loadBase(day);
    const changed = new Map<string, Baseline>();
    const cooldown = this.store.activeCooldowns(nowMs - this.cfg.cooldownMin * 60000);
    const cands: Candidate[] = [];
    let budgetStop = false;

    for (const ticker of this.cfg.tickers) {
      if (budgetStop) { stats.tickers[ticker] = 'atlandı (bütçe)'; continue; }
      try {
        const r = await this.src.chain(ticker, { dte, maxage: `${this.cfg.intervalMin}min` }, nowMs);
        if (r.status === 204) { stats.tickers[ticker] = 'yeni veri yok'; continue; }
        if (!OK(r.status)) { stats.tickers[ticker] = `HTTP ${r.status}`; continue; }
        const rows = parseChainRows(r.json).filter(x => targetSet.has(x.expiry));
        if (!rows.length) { stats.tickers[ticker] = 'boş'; continue; }
        if (!first) cands.push(...candidates(rows, base, th, false, occ => cooldown.has(occ)));
        for (const [occ, b] of nextBaseline(rows, base)) {
          if (base.get(occ)?.upd !== b.upd || base.get(occ)?.vol !== b.vol) { base.set(occ, b); changed.set(occ, b); }
        }
        stats.tickers[ticker] = `ok (${rows.length})`;
        this.lastOkAt = nowMs;
      } catch (e) {
        if (e instanceof BudgetError) { budgetStop = true; stats.note = e.message; }
        stats.tickers[ticker] = 'hata: ' + errText(e);
        this.lastError = errText(e);
      }
    }
    stats.candidates = cands.length;

    // Aday sırası: prim (yüksek önce). En çok K tanesi canlı teyit; kalanı teyitsiz kaydedilir.
    cands.sort((a, b) => b.m.prem - a.m.prem);
    const K = this.cfg.confirmsPerPoll;
    const events: { e: Omit<FlowEvent, 'id'>; confirmed: boolean }[] = [];
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      if (i >= K || budgetStop) { events.push({ e: toEvent(c.row, c.m, false, nowMs, day), confirmed: false }); continue; }
      let live: ChainRow | undefined;
      try {
        const r = await this.src.quote(c.row.occ, nowMs);
        if (OK(r.status)) live = parseChainRows(r.json).find(x => x.occ === c.row.occ);
      } catch (e) {
        if (e instanceof BudgetError) { budgetStop = true; stats.note = e.message; }
        this.lastError = errText(e);
      }
      if (!live) { events.push({ e: toEvent(c.row, c.m, false, nowMs, day), confirmed: false }); continue; }
      base.set(live.occ, { vol: live.volume, upd: live.updated });
      changed.set(live.occ, { vol: live.volume, upd: live.updated });
      const m = confirmLive(c.prev, live, th);
      if (m) events.push({ e: toEvent(live, m, true, nowMs, day), confirmed: true });
    }
    stats.confirmed = events.filter(x => x.confirmed).length;
    stats.unconfirmed = events.length - stats.confirmed;

    // Kalıcılık: taban, olaylar, soğuma (tek işlem)
    if (changed.size) this.store.saveBase(day, changed);
    const saved: FlowEvent[] = [];
    for (const { e } of events) {
      const id = this.store.insertEvent(e);
      this.store.setCooldown(e.occ, nowMs);
      saved.push({ ...e, id });
    }
    stats.events = saved.length;

    // Push: yalnız teyitli, dar spread, eşik üstü; günlük sınır
    const pushable = saved.filter(e => e.confirmed && !e.wide && e.prem >= this.cfg.pushMinPremium).sort((a, b) => b.prem - a.prem);
    const room = Math.max(0, this.cfg.pushMaxPerDay - this.store.pushCountToday(day));
    const toPush = pushable.slice(0, room);
    if (this.push && toPush.length) {
      try {
        const { sent, ids } = await this.push.send(toPush);
        for (const id of ids) this.store.markPushed(id);
        if (sent) this.store.addPushCount(day, sent);
        stats.pushed = sent;
      } catch (e) { this.lastError = 'push: ' + errText(e); }
    }

    this.last = stats;
    if (stats.events) this.log(`akış: ${stats.events} olay (${stats.confirmed} teyitli), ${stats.pushed} push`);
    return stats;
  }
}

/** Hata metni: tokenlar hiçbir zaman yazılmaz (kaynak mesajlar yalnız kendi Türkçe metinlerimizdir) */
export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.replace(/Bearer\s+\S+/gi, 'Bearer ***').slice(0, 160);
}
