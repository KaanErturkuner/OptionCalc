// Seans rejimi (regime.ts), ara rapor senaryoları (intra.ts) ve Sonuç kartı rejim kuralı (verdict.ts). Sentetik 1 dk barlar; ağ YOK.
import * as RG from '../src/lib/market/regime.ts';
import * as IV from '../src/lib/reports/intra.ts';
import * as V from '../src/lib/signals/verdict.ts';
import * as TR from '../src/lib/signals/trade.ts';
import { fmt } from '../src/lib/format.ts';

const lvTxt = (x: number) => fmt(x, x % 1 ? 2 : 0);

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

// Kış günü: 09:30 ET = 14:30 UTC
const DAY = '2026-11-16';
const SS = Date.parse(`${DAY}T14:30:00Z`);
const MIN = 60000;

/** Fiyat yolundan 1 dk barlar. vol(i) her dakika hacmi (varsayılan 1000). */
function tape(prices: number[], vol: (i: number) => number = () => 1000): RG.TapeBar[] {
  return prices.map((c, i) => {
    const o = i ? prices[i - 1] : c;
    return { t: SS + i * MIN, o, h: Math.max(o, c) + 0.02, l: Math.min(o, c) - 0.02, c, v: vol(i) };
  });
}
/** Doğrusal yol: a → b, n dk */
const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i + 1) / n);
/** Dalgalı yol: merkez ± genlik, n dk (sinüs benzeri, deterministik) */
const wave = (mid: number, amp: number, n: number) => Array.from({ length: n }, (_, i) => mid + amp * Math.sin(i * 0.9));
const at = (min: number) => SS + min * MIN;

// ───── 1) Trend günü (sürekli yükseliş) ─────
{
  const p = [500, ...lin(500, 510, 240)];
  const b = tape(p);
  const r = RG.regimeAt(b, at(240), SS);
  ok('trend: sürekli yükseliş → trend_up', r.kind === 'trend_up' && r.dir === 'up', `kind=${r.kind} ${r.reason}`);
  ok('trend: bant (pencere) mevcut, üst > alt', !!r.band && r.band.high > r.band.low);
  ok('trend: VWAP fiyatın altında (yükseliş)', r.vwap != null && r.last != null && r.vwap < r.last);
  const ch = RG.regimeChanges(b, SS, at(240));
  ok('trend: değişim listesi trend_up ile biter', ch.length > 0 && ch[ch.length - 1].kind === 'trend_up', JSON.stringify(ch));
  const down = tape([500, ...lin(500, 490, 240)]);
  ok('trend: sürekli düşüş → trend_down', RG.regimeAt(down, at(240), SS).kind === 'trend_down');
}

// ───── 2) Konsolidasyon: 90 dk yükseliş, sonra 75 dk dar bant, hacim düşüyor, VWAP etrafında salınım ─────
{
  const p = [500, ...lin(500, 505, 90), ...wave(504.9, 0.25, 75)];
  const vol = (i: number) => (i < 90 ? 2000 : 500);
  const b = tape(p, vol);
  const r = RG.regimeAt(b, at(165), SS);
  ok('konsolidasyon: dar bant + hacim düşüşü → konsolidasyon', r.kind === 'konsolidasyon', `kind=${r.kind} ${r.reason}`);
  ok('konsolidasyon: bant seviyeleri var', !!r.band && r.band.high > r.band.low);
  ok('konsolidasyon: etiket bant kırılımını söyler', r.label.includes('bant kırılımı'));
  const it = IV.intraView([{ ticker: 'QQQ', bars: b }], at(165), SS);
  ok('konsolidasyon: görünüm BEKLE (eski yön yok)', it?.bias === 'BEKLE', JSON.stringify(it?.bias));
  ok('konsolidasyon: plan bant üstü CALL / altı PUT', !!it && it.plan.includes('CALL') && it.plan.includes('PUT'), it?.plan);
  ok('konsolidasyon: devam tetikleyicisi bant üstü seviyesini içerir', !!it && it.scenarios[0].trigger.includes(`${lvTxt(r.band!.high)} üstü`), it?.scenarios[0].trigger);
}

