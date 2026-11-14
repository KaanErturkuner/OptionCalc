/*
 * Dolum zaman sağlaması (saf). Midas saatleri ZATEN İstanbul yerel saatidir; model bir ara ET→İstanbul "çevirisi" yapıp
 * +7/+8 saat ekleyebiliyor (ör. ekran 18:05 → model 01:05 + ertesi gün). Bu modül dolumu uygulamadan ÖNCE denetler:
 *  - Geçerli: dolum, bir işlem gününün seans penceresinde (İstanbul 16:30 → ertesi gün 00:15) ve vade ≥ o günse.
 *    0DTE (vade = seans günü) ise yalnız vade gününde. Pencere sabit İstanbul saatidir (İstanbul'da yaz saati yok) → DST gerekmez.
 *  - Geçersizse ve zaman tam −7/−8/+7/+8 saat kaymışsa VE düzeltilmiş zaman geçerliyse düzeltilir (uyarıyla).
 *    Birden çok düzeltme geçerliyse ilki (−7: gözlenen model hatası) alınır, alternatif uyarıda yazılır.
 *  - Aksi halde zaman DEĞİŞTİRİLMEZ; yalnız uyarı üretilir.
 */
import { addDaysStr, isTradingDay } from '../usmarket.ts';
import { istHm, istToMs } from './time.ts';

const HOUR_MS = 3600000;
const SESSION_START = '16:30';
const SESSION_LEN_MS = (7 * 60 + 45) * 60000;   // 16:30 → ertesi gün 00:15
const SHIFTS_H = [-7, -8, 7, 8];

export interface TimeCheck { t: string; warn: string | null; corrected: boolean }

const istDay = (ms: number): string => new Date(ms + 3 * HOUR_MS).toISOString().slice(0, 10);
const isoIst = (ms: number): string => `${istDay(ms)}T${istHm(ms)}`;
const shown = (t: string): string => t.replace('T', ' ');

/** ms, D işlem gününün (İstanbul başlangıç günü) seans penceresinde mi? */
function inSession(ms: number, D: string): boolean {
  const start = istToMs(`${D}T${SESSION_START}`);
  return start != null && ms >= start && ms <= start + SESSION_LEN_MS;
}

/** Seansın işlem günü (D) — ms bir işlem gününün seans penceresindeyse; değilse null */
export function sessionDay(ms: number): string | null {
  const d0 = istDay(ms);
  for (const D of [d0, addDaysStr(d0, -1)]) if (isTradingDay(D) && inSession(ms, D)) return D;
  return null;
}

/** Dolum geçerli mi? Seans günü = vade (0DTE) veya vade seans gününden sonra (diğer vadeler). */
export function fillTimeValid(ms: number, exp: string): boolean {
  const D = sessionDay(ms);
  return D != null && (D === exp || exp > D);
}

/** Zaman vade gününe "bakıyor" mu (0DTE şekli): vade, zamanın İstanbul günü veya bir önceki günü. */
const zeroDteShaped = (ms: number, exp: string): boolean => { const d0 = istDay(ms); return exp === d0 || exp === addDaysStr(d0, -1); };

/** Tek dolum zamanını denetler. t: YYYY-MM-DDTHH:MM (İstanbul), exp: vade. Dönüş: (düzeltilmiş) t + Türkçe uyarı. */
export function checkFillTime(t: string, exp: string): TimeCheck {
  const ms = istToMs(t);
  if (ms == null || fillTimeValid(ms, exp)) return { t, warn: null, corrected: false };
  const strict = zeroDteShaped(ms, exp);
  const fixes = SHIFTS_H.map(h => ({ h, c: ms + h * HOUR_MS }))
    .filter(x => fillTimeValid(x.c, exp) && (!strict || sessionDay(x.c) === exp));
  if (!fixes.length) {
    return { t, warn: `saat dilimi şüpheli: ${shown(t)} (vade ${exp}; seans 16:30–00:15 İstanbul dışında); kontrol et`, corrected: false };
  }
  const [first, ...rest] = fixes;
  const sign = first.h > 0 ? `+${first.h}` : `${first.h}`;
  const alt = rest.length ? `; ${rest.map(x => `${x.h > 0 ? '+' : ''}${x.h} sa ile ${shown(isoIst(x.c))} de olabilirdi`).join(', ')}` : '';
  return {
    t: isoIst(first.c), corrected: true,
    warn: `saat dilimi düzeltildi: ${shown(t)} → ${shown(isoIst(first.c))} (${sign} sa)${alt}`,
  };
}
