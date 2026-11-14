/*
 * Kaan kuralları — deterministik kontroller (saf). Model yorumu bunların üstüne kurulur; sayılar buradan gelir.
 * Kurallar (Kaan): giriş 16:30–20:00 İst; 0–3 DTE; prim stopu −%40 (giriş × 0,60); hedef 1:5 brüt (yedek 1:4). Sayılar paper/rules.ts'ten.
 * Kademe 50/40/30 ve hacim-dönüş çıkışı görüntüden ölçülemez → model yorumlar, "bilinmiyor" işaretlenir.
 */
import type { ExtractedTrade, RuleFact } from './types.ts';
import { dteOf, inEntryWindowIst, istHm, istToMs } from './time.ts';
import { RR_MAIN, RR_FALLBACK, PREMIUM_STOP_PCT, stopPremOf, targetPremOf } from '../paper/rules.ts';

export { RR_MAIN, RR_FALLBACK, PREMIUM_STOP_PCT } from '../paper/rules.ts';

/** Prim stop seviyesi: giriş × 0,60 (−%40). Tek kaynak: paper/rules.ts */
export const stopPriceOf = (entry: number): number => stopPremOf(entry);

/** Hedef seviyesi: giriş + rr × risk, risk = giriş × 0,40 (brüt, komisyon hariç) */
export const targetPriceOf = (entry: number, rr: number): number => targetPremOf(entry, rr);

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
    out.push({ kural: `Prim stopu −%${PREMIUM_STOP_PCT} / hedef 1:5`, durum: 'bilinmiyor', aciklama: 'Giriş primi okunamadı' });
  } else {
    const e = t.entryPrice;
    out.push({
      kural: `Prim stopu −%${PREMIUM_STOP_PCT} / hedef 1:5`, durum: 'bilinmiyor',
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
