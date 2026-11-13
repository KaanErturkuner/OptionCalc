/* Opsiyonel Q çıkış uyarlamaları (varsayılan KAPALI, ayarlanır): "LOD/HOD kırılırsa çık" ve "5 dk EMA10 iz süren çıkış".
 * Qullamaggie uyarlaması — Kaan onayı yok. Yalnız Q pozisyonlarında (setup Q1/Q1S/Q2/Q3) etkin. Saf.
 * Not: Qullamaggie'nin 3–5 gün sonra kısmi satış ve 10/20 günlük MA ile iz sürme 0–3 DTE'de uygulanamaz (günlük bar yok). */
import type { Bar } from '../../odte/analytics.ts';
import { ema } from './daily.ts';
import { isQ } from './policy.ts';

export interface QExitOn { lod: boolean; ema: boolean }
export interface QExitFlags { lod: boolean; ema: boolean }
export interface QPosLike { setup: string; dir: 'call' | 'put'; und?: { stop: number } | undefined }

/** Tamamlanmış 5 dk kapanışlar (1 dk barların her 5'inci kapanışı; yarım kalan kova dahil değil). */
export function fiveMinCloses(bs: Bar[]): number[] {
  const out: number[] = [];
  for (let i = 4; i < bs.length; i += 5) out.push(bs[i].c);
  return out;
}

/** LOD (yükseliş) / HOD (düşüş) kırılımı: son tamamlanmış 1 dk kapanış, pozisyonun dayanak stopunun (LOD/HOD) karşı tarafında. */
export function lodBroken(pos: QPosLike, bs: Bar[]): boolean {
  if (!pos.und || !bs.length) return false;
  const c = bs[bs.length - 1].c, lvl = pos.und.stop;
  return pos.dir === 'call' ? c < lvl : c > lvl;
}

/** 5 dk EMA10 kırılımı: son tamamlanmış 5 dk kapanış EMA10'un karşı tarafında. Yeterli 5 dk kapanış yoksa (< 10) false. */
export function ema5Broken(pos: QPosLike, bs: Bar[]): boolean {
  const closes = fiveMinCloses(bs);
  if (closes.length < 10) return false;
  const e = ema(closes, 10)[closes.length - 1], c = closes[closes.length - 1];
  return pos.dir === 'call' ? c < e : c > e;
}

/** Açık pozisyon için Q çıkış tetikleri. Q olmayan pozisyonda ya da ayar kapalıyken hepsi false. */
export function qExitTriggers(pos: QPosLike, bs: Bar[], on: QExitOn): QExitFlags {
  if (!isQ(pos.setup)) return { lod: false, ema: false };
  return { lod: on.lod && lodBroken(pos, bs), ema: on.ema && ema5Broken(pos, bs) };
}
