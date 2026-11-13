/* Paylaşılan kısa ömürlü önbellek (varsayılan 60 sn): aynı sembolün zinciri/barları ikinci kez çekilmez. Hata olan istek önbellekten silinir. */
export const SCAN_TTL = 60000;
const store = new Map<string, { at: number; p: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now(), hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = fn().catch(e => { store.delete(key); throw e; });
  store.set(key, { at: now, p });
  return p;
}
