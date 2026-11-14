// Önceki kapanış (tarihsel EOD) zinciri → rapor girdisi: en yakın vade duvarı, OI × orta fiyat birikimi, etiketli başlıklar,
// "açılış anı yok" dürüstlüğü ve canlı (basis'siz) çıktının değişmemesi. Ağ YOK.
import { histSnapshot, midOf } from '../src/lib/reports/histchain.ts';
import { buildReport, wallLine } from '../src/lib/reports/text.ts';
import type { ChainRow } from '../src/lib/flow/detect.ts';
import type { ReportInput } from '../src/lib/reports/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const row = (p: Partial<ChainRow> & Pick<ChainRow, 'expiry' | 'side' | 'strike'>): ChainRow => ({
  occ: `QQQ${p.expiry}${p.side}${p.strike}`, ticker: 'QQQ', volume: 0, oi: 0, bid: 0, ask: 0, last: 0, updated: 0, underlying: 580, ...p,
} as ChainRow);

// 1) orta fiyat
ok('mid: bid/ask ortalaması', midOf({ bid: 1, ask: 1.2, last: 9 }) === 1.1);
ok('mid: bid/ask yoksa son işlem', midOf({ bid: 0, ask: 0, last: 0.5 }) === 0.5);
ok('mid: hiç fiyat yok → null', midOf({ bid: 0, ask: 0, last: 0 }) === null);

// 2) duvar: reportDay'den sonraki en yakın vade; birikim: OI × mid × 100, ticker başına en çok 2
const rows: ChainRow[] = [
  row({ expiry: '2026-11-13', side: 'call', strike: 585, oi: 9000, bid: 1, ask: 1.2 }),   // 0DTE call duvarı adayı
  row({ expiry: '2026-11-13', side: 'put', strike: 570, oi: 8000, bid: 2, ask: 2.2 }),
  row({ expiry: '2026-11-13', side: 'call', strike: 590, oi: 0, bid: 1, ask: 1.1 }),     // OI 0 → birikime girmez
  row({ expiry: '2026-11-20', side: 'call', strike: 600, oi: 50000, bid: 0.5, ask: 0.6 }), // daha uzak vade, duvar için kullanılmaz
  row({ expiry: '2026-11-13', side: 'call', strike: 580, oi: 100, bid: 0, ask: 0, last: 0 }), // fiyatsız → birikime girmez
];
const snap = histSnapshot(rows, '2026-11-13', Date.parse('2026-11-12T21:00:00Z'));
ok('duvar: en yakın vade (13/11) üzerinde', snap.wall != null && snap.wall.expiry === '2026-11-13', JSON.stringify(snap.wall));
ok('duvar: call duvarı = en büyük call OI (585)', snap.wall?.callWall === 585, String(snap.wall?.callWall));
ok('duvar: put duvarı = 570', snap.wall?.putWall === 570, String(snap.wall?.putWall));
ok('duvar: spot satırdan (580)', snap.wall?.spot === 580, String(snap.wall?.spot));
const top = snap.flow.map(f => `${f.side}${f.strike}@${f.expiry}`);
ok('birikim: OI 0 ve fiyatsız satır yok', !snap.flow.some(f => f.contracts === 0) && snap.flow.length === 2, JSON.stringify(top));
ok('birikim: premium = OI × mid × 100 (570 put: 8000×2.1×100)', Math.abs((snap.flow.find(f => f.strike === 570)?.premium ?? 0) - 1680000) < 1e-6, JSON.stringify(top));
ok('birikim: 585 call (990k) top-2 dışında kalır (600 call 2.75M, 570 put 1.68M)', !snap.flow.some(f => f.strike === 585));
ok('birikim: 50k OI’li uzak vade (20/11) ticker top-2’ye girer', snap.flow.some(f => f.expiry === '2026-11-20'), JSON.stringify(top));

// 3) etiketli duvar satırı: açılış anı yok → kayma yazılmaz; önceki kapanış etiketi ile kayma
const w = (callWall: number): NonNullable<ReportInput['walls'][number]['now']> => ({ spot: 580, callWall, putWall: 570, flip: 578, maxPain: 580, expiry: '2026-11-13', at: 0 });
const lineNoOpen = wallLine('QQQ', null, w(585));
ok('duvar satırı: açılış yok → kayma parantezi yok', !lineNoOpen.includes('['), lineNoOpen);
const lineShift = wallLine('QQQ', w(580), w(585), '12/11');
ok('duvar satırı: etiket "12/11" ve kayma ↑5', lineShift.includes('[12/11 580 (↑5)]') || lineShift.includes('[12/11 580 ↑5]'), lineShift);
ok('duvar satırı: etiket verilince "açılış" geçmez', !lineShift.includes('açılış'), lineShift);

