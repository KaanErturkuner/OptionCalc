/* Para kuralları — TEK KAYNAK. Saf. Prim stopu, risk ve hedef buradan türer; hiçbir yerde 0,33/0,67/%67 literal'i yazılmaz.
 * Kaan kararı (2026-11-14, güncel): sert stop = prim girişten %50 düşünce. Giriş × 0,50 = stop.
 * Risk (1R) = giriş × 0,50 (kontrat başına, SABİT; dayanak stopu 1R'yi değiştirmez).
 * Hedef 1:N, N ∈ {5, 4, 3} (sistem en yükseği dener): hedef = giriş + N × 1R (1:5 = giriş × 3,5; 1:4 = × 3,0; 1:3 = × 2,5).
 * Komisyon ($1,50/kontrat/yön) RR ve hedef fiyatına girmez (brüt); net K/Z'de ayrıca düşülür.
 * Örnek: giriş 3,00 → stop 1,50 · 1:5 hedef 10,50 · 1:4 9,00 · 1:3 7,50.
 * Kaan'ın değiştirdiği tek sayı bu dosyadaki PREMIUM_STOP_DROP'tur. Ekran metni PREMIUM_STOP_PCT'den üretilir. */

/** Sert prim stopu: giriş primine göre bu oranda düşüş (0,40 = %40). */
export const PREMIUM_STOP_DROP = 0.50;
/** Ekran / metin için yüzde (40). */
export const PREMIUM_STOP_PCT = Math.round(PREMIUM_STOP_DROP * 100);
/** Stop seviyesi = giriş × STOP_KEEP (0,60). */
export const STOP_KEEP = 1 - PREMIUM_STOP_DROP;
/** 1R = giriş × RISK_SHARE (kontrat başına, komisyon hariç). */
export const RISK_SHARE = PREMIUM_STOP_DROP;
/** Hedef çarpanları: birincil 1:5, yedek 1:4, en düşük kabul 1:3. */
export const RR_MAIN = 5;
export const RR_FALLBACK = 4;
export const RR_MIN = 3;

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

/** Ekran metni: "−%50" */
export const STOP_LABEL = `−%${PREMIUM_STOP_PCT}`;
