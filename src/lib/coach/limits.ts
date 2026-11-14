/* Koç hız sınırı (saf): son 24 saatte en çok DAILY_CAP yükleme (kayan pencere) + iki yükleme arası asgari süre.
 * Sayılar veritabanından gelir (kalıcı). Yalnız gerçek çıkarma çağrıları sayılır; aynı görüntünün tekrarı sayılmaz. */
export const DAILY_CAP = 100;
export const MIN_GAP_SEC = 2;

export function canCoach(a: { nowMs: number; countToday: number; lastAtMs: number | null; dailyCap?: number; minGapSec?: number }):
  { ok: true } | { ok: false; error: string; retryAfterSec: number; kind: 'gap' | 'daily' } {
  const cap = a.dailyCap ?? DAILY_CAP, gap = a.minGapSec ?? MIN_GAP_SEC;
  if (a.countToday >= cap) return { ok: false, error: `24 saatte en çok ${cap} yükleme — daha sonra dene`, retryAfterSec: 3600, kind: 'daily' };
  if (a.lastAtMs != null) {
    const wait = Math.ceil((a.lastAtMs + gap * 1000 - a.nowMs) / 1000);
    if (wait > 0) return { ok: false, error: `Çok hızlı — ${wait} sn sonra dene`, retryAfterSec: wait, kind: 'gap' };
  }
  return { ok: true };
}
