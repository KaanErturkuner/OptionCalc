// Rapor zamanlaması (DST haftası, tatil, erken kapanış), metin üretimi (fixture) ve kaynak ayrıştırıcıları. Ağ YOK.
import { eventsOn } from '../src/lib/calendar/releases.ts';
import * as S from '../src/lib/reports/schedule.ts';
import * as T from '../src/lib/reports/text.ts';
import * as R from '../src/lib/reports/sources.ts';
import * as W from '../src/lib/reports/walls.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const ist = (ms: number) => S.istHm(ms);
const at = (day: string, kind: S.ReportKind) => S.slotsFor(day).find(s => s.kind === kind)!;

// ───── 1) Zamanlama: normal kış haftası (US EST, İst = UTC+3) ─────
{
  const d = '2026-11-16';                    // Pazartesi; US EST: açılış 09:30 ET = 17:30 İst
  ok('kış: 5 slot', S.slotsFor(d).length === 5);
  ok('kış: piyasa öncesi 17:00 İst', ist(at(d, 'premarket').atMs) === '17:00', ist(at(d, 'premarket').atMs));
  ok('kış: açılış +30 dk 18:00 İst', ist(at(d, 'intra1').atMs) === '18:00');
  ok('kış: açılış +1,5 sa 19:00 İst', ist(at(d, 'intra2').atMs) === '19:00');
  ok('kış: açılış +2,5 sa 20:00 İst', ist(at(d, 'intra3').atMs) === '20:00');
  ok('kış: gün sonu kapanış+30 dk = 00:30 İst (ertesi gün)', ist(at(d, 'eod').atMs) === '00:30', ist(at(d, 'eod').atMs));
}
// ───── 2) DST uyumsuzluk haftası: US EDT (8 Mar–1 Kas), Istanbul sabit: açılış 16:30 İst ─────
{
  const d = '2026-03-16';                    // US EDT, Avrupa henüz CET (29 Mart'ta değişir)
  ok('DST uyumsuz hafta: piyasa öncesi 16:00 İst', ist(at(d, 'premarket').atMs) === '16:00', ist(at(d, 'premarket').atMs));
  ok('DST uyumsuz hafta: açılış +30 dk 17:00 İst', ist(at(d, 'intra1').atMs) === '17:00');
  ok('DST uyumsuz hafta: gün sonu 23:30 İst (kapanış 23:00 + 30)', ist(at(d, 'eod').atMs) === '23:30', ist(at(d, 'eod').atMs));
  const kis = '2026-11-16';
  ok('yaz/kış farkı: aynı slot kış ile yazda 1 saat kayar (pre 16:00 vs 17:00)', ist(at(d, 'premarket').atMs) !== ist(at(kis, 'premarket').atMs));
}
// ───── 3) Tatil ve hafta sonu ─────
{
  ok('Şükran Günü (26 Kas 2026): rapor yok', S.slotsFor('2026-11-26').length === 0);
  ok('Cumartesi: rapor yok', S.slotsFor('2026-11-14').length === 0);
  ok('Noel (25 Ara 2026, Cuma): rapor yok', S.slotsFor('2026-12-25').length === 0);
}
// ───── 4) Erken kapanış (13:00 ET) ─────
{
  ok('Şükran ertesi (27 Kas 2026) erken kapanış', S.isEarlyClose('2026-11-27'));
  const eod = at('2026-11-27', 'eod').atMs;
  ok('erken kapanış: gün sonu 13:30 ET = 21:30 İst', ist(eod) === '21:30', ist(eod));
  ok('24 Aralık (Perşembe) erken kapanış', S.isEarlyClose('2026-12-24'));
  ok('normal gün erken kapanış değil', !S.isEarlyClose('2026-11-16'));
  ok('erken kapanış günü: intra3 hâlâ açılıştan 2,5 sa sonra (12:00 ET)', ist(at('2026-11-27', 'intra3').atMs) === '20:00');
}
// ───── 5) Vakti gelen slotlar (grace) ─────
{
  const d = '2026-11-16';
  const pre = at(d, 'premarket').atMs, i3 = at(d, 'intra3').atMs, i2 = at(d, 'intra2').atMs;
  ok('pre tam zamanında vakti gelmiş', S.dueSlots(pre + 60000).map(s => s.kind).join() === 'premarket');
  ok('vakti gelmemiş: pre öncesi hiçbir slot yok', S.dueSlots(pre - 60000).length === 0);
  ok('intra2 yeniden başlatmada 45 dk+ gecikmişse atlanır', !S.dueSlots(i3 + 60000).some(s => s.kind === 'intra2') && i2 < i3 - 45 * 60000);
  ok('intra3 vakti: yalnız intra3', S.dueSlots(i3 + 60000).map(s => s.kind).join() === 'intra3');
}

