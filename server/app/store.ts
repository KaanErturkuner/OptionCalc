/* SQLite (node:sqlite, yerleşik; native derleme YOK): kredi sayacı, gün içi hacim tabanı, olaylar, soğuma, push tokenları. */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Baseline, ChainRow } from '../../src/lib/flow/detect.ts';
import type { FlowEvent } from '../../src/lib/flow/model.ts';
import { FLOW_DAYS_MAX, oldestTradingDay } from '../../src/lib/flow/days.ts';

/** Olay saklama: son N işlem günü (akış penceresi en çok FLOW_DAYS_MAX; bir fazlası tampon) */
export const RETAIN_TRADING_DAYS = FLOW_DAYS_MAX;

export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credits (day TEXT NOT NULL, src TEXT NOT NULL, used INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, src));
      CREATE TABLE IF NOT EXISTS base (day TEXT NOT NULL, occ TEXT NOT NULL, vol REAL NOT NULL, upd REAL NOT NULL, PRIMARY KEY (day, occ));
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, ticker TEXT NOT NULL, occ TEXT NOT NULL,
        expiry TEXT NOT NULL, side TEXT NOT NULL, strike REAL NOT NULL, dv REAL NOT NULL, volume REAL NOT NULL, oi REAL NOT NULL,
        bid REAL NOT NULL, ask REAL NOT NULL, mid REAL NOT NULL, prem REAL NOT NULL, volOi REAL NOT NULL,
        confirmed INTEGER NOT NULL, wide INTEGER NOT NULL, pushed INTEGER NOT NULL, underlying REAL);
      CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      CREATE INDEX IF NOT EXISTS events_day ON events (day);
      CREATE TABLE IF NOT EXISTS cooldown (occ TEXT PRIMARY KEY, at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS push_tokens (token TEXT PRIMARY KEY, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS push_count (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, day TEXT NOT NULL,
        ts INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, push_title TEXT NOT NULL, push_body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS reports_ts ON reports (ts);
      CREATE TABLE IF NOT EXISTS snap (day TEXT NOT NULL, ticker TEXT NOT NULL, kind TEXT NOT NULL, ts INTEGER NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY (day, ticker, kind));
      CREATE TABLE IF NOT EXISTS coach_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
        model TEXT NOT NULL, in_tok INTEGER NOT NULL, out_tok INTEGER NOT NULL, ok INTEGER NOT NULL, fallback INTEGER NOT NULL, ms INTEGER NOT NULL, err TEXT);
      CREATE INDEX IF NOT EXISTS coach_calls_ts ON coach_calls (ts);
      CREATE TABLE IF NOT EXISTS coach_trades (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, day TEXT NOT NULL, trade TEXT NOT NULL,
        rules TEXT NOT NULL, feedback TEXT, context TEXT, model TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS coach_trades_day ON coach_trades (day);
      CREATE TABLE IF NOT EXISTS coach_karne (day TEXT PRIMARY KEY, ts INTEGER NOT NULL, model TEXT NOT NULL, body TEXT NOT NULL);
    `);
  }

  // ── kredi sayacı (gün = MarketData kredi günü, 09:30 ET'de döner; bkz. server/README) ──
  addCredits(day: string, src: string, n: number): void {
    if (!(n > 0)) return;
    this.db.prepare('INSERT INTO credits (day, src, used) VALUES (?, ?, ?) ON CONFLICT (day, src) DO UPDATE SET used = used + excluded.used')
      .run(day, src, Math.round(n));
  }
  creditsOn(day: string, src?: string): number {
    const r = src
      ? this.db.prepare('SELECT used FROM credits WHERE day = ? AND src = ?').get(day, src)
      : this.db.prepare('SELECT COALESCE(SUM(used), 0) AS used FROM credits WHERE day = ?').get(day);
    return Number((r as { used?: number } | undefined)?.used ?? 0);
  }
  creditsByDay(limit = 7): { day: string; src: string; used: number }[] {
    return this.db.prepare('SELECT day, src, used FROM credits ORDER BY day DESC, src LIMIT ?').all(limit * 4) as { day: string; src: string; used: number }[];
  }

  // ── gün içi hacim tabanı ──
  baseCount(day: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM base WHERE day = ?').get(day) as { n: number }).n);
  }
  loadBase(day: string): Map<string, Baseline> {
    const m = new Map<string, Baseline>();
    for (const r of this.db.prepare('SELECT occ, vol, upd FROM base WHERE day = ?').all(day) as { occ: string; vol: number; upd: number }[])
      m.set(r.occ, { vol: r.vol, upd: r.upd });
    return m;
  }
  saveBase(day: string, rows: Map<string, Baseline>): void {
    const st = this.db.prepare('INSERT INTO base (day, occ, vol, upd) VALUES (?, ?, ?, ?) ON CONFLICT (day, occ) DO UPDATE SET vol = excluded.vol, upd = excluded.upd');
    this.db.exec('BEGIN');
    try { for (const [occ, b] of rows) st.run(day, occ, b.vol, b.upd); this.db.exec('COMMIT'); }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  /** Eski günleri sil: taban ve kredi 14 takvim günü; olaylar son RETAIN_TRADING_DAYS işlem günü tutulur */
  prune(today: string, nowMs: number): void {
    const cutoff = new Date(Date.parse(today + 'T12:00:00Z') - 14 * 86400000).toISOString().slice(0, 10);
    this.db.prepare('DELETE FROM base WHERE day < ?').run(cutoff);
    this.db.prepare('DELETE FROM events WHERE day < ?').run(oldestTradingDay(nowMs, RETAIN_TRADING_DAYS));
    this.db.prepare('DELETE FROM credits WHERE day < ?').run(cutoff);
    this.db.prepare('DELETE FROM push_count WHERE day < ?').run(cutoff);
  }

  // ── olaylar ──
  insertEvent(e: Omit<FlowEvent, 'id'>): number {
    const r = this.db.prepare(`INSERT INTO events (ts, day, ticker, occ, expiry, side, strike, dv, volume, oi, bid, ask, mid, prem, volOi, confirmed, wide, pushed, underlying)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      e.ts, e.day, e.ticker, e.occ, e.expiry, e.side, e.strike, e.dv, e.volume, e.oi, e.bid, e.ask, e.mid, e.prem, e.volOi,
      e.confirmed ? 1 : 0, e.wide ? 1 : 0, e.pushed ? 1 : 0, e.underlying);
    return Number(r.lastInsertRowid);
  }
  markPushed(id: number): void { this.db.prepare('UPDATE events SET pushed = 1 WHERE id = ?').run(id); }
  /** Olaylar yeni → eski. day: tek gün; fromDay: bu günden (dâhil) itibaren (ET, YYYY-MM-DD ile karşılaştırılır) */
  listEvents(opts: { sinceId?: number; limit?: number; day?: string; fromDay?: string }): FlowEvent[] {
    const lim = Math.min(500, Math.max(1, opts.limit ?? 100));
    const rows = opts.day
      ? this.db.prepare('SELECT * FROM events WHERE day = ? AND id > ? ORDER BY id DESC LIMIT ?').all(opts.day, opts.sinceId ?? 0, lim)
      : opts.fromDay
        ? this.db.prepare('SELECT * FROM events WHERE day >= ? AND id > ? ORDER BY id DESC LIMIT ?').all(opts.fromDay, opts.sinceId ?? 0, lim)
        : this.db.prepare('SELECT * FROM events WHERE id > ? ORDER BY id DESC LIMIT ?').all(opts.sinceId ?? 0, lim);
    return (rows as Record<string, unknown>[]).map(toEvent);
  }
  summary(day: string): { ticker: string; callPrem: number; putPrem: number; events: number }[] {
    return this.db.prepare(`SELECT ticker,
        COALESCE(SUM(CASE WHEN side = 'call' THEN prem ELSE 0 END), 0) AS callPrem,
        COALESCE(SUM(CASE WHEN side = 'put' THEN prem ELSE 0 END), 0) AS putPrem,
        COUNT(*) AS events FROM events WHERE day = ? AND confirmed = 1 GROUP BY ticker ORDER BY ticker`).all(day) as
      { ticker: string; callPrem: number; putPrem: number; events: number }[];
  }

  // ── soğuma (kontrat başına) ──
  activeCooldowns(sinceMs: number): Set<string> {
    return new Set((this.db.prepare('SELECT occ FROM cooldown WHERE at > ?').all(sinceMs) as { occ: string }[]).map(r => r.occ));
  }
  setCooldown(occ: string, at: number): void {
    this.db.prepare('INSERT INTO cooldown (occ, at) VALUES (?, ?) ON CONFLICT (occ) DO UPDATE SET at = excluded.at').run(occ, at);
  }

  // ── push ──
  pushTokens(): string[] { return (this.db.prepare('SELECT token FROM push_tokens').all() as { token: string }[]).map(r => r.token); }
  addPushToken(token: string, at: number): void {
    this.db.prepare('INSERT INTO push_tokens (token, created) VALUES (?, ?) ON CONFLICT (token) DO NOTHING').run(token, at);
  }
  removePushToken(token: string): boolean {
    return Number(this.db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token).changes) > 0;
  }
  pushCountToday(day: string): number {
    return Number((this.db.prepare('SELECT n FROM push_count WHERE day = ?').get(day) as { n: number } | undefined)?.n ?? 0);
  }
  addPushCount(day: string, n: number): void {
    this.db.prepare('INSERT INTO push_count (day, n) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET n = n + excluded.n').run(day, n);
  }

  // ── rapor duvar anlık görüntüleri (gün başı 'open' = ilk tarama; 'last' = her tarama) ──
  snapPut(day: string, ticker: string, kind: 'open' | 'last', ts: number, data: object): void {
    const json = JSON.stringify(data);
    if (kind === 'open') this.db.prepare('INSERT OR IGNORE INTO snap (day, ticker, kind, ts, data) VALUES (?, ?, ?, ?, ?)').run(day, ticker, kind, ts, json);
    else this.db.prepare('INSERT INTO snap (day, ticker, kind, ts, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, ticker, kind) DO UPDATE SET ts = excluded.ts, data = excluded.data').run(day, ticker, kind, ts, json);
  }
  snapGet<T = unknown>(day: string, ticker: string, kind: 'open' | 'last'): T | null {
    const r = this.db.prepare('SELECT data FROM snap WHERE day = ? AND ticker = ? AND kind = ?').get(day, ticker, kind) as { data: string } | undefined;
    return r ? JSON.parse(r.data) as T : null;
  }
  /** Bugünkü teyitli+teyitsiz olayların kontrat bazlı toplamı (dV ve prim) */
  flowAgg(day: string): { ticker: string; expiry: string; side: 'call' | 'put'; strike: number; contracts: number; premium: number }[] {
    return (this.db.prepare(`SELECT ticker, expiry, side, strike, SUM(dv) AS contracts, SUM(prem) AS premium FROM events WHERE day = ?
      GROUP BY ticker, expiry, side, strike ORDER BY premium DESC LIMIT 40`).all(day) as
      { ticker: string; expiry: string; side: string; strike: number; contracts: number; premium: number }[])
      .map(r => ({ ...r, side: r.side === 'put' ? 'put' as const : 'call' as const }));
  }

  // ── raporlar (30 gün) ──
  hasReport(key: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM reports WHERE key = ?').get(key);
  }
  insertReport(r: { key: string; kind: string; day: string; ts: number; title: string; body: string; pushTitle: string; pushBody: string }): number {
    const x = this.db.prepare(`INSERT OR IGNORE INTO reports (key, kind, day, ts, title, body, push_title, push_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(r.key, r.kind, r.day, r.ts, r.title, r.body, r.pushTitle, r.pushBody);
    return Number(x.lastInsertRowid);
  }
  listReports(limit: number): ReportRow[] {
    return (this.db.prepare('SELECT id, kind, day, ts, title, body FROM reports ORDER BY ts DESC, id DESC LIMIT ?').all(Math.min(50, Math.max(1, limit))) as unknown as ReportRow[]);
  }
  getReport(id: number): ReportRow | null {
    return (this.db.prepare('SELECT id, kind, day, ts, title, body FROM reports WHERE id = ?').get(id) as unknown as ReportRow | undefined) ?? null;
  }
  /** Saklama: ts'si cutoffMs'den eski raporlar silinir */
  pruneReports(cutoffMs: number): number {
    return Number(this.db.prepare('DELETE FROM reports WHERE ts < ?').run(cutoffMs).changes);
  }
  /** Duvar anlık görüntüleri: 14 gün */
  // ── koç (coach): çağrı kaydı (token), işlemler, karne ──
  coachLog(r: { ts: number; day: string; kind: string; model: string; inTok: number; outTok: number; ok: boolean; fallback: boolean; ms: number; err: string | null }): void {
    this.db.prepare('INSERT INTO coach_calls (ts, day, kind, model, in_tok, out_tok, ok, fallback, ms, err) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(r.ts, r.day, r.kind, r.model, r.inTok, r.outTok, r.ok ? 1 : 0, r.fallback ? 1 : 0, r.ms, r.err);
  }
  /** Hız sınırı için: son N ms'de 'extract' çağrı sayısı ve son çağrı zamanı */
  coachRecent(sinceMs: number): { n: number; lastTs: number | null } {
    const r = this.db.prepare("SELECT COUNT(*) AS n, MAX(ts) AS last FROM coach_calls WHERE kind = 'extract' AND ts >= ?").get(sinceMs) as { n: number; last: number | null };
    return { n: Number(r.n), lastTs: r.last == null ? null : Number(r.last) };
  }
  /** Bir gün için toplam token kullanımı (kayıtlı çağrılar) */
  coachUsageOn(day: string): { calls: number; inTok: number; outTok: number } {
    const r = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(in_tok), 0) AS i, COALESCE(SUM(out_tok), 0) AS o FROM coach_calls WHERE day = ?').get(day) as { n: number; i: number; o: number };
    return { calls: Number(r.n), inTok: Number(r.i), outTok: Number(r.o) };
  }
  coachAddTrade(r: { ts: number; day: string; trade: unknown; rules: unknown; feedback: unknown; context: unknown; model: string }): number {
    const x = this.db.prepare('INSERT INTO coach_trades (ts, day, trade, rules, feedback, context, model) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.ts, r.day, JSON.stringify(r.trade), JSON.stringify(r.rules), r.feedback == null ? null : JSON.stringify(r.feedback), r.context == null ? null : JSON.stringify(r.context), r.model);
    return Number(x.lastInsertRowid);
  }
  coachTradesOn(day: string): { id: number; ts: number; day: string; trade: unknown; rules: unknown; feedback: unknown; context: unknown; model: string }[] {
    return (this.db.prepare('SELECT id, ts, day, trade, rules, feedback, context, model FROM coach_trades WHERE day = ? ORDER BY ts, id').all(day) as
      { id: number; ts: number; day: string; trade: string; rules: string; feedback: string | null; context: string | null; model: string }[])
      .map(r => ({ id: Number(r.id), ts: Number(r.ts), day: r.day, trade: JSON.parse(r.trade), rules: JSON.parse(r.rules),
        feedback: r.feedback == null ? null : JSON.parse(r.feedback), context: r.context == null ? null : JSON.parse(r.context), model: r.model }));
  }
  coachSaveKarne(day: string, ts: number, model: string, body: unknown): void {
    this.db.prepare('INSERT INTO coach_karne (day, ts, model, body) VALUES (?, ?, ?, ?) ON CONFLICT (day) DO UPDATE SET ts = excluded.ts, model = excluded.model, body = excluded.body')
      .run(day, ts, model, JSON.stringify(body));
  }
  coachKarneOn(day: string): { day: string; ts: number; model: string; body: unknown } | null {
    const r = this.db.prepare('SELECT day, ts, model, body FROM coach_karne WHERE day = ?').get(day) as { day: string; ts: number; model: string; body: string } | undefined;
    return r ? { day: r.day, ts: Number(r.ts), model: r.model, body: JSON.parse(r.body) } : null;
  }
  /** 30 günden eski koç kayıtları (çağrı, işlem, karne) silinir */
  coachPrune(cutoffMs: number, cutoffDay: string): void {
    this.db.prepare('DELETE FROM coach_calls WHERE ts < ?').run(cutoffMs);
    this.db.prepare('DELETE FROM coach_trades WHERE day < ?').run(cutoffDay);
    this.db.prepare('DELETE FROM coach_karne WHERE day < ?').run(cutoffDay);
  }

  snapPrune(day: string): void { this.db.prepare('DELETE FROM snap WHERE day < ?').run(day); }

  close(): void { this.db.close(); }
}

function toEvent(r: Record<string, unknown>): FlowEvent {
  return {
    id: Number(r.id), ts: Number(r.ts), day: String(r.day), ticker: String(r.ticker), occ: String(r.occ), expiry: String(r.expiry),
    side: r.side === 'put' ? 'put' : 'call', strike: Number(r.strike), dv: Number(r.dv), volume: Number(r.volume), oi: Number(r.oi),
    bid: Number(r.bid), ask: Number(r.ask), mid: Number(r.mid), prem: Number(r.prem), volOi: Number(r.volOi),
    confirmed: !!r.confirmed, wide: !!r.wide, pushed: !!r.pushed, underlying: r.underlying == null ? null : Number(r.underlying),
  };
}
export type { ChainRow };

export interface ReportRow { id: number; kind: string; day: string; ts: number; title: string; body: string }
