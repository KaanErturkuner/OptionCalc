/*
 * Örnek rapor geri doldurma (tek seferlik, YALNIZ sunucuda). Bir geçmiş ABD işlem günü için 5 raporu (piyasa öncesi,
 * açılış +30 dk / +1,5 sa / +2,5 sa, gün sonu) NOKTA-ZAMANLI yeniden kurar: her rapor yalnız kendi anından ÖNCE
 * tamamlanmış veriyi görür (src/lib/reports/pit.ts). Örnek olarak işaretlenir (başlık öneki + example=1). Push GÖNDERİLMEZ.
 *
 *   node server/app/backfill.ts --day 2026-11-13 [--dry-run] [--force]
 *
 * MarketData: bu dosya md.ts'i İÇE AKTARMAZ; hiçbir MarketData çağrısı yok. Akış (flow) kaydı o an için yoksa duvar ve
 * birikim satırları "veri alınamadı" yazar. Kaynaklar: Yahoo (tarihsel seri, period2 = rapor anı) ve Finnhub
 * (yayın zamanı < rapor anı). Finnhub anahtarı yalnız CREDENTIALS_DIRECTORY/finnhub_key ya da FLOW_FINNHUB_FILE'dan okunur;
 * asla yazdırılmaz ve hata metinlerine girmez (errText).
 * --dry-run: DB'ye yazmaz, metni yazdırır. --force: aynı günün mevcut örnek raporlarını yeniden yazar (yalnız örnekler).
 */
import { loadConfig } from './config.ts';
import { Store } from './store.ts';
import { YahooClient, FinnhubClient } from './sources.ts';
import { ASIA, EUROPE, FUTURES, VIX, nextTradingDay } from './reporter.ts';
import { errText } from './poller.ts';
import { buildReport } from '../../src/lib/reports/text.ts';
import { slotsFor, istHm, type Slot } from '../../src/lib/reports/schedule.ts';
import { pctOf, sma } from '../../src/lib/reports/sources.ts';
import { dailyDoneBy, exampleReport, MIN_MS, openAndLast, pitPeriods, pitPrice, prevCloseBefore } from '../../src/lib/reports/pit.ts';
import type { Bias, FlowAgg, Move, MacroLite, NewsLite, ReportInput, SmaRow, WallSnap } from '../../src/lib/reports/types.ts';
import { expectationOf } from '../../src/lib/reports/sections.ts';
import { eventsOn } from '../../src/lib/calendar/releases.ts';
import { addDaysStr, exDivMs, isTradingDay, prevTradingDay } from '../../src/lib/usmarket.ts';
import type { HistSnap } from '../../src/lib/reports/histchain.ts';
import type { NewsItem } from '../../src/lib/news/types.ts';

const DAY_MS = 86400000;
const args = process.argv.slice(2);
const argVal = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const log = (m: string) => console.log(m);

const macroOn = (d: string): MacroLite[] => eventsOn(d);