// ───── 6) Beklenti kuralları ─────
{
  const up = T.openBias([{ name: 'ES', pct: 1 }, { name: 'NQ', pct: 1 }], [{ name: 'N', pct: 0.5 }]);
  ok('vadeli +1 → yukarı açılış eğilimi', up?.label === 'yukarı açılış eğilimi', JSON.stringify(up));
  ok('veri yok → null', T.openBias([], []) === null);
  ok('seans yönü: yatay (ortalama 0,19)', T.intraDirection([{ name: 'QQQ', pct: 0.46 }, { name: 'SPY', pct: 0.31 }, { name: 'NVDA', pct: -0.2 }]).label === 'yatay');
  ok('seans yönü: aşağı', T.intraDirection([{ name: 'QQQ', pct: -0.6 }]).label === 'aşağı');
}

// ───── 7) Duvar kayması ve akış metni ─────
{
  const open = { spot: 598, callWall: 600, putWall: 580, flip: 596, maxPain: 597, expiry: 'x', at: 0 };
  const now = { spot: 600.2, callWall: 605, putWall: 580, flip: 599, maxPain: 600, expiry: 'x', at: 1 };
  const line = T.wallLine('QQQ', open, now);
  ok('duvar kayması: call 600 → 605 (↑5)', line.includes('call duvarı 605 [açılış 600 (↑5)]'), line);
  ok('duvar kayması: put değişmedi (=)', line.includes('put duvarı 580 [açılış 580 (=)]'), line);
  ok('duvar: anlık görüntü yok → veri alınamadı', T.wallLine('QQQ', null, null).includes('veri alınamadı'));
  const f = T.flowLines([{ ticker: 'QQQ', expiry: '2026-11-20', side: 'call', strike: 520, contracts: 12400, premium: 1240000 }]);
  ok('akış metni: "12.400 kontrat", "20 Kas 520 C", prim', f[0].includes('12.400 kontrat') && f[0].includes('520 C') && f[0].includes('1,24 M$'), f[0]);
}

