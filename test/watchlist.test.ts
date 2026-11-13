// Takip listesi saf mantığı: OCC sembolü, P/L, vade durumu, ekleme/yineleme, yenileme eşlemesi, bacak → kalem. Ağ YOK.
import * as W from '../src/lib/watchlist/model.ts';
import * as PL from '../src/lib/watchlist/pl.ts';
import * as R from '../src/lib/watchlist/refresh.ts';
import * as B from '../src/lib/watchlist/build.ts';
import * as V from '../src/lib/watchlist/view.ts';
import { mkLeg } from '../src/lib/state.ts';
import type { Chain } from '../src/lib/market/types.ts';
import type { WatchItem } from '../src/lib/watchlist/model.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const pending: Promise<void>[] = [];

// ───── 1) OCC sembolü ─────
ok('OCC SPCX P 130 20.11.2026', W.occSymbol('SPCX', '2026-11-20', 'put', 130) === 'SPCX261120P00130000', W.occSymbol('SPCX', '2026-11-20', 'put', 130));
ok('OCC QQQ C 585.5', W.occSymbol('QQQ', '2026-11-20', 'call', 585.5) === 'QQQ261120C00585500');
ok('OCC geçersiz strike reddedilir', (() => { try { W.occSymbol('QQQ', '2026-11-20', 'call', 0); return false; } catch { return true; } })());
ok('OCC geçersiz sembol reddedilir', (() => { try { W.occSymbol('qq qq', '2026-11-20', 'call', 1); return false; } catch { return true; } })());

// ───── 2) Kâr/zarar ─────
const pl1 = PL.optionPL(2.5, 3.1, 2);            // long, 2 kontrat
ok('long P/L toplam = (3.1-2.5)*2*100 = 120', near(pl1.total, 120), String(pl1.total));
ok('long P/L % = 24', near(pl1.pct!, 24), String(pl1.pct));
const pl2 = PL.optionPL(2.5, 1.5, 1, -1);        // short: fiyat düşünce kâr
ok('short P/L toplam = +100', near(pl2.total, 100), String(pl2.total));
ok('giriş 0 → % null', PL.optionPL(0, 1, 1).pct === null);
ok('toplam: fiyatsız kalem sayılmaz', near(PL.sumPL([{ total: 50 }, { total: null }, { total: -20 }]), 30));

// ───── 3) Vade durumu / gün sayısı (İstanbul) ─────
const NOV13 = Date.parse('2026-11-13T15:00:00Z'); // 13 Kasım 15:00 UTC = 18:00 TR, seans açık (ET 10:00)
ok('vade açık', !W.isExpired('2026-11-20', NOV13));
ok('vade dolu (geçmiş gün)', W.isExpired('2026-11-10', NOV13));
ok('vade günü 16:00 ET sonrası dolu', W.isExpired('2026-11-13', Date.parse('2026-11-13T21:01:00Z')));  // 16:01 EST
ok('vade günü 16:00 ET öncesi açık', !W.isExpired('2026-11-13', Date.parse('2026-11-13T20:59:00Z')));
ok('gün sayısı: 2 gün 3 saat → 2', W.daysSince('2026-11-11T12:00:00Z', NOV13) === 2, String(W.daysSince('2026-11-11T12:00:00Z', NOV13)));
ok('İstanbul saati UTC+3', W.istanbulStamp(Date.parse('2026-11-13T12:30:00Z')) === '13.11 15:30', W.istanbulStamp(Date.parse('2026-11-13T12:30:00Z')));
ok('İstanbul saati yıl ile', W.istanbulStamp(Date.parse('2026-11-13T12:30:00Z'), true) === '13.11.2026 15:30');

// ───── 4) Ekleme ve yineleme ─────
const base: W.NewItem = { symbol: 'SPCX', expiry: '2026-11-20', strike: 130, type: 'put', side: 1, qty: 1, entry: 4.2, entrySrc: 'zincir', underlyingAdded: 135, };
const r1 = W.addItems([], [base, base], NOV13, () => 0.5);
ok('aynı çağrıda tekrar → 1 eklendi, 1 yineleme', r1.added === 1 && r1.dup === 1 && r1.list.length === 1, JSON.stringify([r1.added, r1.dup]));
const r2 = W.addItems(r1.list, [base, { ...base, qty: 3 }], NOV13, () => 0.7);
ok('listedeki kontrat tekrar eklenmez (qty farklı olsa da)', r2.added === 0 && r2.dup === 2 && r2.list.length === 1);
const r3 = W.addItems(r1.list, [{ ...base, side: -1 }], NOV13);
ok('yön farklıysa ayrı kalem', r3.added === 1);
const it = r1.list[0];
ok('yeni kalem son fiyatı = giriş primi', it.last?.premium === 4.2 && it.addedAt === new Date(NOV13).toISOString());
ok('dupKey farklı strike ayrı', W.dupKey(base) !== W.dupKey({ ...base, strike: 131 }));

