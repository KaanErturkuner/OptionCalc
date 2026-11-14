/*
 * Rapor üretici + zamanlayıcı (sunucu). Veri: poller anlık görüntüleri (MarketData'ya EK çağrı yok), Yahoo chart, Finnhub.
 * Her slot bir kez üretilir (reports.key); üretim → SQLite → Expo push (kısa). Kaynak hatası → "veri alınamadı" satırı; rapor yine üretilir.
 * Anahtarlar (Finnhub) yalnız başlıkta gider; hata metinleri maskelenir (poller errText).
 */
import { buildReport } from '../../src/lib/reports/text.ts';
import { expectationOf } from '../../src/lib/reports/sections.ts';
import { dueSlots, type ReportKind } from '../../src/lib/reports/schedule.ts';
import { pctOf, sma } from '../../src/lib/reports/sources.ts';
import { wallSnapFromRows } from '../../src/lib/reports/walls.ts';
import type { FlowAgg, Move, MacroLite, NewsLite, Report, ReportInput, SmaRow, WallSnap } from '../../src/lib/reports/types.ts';
import { eventsOn } from '../../src/lib/calendar/releases.ts';
import { addDaysStr, isTradingDay } from '../../src/lib/usmarket.ts';
import type { ChainRow } from '../../src/lib/flow/detect.ts';
import type { NewsItem } from '../../src/lib/news/types.ts';
import type { Config } from './config.ts';
import type { Store } from './store.ts';
import type { FinnhubClient, YahooClient } from './sources.ts';
import { errText } from './poller.ts';

/** Endeks ve vadeliler (Yahoo sembolleri) */
export const ASIA: [string, string][] = [['Nikkei 225', '^N225'], ['Hang Seng', '^HSI']];
export const EUROPE: [string, string][] = [['FTSE 100', '^FTSE'], ['DAX', '^GDAXI']];
export const FUTURES: [string, string][] = [['ES (S&P vadeli)', 'ES=F'], ['NQ (Nasdaq vadeli)', 'NQ=F']];
export const VIX: [string, string] = ['VIX', '^VIX'];
const DAY_MS = 86400000;
const RETAIN_MS = 30 * DAY_MS;

export interface PushLike { broadcast(title: string, body: string, data: Record<string, unknown>): Promise<number> }
export interface ReporterDeps {
  cfg: Config; store: Store; yahoo: YahooClient; finnhub: FinnhubClient | null; push: PushLike | null;
  log: (m: string) => void; now?: () => number;
}

export function nextTradingDay(day: string): string {
  let d = addDaysStr(day, 1);
  while (!isTradingDay(d)) d = addDaysStr(d, 1);
  return d;
}

export class Reporter {
  private readonly d: ReporterDeps;
  private readonly inFlight = new Set<string>();
  constructor(deps: ReporterDeps) { this.d = deps; }

  private now(): number { return this.d.now ? this.d.now() : Date.now(); }

  /** Zamanlayıcı: 30 sn'de bir vakti gelmiş slotlara bak; üretilmemişleri üret */
  start(): NodeJS.Timeout {
    return setInterval(() => this.tick(), 30000);
  }
  tick(): void {
    if (!this.d.cfg.reportsEnabled) return;
    const now = this.now();
    for (const s of dueSlots(now)) {
      if (this.inFlight.has(s.key) || this.d.store.hasReport(s.key)) continue;
      this.inFlight.add(s.key);
      this.generate(s.kind, s.day, now)
        .catch(e => this.d.log(`rapor hatası (${s.key}): ${errText(e)}`))
        .finally(() => this.inFlight.delete(s.key));
    }
  }

  /** Poller kancası: her taramada duvar anlık görüntüsü; gün başında ilk tarama 'open' olur */
  recordRows(ticker: string, rows: ChainRow[], nowMs: number, day: string): void {
    if (!this.d.cfg.reportsEnabled) return;
    const snap = wallSnapFromRows(rows, day, nowMs);
    if (!snap) return;
    this.d.store.snapPut(day, ticker, 'last', nowMs, snap);
    this.d.store.snapPut(day, ticker, 'open', nowMs, snap);   // INSERT OR IGNORE: yalnız ilki kalır
  }

  /** Bir raporu üret. dryRun: DB'ye yazmaz, push göndermez. */
  async generate(kind: ReportKind, day: string, nowMs: number, opts: { dryRun?: boolean } = {}): Promise<Report> {
    const input = await this.gather(kind, day, nowMs);
    const rep = buildReport(input);
    if (opts.dryRun) return rep;
    const key = `${day}:${kind}`;
    const id = this.d.store.insertReport({ key, kind, day, ts: nowMs, title: rep.title, body: rep.body, pushTitle: rep.pushTitle, pushBody: rep.pushBody, sections: rep.sections });
    this.d.store.pruneReports(nowMs - RETAIN_MS);
    this.d.store.snapPrune(addDaysStr(day, -14));
    let sent = 0;
    if (this.d.push) sent = await this.d.push.broadcast(rep.pushTitle, rep.pushBody, { type: 'report', id, kind, day }).catch(() => 0);
    this.d.log(`rapor üretildi: ${kind} ${day} (id ${id}, push ${sent})`);
    return rep;
  }