// 4) rapor: önceki kapanış temelli intra → etiketli başlıklar, Gözlem yok, canlı başlık yok
const base = (kind: 'intra1' | 'eod'): ReportInput => ({
  kind, day: '2026-11-13', nowMs: Date.parse(kind === 'eod' ? '2026-11-14T00:30:00+03:00' : '2026-11-13T18:00:00+03:00'),
  watch: ['QQQ'], asia: [], europe: [], futures: [], preMarket: [], moves: [{ name: 'QQQ', pct: 0.4, price: 582 }, { name: 'SPY', pct: 0.3, price: 650 }],
  walls: [], flow: [], news: [], newsOk: true, macro: { today: [], tomorrow: [] }, earnings: [], sma: [], failures: [], flowKnown: true,
});
{
  const intra = base('intra1');
  intra.walls = [{ ticker: 'QQQ', open: null, now: w(585) }];
  intra.flow = snap.flow;
  intra.basis = { wallsHead: 'Duvarlar — önceki kapanış (12/11) zincirine göre (açılış anı yok; kayma ölçülemez)', flowHead: 'Opsiyon birikimi — önceki kapanış (12/11) zincirine göre (en büyük açık pozisyon)' };
  const body = buildReport(intra).body;
  ok('intra(basis): duvar başlığı 12/11 etiketli', body.includes('önceki kapanış (12/11) zincirine göre (açılış anı yok'), body);
  ok('intra(basis): birikim başlığı 12/11 etiketli', body.includes('Opsiyon birikimi — önceki kapanış (12/11)'));
  ok('intra(basis): "Gözlem" notu yazılmaz (spot önceki kapanış)', !body.includes('\nGözlem'));
  ok('intra(basis): canlı "Duvarlar (açılış → şimdi)" başlığı yok', !body.includes('Duvarlar (açılış → şimdi)'));
  ok('intra(basis): "intraday" gibi sunulmaz — kayma satırı yok', !body.includes('[açılış'));
}
{
  // Canlı (basis'siz) intra: eski başlıklar ve Gözlem davranışı korunur
  const live = base('intra1');
  live.walls = [{ ticker: 'QQQ', open: w(580), now: w(585) }];
  const body = buildReport(live).body;
  ok('canlı intra: başlık "Duvarlar (açılış → şimdi)" korunur', body.includes('Duvarlar (açılış → şimdi)'));
  ok('canlı intra: kayma "[açılış 580 ↑5]" korunur', body.includes('[açılış 580'), body);
}
{
  // EOD: 12/11 → 13/11 kayma; 13/11 zinciri yoksa "veri alınamadı" + dürüst not
  const eodFull = base('eod');
  eodFull.walls = [{ ticker: 'QQQ', open: w(580), now: w(585) }];
  eodFull.basis = { wallsHead: 'Duvar kayması — önceki kapanış (12/11) → gün sonu (13/11) zincirine göre', openLabel: '12/11', flowHead: 'Opsiyon birikimi — önceki kapanış (12/11) zincirine göre (en büyük açık pozisyon)' };
  const b1 = buildReport(eodFull).body;
  ok('eod(basis): kayma etiketi "12/11" ve ↑5', b1.includes('[12/11 580 (↑5)]') || b1.includes('[12/11 580 ↑5]'), b1);
  const eodNone = base('eod');
  eodNone.walls = [{ ticker: 'QQQ', open: w(580), now: null }];
  eodNone.basis = { wallsHead: 'Duvar kayması — önceki kapanış (12/11) → gün sonu (13/11) zincirine göre', openLabel: '12/11', flowHead: 'x' };
  eodNone.failures = ['13/11 gün sonu zinciri yok: duvar kayması ölçülemez'];
  const b2 = buildReport(eodNone).body;
  ok('eod(basis, 13/11 yok): duvar satırı "veri alınamadı"', b2.includes('QQQ: veri alınamadı'), b2);
  ok('eod(basis, 13/11 yok): dürüst not düşer', b2.includes('duvar kayması ölçülemez'));
}
{
  // Canlı EOD başlığı korunur (basis yok)
  const live = base('eod');
  live.walls = [{ ticker: 'QQQ', open: w(580), now: w(585) }];
  ok('canlı eod: "Duvar kayması (açılış → kapanış)" korunur', buildReport(live).body.includes('Duvar kayması (açılış → kapanış)'));
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm reports-hist testleri geçti');
if (fail) process.exit(1);
