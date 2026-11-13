/*
 * Model çıktısının ayrıştırılması ve doğrulanması (saf). Model metni güvenilmez girdidir: JSON ayıklanır, tipler
 * ve enum'lar denetlenir, uzunluklar kırpılır. Geçersiz çıktı → { ok:false, error } (asla kısmi/uydurma sonuç yok).
 */
import type { ExtractedTrade, Karne, ModelFeedback, OptSide } from './types.ts';
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

/** Görüntüden çıkan işlem listesi */
export function validateExtract(o: Record<string, unknown>): Result<{ trades: ExtractedTrade[]; okunamadi: string | null }> {
  const raw = Array.isArray(o.trades) ? o.trades.slice(0, 5) : [];
  const trades: ExtractedTrade[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const side = String(r.side ?? '').toUpperCase();
    const ticker = str(r.ticker, 12).toUpperCase().replace(/[^A-Z0-9.]/g, '');
    const expiry = str(r.expiry, 10);
    const strike = num(r.strike);
    if (!ticker || (side !== 'CALL' && side !== 'PUT') || !YMD.test(expiry) || strike == null || strike <= 0) continue;
    const entryTime = optStr(r.entryTime, 16), exitTime = optStr(r.exitTime, 16);
    const trade: ExtractedTrade = {
      ticker, side: side as OptSide, strike, expiry,
      qty: num(r.qty) != null && (num(r.qty) as number) > 0 ? Math.round(num(r.qty) as number) : null,
      entryTime: entryTime && istToMs(entryTime) != null ? entryTime : null,
      entryPrice: num(r.entryPrice) != null && (num(r.entryPrice) as number) > 0 ? num(r.entryPrice) : null,
      exitTime: exitTime && istToMs(exitTime) != null ? exitTime : null,
      exitPrice: num(r.exitPrice) != null && (num(r.exitPrice) as number) >= 0 ? num(r.exitPrice) : null,
      status: pick(r.status, ['kapali', 'acik'] as const, 'kapali'),
      confidence: pick(r.confidence, ['yuksek', 'orta', 'dusuk'] as const, 'dusuk'),
    };
    if (trade.status === 'kapali' && (trade.exitTime == null || trade.exitPrice == null)) trade.status = 'acik';
    trades.push(trade);
  }
  if (!trades.length) return { ok: false, error: str(o.okunamadi, 300) || 'Görüntüde işlem okunamadı' };
  return { ok: true, value: { trades, okunamadi: optStr(o.okunamadi, 300) } };
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