/** Bir rapor için nokta-zamanlı girdiler. fails: bu raporun "veri sorunları" satırları. */
async function gatherPit(slot: Slot, deps: { cfg: ReturnType<typeof loadConfig>; store: Store; yahoo: YahooClient; finnhub: FinnhubClient | null }): Promise<ReportInput> {
  const { cfg, store, yahoo, finnhub } = deps;
  const { kind, day } = slot;
  const cutoff = slot.atMs;                               // rapor anı: yalnız bu andan ÖNCE tamamlanan veri kullanılır
  const dayStart = exDivMs(day);                          // 09:30 ET
  const watch = cfg.tickers;
  const fails: string[] = [];
  const flowKnown = store.pollSeenBefore(day, cutoff);

  /** Asya / Avrupa / vadeli / ön piyasa: son tamamlanmış bar; önceki yerel gün kapanışı; bar yerel tarihi = rapor günü */
  const refMove = async (name: string, sym: string, pre: boolean): Promise<Move> => {
    try {
      const ip = pitPeriods(cutoff, 3), dp = pitPeriods(cutoff, 400);
      const intra = await yahoo.series(sym, ip.period1, ip.period2, pre ? '1m' : '5m', pre);
      const daily = await yahoo.series(sym, dp.period1, dp.period2, '1d');
      if (!intra || !daily) throw new Error('boş yanıt');
      const price = pitPrice(intra.bars, pre ? MIN_MS : 5 * MIN_MS, cutoff, intra.tz, day);
      if (price == null) { fails.push(`${name}: ${istHm(cutoff)} İst itibarıyla işlem verisi yok`); return { name, pct: null, price: null }; }
      return { name, pct: pctOf(price, prevCloseBefore(daily.bars, day, daily.tz)), price };
    } catch (e) {
      fails.push(`Yahoo ${sym} alınamadı (${errText(e)})`);
      return { name, pct: null, price: null };
    }
  };

  /** Haberler: yalnız yayın zamanı [sinceMs, rapor anı) aralığındakiler */
  const news = async (sinceMs: number): Promise<{ news: NewsLite[]; newsOk: boolean }> => {
    if (!finnhub) { fails.push('Haber: Finnhub anahtarı yok'); return { news: [], newsOk: false }; }
    const items: NewsItem[] = [];
    let okCount = 0, errs = 0;
    try {
      const all = await finnhub.marketNews(0);            // güncel akış; geri kapsamını kontrol etmek için süzmeden alınır
      const oldest = all.reduce((m, n) => Math.min(m, n.publishedAt), Infinity);
      if (oldest > sinceMs) fails.push('Genel piyasa haberleri: sağlayıcı bu saate kadar geri gitmiyor (kapsam eksik; yalnız şirket haberleri ve bulunan genel haberler)');
      items.push(...all);
      okCount++;
    } catch (e) { errs++; fails.push(`Finnhub genel haber: ${errText(e)}`); }
    for (const t of watch) {
      try { items.push(...await finnhub.companyNews(t, sinceMs, day)); okCount++; } catch { errs++; }
    }
    if (errs) fails.push(`Finnhub: ${errs} istek başarısız`);
    const seen = new Set<string>();
    const out: NewsLite[] = [];
    for (const n of items.filter(x => x.publishedAt >= sinceMs && x.publishedAt < cutoff).sort((a, b) => b.publishedAt - a.publishedAt)) {
      if (seen.has(n.title)) continue;
      seen.add(n.title);
      out.push({ title: n.title, source: n.source, at: n.publishedAt, tickers: n.tickers });
    }
    return { news: out, newsOk: okCount > 0 };
  };

  /** Duvar anlık görüntüsü: yalnız rapor anından önce yazılmışsa. 'last' (son yazım) rapor anından sonraysa önceki değer kaybolmuştur → yok. */
  const wall = (t: string, which: 'open' | 'last'): WallSnap | null => {
    const s = store.snapGet<WallSnap>(day, t, which);
    return s && s.at < cutoff ? s : null;
  };
  const walls = (): ReportInput['walls'] => watch.map(t => ({ ticker: t, open: wall(t, 'open'), now: wall(t, 'last') }));

  /** Önceki kapanış (tarihsel EOD) özeti: yalnız zincir tarihi rapor anından önce tamamlanmışsa (PIT kapısı: kapanış < rapor anı) */
  const prevDay = prevTradingDay(addDaysStr(day, -1));
  const histOf = (src: string, t: string): HistSnap | null => {
    const h = store.histGet<HistSnap>(src, t);
    return h && h.asOf < cutoff ? h : null;
  };
  /** Canlı akış kaydı yoksa ve önceki kapanış zinciri varsa: rapor önceki kapanış verisiyle kurulur (etiketli) */
  const useHist = !flowKnown && watch.some(t => histOf(prevDay, t) != null);
  const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const histMissing = (xs: string[]) => { if (xs.length) fails.push(`${dm(prevDay)} kapanış zinciri yok (MarketData geçmiş zincir kaydı alınmadı): ${xs.join(', ')}`); };

  const base: ReportInput = {
    kind, day, nowMs: cutoff, watch, asia: [], europe: [], futures: [], preMarket: [], moves: [], walls: [], flow: [],
    news: [], newsOk: false, macro: { today: macroOn(day), tomorrow: [] }, earnings: null, sma: [], failures: fails, flowKnown,
  };
  // Bilanço takvimi: Finnhub yalnız BUGÜNKÜ takvimi verir; geçmiş anlık görüntü yok → kapalı bırakılır (dürüstlük).
  const earningsNote = () => fails.push('Bilanço takvimi: geçmiş takvim anlık görüntüsü yok (nokta-zamanlı değil)');

  if (kind === 'premarket') {
    for (const [n, s] of ASIA) base.asia.push(await refMove(n, s, false));
    for (const [n, s] of EUROPE) base.europe.push(await refMove(n, s, false));
    for (const [n, s] of FUTURES) base.futures.push(await refMove(n, s, false));
    for (const t of watch) base.preMarket.push(await refMove(t, t, true));
    base.vix = await refMove(VIX[0], VIX[1], false);
    Object.assign(base, await news(cutoff - DAY_MS));
    earningsNote();
    base.macro.tomorrow = macroOn(nextTradingDay(day));
    return base;
  }

  if (kind === 'eod') {
    const smaRows: SmaRow[] = [];
    for (const t of watch) {
      try {
        const dp = pitPeriods(cutoff, 400);
        const q = await yahoo.series(t, dp.period1, dp.period2, '1d');
        const c = dailyDoneBy(q?.bars ?? [], cutoff).map(b => b.c);   // yalnız kapanışı rapor anından önce olan günler
        if (c.length < 2) throw new Error('boş yanıt');
        const last = c[c.length - 1];
        base.moves.push({ name: t, pct: pctOf(last, c[c.length - 2]), price: last });
        smaRows.push({ ticker: t, price: last, sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200) });
      } catch (e) {
        fails.push(`Yahoo ${t} günlük veri alınamadı (${errText(e)})`);
        base.moves.push({ name: t, pct: null, price: null });
        smaRows.push({ ticker: t, price: null, sma20: null, sma50: null, sma200: null });
      }
    }
    base.sma = smaRows;
    base.vix = await refMove(VIX[0], VIX[1], false);
    if (useHist) {
      // Duvar kayması: önceki kapanış (12/11) → gün sonu (13/11) zinciri. Gün sonu zinciri yoksa kayma ölçülemez (dürüstlük).
      const rows = watch.map(t => ({ t, o: histOf(prevDay, t), n: histOf(day, t) }));
      base.walls = rows.map(({ t, o, n }) => ({ ticker: t, open: o?.wall ?? null, now: n?.wall ?? null }));
      base.flow = rows.flatMap(({ o }) => o?.flow ?? []);
      base.flowKnown = true;
      base.basis = { wallsHead: `Duvar kayması — önceki kapanış (${dm(prevDay)}) → gün sonu (${dm(day)}) zincirine göre`, openLabel: dm(prevDay),
        flowHead: `Opsiyon birikimi — önceki kapanış (${dm(prevDay)}) zincirine göre (en büyük açık pozisyon)`,
        source: `önceki kapanış (${dm(prevDay)}) → gün sonu (${dm(day)}) zincirine göre` };
      if (!rows.some(x => x.n)) fails.push(`${dm(day)} gün sonu zinciri yok: duvar kayması ölçülemez`);
      histMissing(rows.filter(x => !x.o).map(x => x.t));
    } else {
      base.walls = walls();
      base.flow = store.flowAgg(day, cutoff) as FlowAgg[];
      if (!flowKnown) fails.push(`Opsiyon akışı ve duvarlar: ${day} için ${istHm(cutoff)} öncesi kayıt yok (MarketData kredisi kullanılmadı)`);
    }
    Object.assign(base, await news(cutoff - DAY_MS));
    earningsNote();
    base.macro.tomorrow = macroOn(nextTradingDay(day));
    return base;
  }

  // intra1 / intra2 / intra3: açılıştan rapor anına (1 dk barlar, yalnız bugünkü seans)
  const ip = { period1: Math.floor((dayStart - DAY_MS) / 1000), period2: Math.floor(cutoff / 1000) };
  for (const t of watch) {
    try {
      const q = await yahoo.series(t, ip.period1, ip.period2, '1m');
      if (!q) throw new Error('boş yanıt');
      const { open, last } = openAndLast(q.bars, MIN_MS, cutoff, dayStart);
      base.moves.push({ name: t, pct: pctOf(last, open), price: last });
    } catch (e) {
      fails.push(`Yahoo ${t} 1 dk veri alınamadı (${errText(e)})`);
      base.moves.push({ name: t, pct: null, price: null });
    }
  }
  base.vix = await refMove(VIX[0], VIX[1], false);
  if (useHist) {
    // Açılış anı (açılış duvarı) yok: yalnız önceki kapanış zincirinden duvar ve birikim; kayma ölçülemez, spot notu yazılmaz
    const rows = watch.map(t => ({ t, h: histOf(prevDay, t) }));
    base.walls = rows.map(({ t, h }) => ({ ticker: t, open: null, now: h?.wall ?? null }));
    base.flow = rows.flatMap(({ h }) => h?.flow ?? []);
    base.flowKnown = true;
    base.basis = { wallsHead: `Duvarlar — önceki kapanış (${dm(prevDay)}) zincirine göre (açılış anı yok; kayma ölçülemez)`,
      flowHead: `Opsiyon birikimi — önceki kapanış (${dm(prevDay)}) zincirine göre (en büyük açık pozisyon)`,
      source: `önceki kapanış (${dm(prevDay)}) zincirine göre` };
    histMissing(rows.filter(x => !x.h).map(x => x.t));
  } else {
    base.walls = walls();
    base.flow = store.flowAgg(day, cutoff) as FlowAgg[];
    if (!flowKnown) fails.push(`Opsiyon akışı ve duvarlar: ${day} için ${istHm(cutoff)} öncesi kayıt yok (MarketData kredisi kullanılmadı)`);
  }
  Object.assign(base, await news(cutoff - 3 * 3600000));
  return base;
}

