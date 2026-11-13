/* Fırsat bildirim kapısı: 30 dk soğuma (ticker+setup), günde en fazla 10. Saf. Risk bildirimleri soğumaya takılmaz. */
export interface Sent { key: string; at: number; day: string }
export const COOL_MS = 30 * 60000, DAILY_CAP = 10, SENT_KEEP = 300;

export function gateCheck(sent: Sent[], key: string, now: number, day: string, risk = false): { ok: boolean; reason?: string } {
  if (!risk && sent.some(s => s.key === key && now - s.at < COOL_MS)) return { ok: false, reason: 'soğuma' };
  if (sent.filter(s => s.day === day).length >= DAILY_CAP) return { ok: false, reason: 'günlük tavan' };
  return { ok: true };
}
export const gateRecord = (sent: Sent[], key: string, now: number, day: string): Sent[] => [...sent, { key, at: now, day }].slice(-SENT_KEEP);
