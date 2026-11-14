/* Para kuralları — TEK KAYNAK. Saf. Prim stopu, risk ve hedef buradan türer; hiçbir yerde 0,33/0,67/%67 literal'i yazılmaz.
 * Kaan kararı (2026-11-14): sert stop = prim girişten %40 düşünce (eskiden %67). Giriş × 0,60 = stop.
 * Risk (1R) = giriş × 0,40 (kontrat başına). 1:N hedef = giriş + N × risk (1:5 = giriş × 3,0; 1:4 = giriş × 2,6).
 * Komisyon ($1,50/kontrat/yön) RR ve hedef fiyatına girmez (brüt); net K/Z'de ayrıca düşülür.
 * Örnek: giriş 3,00 → stop 1,80 · 1:5 hedef 9,00 · 1:4 yedek 7,80.
 * Kaan'ın değiştirdiği tek sayı bu dosyadaki PREMIUM_STOP_DROP'tur. Ekran metni PREMIUM_STOP_PCT'den üretilir. */

/** Sert prim stopu: giriş primine göre bu oranda düşüş (0,40 = %40). */
export const PREMIUM_STOP_DROP = 0.40;
/** Ekran / metin için yüzde (40). */
export const PREMIUM_STOP_PCT = Math.round(PREMIUM_STOP_DROP * 100);
/** Stop seviyesi = giriş × STOP_KEEP (0,60). */
export const STOP_KEEP = 1 - PREMIUM_STOP_DROP;
/** 1R = giriş × RISK_SHARE (kontrat başına, komisyon hariç). */
export const RISK_SHARE = PREMIUM_STOP_DROP;
/** Birincil ve yedek hedef çarpanları (1:5, 1:4). */
export const RR_MAIN = 5;
export const RR_FALLBACK = 4;

/** Stop prim seviyesi (ham, yuvarlamasız): giriş × 0,60. */
export const stopPremRaw = (entry: number): number => entry * STOP_KEEP;

/** Stop prim seviyesi, 2 ondalık (kuruş). 3,00 → 1,80. */
export const stopPremOf = (entry: number): number => Math.round(stopPremRaw(entry) * 100) / 100;

/** 1R (kontrat başına prim riski): giriş × 0,40. 3,00 → 1,20. */
export const riskPremOf = (entry: number): number => entry * RISK_SHARE;

/** Hedef prim (1:N, risk bazlı, yuvarlamasız): giriş + N × risk. 1:5 → giriş × 3,0; 1:4 → giriş × 2,6. */
export const targetPremRaw = (entry: number, N: number): number => entry + N * riskPremOf(entry);

/** Hedef prim, 2 ondalık. 3,00 → 1:5 9,00 · 1:4 7,80. */
export const targetPremOf = (entry: number, N: number): number => Math.round(targetPremRaw(entry, N) * 100) / 100;

/** Çıkış primi → R (kontrat başına): (çıkış − giriş) / (giriş × 0,40). Stop −1R, 1:5 +5R. */
export const exitPremForR = (R: number, entry: number): number => Math.max(0, entry * (1 + RISK_SHARE * R));

/** Ekran metni: "−%40" */
export const STOP_LABEL = `−%${PREMIUM_STOP_PCT}`;
