// Radar hisse detay grafiği: saf veri şekillendirme (strike birleştirme, pencere, kovalama, işaretler, vade seçimi). Ağ YOK.
import * as D from '../src/lib/radar/detail.ts';
import type { Chain, OptQuote } from '../src/lib/market/types.ts';
import { closeMs } from '../src/lib/usmarket.ts';
import * as Y from '../src/lib/radar/yorum.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const q = (type: 'call' | 'put', strike: number, oi: number, volume = 0): OptQuote => ({ type, strike, bid: 1, ask: 1.2, last: 1.1, iv: 0.4, volume, oi });

// Örnek zincir: spot 100; calls OI büyük 105'te, puts OI büyük 95'te
const ch: Chain = {
  expiry: '2026-11-20', underlying: 100, updated: Date.parse('2026-11-16T15:00:00Z'),
  calls: [q('call', 95, 100, 10), q('call', 100, 500, 900), q('call', 105, 2000, 300), q('call', 110, 800, 50)],
  puts: [q('put', 90, 300, 5), q('put', 95, 1500, 800), q('put', 100, 400, 100), q('put', 105, 50, 0)],
};

// ───── 1) Strike birleştirme ─────
const rows = D.strikeRows(ch);
ok('strike birleştirme: 5 benzersiz strike (90..110), artan', rows.length === 5 && rows.every((r, i) => i === 0 || r.k > rows[i - 1].k), String(rows.length));
const r100 = rows.find(r => r.k === 100)!;
ok('strike 100: call OI 500, put OI 400, hacim ayrı', r100.callOi === 500 && r100.putOi === 400 && r100.callVol === 900 && r100.putVol === 100);
ok('yalnız call olan strike: put 0', rows.find(r => r.k === 110)!.putOi === 0);
ok('sıfır/negatif strike atılır', D.strikeRows({ ...ch, calls: [q('call', 0, 5)], puts: [] }).length === 0);

// ───── 2) Pencere ─────
const win = D.windowRows(rows, 100, 0.06);
ok('pencere ±%6: 95..105 (90 ve 110 dışarıda)', win.map(r => r.k).join(',') === '95,100,105', win.map(r => r.k).join(','));
ok('pencere: spot ≤ 0 → boş', D.windowRows(rows, 0).length === 0);
const many = Array.from({ length: 100 }, (_, i) => ({ k: 50 + i, callOi: 1, putOi: 1, callVol: 0, putVol: 0 }));
const wm = D.windowRows(many, 100, 0.5, 20);
ok('pencere maxBars: spot'+'a en yakın 20, artan', wm.length === 20 && wm.every((r, i) => i === 0 || r.k > wm[i - 1].k) && wm.some(r => r.k === 100));

// ───── 3) Kovalama ─────
const b = D.bucketRows(many, 10);
ok('kovalama: 10 çubuk (100 → 10)', b.length === 10, String(b.length));
ok('kovalama: toplam OI korunur', b.reduce((a, r) => a + r.callOi, 0) === 100 && b.reduce((a, r) => a + r.putOi, 0) === 100);
ok('kovalama: grup ortalama strike artan', b.every((r, i) => i === 0 || r.k > b[i - 1].k));
ok('kovalama: küçük liste aynen', D.bucketRows(rows, 40) === rows);

// ───── 4) Ölçek ─────
ok('metricMax OI: en büyük çubuk (2000)', D.metricMax(rows, 'oi') === 2000, String(D.metricMax(rows, 'oi')));
ok('metricMax hacim: 900', D.metricMax(rows, 'vol') === 900);
ok('metricMax boş: 0', D.metricMax([], 'oi') === 0);

