/*
 * Kural tabanlı Akış yorumu (ücretsiz, LLM yok). Saf: React / Date.now YOK.
 * Girdi: strike satırları + spot + olay özeti. Çıktı: tek kalın özet + en çok 5 madde + güven.
 * Eşikler bilerek kaba ve açıktır; "yatırım tavsiyesi değildir" kuralı her yorumda vardır.
 */
import { fmtUsdShort } from './model.ts';
import { nearSpot, strikeSide, type DistRow } from './distribution.ts';

export type Bias = 'yukarı' | 'aşağı' | 'kararsız';
export type Confidence = 'düşük' | 'orta' | 'yüksek';
export interface Interpretation { summary: string; bullets: string[]; bias: Bias; confidence: Confidence }

export interface DistInput {
  ticker: string;
  rows: DistRow[];            // strike satırları (aggregateByStrike)
  spot: number | null;
  eventCount: number;
  zeroDtePrem: number;        // vadesi olay günü olan kontratların primi
  reconstructedCount: number; // sonradan kurulmuş olay sayısı
}

export const YORUM_CAVEAT = 'Yatırım tavsiyesi değildir.';
export const MIN_EVENTS = 3;            // bunun altında yön yorumu yapılmaz
export const MIN_TOTAL = 100_000;       // USD; altı "veri az"
export const STRONG_TOTAL = 1_000_000;  // yüksek güven için
export const IMBALANCE = 1.6;           // taraf ağırlığı eşiği (oran)
export const STRONG_IMBALANCE = 2.5;
export const BIAS_NEAR_PCT = 0.03;      // dominant tarafın primi spot ±%3 içinde olmalı
export const BIAS_NEAR_SHARE = 0.25;    // …bu payın en az %25'i
const CONC_PCT = 0.01;                  // yoğunlaşma: spot ±%1

const tr = (x: number, d = 1) => x.toFixed(d).replace('.', ',');
const pct = (x: number) => `%${Math.round(x * 100)}`;

/** Akış dağılımından kural tabanlı yorum */
export function interpretDistribution(input: DistInput): Interpretation {
  const { rows, spot, eventCount, zeroDtePrem, reconstructedCount } = input;
  const callP = rows.reduce((a, r) => a + r.callPrem, 0);
  const putP = rows.reduce((a, r) => a + r.putPrem, 0);
  const total = callP + putP;

  if (eventCount === 0 || total <= 0) {
    return { summary: 'Yeterli akış verisi yok.', bullets: ['Bu hisse için seçili filtrelerde olay yok.', YORUM_CAVEAT], bias: 'kararsız', confidence: 'düşük' };
  }

  const thin = eventCount < MIN_EVENTS || total < MIN_TOTAL;
  const callDom = callP >= putP;
  const dom = Math.max(callP, putP), other = Math.min(callP, putP);
  const ratio = other > 0 ? dom / other : Infinity;
  const balanced = ratio < IMBALANCE;

  // Dominant taraf spot yakınında mı, yoksa yalnız uzak OTM kanatlarda mı?
  let farOtm = false;
  if (spot != null) {
    const domNear = rows.reduce((a, r) => a + (nearSpot(r.strike, spot, BIAS_NEAR_PCT) ? (callDom ? r.callPrem : r.putPrem) : 0), 0);
    farOtm = dom > 0 && domNear / dom < BIAS_NEAR_SHARE;
  }

  let bias: Bias = 'kararsız';
  if (!thin && !balanced && !farOtm) bias = callDom ? 'yukarı' : 'aşağı';

  // Güven: yalnız net, yoğun ve yeterli prim varsa yüksek; yeniden kurulmuş veriyle en çok orta
  let confidence: Confidence = 'düşük';
  if (bias !== 'kararsız') {
    const sorted = [...rows].sort((a, b) => b.total - a.total);
    const top3 = sorted.slice(0, 3).reduce((a, r) => a + r.total, 0) / total;
    const nearShare = spot != null ? rows.reduce((a, r) => a + (nearSpot(r.strike, spot, CONC_PCT) ? r.total : 0), 0) / total : 0;
    const concentrated = top3 >= 0.5 || nearShare >= 0.4;
    confidence = ratio >= STRONG_IMBALANCE && concentrated && total >= STRONG_TOTAL ? 'yüksek' : 'orta';
  }
  if (reconstructedCount > 0 && reconstructedCount === eventCount && confidence === 'yüksek') confidence = 'orta';

  // Özet cümlesi
  let summary: string;
  if (bias === 'yukarı') summary = 'Yukarı eğilim: call primi ağır.';
  else if (bias === 'aşağı') summary = 'Aşağı eğilim: put primi ağır.';
  else if (thin) summary = 'Kararsız: veri az.';
  else if (balanced) summary = 'Kararsız: call ve put primi dengeli.';
  else summary = 'Kararsız: prim uzak strike’larda, spot yakınında belirgin taraf yok.';
  summary += ` Güven: ${confidence}.`;

  // Maddeler (en çok 4 içerik + yasal not)
  const content: string[] = [];
  if (thin) content.push(`Veri az (${eventCount} olay, toplam ${fmtUsdShort(total)}): yön için yeterli değil.`);
  const ratioTxt = other > 0 ? ` (${tr(ratio)}×)` : ' (yalnız bir taraf var)';
  const ratioLabel = balanced ? 'dengeli' : callDom ? 'call ağır' : 'put ağır';
  content.push(`Call prim ${fmtUsdShort(callP)}, put prim ${fmtUsdShort(putP)}: ${ratioLabel}${ratioTxt}.`);
  if (farOtm) content.push('Prim çoğunlukla spota uzak strike’larda; bu, yönsel bir sinyal olarak zayıf.');

  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, 3);
  const topTxt = top.map(r => {
    const side = strikeSide(r.strike, spot);
    const lab = side === 'above' ? ', spot üstü (direnç / çekim)' : side === 'below' ? ', spot altı (destek / çekim)' : side === 'at' ? ', spot seviyesi' : '';
    return `${Number.isInteger(r.strike) ? r.strike : tr(r.strike, 2)} (${fmtUsdShort(r.total)}${lab})`;
  });
  content.push(`En yoğun strike’lar: ${topTxt.join('; ')}${spot == null ? ' (spot yok: seviye olarak okunur)' : ''}.`);

  if (reconstructedCount > 0) {
    content.push(reconstructedCount === eventCount
      ? 'Tüm olaylar sonradan kuruldu (kapanış verisi, gün içi an yok): zamanlama yorumu yapılamaz.'
      : `${reconstructedCount} olay sonradan kuruldu (kapanış verisi, gün içi an yok).`);
  }
  if (spot != null) {
    const nearShare = rows.reduce((a, r) => a + (nearSpot(r.strike, spot, CONC_PCT) ? r.total : 0), 0) / total;
    content.push(`Primin ${pct(nearShare)}’i spotun ±%1’i içinde; kalanı uzak strike’larda.`);
  }
  if (zeroDtePrem > 0) content.push(`Primin ${pct(zeroDtePrem / total)}’i 0DTE (vadesi olay günü) kontratlarda.`);

  return { summary, bullets: [...content.slice(0, 4), YORUM_CAVEAT], bias, confidence };
}
