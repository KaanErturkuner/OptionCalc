/* Setup kayıt defteri ve ticker kısıtları (GLD/SLV: S1, S2, S5; NVDA: S1, S3, S4; diğerleri: hepsi). */
import type { SetupCtx, SetupCandidate, SetupFn, SetupId } from '../types.ts';
import { orbUyum } from './s1-orb.ts';
import { sikisma } from './s2-sikisma.ts';
import { vwapGeriAlma } from './s3-vwap.ts';
import { duvarKirilim } from './s4-duvar.ts';
import { haberDevam } from './s5-haber.ts';
import { ucuzIv } from './s6-ucuz-iv.ts';

export const SETUPS: Record<SetupId, SetupFn> = { S1: orbUyum, S2: sikisma, S3: vwapGeriAlma, S4: duvarKirilim, S5: haberDevam, S6: ucuzIv };
export const ALL_SETUPS: SetupId[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

export function allowedFor(ticker: string): SetupId[] {
  if (ticker === 'GLD' || ticker === 'SLV') return ['S1', 'S2', 'S5'];
  if (ticker === 'NVDA') return ['S1', 'S3', 'S4'];
  return ALL_SETUPS;
}
/** Bağlamdaki izinli setupları çalıştırır; sonuç yoksa boş liste */
export function runSetups(c: SetupCtx): SetupCandidate[] {
  const out: SetupCandidate[] = [];
  for (const id of c.allowed) { const r = SETUPS[id](c); if (r) out.push(r); }
  return out;
}
