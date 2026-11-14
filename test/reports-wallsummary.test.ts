// Rapor duvar bölümü daraltılmış başlık özeti (saf fonksiyon). Ağ YOK.
import * as WS from '../src/lib/reports/wallSummary.ts';
import type { WallRow } from '../src/lib/reports/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const wall = (over: Partial<WallRow>): WallRow => ({
  ticker: 'QQQ', spot: 680, callWall: 710, putWall: 650, gammaFlip: 672, maxPain: 685,
  prev: null, prevLabel: null, source: 'canlı zincir', ...over,
});

ok('boş duvar listesi → null', WS.wallSummaryLine([]) === null);
ok('tek ticker: "QQQ: CW 710 · PW 650"', WS.wallSummaryLine([wall({})]) === 'QQQ: CW 710 · PW 650', String(WS.wallSummaryLine([wall({})])));
const two = WS.wallSummaryLine([wall({}), wall({ ticker: 'SPY', callWall: 5800, putWall: 5600 })]);
ok('iki ticker ayrı parçalar (tr-TR binlik)', two === 'QQQ: CW 710 · PW 650  |  SPY: CW 5.800 · PW 5.600', String(two));
ok('eksik duvar → "—"', WS.wallSummaryLine([wall({ callWall: null, putWall: null })]) === 'QQQ: CW — · PW —');
ok('kısmi eksik: yalnız put duvarı', WS.wallSummaryLine([wall({ callWall: null })]) === 'QQQ: CW — · PW 650');

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm duvar özeti testleri geçti');
if (fail) process.exit(1);