// ───── 5) İşaretler ─────
const now = Date.parse('2026-11-16T15:00:00Z');
const m = D.markers(ch, 100, now);
ok('call wall = en büyük call OI (105)', m.callWall === 105, String(m.callWall));
ok('put wall = en büyük put OI (95)', m.putWall === 95, String(m.putWall));
ok('max pain bir strike değeri', rows.some(r => r.k === m.maxPain), String(m.maxPain));
ok('spot işareti', m.spot === 100);
ok('gamma flip sayı veya null (aralık içinde)', m.flip === null || (m.flip > 70 && m.flip < 130), String(m.flip));
ok('spot yoksa işaret yok', D.markers(ch, null, now).spot === null && D.markers(ch, null, now).flip === null);
ok('boş zincir: duvarlar null', D.markers({ expiry: ch.expiry, calls: [], puts: [] }, 100, now).callWall === null);
ok('inRange: içeride', D.inRange(105, win) && !D.inRange(110, win) && !D.inRange(null, win));

// ───── 6) Vade seçimi ─────
// Pazartesi 16 Kas 2026 10:00 ET (15:00Z)
const e1 = D.nearestExpiry(now);
// expirations() yalnız Cuma/aylık vadeleri listeler (günlük 0DTE listesi yok) → en yakın Cuma
ok('vade: açık seansta en yakın Cuma (20 Kas)', e1 === '2026-11-20', String(e1));
const after = Date.parse('2026-11-16T21:30:00Z');     // 16:30 ET — kapandı
const e2 = D.nearestExpiry(after);
ok('vade: kapandıktan sonra bugün atlanır', e2 !== null && e2 > '2026-11-16', String(e2));
ok('vade: kapanış ms geçmiş', closeMs('2026-11-16') <= after);

// ───── 7) Dikey merdiven: sıra, enterpolasyon, kaydırma ─────
const desc = D.ladderOrder(rows);                       // 110,105,100,95,90
ok('ladderOrder: azalan (en yüksek strike üstte)', desc.map(r => r.k).join(',') === '110,105,100,95,90', desc.map(r => r.k).join(','));
ok('ladderOrder: girdi değişmez', rows[0].k === 90 && rows[rows.length - 1].k === 110);
ok('valueIndex: tam strike → satır', D.valueIndex(105, desc) === 1 && D.valueIndex(110, desc) === 0 && D.valueIndex(90, desc) === 4);
ok('valueIndex: iki strike arası enterpolasyon', D.valueIndex(102.5, desc) === 1.5 && D.valueIndex(97.5, desc) === 2.5, String(D.valueIndex(102.5, desc)));
ok('valueIndex: aralık dışı / null / boş → null', D.valueIndex(111, desc) === null && D.valueIndex(89, desc) === null && D.valueIndex(null, desc) === null && D.valueIndex(100, []) === null);
ok('valueIndex: tek satır', D.valueIndex(50, [{ k: 50, callOi: 0, putOi: 0, callVol: 0, putVol: 0 }]) === 0);
ok('rowY: satır merkezi (top 22, h 22)', D.rowY(0) === 33 && D.rowY(1.5) === 66, `${D.rowY(0)} ${D.rowY(1.5)}`);
ok('nearestIndex: spot 100 → 2, 102.6 → 1 (105 yakın)', D.nearestIndex(desc, 100) === 2 && D.nearestIndex(desc, 102.6) === 1);
ok('nearestIndex: eşitlikte üst satır (105)', D.nearestIndex(desc, 102.5) === 1);
ok('nearestIndex: boş → −1', D.nearestIndex([], 100) === -1);
ok('ladderHeight: 5 satır = 22 + 110 + 8', D.ladderHeight(5) === 140);
// viewH 110, içerik 140 → maxY 30
ok('scrollTargetY: spot 100 ortaya (22)', D.scrollTargetY(desc, 100, 110) === 22, String(D.scrollTargetY(desc, 100, 110)));
ok('scrollTargetY: en üst strike → 0 (kırpılır)', D.scrollTargetY(desc, 110, 110) === 0);
ok('scrollTargetY: en alt strike → maxY (30)', D.scrollTargetY(desc, 90, 110) === 30);
ok('scrollTargetY: içerik görünümden küçük → 0', D.scrollTargetY(desc, 100, 500) === 0);
ok('scrollTargetY: boş → 0', D.scrollTargetY([], 100, 110) === 0);
const mf = D.markerFracs({ spot: 100, callWall: 105, putWall: null, flip: 130, maxPain: 102.5 }, desc);
const mfOf = (k: string) => mf.find(x => x.key === k)!.f;
ok('markerFracs: spot 2, call duvarı 1, put duvarı null', mfOf('spot') === 2 && mfOf('callWall') === 1 && mfOf('putWall') === null);
ok('markerFracs: aralık dışı flip null, max pain 1.5 (enterpolasyon)', mfOf('flip') === null && mfOf('maxPain') === 1.5);

