/* Setup kayıt defteri ve ticker kısıtları (GLD/SLV: S1, S2, S5; NVDA: S1, S3, S4; diğerleri: hepsi).
 * Q setupları (Qullamaggie uyarlaması — Kaan onayı yok) tüm tickerlarda izinlidir; hangilerinin açık olduğu ayardan gelir (allowedFor 3. parametre). */
import type { SetupCtx, SetupCandidate, SetupFn, SetupId } from '../types.ts';
import { orbUyum } from './s1-orb.ts';
import { sikisma } from './s2-sikisma.ts';
import { vwapGeriAlma } from './s3-vwap.ts';
import { duvarKirilim } from './s4-duvar.ts';
import { haberDevam } from './s5-haber.ts';
import { ucuzIv } from './s6-ucuz-iv.ts';
import { q1Orh, q1sOrl } from './q1-orh.ts';
import { q2Ep } from './q2-ep.ts';
import { q3Parabolik } from './q3-parabolik.ts';

export const SETUPS: Record<SetupId, SetupFn> = {
  S1: orbUyum, S2: sikisma, S3: vwapGeriAlma, S4: duvarKirilim, S5: haberDevam, S6: ucuzIv,
  Q1: q1Orh, Q1S: q1sOrl, Q2: q2Ep, Q3: q3Parabolik,
};
/** Sinyal (S) setupları. Q setupları ayarla eklenir (bkz. allowedFor). */
export const ALL_SETUPS: SetupId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

export function allowedFor(ticker: string, q: SetupId[] = []): SetupId[] {
  const base = ticker === 'GLD' || ticker === 'SLV' ? ['S1', 'S2', 'S5'] : ticker === 'NVDA' ? ['S1', 'S3', 'S4'] : ALL_SETUPS;
  return [...base as SetupId[], ...q];
}
/** Bağlamdaki izinli setupları çalıştırır; sonuç yoksa boş liste */
export function runSetups(c: SetupCtx): SetupCandidate[] {
  const out: SetupCandidate[] = [];
  for (const id of c.allowed) { const r = SETUPS[id](c); if (r) out.push(r); }
  return out;
}
