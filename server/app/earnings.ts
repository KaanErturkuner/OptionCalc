/*
 * Bilanço takvimi önbelleği (sunucu): Finnhub → SQLite → GET /earnings, GET /earnings/history, POST /earnings/favs.
 *  - Takvim (/calendar/earnings): gün başına izlenir (src/lib/earnings/model.ts › staleDays): 24 saatten eski veya
 *    hiç çekilmemiş gün yenilenir; geçmiş/bugünkü gün ayrıca 08:00 ve 16:30 ET kontrol noktalarından sonra bir kez.
 *  - Piyasa değeri (/stock/profile2): sembol başına haftada bir; tick'te en çok EARN_CAPS_PER_TICK, sırayla (60/dk sınırı
 *    FinnhubClient'ta). Değeri bilinmeyen küçük şirket yalnız izleme listesi/favoriyse görünür.
 *  - Geçmiş çeyrekler (/stock/earnings): sembol başına 24 saatte bir.
 *  - Favori bildirimi: bir favori sembolün epsActual'i ÖNCE boşken, şimdi doluysa, o cihaza Expo push (sunucu tarafı; uygulama
 *    açık olmak zorunda değil). Aynı cihaz+gün+sembol bir kez (earn_notified). İlk çekimde görülen geçmiş sonuçlar bildirmez.
 * Tick: bugün−3 … bugün+14, 15 dk. Hata metinleri errText ile maskelenir; anahtar asla loglanmaz/yanıtlanmaz.
 */
import { addDaysStr, etDate } from '../../src/lib/usmarket.ts';
import {
  capUsdFromProfile, daysBetween, newActualsOf, parseFinnhubCalendar, parseFinnhubHistory, passesCapFilter, staleDays,
  type EarnHistory, type EarningsItem, type EarningsRange,
} from '../../src/lib/earnings/model.ts';
import { earnActualText } from '../../src/lib/earnings/calendar.ts';
import type { Store } from './store.ts';
import { errText } from './poller.ts';

export interface CalendarSource {
  calendarEarnings(from: string, to: string): Promise<unknown>;
  profile(sym: string): Promise<unknown>;
  earningsHistory(sym: string): Promise<unknown>;
}
export interface PushMsg { to: string; title: string; body: string; data: Record<string, unknown> }
export interface EarningsDeps {
  store: Store; src: CalendarSource; now?: () => number; log?: (m: string) => void;
  /** Expo push (ExpoPush.sendTo); yoksa bildirim üretilmez */
  notify?: (msgs: PushMsg[]) => Promise<number>;
}

/** Başarısız çekimden sonra aynı aralığı bu kadar beklemeden yeniden deneme (istek fırtınası olmasın) */
export const EARN_RETRY_AFTER_FAIL_MS = 5 * 60000;
export const EARN_TICK_MS = 15 * 60000;
export const EARN_CAP_STALE_MS = 7 * 86400000;
export const EARN_HIST_TTL_MS = 86400000;
/** Her tick'te en çok bu kadar piyasa değeri sorgusu (≈1,1 sn aralıkla; tick arka planda çalışır) */
export const EARN_CAPS_PER_TICK = 120;
/** Cihaz başına favori sınırı ve toplam cihaz sınırı */
export const EARN_MAX_FAV_DEVICES = 500;

export class EarningsError extends Error {
  status: number;
  constructor(msg: string, status: number) { super(msg); this.status = status; }
}

export class EarningsCache {
  private readonly d: EarningsDeps;
  private readonly inflight = new Map<string, Promise<void>>();
  private readonly failedAt = new Map<string, number>();
  private ticking = false;
  constructor(d: EarningsDeps) { this.d = d; }

  private now(): number { return this.d.now ? this.d.now() : Date.now(); }
  private log(m: string): void { (this.d.log ?? console.log)(`${new Date().toISOString()} ${m}`); }

  /**
   * [from,to] takvimi (piyasa değeri filtreli: watch = izleme listesi + favoriler). Gerekirse Finnhub'dan yeniler.
   * Yenileme başarısızsa ve aralığın her günü önbellekteyse önbellek döner (fetchedAt eski kalır); eksik gün varsa hata fırlatır.
   */
  async range(from: string, to: string, watch: string[] = []): Promise<EarningsRange> {
    const t = this.now();
    const days = daysBetween(from, to);
    if (staleDays(this.d.store.earnFetchedDays(from, to), from, to, t).length) {
      try { await this.refreshOnce(from, to); }
      catch (e) {
        const have = this.d.store.earnFetchedDays(from, to);
        if (!days.every(d => have.has(d))) throw e;
        this.log('bilanço takvimi yenilenemedi, önbellek kullanılıyor: ' + errText(e));
      }
    }
    const fetched = this.d.store.earnFetchedDays(from, to);
    const vals = days.map(d => fetched.get(d)).filter((x): x is number => x != null);
    const keep = new Set(watch);
    const items = this.d.store.earnItems(from, to).filter(it => passesCapFilter(it, keep));
    return { from, to, fetchedAt: vals.length ? Math.min(...vals) : 0, items };
  }

