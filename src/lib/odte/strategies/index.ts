/* Strateji kaydı. Yeni strateji: modül ekle → buraya kaydet → `node backtest/compare.mts --s <id>` */
import type { CommonParams, Strategy } from './types.ts';
import { orbVwap } from './orbVwap.ts';
import { gammaRegime } from './gammaRegime.ts';
import { oiWall } from './oiWall.ts';
import { emBreach } from './emBreach.ts';
import { confluence, confluenceV1 } from './confluence.ts';
import { kaanMomentum0, kaanMomentum13, kaanMomentumRelaxed0, kaanMomentumRelaxed13 } from './kaanMomentum.ts';
import { firsatStrategies } from './firsat.ts';
import { qullStrategies } from './qull.ts';

export * from './types.ts';
export { pickContract, pickStrike } from './util.ts';
/** Zaman dilimi filtresi sarmalayıcı: herhangi bir stratejiyi belirli ET pencereleriyle sınırla (dakika, 09:30'dan) */
export function withTimeFilter<P extends CommonParams>(s: Strategy<P>, startMin: number, endMin: number, tag = `${startMin}-${endMin}`): Strategy<P> {
  return { ...s, id: `${s.id}@${tag}`, name: `${s.name} [${tag}]`, defaults: { ...s.defaults, startMin, endMin },
    space: { ...s.space, startMin: undefined, endMin: undefined } };
}
export const STRATEGIES: Strategy<any>[] = [
  confluence, confluenceV1, orbVwap, gammaRegime, oiWall, emBreach,
  withTimeFilter(orbVwap, 15, 90, 'sabah'),          // 09:45–11:00 ET
  withTimeFilter(gammaRegime, 240, 345, 'ogleden-sonra'), // 13:30–15:15 ET
  kaanMomentum0, kaanMomentum13, kaanMomentumRelaxed0, kaanMomentumRelaxed13,
  ...firsatStrategies,
  ...qullStrategies,
];
export const strategyById = (id: string) => STRATEGIES.find(s => s.id === id);