// ───── 7) Zincir kural yorumu (interpretChain) ─────
{
  const NOM = { spot: null, callWall: null, putWall: null, flip: null, maxPain: null } as D.Markers;
  const rowsZ = [{ k: 95, callOi: 100, putOi: 500, callVol: 0, putVol: 0 }, { k: 100, callOi: 500, putOi: 400, callVol: 0, putVol: 0 }, { k: 105, callOi: 2000, putOi: 50, callVol: 0, putVol: 0 }];
  const up = Y.interpretChain({ spot: 100, rows: rowsZ, marks: { spot: 100, callWall: 105, putWall: 95, flip: 98, maxPain: 104 }, sumCallOi: 5000, sumPutOi: 2000 });
  ok('chain: call OI ağır (P/C 0,4) + spot max pain altında → yukarı, güven orta', up.bias === 'yukarı' && up.confidence === 'orta' && up.summary.includes('Yukarı'), JSON.stringify(up));
  ok('chain: madde sayısı ≤ 5, son madde yasal not', up.bullets.length <= 5 && up.bullets.at(-1) === 'Yatırım tavsiyesi değildir.');
  ok('chain: gamma flip ve max pain maddesi (yaklaşık / kanıtlanmamış dili)', up.bullets.some(b => b.includes('gamma flip') && b.includes('yaklaşık')) && up.bullets.some(b => b.includes('Max pain')));
  const dn = Y.interpretChain({ spot: 90, rows: rowsZ, marks: { spot: 90, callWall: 105, putWall: 95, flip: null, maxPain: 85 }, sumCallOi: 1000, sumPutOi: 3000 });
  ok('chain: put OI ağır (P/C 3) + spot put duvarının altı + max pain altı → aşağı', dn.bias === 'aşağı' && dn.bullets.some(b => b.includes('put duvarı') && b.includes('altında')), JSON.stringify(dn));
  const between = Y.interpretChain({ spot: 100, rows: rowsZ, marks: { spot: 100, callWall: 105, putWall: 95, flip: null, maxPain: 100 }, sumCallOi: 1000, sumPutOi: 1000 });
  ok('chain: dengeli OI, iki duvar arası, max pain spota yakın → kararsız', between.bias === 'kararsız' && between.bullets.some(b => b.includes('iki duvar arasında')), JSON.stringify(between.bias));
  ok('chain: güven yüksek olamaz (zayıf sinyal kuralı)', up.confidence !== 'yüksek' && dn.confidence !== 'yüksek');
  const empty = Y.interpretChain({ spot: 100, rows: [], marks: NOM, sumCallOi: 0, sumPutOi: 0 });
  ok('chain: OI yok → kararsız, düşük, çökmez', empty.bias === 'kararsız' && empty.confidence === 'düşük' && empty.summary === 'Yeterli zincir verisi yok.');
  const noMarks = Y.interpretChain({ spot: 100, rows: rowsZ, marks: { ...NOM, spot: 100 }, sumCallOi: 2000, sumPutOi: 1000 });
  ok('chain: duvar/max pain/flip eksik → çökmez, güven düşük', noMarks.confidence === 'düşük' && noMarks.bullets.some(b => b.includes('hesaplanamadı')) && noMarks.bullets.length <= 5, JSON.stringify(noMarks));
  const noSpot = Y.interpretChain({ spot: null, rows: rowsZ, marks: NOM, sumCallOi: 2000, sumPutOi: 1000 });
  ok('chain: spot yok → kararsız, düşük', noSpot.bias === 'kararsız' && noSpot.confidence === 'düşük');
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm radar-detay testleri geçti');
if (fail) process.exit(1);
