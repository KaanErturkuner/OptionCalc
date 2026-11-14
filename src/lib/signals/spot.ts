/*
 * Fırsat dayanak fiyatı seçimi. Saf.
 * Sorun: keyless 'auto' sırası CBOE (delayed_quotes, 15 dk gecikmeli) → Yahoo. Fiyat CBOE'den gelince Fırsat 15 dk geride kalıyordu.
 * Çözüm: taze bir 1 dk bar varsa onun kapanışı (Yahoo barları, ~1 dk gecikme) kullanılır; yoksa kotasyon ve kendi gecikme etiketi.
 */
export interface SpotBar { t: number; c: number }  // t: bar başlangıcı (ms), c: kapanış
export interface SpotPick { price: number; source: 'bar' | 'quote'; delayedMin: number; ageSec: number | null }

/** Bar yaşı = şimdi − (bar başlangıcı + 1 dk). En fazla maxBarAgeSec yaşlı bar kabul edilir. Kotasyonda yaş bilinmez (null). */
export function spotPrice(quote: { price: number; delayedMin: number }, lastBar: SpotBar | null,
  nowMs: number, maxBarAgeSec = 300): SpotPick {
  if (lastBar && lastBar.c > 0 && Number.isFinite(lastBar.c)) {
    const ageSec = Math.max(0, (nowMs - (lastBar.t + 60000)) / 1000);
    if (ageSec <= maxBarAgeSec) return { price: lastBar.c, source: 'bar', delayedMin: 0, ageSec: Math.round(ageSec) };
  }
  return { price: quote.price, source: 'quote', delayedMin: quote.delayedMin, ageSec: null };
}
