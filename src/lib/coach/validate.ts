/*
 * Model çıktısının ayrıştırılması ve doğrulanması (saf). Model metni güvenilmez girdidir: JSON ayıklanır, tipler
 * ve enum'lar denetlenir, uzunluklar kırpılır. Geçersiz çıktı → { ok:false, error } (asla kısmi/uydurma sonuç yok).
 */
import type { ExtractedTrade, Karne, OptSide, TradeFeedback } from './types.ts';
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
const ETIKET = ['acele', 'erken_cikis', 'gec_cikis', 'gec_giris', 'pencere_disi', 'dte_disi', 'stop_iyi', 'stop_yok', 'kapatmamaliydi', 'kademe_disi', 'hacim_donusu_kacirildi', 'duygusal'] as const;

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

/** Tek işlem geri bildirimi */
export function validateFeedback(r: Record<string, unknown>): TradeFeedback | null {
  const neYaptin = str(r.neYaptin), dogruAciklama = str(r.dogruAciklama), neden = str(r.neden), birDahakine = str(r.birDahakine);
  if (!neYaptin || !dogruAciklama) return null;
  const etiketler = Array.isArray(r.etiketler) ? r.etiketler.map(x => str(x, 40)).filter(x => (ETIKET as readonly string[]).includes(x)).slice(0, 6) : [];
  return {
    neYaptin, dogruMu: pick(r.dogruMu, ['evet', 'kismen', 'hayir'] as const, 'kismen'), dogruAciklama, neden, birDahakine,
    cikis: pick(r.cikis, ['erken', 'gec', 'iyi_stop', 'dogru', 'kapatmamaliydin', 'belirsiz'] as const, 'belirsiz'),
    etiketler: [...new Set(etiketler)],
  };
}

/** Koçluk çıktısı: feedback[] (giriş sırasıyla eşleşir) */
export function validateCoach(o: Record<string, unknown>, expected: number): Result<(TradeFeedback | null)[]> {
  const list = Array.isArray(o.feedback) ? o.feedback : null;
  if (!list) return { ok: false, error: 'Koçluk çıktısında "feedback" dizisi yok' };
  const byIdx = new Map<number, TradeFeedback | null>();
  list.forEach((x, i) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const idx = typeof r.index === 'number' && Number.isInteger(r.index) ? r.index : i;
    byIdx.set(idx, validateFeedback(r));
  });
  const out: (TradeFeedback | null)[] = [];
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
