/* Koç hız sınırı (saf): günlük üst sınır + iki istek arası asgari süre. Sayılar veritabanından gelir (kalıcı). */
export const DAILY_CAP = 20;
export const MIN_GAP_SEC = 10;

export function canCoach(a: { nowMs: number; countToday: number; lastAtMs: number | null; dailyCap?: number; minGapSec?: number }):
  { ok: true } | { ok: false; error: string; retryAfterSec: number } {
  const cap = a.dailyCap ?? DAILY_CAP, gap = a.minGapSec ?? MIN_GAP_SEC;
  if (a.countToday >= cap) return { ok: false, error: `Günlük koçluk sınırı (${cap}) doldu — yarın dene`, retryAfterSec: 3600 };
  if (a.lastAtMs != null) {
    const wait = Math.ceil((a.lastAtMs + gap * 1000 - a.nowMs) / 1000);
    if (wait > 0) return { ok: false, error: `Çok hızlı — ${wait} sn sonra dene`, retryAfterSec: wait };
  }
  return { ok: true };
}
