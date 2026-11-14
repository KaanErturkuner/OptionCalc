/*
 * MarketData istemcisi — sunucunun TEK MarketData çağrı noktası. Aynı anda tek istek (kuyruk), kredi muhasebesi,
 * bütçe freni. Token yalnız Authorization başlığında; hiçbir hata/log metnine yazılmaz.
 */
import type { Store } from './store.ts';
import { etDate } from '../../src/lib/usmarket.ts';

export const MD_BASE = 'https://api.marketdata.app/v1';

export interface MdReply { status: number; text: string; json: any; consumed: number; remaining: number | null }
export class BudgetError extends Error {}

/** Kredi günü: MarketData sayacı 09:30 ET'de sıfırlanır → 09:30'dan önce önceki günün kredisi */
export function creditDay(nowMs: number): string { return etDate(nowMs - 9.5 * 3600000); }

export class MdClient {
  private tail: Promise<unknown> = Promise.resolve();
  lastRemaining: number | null = null;
  private readonly token: string;
  private readonly store: Store;
  private readonly limits: { flowDailyCap: number; proxyDailyCap: number; creditReserve: number };
  private readonly fetchImpl: typeof fetch;
  constructor(token: string, store: Store, limits: { flowDailyCap: number; proxyDailyCap: number; creditReserve: number }, fetchImpl: typeof fetch = fetch) {
    this.token = token; this.store = store; this.limits = limits; this.fetchImpl = fetchImpl;
  }

  /** Kuyruğa al: aynı anda yalnız bir MarketData isteği */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.tail.then(fn, fn);
    this.tail = p.catch(() => undefined);
    return p as Promise<T>;
  }

  /** Bütçe kontrolü: istek öncesi. flow: akış tavanı; proxy: uygulama tavanı; ikisinde de kalan kredi rezervi. */
  checkBudget(src: 'flow' | 'proxy', nowMs: number): void {
    const day = creditDay(nowMs);
    if (!this.token) throw new BudgetError('MarketData tokenı sunucuda tanımlı değil');
    if (this.lastRemaining != null && this.lastRemaining < this.limits.creditReserve) throw new BudgetError('MarketData kredisi rezerv altında (ABD açılışında, TR 16:30–17:30 arası yenilenir)');
    if (src === 'flow' && this.store.creditsOn(day, 'flow') >= this.limits.flowDailyCap) throw new BudgetError('Akış günlük kredi tavanına ulaştı');
    if (this.store.creditsOn(day) >= this.limits.proxyDailyCap) throw new BudgetError('Günlük kredi tavanına ulaşıldı');
  }

  /** path: "/options/chain/QQQ/?dte=0,4&mode=cached&maxage=2min" biçiminde (sorgu dâhil). */
  get(path: string, src: 'flow' | 'proxy', opts: { timeoutMs?: number; nowMs?: number } = {}): Promise<MdReply> {
    return this.serial(async () => {
      const now = opts.nowMs ?? Date.now();
      this.checkBudget(src, now);
      let r: Response;
      try {
        r = await this.fetchImpl(MD_BASE + path, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
        });
      } catch (e) {
        throw new Error((e as Error)?.name === 'TimeoutError' ? 'MarketData zaman aşımı' : 'MarketData’ya bağlanılamadı');
      }
      const consumed = Number(r.headers.get('x-api-ratelimit-consumed') ?? 0) || 0;
      const remH = r.headers.get('x-api-ratelimit-remaining');
      if (remH != null && Number.isFinite(Number(remH))) this.lastRemaining = Number(remH);
      // Yalnız 200/203 kredi tüketir (belgeye göre); başlık yoksa kredi 0 sayılır
      if (r.status === 200 || r.status === 203) this.store.addCredits(creditDay(now), src, consumed);
      const text = r.status === 204 ? '' : await r.text();
      let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: r.status, text, json, consumed, remaining: this.lastRemaining };
    });
  }
}

/** Yanıttan Türkçe, sırsız hata metni (MarketData errmsg'i yalnız hata durumunda ve maskelenmiş) */
export function mdErrorText(status: number, json: any): string {
  const m = String(json?.errmsg || '');
  if (/one device/i.test(m)) return 'MarketData tek cihaz kuralı: başka bir cihaz/IP kullanıyor olabilir';
  if (status === 401) return 'MarketData tokenı geçersiz';
  if (status === 402) return 'Bu veri planında yok (402)';
  if (status === 403) return 'MarketData erişimi reddedildi (403): IP / tek cihaz kuralı';
  if (status === 404) return 'Sembol bulunamadı';
  if (status === 429) return 'MarketData günlük kredisi bitti';
  return `MarketData HTTP ${status}`;
}
