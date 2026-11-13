/* "Onayla" akışı (manuel giriş): süre dolumu, geçersizleşme, yeniden fiyatlama — SINYAL-FIRSAT §7.7, K3. Saf.
 * Kâğıt hesap hiçbir sinyali kendiliğinden almaz; giriş yalnızca kullanıcının "Onayla"sıyla olur. */
import type { SignalMode } from './account.ts';
import { entryFill, DEFAULT_SLIPPAGE } from './costs.ts';

export const APPROVAL_TTL_MIN_0DTE = 3;     // dk
export const APPROVAL_TTL_MIN_MULTI = 5;    // dk (1–3 DTE)
export const APPROVAL_TTL_RANGE: [number, number] = [1, 10];  // ayar aralığı (dk)
export const PRICE_DRIFT_FRAC = 0.25;       // |S − giriş| > 0,25 × |giriş − stop|
export const FILL_JUMP_MAX = 1.10;          // yeni ask > sinyal ask × 1,10 → fiyat kaçtı
export const CHAIN_MAX_AGE_MS = 60000;      // onayda zincir 60 sn'den eskiyse yeniden çekilir

export type ApprovalState = 'bekliyor' | 'onaylandi' | 'reddedildi' | 'suresi-doldu' | 'fiyat-kacti';
export type ExpiryReason = 'zaman' | 'fiyat-kaymasi' | 'stop-dokunusu' | 'hedef-yarisi' | 'pencere-kapandi' | 'gecersizlesti';

/** Süre: 0DTE 3 dk, 1–3 DTE 5 dk; ayar (1–10 dk) geçersiz kılar. */
export function approvalTtlMs(dte: number, overrideMin?: number): number {
  if (overrideMin !== undefined && Number.isFinite(overrideMin)) {
    const [lo, hi] = APPROVAL_TTL_RANGE;
    return Math.min(hi, Math.max(lo, overrideMin)) * 60000;
  }
  return (dte === 0 ? APPROVAL_TTL_MIN_0DTE : APPROVAL_TTL_MIN_MULTI) * 60000;
}

export interface ApprovalSignal {
  createdAt: number;
  dte: number;
  dirSign: 1 | -1;            // +1 call (yukarı), −1 put (aşağı)
  spot0: number;              // sinyal anındaki dayanak
  entryUnd: number;           // dayanak giriş seviyesi
  stopUnd: number;            // dayanak stop
  targetUnd: number;          // dayanak hedef
  ask0: number;               // sinyal anındaki ask
  mode: SignalMode;
  windowEndMin: number;       // giriş penceresi bitişi (ET dk); 0DTE için 14:30 veto dâhil
}

export interface ApprovalTick {
  now: number;
  spot: number;
  etMin: number;
  marketOpen: boolean;
  /** Yeni tarama: aynı setup hâlâ geçerli mi (skor ve RR). Yoksa null. */
  fresh: { score: number; rr: number; minScore: number; minRR: number } | null;
}

/** Süre dolumu / geçersizleşme nedeni. İlki kazanır; yoksa null. */
export function expiryReason(s: ApprovalSignal, t: ApprovalTick, ttlMs: number): ExpiryReason | null {
  if (t.now - s.createdAt >= ttlMs) return 'zaman';
  const risk = Math.abs(s.entryUnd - s.stopUnd);
  if (Math.abs(t.spot - s.spot0) > PRICE_DRIFT_FRAC * risk) return 'fiyat-kaymasi';
  if (s.dirSign * (t.spot - s.stopUnd) <= 0) return 'stop-dokunusu';
  const half = s.entryUnd + 0.5 * (s.targetUnd - s.entryUnd);
  if (s.dirSign * (t.spot - half) >= 0) return 'hedef-yarisi';
  if (!t.marketOpen || t.etMin >= s.windowEndMin) return 'pencere-kapandi';
  if (!t.fresh || t.fresh.score < t.fresh.minScore || t.fresh.rr < t.fresh.minRR) return 'gecersizlesti';
  return null;
}

export type RepriceResult = { ok: true; fill: number } | { ok: false; reason: 'fiyat-kacti'; detail: string };

/**
 * Onaya basınca yeniden fiyatlama (§7.7): yeni ask > sinyal ask × 1,10 veya yeni RR < mod alt sınırı → fiyat kaçtı.
 * Aksi halde dolum = yeni ask + kayma. Çağıran zinciri 60 sn'den eskiyse yeniden çekmeli.
 */
export function repriceOnApprove(sig: { ask0: number }, fresh: { ask: number; rr: number; minRR: number },
  slip = DEFAULT_SLIPPAGE): RepriceResult {
  if (fresh.ask > sig.ask0 * FILL_JUMP_MAX) {
    return { ok: false, reason: 'fiyat-kacti', detail: `ask ${sig.ask0.toFixed(2)} → ${fresh.ask.toFixed(2)}` };
  }
  if (fresh.rr < fresh.minRR) {
    return { ok: false, reason: 'fiyat-kacti', detail: `RR ${fresh.rr.toFixed(2)} < ${fresh.minRR}` };
  }
  return { ok: true, fill: entryFill(fresh.ask, slip) };
}

/** Kullanıcı eylemi sonrası durum. Onaylanmayan (geç / süresi dolan) sinyal hesabı ve sayaçları değiştirmez. */
export function resolveApproval(
  current: ApprovalState, action: 'onayla' | 'gec', expired: ExpiryReason | null,
  reprice: RepriceResult | null,
): { state: ApprovalState; reason?: string } {
  if (current !== 'bekliyor') return { state: current, reason: 'karar zaten verildi' };
  if (action === 'gec') return { state: 'reddedildi' };
  if (expired) return { state: 'suresi-doldu', reason: expired };
  if (!reprice) return { state: 'bekliyor', reason: 'yeniden fiyatlama gerekli' };
  if (!reprice.ok) return { state: 'fiyat-kacti', reason: reprice.detail };
  return { state: 'onaylandi' };
}

/** Kalibrasyon kaydı için karar etiketi (§5.5). */
export const decisionLabel = (s: ApprovalState): 'onaylandı' | 'reddedildi' | 'süresi doldu' | 'fiyat kaçtı' | 'bekliyor' =>
  s === 'onaylandi' ? 'onaylandı' : s === 'reddedildi' ? 'reddedildi' : s === 'suresi-doldu' ? 'süresi doldu'
    : s === 'fiyat-kacti' ? 'fiyat kaçtı' : 'bekliyor';