// ───── 8) Tam metin: fixture'dan (sentetik) ─────
{
  const B = { day: '2026-11-16', watch: ['QQQ', 'SPY', 'NVDA'], asia: [], europe: [], futures: [], preMarket: [], moves: [], walls: [], flow: [], news: [], newsOk: true,
    macro: { today: [], tomorrow: [] }, earnings: null, sma: [], failures: [] as string[] };
  const all: Record<string, any> = {
    premarket: { ...B, kind: 'premarket', nowMs: Date.parse('2026-11-16T14:00:00Z'), asia: [{ name: 'Nikkei 225', pct: 0.42, price: 50210 }],
      europe: [{ name: 'DAX', pct: 0.27, price: 24510 }], futures: [{ name: 'ES (S&P vadeli)', pct: 0.21, price: 6812.5 }, { name: 'NQ (Nasdaq vadeli)', pct: 0.35, price: 24410 }],
      preMarket: [{ name: 'QQQ', pct: 0.4, price: 598.1 }], macro: { today: eventsOn('2026-11-16'), tomorrow: [] } },
    intra1: { ...B, kind: 'intra1', nowMs: Date.parse('2026-11-16T15:00:00Z'), moves: [{ name: 'QQQ', pct: 0.46, price: 600.2 }],
      walls: [{ ticker: 'QQQ', open: { spot: 598, callWall: 600, putWall: 580, flip: 596, maxPain: 597, expiry: 'x', at: 0 }, now: { spot: 600.2, callWall: 605, putWall: 580, flip: 599, maxPain: 600, expiry: 'x', at: 1 } }] },
    eod: { ...B, kind: 'eod', nowMs: Date.parse('2026-11-16T21:30:00Z'), moves: [{ name: 'QQQ', pct: 0.8, price: 604.4 }],
      sma: [{ ticker: 'QQQ', price: 604.4, sma20: 590.1, sma50: 575.3, sma200: 520.8 }], macro: { today: [], tomorrow: eventsOn('2026-11-17') } },
  };
  const pre = T.buildReport(all.premarket);
  ok('piyasa öncesi: başlık 17:00 İst', pre.title === 'Piyasa öncesi · 17:00 İst', pre.title);
  ok('piyasa öncesi: Asya, Avrupa, vadeliler, takvim, beklenti bölümleri var',
    ['Asya', 'Avrupa', 'Vadeliler', 'Takvim', 'Beklenti (kural tabanlı)'].every(h => pre.body.includes(h)));
  ok('piyasa öncesi: tavsiye değildir notu', pre.body.includes('yatırım tavsiyesi değildir'));
  const i1 = T.buildReport(all.intra1);
  ok('intra: başlık 18:00 İst ve duvar bölümü', i1.title.endsWith('18:00 İst') && i1.body.includes('Duvarlar (açılış → şimdi)'));
  const eod = T.buildReport(all.eod);
  ok('gün sonu: başlık 00:30 İst; SMA ve yarın bölümü', eod.title === 'Gün sonu · 00:30 İst' && eod.body.includes('SMA200') && eod.body.includes('Yarın:'), eod.title);
  ok('gün sonu: NFP yarın → push özeti', eod.pushBody.includes('yarın'), eod.pushBody);
  const empty = T.buildReport({ ...all.premarket, asia: [], europe: [], futures: [], preMarket: [], news: [], newsOk: false, earnings: null, failures: [] });
  ok('veri yok: rapor üretilir, "veri alınamadı" yazar', empty.body.includes('veri alınamadı') && empty.pushBody.length > 0);
}

// ───── 9) Kaynak ayrıştırıcıları ─────
{
  const j = { chart: { result: [{ meta: { regularMarketPrice: 101, chartPreviousClose: 100, preMarketPrice: 102, regularMarketTime: 1700000000 },
    indicators: { quote: [{ close: [99, null, 101] }] } }] } };
  const q = R.parseYahooChart(j, 'X');
  ok('Yahoo: fiyat, önceki kapanış, ön piyasa, kapanış serisi', q?.price === 101 && q?.prevClose === 100 && q?.prePrice === 102 && q?.closes.join() === '99,101', JSON.stringify(q));
  ok('Yahoo: boş yanıt → null', R.parseYahooChart({ chart: { result: null } }, 'X') === null);
  ok('pctOf: 101/100 → %1', Math.abs((R.pctOf(101, 100) ?? 0) - 1) < 1e-9);
  const xs = Array.from({ length: 10 }, (_, i) => i + 1);
  ok('SMA5 son 5 ortalaması = 8', R.sma(xs, 5) === 8);
  ok('SMA: yetersiz veri → null', R.sma(xs, 20) === null);
  const snap = W.wallSnapFromRows([
    { occ: 'A', ticker: 'QQQ', expiry: '2026-11-16', side: 'call', strike: 600, volume: 0, oi: 5000, bid: 1, ask: 1.1, last: 1, updated: 0, underlying: 598 },
    { occ: 'B', ticker: 'QQQ', expiry: '2026-11-16', side: 'put', strike: 590, volume: 0, oi: 3000, bid: 1, ask: 1.1, last: 1, updated: 0, underlying: 598 },
  ], '2026-11-16', Date.parse('2026-11-16T16:00:00Z'));
  ok('duvar anlık görüntüsü: call duvarı 600, put duvarı 590, spot 598', snap?.callWall === 600 && snap?.putWall === 590 && snap?.spot === 598, JSON.stringify(snap));
}

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\nreports testleri tamam');