// ───── 5) Yenileme eşlemesi (sahte zincir, ağ yok) ─────
const chain: Chain = {
  expiry: '2026-11-20', underlying: 128.5, calls: [],
  puts: [{ type: 'put', strike: 130, bid: 5.0, ask: 5.4, last: 5.1, iv: 0.6, volume: 1, oi: 1 }, { type: 'put', strike: 125, bid: 0, ask: 0, last: 0, iv: null, volume: 0, oi: 0 }],
};
const items: WatchItem[] = [
  W.makeItem(base, NOV13, () => 0.3),
  W.makeItem({ ...base, strike: 125, entry: 1, expiry: '2026-11-20' }, NOV13, () => 0.4),
  W.makeItem({ ...base, symbol: 'OLD', expiry: '2026-11-06' }, NOV13, () => 0.5),
];
const calls: string[] = [];
const fetchChain = async (sym: string, exp: string) => { calls.push(sym + '|' + exp); return { chain, provider: 'marketdata' }; };
const later = Date.parse('2026-11-14T15:00:00Z');
pending.push((async () => {
  const out = await R.refreshItems(items, fetchChain, later);
  ok('yenileme: tek (sembol,vade) için tek istek', calls.length === 1 && calls[0] === 'SPCX|2026-11-20', calls.join(','));
  ok('yenileme: vadesi dolan için istek yok', !calls.some(c => c.startsWith('OLD')));
  ok('yenileme: mid fiyat 5.2', out.items[0].last?.premium === 5.2, String(out.items[0].last?.premium));
  ok('yenileme: fiyatsız (0) kontrat → önceki değer korunur', out.items[1].last?.premium === 1, String(out.items[1].last?.premium));
  ok('yenileme: vadesi dolan kalem aynen', out.items[2] === items[2]);
  ok('yenileme: sayım', out.fetched === 1);
  const bad = await R.refreshItems([items[0]], async () => { throw new Error('Zaman aşımı'); }, later);
  ok('yenileme: hata → kalem korunur, mesaj', bad.items[0] === items[0] && bad.errors['SPCX|2026-11-20'] === 'Zaman aşımı');
})());

// ───── 6) Bacak → kalem ─────
const legs = [
  mkLeg('put', -1, 130, '2026-11-20', 40, 2, 4.2),
  { ...mkLeg('stock', 1, 0, '2026-11-20', 0, 100, null) },
  mkLeg('call', 1, 140, '2026-11-20', 35, 1, null),
];
const newItems = B.legsToItems(legs, 'SPCX', 135, l => l.premium ?? 3.3);
ok('bacak: hisse atlanır, 2 opsiyon', newItems.length === 2, String(newItems.length));
ok('bacak: short put → side −1, qty 2, girilen', newItems[0].side === -1 && newItems[0].qty === 2 && newItems[0].entrySrc === 'girilen' && newItems[0].entry === 4.2);
ok('bacak: primi boş → teorik', newItems[1].entrySrc === 'teorik' && newItems[1].entry === 3.3 && newItems[1].type === 'call');

// ───── 7) Satır görünümü ─────
const row = V.rowOf(W.makeItem(base, NOV13, () => 0.3), Date.parse('2026-11-16T15:00:00Z'));
ok('satır: OCC', row.occ === 'SPCX261120P00130000');
ok('satır: gün sayısı 3', row.days === 3, String(row.days));
ok('satır: vadesi açık', !row.expired);
const exRow = V.rowOf(W.makeItem({ ...base, expiry: '2026-11-06' }, NOV13, () => 0.3), later);
ok('satır: vadesi dolmuş işaretlenir', exRow.expired && exRow.pl !== null);
const tot = V.totals([V.rowOf(W.makeItem({ ...base, entry: 1 }, NOV13, () => 0.3), NOV13), V.rowOf({ ...W.makeItem(base, NOV13, () => 0.3), last: null }, NOV13)]);
ok('toplam: eksik fiyatlı kalem sayılır', tot.missing === 1 && near(tot.total, 0), JSON.stringify(tot));

Promise.all(pending).then(() => {
  console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm watchlist testleri geçti');
  if (fail) process.exit(1);
});
