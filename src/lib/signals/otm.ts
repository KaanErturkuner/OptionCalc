/* OTM strike uzaklığı: sabit (Kaan çapası) veya oynaklıktan otomatik k. Saf. d = k × EM_vade */
export type OtmRule = { mode: 'sabit'; k: number } | { mode: 'oto'; k0: number; kMin: number; kMax: number };
export interface AutoKOut { k: number; source: 'çapa' | 'oto' | 'başlangıç'; raw: number | null; note: string }

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

/** Doğrusal enterpolasyonlu yüzdelik (q 0–1) */
export function quantile(xs: number[], q: number): number {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * clamp(q, 0, 1), lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/**
 * ratios: son işlem günlerinin (max(high−open, open−low) / EM0) oranları.
 * k_ham = 0,9 × %60 yüzdelik; IV rank > 80 → ×0,85; < 20 → ×1,10; [kMin, kMax] içine kırpılır.
 * 20 günden az veri varsa k0 kullanılır (kartta "başlangıç değeri" yazar).
 */
export function autoK(i: { rule: OtmRule; ratios: number[]; ivRank: number | null }): AutoKOut {
  const r = i.rule;
  if (r.mode === 'sabit') return { k: r.k, source: 'çapa', raw: null, note: 'Kaan çapası (sabit)' };
  const xs = i.ratios.filter(Number.isFinite).slice(-60);
  if (xs.length < 20) return { k: r.k0, source: 'başlangıç', raw: null, note: `geçmiş ${xs.length} gün (<20): başlangıç değeri` };
  let raw = 0.9 * quantile(xs, 0.6);
  if (i.ivRank != null && i.ivRank > 80) raw *= 0.85;
  else if (i.ivRank != null && i.ivRank < 20) raw *= 1.1;
  return { k: clamp(raw, r.kMin, r.kMax), source: 'oto', raw, note: `k_ham=${raw.toFixed(2)} → [${r.kMin}, ${r.kMax}]` };
}

/** Uzaklık ($): k × EM_vade */
export const otmDistance = (k: number, em: number) => k * em;
