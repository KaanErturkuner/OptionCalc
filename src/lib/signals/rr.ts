/* Opsiyon RR (prim bazlı) — SINYAL-FIRSAT §6.1. Saf; fiyatlayıcı enjekte edilebilir (testler için). */
import { americanPrice, FAST_STEPS, type OptType } from '../american.ts';

export const MIN_PER_YEAR = 252 * 390;   // işlem dakikası
export const RATE = 0.04;
export const COMMISSION = 1.5;            // kontrat başına, açılış ve kapanışta ayrı (Kaan 2026-11-13)
export const SLIPPAGE = 0.01;
export const PRIM_STOP_MAX = 0.67;        // Kaan onayladı
export const TAU_STOP_MIN = 15;
export const TAU_TARGET_MIN_MIN = 20;

export type Pricer = (type: OptType, S: number, K: number, T: number, r: number, q: number, sigma: number, divs: never[], steps: number) => number;

export interface RRInput {
  type: OptType; S: number; K: number; T0: number;          // T0: vadeye yıl
  sigma: number;                                            // K'daki IV (ondalık)
  bid: number; ask: number;
  und: { entry: number; stop: number; target: number };     // dayanak seviyeleri
  emRemain: number; sessionLeftMin: number;
  ivStopMult?: number; ivTargetMult?: number;
  commission?: number; slippage?: number; primStopMax?: number;
}
export interface RRResult {
  entry: number; primStop: number; primTarget: number; risk: number; reward: number; rr: number;
  tauTargetMin: number; valid: boolean; reason?: string;
}

const defaultPricer: Pricer = (type, S, K, T, r, q, sigma, divs, steps) => americanPrice(type, S, K, T, r, q, sigma, divs, steps);

export function optionRR(i: RRInput, pricer: Pricer = defaultPricer): RRResult {
  const comm = i.commission ?? COMMISSION, slip = i.slippage ?? SLIPPAGE, pmax = i.primStopMax ?? PRIM_STOP_MAX;
  const half = Math.max(0, (i.ask - i.bid) / 2), entry = i.ask + slip;
  const tYears = (min: number) => Math.max(0, min) / MIN_PER_YEAR;
  const valueAt = (S: number, min: number, mult: number) => pricer(i.type, S, i.K, Math.max(1e-6, i.T0 - tYears(min)), RATE, 0, i.sigma * mult, [], FAST_STEPS) - half;
  // Stop: dayanakta τ_stop sonrası prim (yarım spread düşülmüş)
  const primStop = valueAt(i.und.stop, TAU_STOP_MIN, i.ivStopMult ?? 1.0);
  // Hedef: τ_hedef ve 2 × τ_hedef denenir; küçük ödül alınır (teta temkini)
  const need = Math.abs(i.und.target - i.S), ratio = i.emRemain > 0 ? Math.min(1, need / i.emRemain) : 1;
  const left = Math.max(0, i.sessionLeftMin);
  const tau1 = Math.min(left, Math.max(TAU_TARGET_MIN_MIN, left * ratio * ratio));
  const tau2 = Math.min(left, 2 * tau1);
  const rewardAt = (tau: number) => valueAt(i.und.target, tau, i.ivTargetMult ?? 1.0) - entry - 2 * comm / 100;
  const reward = Math.min(rewardAt(tau1), rewardAt(tau2));
  const primTarget = valueAt(i.und.target, tau1, i.ivTargetMult ?? 1.0);
  const risk = entry - Math.max(primStop, entry * (1 - pmax)) + 2 * comm / 100;
  const valid = risk > 0 && reward > 0;
  return { entry, primStop, primTarget, risk, reward, rr: valid ? reward / risk : 0, tauTargetMin: tau1, valid,
    reason: !(risk > 0) ? 'risk ≤ 0' : !(reward > 0) ? 'ödül ≤ 0 (komisyon ve teta sonrası)' : undefined };
}
