/*
 * Model çıktısının ayrıştırılması ve doğrulanması (saf). Model metni güvenilmez girdidir: JSON ayıklanır, tipler
 * ve enum'lar denetlenir, uzunluklar kırpılır. Geçersiz çıktı → { ok:false, error } (asla kısmi/uydurma sonuç yok).
 */
import type { Conf, Karne, ModelFeedback } from './types.ts';
import { istToMs } from './time.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Metinden ilk JSON nesnesini çıkarır (```json çitleri ve önsöz/sonsöz toleranslı). */
export function parseJsonLoose(text: string): Result<Record<string, unknown>> {
  const s = text.replace(/```(?:json)?/gi, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, error: 'Model çıktısında JSON yok' };
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false, error: 'JSON nesnesi değil' };
  } catch { return { ok: false, error: 'JSON ayrıştırılamadı' }; }
}

const str = (x: unknown, max = 400): string => (typeof x === 'string' ? x.trim().slice(0, max) : '');
const optStr = (x: unknown, max = 40): string | null => { const s = str(x, max); return s || null; };
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const pick = <T extends string>(x: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(x as string) ? (x as T) : fallback;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export interface FillInput { tk: string; exp: string; k: number; cp: 'C' | 'P'; q: number; side: 'buy' | 'sell'; px: number; t: string; conf: Conf }

const SIDE: Record<string, 'buy' | 'sell'> = {
  buy: 'buy', al: 'buy', alis: 'buy', 'alış': 'buy', acilis: 'buy', 'açılış': 'buy',
  sell: 'sell', sat: 'sell', satis: 'sell', 'satış': 'sell', kapanis: 'sell', 'kapanış': 'sell',
};

/** Görüntüden çıkan dolumlar (en çok 6). Zorunlu alanı eksik/geçersiz satır atılır; hiç satır kalmazsa hata (note ile). */
export function validateFills(o: Record<string, unknown>): Result<{ fills: FillInput[]; note: string | null }> {
  const raw = Array.isArray(o.fills) ? o.fills.slice(0, 6) : [];
  const fills: FillInput[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const tk = str(r.tk, 12).toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const exp = str(r.exp, 10);
    const k = num(r.k), q = num(r.q), px = num(r.px);
    const cpS = str(r.cp, 6).toUpperCase();
    const cp = cpS === 'C' || cpS === 'CALL' ? 'C' : cpS === 'P' || cpS === 'PUT' ? 'P' : null;
    const side = SIDE[str(r.side, 12).toLowerCase()] ?? null;
    const t = optStr(r.t, 16);
    if (!tk || !YMD.test(exp) || k == null || k <= 0 || !cp || q == null || q < 1 || !side || px == null || px <= 0 || !t || istToMs(t) == null) continue;
    fills.push({ tk, exp, k, cp, q: Math.round(q), side, px, t, conf: pick(r.conf, ['yuksek', 'orta', 'dusuk'] as const, 'dusuk') });
  }
  if (!fills.length) return { ok: false, error: str(o.note, 300) || 'Görüntüde işlem satırı okunamadı' };
  return { ok: true, value: { fills, note: optStr(o.note, 300) } };
}

const int010 = (x: unknown): number | null => { const n = num(x); return n == null ? null : Math.min(10, Math.max(0, Math.round(n))); };

/** Tek işlem yorumu (ModelFeedback). Zorunlu alan eksikse null (kısmi rapor yok). */
export function validateFeedback(r: Record<string, unknown>): ModelFeedback | null {
  const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' ? x as Record<string, unknown> : {});
  const no = obj(r.neOldu), ci = obj(r.cikis), gi = obj(r.giris), st = obj(r.strike), ka = obj(r.karne);
  const bd = Array.isArray(r.birDahakine) ? r.birDahakine.map(x => str(x, 300)).filter(Boolean) : [];
  const d = { oncesi: str(no.oncesi), sirasinda: str(no.sirasinda), sonrasi: str(no.sonrasi) };
  const cikisN = str(ci.neden), girisN = str(gi.neden), strikeN = str(st.neden), yorum = str(r.kacanFirsatYorum);
  const dis = int010(ka.disiplinCikis), gz = int010(ka.girisZamanlamasi), ss = int010(ka.strikeSecimi);
  if (!d.oncesi || !d.sirasinda || !d.sonrasi || !cikisN || !girisN || !strikeN || !yorum || bd.length !== 3 || dis == null || gz == null || ss == null) return null;
  return {
    neOldu: d,
    cikis: { karar: pick(ci.karar, ['dogru', 'erken', 'yanlis', 'belirsiz'] as const, 'belirsiz'), neden: cikisN },
    giris: { karar: pick(gi.karar, ['iyi', 'kovalama', 'riskli', 'belirsiz'] as const, 'belirsiz'), neden: girisN },
    strike: { karar: pick(st.karar, ['uygun', 'yakin', 'uzak', 'belirsiz'] as const, 'belirsiz'), neden: strikeN },
    kacanFirsatYorum: yorum,
    birDahakine: [bd[0], bd[1], bd[2]],
    karne: { disiplinCikis: dis, girisZamanlamasi: gz, strikeSecimi: ss, aciklama: str(ka.aciklama, 300) },
  };
}

/** Koçluk çıktısı: feedback[] (giriş sırasıyla eşleşir) */
export function validateCoach(o: Record<string, unknown>, expected: number): Result<(ModelFeedback | null)[]> {
  const list = Array.isArray(o.feedback) ? o.feedback : null;
  if (!list) return { ok: false, error: 'Koçluk çıktısında "feedback" dizisi yok' };
  const byIdx = new Map<number, ModelFeedback | null>();
  list.forEach((x, i) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const idx = typeof r.index === 'number' && Number.isInteger(r.index) ? r.index : i;
    byIdx.set(idx, validateFeedback(r));
  });
  const out: (ModelFeedback | null)[] = [];
  for (let i = 0; i < expected; i++) out.push(byIdx.get(i) ?? null);
  return out.some(Boolean) ? { ok: true, value: out } : { ok: false, error: 'Geri bildirim doğrulanamadı' };
}

/** Karne çıktısı */
export function validateKarne(o: Record<string, unknown>): Result<Karne> {
  const ozet = str(o.ozet, 600), yarinOdak = str(o.yarinOdak, 300);
  const list = (x: unknown) => (Array.isArray(x) ? x.map(v => str(v, 240)).filter(Boolean).slice(0, 5) : []);
  if (!ozet || !yarinOdak) return { ok: false, error: 'Karne eksik alan içeriyor' };
  return { ok: true, value: { ozet, guclu: list(o.guclu), tekrarlayanHata: list(o.tekrarlayanHata), yarinOdak } };
}
