/*
 * Bilanço takvimi cihaz içi (bellek) aralık önbelleği. Ay / hafta geçişlerinde ve sekme dönüşlerinde aynı aralık
 * tekrar istenmez; TTL dolunca yeniden çekilir. Saat dışarıdan verilir (test edilebilir). Kalıcı değil (AsyncStorage yok).
 */
export class RangeCache<T> {
  private readonly ttl: number;
  private readonly max: number;
  private readonly m = new Map<string, { at: number; v: T }>();

  constructor(ttlMs: number, max = 24) {
    this.ttl = ttlMs;
    this.max = max;
  }

  get(key: string, now: number): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (now - e.at >= this.ttl) { this.m.delete(key); return undefined; }
    return e.v;
  }

  set(key: string, v: T, now: number): void {
    this.m.delete(key);
    this.m.set(key, { at: now, v });
    while (this.m.size > this.max) this.m.delete(this.m.keys().next().value as string);
  }

  get size(): number { return this.m.size; }
}
