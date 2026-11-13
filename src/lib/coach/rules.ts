/*
 * Kaan kuralları — deterministik kontroller (saf). Model yorumu bunların üstüne kurulur; sayılar buradan gelir.
 * Kurallar (Kaan): giriş 16:30–20:00 İst; 0–3 DTE; prim stopu %67 (kalan %33); hedef 1:5 brüt (yedek 1:4).
 * Kademe 50/40/30 ve hacim-dönüş çıkışı görüntüden ölçülemez → model yorumlar, "bilinmiyor" işaretlenir.
 */
import type { ExtractedTrade, RuleFact } from './types.ts';
import { dteOf, inEntryWindowIst, istHm, istToMs } from './time.ts';

export const STOP_LOSS_PCT = 0.67;   // prim stopu: girişin %67'si kaybedilince çık
export const RR_MAIN = 5;            // 1:5 brüt
export const RR_FALLBACK = 4;        // 1:4 yedek

/** Prim stop seviyesi: giriş × (1 − 0,67) */
export const stopPriceOf = (entry: number): number => +(entry * (1 - STOP_LOSS_PCT)).toFixed(2);

/** Hedef seviyesi: giriş + rr × (giriş − stop) (brüt, komisyon hariç) */
export const targetPriceOf = (entry: number, rr: number): number => {
  const stop = stopPriceOf(entry);
  return +(entry + rr * (entry - stop)).toFixed(2);
};

/** Prim değişimi (%): (çıkış − giriş) / giriş × 100 */
export const premiumPct = (entry: number, exit: number): number => +((exit / entry - 1) * 100).toFixed(1);

/** Kural kontrollerini üretir. Eksik veri → "bilinmiyor" (asla uydurma). */
export function ruleFacts(t: ExtractedTrade, nowMs?: number): RuleFact[] {
  const out: RuleFact[] = [];
  const entryMs = istToMs(t.entryTime);
  if (entryMs == null) {
    out.push({ kural: 'Giriş penceresi 16:30–20:00 İst', durum: 'bilinmiyor', aciklama: 'Giriş zamanı okunamadı' });
  } else {
    const ok = inEntryWindowIst(entryMs);
    out.push({
      kural: 'Giriş penceresi 16:30–20:00 İst', durum: ok ? 'uyuyor' : 'uymuyor',
      aciklama: `Giriş ${istHm(entryMs)} İst${ok ? '' : ' — pencere dışı'}`,
    });
  }

  const day = t.entryTime ? t.entryTime.slice(0, 10) : null;
  const dte = day ? dteOf(t.expiry, day) : null;
  if (dte == null) out.push({ kural: '0–3 DTE vade', durum: 'bilinmiyor', aciklama: 'Vade veya giriş günü eksik/geçersiz' });
  else out.push({ kural: '0–3 DTE vade', durum: dte <= 3 ? 'uyuyor' : 'uymuyor', aciklama: `${dte} gün vade` });

  if (t.entryPrice == null || !(t.entryPrice > 0)) {
    out.push({ kural: 'Prim stopu %67 / hedef 1:5', durum: 'bilinmiyor', aciklama: 'Giriş primi okunamadı' });
  } else {
    const e = t.entryPrice;
    out.push({
      kural: 'Prim stopu %67 / hedef 1:5', durum: 'bilinmiyor',
      aciklama: `Giriş ${e.toFixed(2)} → stop ${stopPriceOf(e).toFixed(2)}, hedef 1:5 ${targetPriceOf(e, RR_MAIN).toFixed(2)} (yedek 1:4 ${targetPriceOf(e, RR_FALLBACK).toFixed(2)})`,
    });
    if (t.exitPrice != null && t.exitPrice >= 0 && t.status === 'kapali') {
      const pct = premiumPct(e, t.exitPrice);
      const x = t.exitPrice;
      const stop = stopPriceOf(e);
      let durum: RuleFact['durum'] = 'uymuyor';
      let ac = `Çıkış ${x.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct}%)`;
      if (x >= targetPriceOf(e, RR_FALLBACK)) { durum = 'uyuyor'; ac += ' — hedef (≥1:4) bölgesinde'; }
      else if (x <= stop + 1e-9) { durum = 'uyuyor'; ac += ' — stop seviyesinde'; }
      else ac += ' — stop/hedef dışında (manuel çıkış)';
      out.push({ kural: 'Çıkış stop veya hedefte', durum, aciklama: ac });
    }
  }

  if (t.status === 'acik') out.push({ kural: 'Pozisyon kapalı', durum: 'bilinmiyor', aciklama: 'Açık pozisyon: çıkış henüz yok, koçluk kapanıştan sonra' });
  if (nowMs != null && t.qty == null) out.push({ kural: 'Kademe 50/40/30', durum: 'bilinmiyor', aciklama: 'Adet okunamadı' });
  return out;
}
