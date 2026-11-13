/* Setup yardımcıları: kutu, sıkışma, uç değerler. Saf. */
import type { Bar } from '../../odte/analytics.ts';
export const hiOf = (bs: Bar[]) => bs.reduce((m, b) => Math.max(m, b.h), -Infinity);
export const loOf = (bs: Bar[]) => bs.reduce((m, b) => Math.min(m, b.l), Infinity);
/** Son n barın kutusu; son bar hariç (kırılım barı kutunun dışında kalır) */
export function box(bs: Bar[], n: number) {
  const xs = bs.slice(-n - 1, -1), hi = hiOf(xs), lo = loOf(xs);
  return { hi, lo, mid: (hi + lo) / 2, h: hi - lo };
}
/** Son 20 dk aralığı EM'in %25'inden dar mı (sıkışma) */
export const squeezed = (bs: Bar[], em: number) => bs.length >= 21 && box(bs, 20).h <= 0.25 * em;
export const MIN_STOP_EM = 0.15;
