/*
 * Model çıktısının ayrıştırılması ve doğrulanması (saf). Model metni güvenilmez girdidir: JSON ayıklanır, tipler
 * ve enum'lar denetlenir, uzunluklar kırpılır. Geçersiz çıktı → { ok:false, error } (asla kısmi/uydurma sonuç yok).
 */
import type { Conf, Karne, ModelFeedback } from './types.ts';
import { istToMs } from './time.ts';

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Dize-duyarlı dengeli kapanış: s[i] '{' veya '[' ise karşılık gelen kapanışın indeksi, yoksa -1 (kesik çıktı). */
export function balancedEnd(s: string, i: number): number {
  const close = s[i] === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { if (--depth === 0) return c === close ? k : -1; }
  }
  return -1;
}

/** Kabul: nesne, ya da en az bir öğeli ve hepsi nesne olan dizi (sayı dizisi gibi önsöz parçalarını eler). */
const acceptable = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 && v.every(x => !!x && typeof x === 'object' && !Array.isArray(x)) : !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Model metninden ilk geçerli JSON değerini (nesne veya nesne dizisi) çıkarır. Toleranslı: ```json çitleri, önsöz/sonsöz,
 * dize içindeki süslü parantezler. prefill: istekte assistant önyüklemesi ("{") verildiyse metnin başına eklenir (devam metni).
 */
export function parseModelJson(text: string, prefill = ''): Result<unknown> {
  const s = (prefill + (text ?? '')).replace(/```[a-zA-Z]*/g, '');
  if (!s.trim()) return { ok: false, error: 'Model yanıtı boş' };
  let opened = false, balanced = false, tried = 0;
  for (let i = 0; i < s.length && tried < 50; i++) {
    if (s[i] !== '{' && s[i] !== '[') continue;
    opened = true; tried++;
    const e = balancedEnd(s, i);
    if (e < 0) continue;
    balanced = true;
    try { const v = JSON.parse(s.slice(i, e + 1)); if (acceptable(v)) return { ok: true, value: v }; } catch { /* sonraki aday */ }
  }
  if (!opened) return { ok: false, error: 'Model çıktısında JSON yok' };
  return { ok: false, error: balanced ? 'JSON ayrıştırılamadı' : 'Model çıktısında tam JSON yok (çıktı kesilmiş olabilir)' };
}

/** Metinden ilk JSON nesnesini çıkarır (```json çitleri ve önsöz/sonsöz toleranslı). */
export function parseJsonLoose(text: string, prefill = ''): Result<Record<string, unknown>> {
  const r = parseModelJson(text, prefill);
  if (!r.ok) return r;
  return Array.isArray(r.value) ? { ok: false, error: 'JSON nesnesi değil' } : { ok: true, value: r.value as Record<string, unknown> };
}

/** Günlük için model metninin kısa ve güvenli örneği (≤ n karakter; kontrol karakterleri boşluk, uzun base64 benzeri dizgiler kırpılır). */
export function sampleText(text: string, n = 300): string {
  return String(text ?? '').replace(/[A-Za-z0-9+/]{60,}={0,2}/g, '[…]').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
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

/** Görüntüden çıkan dolumlar (en çok 6). Girdi: {fills,note} nesnesi VEYA doğrudan dolum dizisi. Zorunlu alanı eksik/geçersiz satır atılır; hiç satır kalmazsa hata (note ile). */
export function validateFills(input: unknown): Result<{ fills: FillInput[]; note: string | null }> {
  const o: Record<string, unknown> = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const list = Array.isArray(input) ? input : Array.isArray(o.fills) ? o.fills : [];
  const raw = list.slice(0, 6);
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