  /** Periyodik: bugün−3 … bugün+14 takvimi, piyasa değerleri, eski satırların budanması. Hata yutulur (loglanır). */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    const today = etDate(this.now());
    try {
      const from = addDaysStr(today, -3), to = addDaysStr(today, 14);
      await this.range(from, to);
      await this.fillCaps(from, to, EARN_CAPS_PER_TICK);
      this.d.store.earnPrune(addDaysStr(today, -60), this.now() - 30 * 86400000);
    } catch (e) { this.log('bilanço takvimi tick hatası: ' + errText(e)); }
    finally { this.ticking = false; }
  }

  /**
   * Aralıktaki eksik/eski piyasa değerleri (en çok `limit`). Finnhub hız sınırına (429) gelince durur; diğer hatalarda
   * sembol boş (null) kaydedilir ve bir hafta sonra yeniden denenir. Döner: doldurulan sembol sayısı.
   */
  async fillCaps(from: string, to: string, limit: number): Promise<number> {
    const due = this.d.store.earnCapsDue(from, to, this.now() - EARN_CAP_STALE_MS, limit);
    let ok = 0;
    for (const sym of due) {
      try {
        const cap = capUsdFromProfile(await this.d.src.profile(sym));
        this.d.store.earnSetCap(sym, this.now(), cap);
        ok++;
      } catch (e) {
        const msg = errText(e);
        if (msg.includes('429')) { this.log('piyasa değeri: Finnhub hız sınırı, sonraki tick\'te devam'); break; }
        this.d.store.earnSetCap(sym, this.now(), null);
      }
    }
    return ok;
  }

  /** Geçmiş çeyrekler (sembol). 24 saatlik önbellek; Finnhub hatasında eski kayıt varsa o döner. */
  async history(symbol: string): Promise<EarnHistory> {
    const t = this.now();
    const row = this.d.store.earnHistGet(symbol);
    if (row && t - row.at < EARN_HIST_TTL_MS) return { ...(JSON.parse(row.body) as EarnHistory), fetchedAt: row.at };
    try {
      const h = parseFinnhubHistory(await this.d.src.earningsHistory(symbol), symbol);
      h.fetchedAt = t;
      this.d.store.earnHistPut(symbol, t, JSON.stringify(h));
      return h;
    } catch (e) {
      if (row) { this.log('geçmiş bilanço yenilenemedi, önbellek: ' + errText(e)); return { ...(JSON.parse(row.body) as EarnHistory), fetchedAt: row.at }; }
      throw e;
    }
  }

  /** Cihazın favori listesi (tam değiştirme). Sınırlar: EARN_MAX_FAV_DEVICES cihaz. Döner: kayıt sayısı. */
  setFavs(token: string, symbols: string[]): number {
    if (this.d.store.earnFavTokenCount() >= EARN_MAX_FAV_DEVICES) throw new EarningsError('favori kayıt sınırı doldu', 409);
    this.d.store.earnFavsSet(token, symbols, this.now());
    return symbols.length;
  }

  /** Aynı aralık için tek uçuşta çekim; yakın zamanda başarısız olduysa bekler. */
  private refreshOnce(from: string, to: string): Promise<void> {
    const key = from + '|' + to;
    const running = this.inflight.get(key);
    if (running) return running;
    const failed = this.failedAt.get(key);
    if (failed != null && this.now() - failed < EARN_RETRY_AFTER_FAIL_MS) return Promise.reject(new Error('son deneme başarısız; kısa süre sonra tekrar denenecek'));
    const p = this.refresh(from, to).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async refresh(from: string, to: string): Promise<void> {
    const t = this.now();
    const key = from + '|' + to;
    try {
      const json = await this.d.src.calendarEarnings(from, to);
      const items = parseFinnhubCalendar(json, from, to);
      const prev = this.d.store.earnActualMap(from, to);
      this.d.store.replaceEarnRange(from, to, items, daysBetween(from, to), t);
      this.d.store.earnLog(t, from, to, items.length, true, null);
      this.failedAt.delete(key);
      const fresh = newActualsOf(prev, items);
      if (fresh.length) void this.notifyActuals(fresh, t).catch(e => this.log('bilanço bildirimi hatası: ' + errText(e)));
    } catch (e) {
      const msg = errText(e);
      this.failedAt.set(key, t);
      this.d.store.earnLog(t, from, to, 0, false, msg);
      throw new Error(msg);
    }
  }

  /** Yeni gerçekleşen EPS'ler → favori yapan cihazlara bir kez bildirim. */
  private async notifyActuals(items: EarningsItem[], t: number): Promise<void> {
    if (!this.d.notify) return;
    const msgs: PushMsg[] = [];
    for (const it of items) {
      for (const to of this.d.store.earnFavTokens(it.symbol)) {
        if (!this.d.store.earnNotifyOnce(to, it.date, it.symbol, t)) continue;
        const m = earnActualText(it);
        msgs.push({ to, title: m.title, body: m.body, data: { type: 'earnings', symbol: it.symbol, date: it.date } });
      }
    }
    if (!msgs.length) return;
    const sent = await this.d.notify(msgs);
    this.log(`bilanço bildirimi: ${sent}/${msgs.length} gönderildi`);
  }
}
