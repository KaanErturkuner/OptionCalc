/* Tüm dedektörleri çalıştır. Her dedektör saf fonksiyon; sonuçlar birleşik Signal[] */
import type { Baseline, Signal, Snapshot } from '../types.ts';
import { pcSurge } from './pcSurge.ts';
import { unusual } from './unusual.ts';
import { oiBuild } from './oiBuild.ts';
import { ivJump } from './ivJump.ts';
import { skewShift } from './skew.ts';
import { complacency } from './complacency.ts';
import { pin } from './pin.ts';
import { sectorDivergence } from './sector.ts';
import { earnings } from './earnings.ts';
import { trend } from './trend.ts';

export const DETECTORS: ((s: Snapshot, b: Baseline) => Signal[])[] = [
  pcSurge, unusual, oiBuild, (s) => ivJump(s), skewShift, complacency, (s) => pin(s), (s) => sectorDivergence(s), earnings, (s) => trend(s),
];
export function runDetectors(s: Snapshot, b: Baseline): Signal[] {
  return DETECTORS.flatMap(f => f(s, b));
}