  /** Tüm girdileri topla. Her kaynak bağımsız; hata → fails listesi, rapor yine kurulur. */
  async gather(kind: ReportKind, day: string, nowMs: number): Promise<ReportInput> {
    const { cfg, store, yahoo, finnhub } = this.d;
    const fails: string[] = [];
    const watch = cfg.tickers;
    const quote = async (name: string, sym: string, range: string, interval: string, pre = false): Promise<Move> => {
      try {
        const q = await yahoo.chart(sym, range, interval, pre);
        if (!q) throw new Error('boş yanıt');
        return pre
          ? { name, pct: pctOf(q.prePrice, q.prevClose), price: q.prePrice }
          : { name, pct: pctOf(q.price, q.prevClose), price: q.price };
      } catch (e) {
        fails.push(`Yahoo ${sym} alınamadı (${errText(e)})`);
        return { name, pct: null, price: null };
      }
    };
    const news = async (sinceMs: number): Promise<{ news: NewsLite[]; ok: boolean }> => {
      if (!finnhub) { fails.push('Haber: Finnhub anahtarı yok'); return { news: [], ok: false }; }
      const items: NewsItem[] = [];
      let okCount = 0, errs = 0;
      try { items.push(...await finnhub.marketNews(sinceMs)); okCount++; } catch (e) { errs++; fails.push(`Finnhub genel haber: ${errText(e)}`); }
      for (const t of watch) {
        try { items.push(...await finnhub.companyNews(t, sinceMs, day)); okCount++; } catch { errs++; }
      }
      if (errs) fails.push(`Finnhub şirket haberi: ${errs} istek başarısız`);
      const seen = new Set<string>();
      const out: NewsLite[] = [];
      for (const n of items.sort((a, b) => b.publishedAt - a.publishedAt)) {
        if (seen.has(n.title)) continue;
        seen.add(n.title);
        out.push({ title: n.title, source: n.source, at: n.publishedAt, tickers: n.tickers });
      }
      return { news: out, ok: okCount > 0 };
    };
    const macroOn = (d: string): MacroLite[] => eventsOn(d);
    const walls = (): ReportInput['walls'] => watch.map(t => ({
      ticker: t, open: store.snapGet<WallSnap>(day, t, 'open'), now: store.snapGet<WallSnap>(day, t, 'last'),
    }));
    const base: ReportInput = {
      kind, day, nowMs, watch, asia: [], europe: [], futures: [], preMarket: [], moves: [], walls: [], flow: [],
      news: [], newsOk: false, macro: { today: macroOn(day), tomorrow: [] }, earnings: null, sma: [], failures: fails,
    };

    if (kind === 'premarket') {
      for (const [n, s] of ASIA) base.asia.push(await quote(n, s, '1d', '5m'));
      for (const [n, s] of EUROPE) base.europe.push(await quote(n, s, '1d', '5m'));
      for (const [n, s] of FUTURES) base.futures.push(await quote(n, s, '1d', '5m'));
      for (const t of watch) base.preMarket.push(await quote(t, t, '1d', '1m', true));
      base.vix = await quote(VIX[0], VIX[1], '1d', '5m');
      Object.assign(base, await news(nowMs - DAY_MS));
      if (finnhub) {
        try { base.earnings = await finnhub.earnings(day, addDaysStr(day, 14), watch); }
        catch (e) { fails.push(`Bilanço takvimi: ${errText(e)}`); }
      }
      base.macro.today = macroOn(day);
      base.macro.tomorrow = macroOn(nextTradingDay(day));
      return base;
    }

    if (kind === 'eod') {
      const smaRows: SmaRow[] = [];
      base.moves = [];
      for (const t of watch) {
        try {
          const q = await yahoo.chart(t, '1y', '1d');
          const c = q?.closes ?? [];
          if (!c.length) throw new Error('boş yanıt');
          base.moves.push({ name: t, pct: c.length > 1 ? pctOf(c[c.length - 1], c[c.length - 2]) : null, price: c[c.length - 1] });
          smaRows.push({ ticker: t, price: c[c.length - 1], sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200) });
        } catch (e) {
          fails.push(`Yahoo ${t} günlük veri alınamadı (${errText(e)})`);
          base.moves.push({ name: t, pct: null, price: null });
          smaRows.push({ ticker: t, price: null, sma20: null, sma50: null, sma200: null });
        }
      }
      base.sma = smaRows;
      base.walls = walls();
      base.flow = store.flowAgg(day) as FlowAgg[];
      base.vix = await quote(VIX[0], VIX[1], '1d', '5m');
      // Sabah beklentisi: aynı günün piyasa öncesi raporu (yoksa / veri yoksa null → "veri yok")
      const morning = store.reportByKey(`${day}:premarket`)?.sections;
      base.morningBias = morning ? expectationOf(morning) : null;
      Object.assign(base, await news(nowMs - DAY_MS));
      const tomorrow = nextTradingDay(day);
      base.macro.tomorrow = macroOn(tomorrow);
      if (finnhub) {
        try { base.earnings = await finnhub.earnings(tomorrow, addDaysStr(day, 16), watch); }
        catch (e) { fails.push(`Bilanço takvimi: ${errText(e)}`); }
      }
      return base;
    }

    // intra1 / intra2 / intra3: açılıştan beri (poller anlık görüntüleri; ek kaynak yok)
    base.moves = watch.map(t => {
      const o = store.snapGet<WallSnap>(day, t, 'open'), n = store.snapGet<WallSnap>(day, t, 'last');
      return { name: t, pct: o?.spot && n?.spot ? pctOf(n.spot, o.spot) : null, price: n?.spot ?? null };
    });
    if (!store.snapGet(day, watch[0] ?? '', 'last')) fails.push('Zincir anlık görüntüsü yok (akış tarayıcısı açık değil ya da seans başlamadı)');
    base.vix = await quote(VIX[0], VIX[1], '1d', '5m');
    base.walls = walls();
    base.flow = store.flowAgg(day) as FlowAgg[];
    Object.assign(base, await news(nowMs - 3 * 3600000));
    return base;
  }
}