// ───── 3) V-dönüşü: 60 dk düşüş (500 → 490), yüksek hacimli dip mumu ve toparlanma; ONAYLI yukarı dönüş ─────
{
  const down = lin(500, 490, 60);
  const dip = [487, 489, 491, 492.5];                          // dip: uzun alt fitil (487) + yukarı kapanış → yüksek hacimli boğa mumu (5 dk)
  const up = lin(492.5, 497.5, 12);                            // teyitler son 30 dk içinde aranır: kontrol dipten 16 dk sonra
  const p = [500, ...down, ...dip, ...up];
  const vol = (i: number) => (i >= 60 && i < 65 ? 6000 : 1000);
  const b = tape(p, vol);
  const t = SS + (p.length - 1) * MIN;
  const r = RG.regimeAt(b, t, SS);
  ok('V-dönüşü: ters hareket ≥ %0,3 ve teyit ≥2 → donus_up', r.kind === 'donus_up' && r.dir === 'up', `kind=${r.kind} ${r.reason}`);
  ok('V-dönüşü: teyitler (VWAP/hacim/yapı) listelenir', !!r.reversal && r.reversal.signals.length >= 2, JSON.stringify(r.reversal));
  const it = IV.intraView([{ ticker: 'QQQ', bars: b }], t, SS);
  ok('V-dönüşü: görünüm CALL (eski düşüş yönü yok)', it?.bias === 'CALL', String(it?.bias));
  const card = V.buildVerdict({
    inputs: { S: 497.5, vwap: 495, orHigh: null, orLow: null, flip: null, callWall: null, putWall: null, emMove: null, pcVol: 1.6, unusualCall: 0, unusualPut: 0,
      momentum: -1, regime: { kind: 'donus_up', dir: 'up', band: null } },
    expiries: [{ date: '2026-11-16', dte: 0 }], nowMs: at(95), quotesFor: () => null, dOf: () => null,
  });
  ok('V-dönüşü: Sonuç kartı eski PUT yönünü sürdürmez', card.dir !== 'put', `dir=${card.dir} puan=${card.sum}`);
}
{
  // Eski yön PUT, onaylı yukarı dönüş → kart PUT veremez
  const cr = V.applyRegime({ dir: 'put', strength: 3, sum: -3, crits: [], fired: [] }, { kind: 'donus_up', dir: 'up', band: null });
  ok('dönüş kuralı: PUT puanı + onaylı yukarı dönüş → bekle', cr.t.dir === 'bekle' && (cr.note ?? '').includes('onaylı yukarı'), String(cr.note));
  const keep = V.applyRegime({ dir: 'call', strength: 3, sum: 3, crits: [], fired: [] }, { kind: 'donus_up', dir: 'up', band: null });
  ok('dönüş kuralı: CALL puanı + yukarı dönüş → korunur', keep.t.dir === 'call' && keep.note == null);
}

// ───── 4) VWAP geri alma: 40 dk VWAP altında kalış, sonra VWAP üstüne geçiş ─────
{
  const p = [500, ...wave(499.2, 0.2, 40), ...lin(499.2, 500.6, 20)];
  const vol = (i: number) => (i < 41 ? 1500 : 1000);
  const b = tape(p, vol);
  const r = RG.regimeAt(b, SS + (p.length - 1) * MIN, SS);
  const sig = r.reversal?.signals ?? [];
  ok('VWAP geri alma: teyit listesinde "VWAP geri alındı" (uzun altta kalış + geçiş)', sig.some(s => s.includes('VWAP geri alındı')) || r.kind !== 'donus_up', JSON.stringify(sig));
  const short = RG.detectReversal(b.slice(0, 20), RG.vwapSeries(b.slice(0, 20)), SS + 19 * MIN);
  ok('VWAP geri alma: 20 dk veriyle teyit yok (yetersiz pencere)', short === null || short.status === 'aday');
}

// ───── 5) Erken seans / yetersiz veri ─────
{
  const b = tape([500, ...lin(500, 500.4, 19)]);
  const r = RG.regimeAt(b, at(20), SS);
  ok('erken: 20 dk seans → erken (yön yorumu yok)', r.kind === 'erken' && r.dir === null, r.kind);
  ok('erken: boş veri → erken', RG.regimeAt([], at(60), SS).kind === 'erken');
  const it = IV.intraView([{ ticker: 'QQQ', bars: b }], at(20), SS);
  ok('erken: görünüm bias null (eğilim kuralına düşer)', it?.bias === null);
}

