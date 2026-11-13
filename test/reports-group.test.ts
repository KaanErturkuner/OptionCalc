// Raporlar ekranı gruplama: gün klasörü etiketi, Türkçe haftanın günü, kutu saatleri (kış/yaz), sıralama, örnek sayısı.
import * as G from '../src/lib/reports/group.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

ok('gün etiketi: 13/11/26 Cuma Raporları', G.dayFolderLabel('2026-11-13') === '13/11/26 Cuma Raporları', G.dayFolderLabel('2026-11-13'));
ok('haftanın günü: 14 Kas Cumartesi', G.weekdayTr('2026-11-14') === 'Cumartesi');
ok('haftanın günü: 15 Kas Pazar', G.weekdayTr('2026-11-15') === 'Pazar');

// Kış (EST): 17:00 / 18:00 / 19:00 / 20:00 İst, gün sonu ayrı etiket
ok('kış: piyasa öncesi 17:00 Raporu', G.reportBoxTitle('premarket', '2026-11-13') === '17:00 Raporu', G.reportBoxTitle('premarket', '2026-11-13'));
ok('kış: açılış +30 dk 18:00 Raporu', G.reportBoxTitle('intra1', '2026-11-13') === '18:00 Raporu');
ok('kış: açılış +1,5 sa 19:00 Raporu', G.reportBoxTitle('intra2', '2026-11-13') === '19:00 Raporu');
ok('kış: açılış +2,5 sa 20:00 Raporu', G.reportBoxTitle('intra3', '2026-11-13') === '20:00 Raporu');
ok('gün sonu: "Gün Sonu Raporu"', G.reportBoxTitle('eod', '2026-11-13') === 'Gün Sonu Raporu');
// Yaz (EDT): 16:00 İst başlar — kutu saati slottan gelir, üretim anından değil
ok('yaz: piyasa öncesi 16:00 Raporu', G.reportBoxTitle('premarket', '2026-07-06') === '16:00 Raporu', G.reportBoxTitle('premarket', '2026-07-06'));

// Gruplama: gün yeni → eski; gün içi tür sırası; aynı türde gerçek önce, örnek sonra
{
  const items: G.GroupableReport[] = [
    { id: 1, kind: 'eod', day: '2026-11-13', ts: 0, title: 'g', body: '' },
    { id: 2, kind: 'premarket', day: '2026-11-13', ts: 0, title: 'o', body: '', example: true },
    { id: 3, kind: 'premarket', day: '2026-11-13', ts: 0, title: 'r', body: '' },
    { id: 4, kind: 'intra1', day: '2026-11-16', ts: 0, title: 'x', body: '' },
  ];
  const g = G.groupByDay(items);
  ok('gruplar: en yeni gün önce', g.length === 2 && g[0].day === '2026-11-16' && g[1].day === '2026-11-13', JSON.stringify(g.map(x => x.day)));
  const d13 = g[1];
  ok('gün 13: sayı ve örnek adedi', d13.count === 3 && d13.examples === 1, JSON.stringify({ c: d13.count, e: d13.examples }));
  ok('gün 13: sıra premarket(gerçek), premarket(örnek), eod', d13.items.map(x => x.id).join(',') === '3,2,1', d13.items.map(x => x.id).join(','));
  ok('kutu başlığı: 17:00 Raporu (örnek de aynı saat)', d13.items[0].boxTitle === '17:00 Raporu' && d13.items[1].example === true);
  ok('kutu başlığı: gün sonu', d13.items[2].boxTitle === 'Gün Sonu Raporu');
  ok('gerçek rapor example=false', d13.items[0].example === false);
}
ok('boş liste → boş gruplar', G.groupByDay([]).length === 0);

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\nreports-group testleri tamam');
