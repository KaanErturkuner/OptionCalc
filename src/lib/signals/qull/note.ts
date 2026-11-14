/* Q-kalite kartı metni (Türkçe, tek satır). Saf. Qullamaggie uyarlaması — Kaan onayı yok; bilgi amaçlı, skora katılmaz. */
import type { Dir, SetupId } from '../types.ts';
import type { QDaily } from './daily.ts';

const tr1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace('.', ',') : '—');
const pctTxt = (x: number) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}%${(x * 100).toFixed(0)}` : '—');

/** Örnek: "Q1: son 3 ay +%24, 8 gün daralma, 5 dk açılış yükseği kırıldı (hacim 2,1×). Stop gün dibi." */
export function qNote(setup: SetupId, dir: Dir, qd: QDaily, orMin: number, volRatio: number): string {
  const up = dir === 'bull';
  const trend = `son 3 ay ${pctTxt(qd.m63)}`;
  if (setup === 'Q3') return `Q3: ${qd.ext.toFixed(1)} ATR uzama, ${qd.upDays} ardışık yükseliş gün · ${trend}. Stop gün zirvesi.`;
  const contraction = qd.consol.days > 0 ? `${qd.consol.days} gün daralma` : 'daralma yok';
  const brk = `${orMin} dk açılış ${up ? 'yükseği' : 'dibi'} kırıldı (hacim ${tr1(volRatio)}×)`;
  const stop = up ? 'Stop gün dibi.' : 'Stop gün zirvesi.';
  if (setup === 'Q2') return `Q2 (EP): ${trend}, ${contraction}, ${brk}. ${stop}`;
  return `${setup}: ${trend}, ${contraction}, ${brk}. ${stop}`;
}
