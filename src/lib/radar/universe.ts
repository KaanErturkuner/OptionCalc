/* Radar evreni: sektör ETF eşlemesi, ETF listesi, strike adımı (Kaan'ın strike kuralı için) */
export const ETFS = new Set(['QQQ', 'SPY', 'IWM', 'GLD', 'SLV', 'SMH', 'IGV', 'ARKX', 'UFO', 'DRAM']);
/** Hisse → sektör ETF'i (ilk eşleşme). NBIS / CRWV için SMH + QQQ'dan QQQ kullanılır (çağıran ikisini de okuyabilir). */
export const SECTOR: Record<string, string> = {
  MU: 'SMH', INTC: 'SMH', AMD: 'SMH', AXTI: 'SMH', AAOI: 'SMH', MRVL: 'SMH', NVDA: 'SMH', DRAM: 'SMH',
  NBIS: 'QQQ', CRWV: 'QQQ', GLW: 'QQQ', TSLA: 'QQQ', RKLB: 'UFO', SPCX: 'UFO',
};
export const isEtf = (t: string) => ETFS.has(t);
/** Kaan'ın strike kuralı: hisse 1,8×, ETF 0,45× günlük beklenen hareket kadar OTM */
export const strikeMult = (t: string) => (isEtf(t) ? 0.45 : 1.8);
/** Strike adımı (state.ts ile aynı kural; saf modülde tekrar tanımlandı) */
export const strikeStep = (S: number) => S < 25 ? 0.5 : S < 200 ? 1 : S < 500 ? 2.5 : S < 1000 ? 5 : 10;
export const roundStrike = (x: number, S: number) => { const st = strikeStep(S); return +(Math.round(x / st) * st).toFixed(4); };
/** Varsayılan Radar evreni (state.ts / 0DTE ile aynı 15 hisse + sektör ETF'leri) */
export const RADAR_WATCH = ['QQQ', 'MU', 'AXTI', 'AAOI', 'MRVL', 'GLW', 'NBIS', 'CRWV', 'DRAM', 'AMD', 'INTC', 'SPCX', 'NVDA', 'TSLA', 'RKLB', 'SMH', 'UFO', 'SPY'];