// ───── 6) Yardımcılar: ATR, VWAP, yeniden örnekleme ─────
{
  const b = tape([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
  const five = RG.resample5(b);
  ok('resample5: 11 dk → 3 mum (5/5/1 dk)', five.length === 3 && five[0].v === 5000 && five[2].v === 1000, String(five.length));
  ok('atr: en az 5 aralık yoksa null', RG.atrOf(five) === null);
  const bigger = RG.resample5(tape(Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i) * 0.5)));
  const a = RG.atrOf(bigger);
  ok('atr: pozitif sayı', a != null && a > 0, String(a));
  const vw = RG.vwapSeries(tape([10, 20], () => 1000));
  ok('vwap: ilk bar tipik fiyat, ikinci bar ağırlıklı ortalama', Math.abs(vw[0] - (10.02 + 9.98 + 10) / 3) < 1e-9 && vw[1] > vw[0]);
}

// ───── 7) Senaryo olasılıkları: tam sayı, toplam 100, tüm rejimler / yönler / taraflar ─────
{
  const kinds = Object.keys(IV.BASE) as RG.RegimeKind[];
  let allSum = true, allInt = true;
  for (const k of kinds) for (const d of ['up', 'down'] as RG.Dir[]) for (const side of [null, 1, -1]) {
    const vwap = 100, last = side == null ? null : vwap + side;
    const [a, b, c] = IV.scenarioPcts(k, d, last, last == null ? null : vwap);
    if (a + b + c !== 100) allSum = false;
    if (![a, b, c].every(Number.isInteger)) allInt = false;
  }
  ok('olasılık: her rejim × yön × VWAP tarafı → toplam 100', allSum);
  ok('olasılık: tam sayı', allInt);
  ok('normalize100: 1/1/1 → 34/33/33 (toplam 100)', IV.normalize100([1, 1, 1]).join() === '34,33,33');
  ok('normalize100: sıfır toplam → 34,33,33 (toplam 100)', IV.normalize100([0, 0, 0]).join() === '34,33,33');
  const [d1] = IV.scenarioPcts('konsolidasyon', 'up', 101, 100);
  const [d0] = IV.scenarioPcts('konsolidasyon', 'up', 99, 100);
  ok('olasılık: VWAP yön tarafındaysa devam, değilse dönüş artar', d1 > d0);
}

// ───── 8) Ara görünüm: tetikleyiciler ve özet ─────
{
  const p = [500, ...lin(500, 510, 240)];
  const it = IV.intraView([{ ticker: 'QQQ', bars: tape(p) }], at(240), SS)!;
  ok('görünüm: senaryo toplamı 100', it.scenarios.reduce((a, s) => a + s.pct, 0) === 100);
  ok('görünüm: devam/dönüş/yatay etiketleri', it.scenarios.map(s => s.key).join() === 'devam,donus,yatay');
  ok('görünüm: yükseliş devamı CALL tetikleyicisi', it.scenarios[0].trigger.includes('CALL'), it.scenarios[0].trigger);
  ok('görünüm: özet satırları (açılış, yüksek/dip, VWAP, rejim)', it.recap.length >= 4 && it.recap[0].startsWith('Açılış') && it.recap.some(x => x.startsWith('VWAP')), it.recap.join(' | '));
  ok('görünüm: method kural tabanlı', it.method.includes('kural tabanlı'));
  ok('görünüm: bar yoksa null', IV.intraView([], at(240), SS) === null);
}

// ───── 9) Fırsat kartı (BEKLE) bant tetikleyicisi ─────
{
  const card = V.buildVerdict({
    inputs: { S: 504, vwap: 504.5, orHigh: null, orLow: null, flip: null, callWall: null, putWall: null, emMove: null, pcVol: null, unusualCall: 0, unusualPut: 0,
      momentum: null, regime: { kind: 'konsolidasyon', dir: 'up', band: { high: 505.2, low: 504.6 } } },
    expiries: [{ date: '2026-11-16', dte: 0 }], nowMs: at(120), quotesFor: () => null, dOf: () => null,
  });
  ok('Sonuç: konsolidasyonda yön bekle', card.dir === 'bekle');
  ok('Sonuç: "Bekle – bant kırılımı" + bant seviyeleri (505,20 / 504,60)', (card.regime ?? '').startsWith('Bekle – bant kırılımı') && (card.regime ?? '').includes('505,20') && (card.regime ?? '').includes('504,60'), card.regime ?? '');
  const board = TR.triggerText('QQQ', card);
  ok('Fırsat BEKLE tetikleyicisi: bant üstü → CALL, altı → PUT', board.includes('bant üstü') && board.includes('CALL') && board.includes('bant altı') && board.includes('PUT'), board);
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nregime: tümü geçti');
if (fail) process.exit(1);