async function main(): Promise<void> {
  const day = argVal('--day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('kullanım: --day YYYY-MM-DD [--dry-run] [--force]');
  if (!isTradingDay(day)) throw new Error(`${day} bir ABD işlem günü değil: rapor yok`);
  const cfg = loadConfig(process.env);
  const store = new Store(cfg.dbPath);
  const deps = { cfg, store, yahoo: new YahooClient(), finnhub: cfg.finnhubKey ? new FinnhubClient(cfg.finnhubKey) : null };
  log(`örnek raporlar ${day}: ${DRY ? 'KURU (DB yazılmaz)' : 'DB’ye yazılır'}; MarketData çağrısı: 0; push: yok`);
  let morning: Bias | null = null;          // aynı günün piyasa öncesi beklentisi (gün sonu incelemesi için)
  for (const slot of slotsFor(day)) {
    const key = `ornek:${slot.day}:${slot.kind}`;
    if (!DRY && store.hasReport(key)) {
      if (!FORCE) {
        log(`  atlandı (zaten var): ${key}`);
        if (slot.kind === 'premarket') morning = store.reportByKey(key)?.sections ? expectationOf(store.reportByKey(key)!.sections!) : null;
        continue;
      }
      store.deleteExampleReport(key);
    }
    const input = await gatherPit(slot, deps);
    if (slot.kind === 'eod') input.morningBias = morning;
    const rep = exampleReport(buildReport(input));
    if (slot.kind === 'premarket') morning = expectationOf(rep.sections);
    if (DRY) {
      log(`\n— ${rep.title}  [${key}]`);
      log(rep.body);
      continue;
    }
    const id = store.insertReport({ key, kind: slot.kind, day, ts: slot.atMs, title: rep.title, body: rep.body, pushTitle: rep.pushTitle, pushBody: rep.pushBody, example: true, sections: rep.sections });
    log(`  yazıldı: ${rep.title} (id ${id}, veri sorunu ${input.failures.length})`);
  }
  store.close();
}

main().catch(e => { console.error('örnek rapor hatası:', errText(e)); process.exit(1); });
