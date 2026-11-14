// Rapor bölümleri (yapılandırılmış veri): karar kuralı, plan cümlesi, kayma okları, haber etkisi, akış, takvim,
// gün sonu isabet/ıska, metrik kartları, duvar merdiveni yerleşimi. Ağ YOK.
import * as RS from '../src/lib/reports/sections.ts';
import * as RU from '../src/lib/reports/rules.ts';
import * as RL from '../src/lib/reports/ladder.ts';
import * as RT from '../src/lib/reports/text.ts';
import type { MacroLite } from '../src/lib/calendar/releases.ts';
import type { ReportInput, WallRow } from '../src/lib/reports/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const DAY = '2026-11-16';
const NOW = Date.parse('2026-11-16T15:00:00Z');   // 18:00 İst, açılıştan 30 dk sonrası (kış)
function base(kind: ReportInput['kind'], over: Partial<ReportInput> = {}): ReportInput {
  return {
    kind, day: DAY, nowMs: NOW, watch: ['QQQ', 'SPY', 'NVDA'], asia: [], europe: [], futures: [], preMarket: [], moves: [], vix: null,
    walls: [], flow: [], news: [], newsOk: true, macro: { today: [], tomorrow: [] }, earnings: null, sma: [], failures: [],
    ...over,
  };
}
const wall = (callWall: number, putWall: number, flip: number | null = 578, maxPain: number | null = 580, spot = 582) =>
  ({ spot, callWall, putWall, flip, maxPain, expiry: DAY, at: NOW });
const row = (ticker: string, over: Partial<WallRow> = {}): WallRow => ({
  ticker, spot: 582, callWall: 585, putWall: 570, gammaFlip: 578, maxPain: 580, prev: null, prevLabel: null, source: 'canlı', ...over,
});
const mac = (label: string, time: string, tier: 'high' | 'medium', day = DAY, verified = true): MacroLite =>
  ({ key: label, short: label, label, tier, day, time, verified, src: 'x' });

// ───── 1) Karar kuralı (eşik) ─────
{
  ok('karar: skor +0,25 → CALL (eşik dâhil)', RU.biasOf(0.25).bias === 'CALL' && RU.biasOf(0.25).dataOk);
  ok('karar: skor −0,25 → PUT', RU.biasOf(-0.25).bias === 'PUT');
  ok('karar: skor 0,10 → BEKLE (yatay)', RU.biasOf(0.1).bias === 'BEKLE' && RU.biasOf(0.1).dataOk);
  ok('karar: skor yok → BEKLE, dataOk=false', RU.biasOf(null).bias === 'BEKLE' && !RU.biasOf(null).dataOk);
  const pre = RS.decideBias(base('premarket', { futures: [{ name: 'ES', pct: 0.6 }, { name: 'NQ', pct: 0.8 }], asia: [{ name: 'N', pct: 0.2 }] }));
  ok('karar: piyasa öncesi vadeli +0,6–0,8 → CALL', pre.bias === 'CALL' && pre.dataOk);
  const intra = RS.decideBias(base('intra2', { moves: [{ name: 'QQQ', pct: -0.6 }, { name: 'SPY', pct: -0.4 }] }));
  ok('karar: açılıştan beri −0,5 ort. → PUT', intra.bias === 'PUT');
  const none = RS.decideBias(base('intra1'));
  ok('karar: hareket verisi yok → BEKLE, dataOk=false', none.bias === 'BEKLE' && !none.dataOk);
  ok('beklenti: veri yokken null (gün sonu "veri yok")', RS.expectationOf({ summary: { bias: 'CALL', dataOk: false, keyLevels: [], plan: '' } }) === null);
  ok('beklenti: veri varken karar', RS.expectationOf({ summary: { bias: 'PUT', dataOk: true, keyLevels: [], plan: '' } }) === 'PUT');
}

// ───── 2) Plan cümlesi (tek cümle, kurala göre) ─────
{
  const c = RS.planText('CALL', true, row('QQQ'));
  ok('plan CALL: flip, call hedefi ve put kırılımı yazılır', c.includes('578 üzerinde') && c.includes('hedef call duvarı 585') && c.includes('570 altına'), c);
  ok('plan CALL: tek cümle (sonda tek nokta)', c.endsWith('.') && c.split('.').length === 2, c);
  const p = RS.planText('PUT', true, row('QQQ'));
  ok('plan PUT: aşağı tez ve put hedefi', p.includes('578 altında') && p.includes('hedef put duvarı 570'), p);
  const b = RS.planText('BEKLE', true, row('QQQ'));
  ok('plan BEKLE: aralık ve flip kırılımı', b.includes('570–585 aralığında') && b.includes('578 kırılımı'), b);
  ok('plan: veri yok → açık mesaj', RS.planText('BEKLE', false, row('QQQ')).includes('alınamadı'));
  ok('plan: seviye yok → yalnız yön', RS.planText('CALL', true, null).includes('seviye verisi yok'));
}

// ───── 3) Ana seviyeler ve ana ticker ─────
{
  const rows = [row('SPY', { callWall: 590 }), row('QQQ'), row('NVDA', { callWall: 200 })];
  ok('ana ticker: QQQ tercih edilir', RS.primaryWall(rows)?.ticker === 'QQQ');
  ok('ana ticker: QQQ yoksa SPY', RS.primaryWall([row('NVDA'), row('SPY')])?.ticker === 'SPY');
  const kl = RS.keyLevelsOf(row('QQQ', { maxPain: null }));
  ok('seviyeler: call/put/flip, max pain yok → atlanır', kl.map(k => k.label).join('|') === 'QQQ call duvarı|QQQ put duvarı|Gamma flip' && kl[0].value === '585', JSON.stringify(kl));
  ok('seviyeler: kesirli değer 2 ondalık (Türkçe virgül)', RS.keyLevelsOf(row('QQQ', { callWall: 585.5 }))[0].value === '585,50');
}

// ───── 4) Kayma okları ─────
{
  ok('ok: artış ↑', RS.shiftArrow(580, 585) === '↑');
  ok('ok: azalış ↓', RS.shiftArrow(585, 580) === '↓');
  ok('ok: değişmedi =', RS.shiftArrow(580, 580) === '=');
  ok('ok: veri yok → null', RS.shiftArrow(null, 580) === null);
  const shifts = RS.wallShifts([row('QQQ', { prev: { callWall: 580, putWall: 570, gammaFlip: null }, prevLabel: '12/11' })]);
  ok('kayma: call ↑ (580→585), put = , flip yok (atlanır)', shifts.length === 2 && shifts[0].arrow === '↑' && shifts[1].arrow === '=', JSON.stringify(shifts));
  ok('kayma: önceki değer yoksa satır yok', RS.wallShifts([row('QQQ')]).length === 0);
}

// ───── 5) Haber etkisi ─────
{
  ok('haber: Fed/CPI anahtar kelimesi → yüksek (Makro)', RS.newsImpact({ title: 'Fed signals rate cut path', tickers: [] }, ['QQQ']).impact === 'high');
  ok('haber: Türkçe faiz kelimesi → yüksek', RS.newsImpact({ title: 'Merkez bankası faiz kararı', tickers: [] }, ['QQQ']).tag === 'Makro');
  ok('haber: izleme tickerı → orta (İzleme)', RS.newsImpact({ title: 'NVIDIA launches chip', tickers: ['NVDA'] }, ['NVDA']).impact === 'med');
  ok('haber: diğer → düşük (Genel)', RS.newsImpact({ title: 'Local bakery opens', tickers: ['XYZ'] }, ['NVDA']).impact === 'low');
  const cards = RS.newsCards(base('intra2', { news: [
    { title: 'a', source: 'S', at: Date.parse('2026-11-16T14:00:00Z'), tickers: [] },
    { title: 'Fed speech', source: 'R', at: Date.parse('2026-11-16T14:30:00Z'), tickers: [] },
  ] }));
  ok('haber: yeni → eski sıralı; saat İstanbul', cards[0].headline === 'Fed speech' && cards[0].time === '17:30', JSON.stringify(cards));
  ok('haber: kaynak kapalıysa boş', RS.newsCards(base('intra2', { newsOk: false, news: [{ title: 'x', source: 'y', at: 1, tickers: [] }] })).length === 0);
}

// ───── 6) Akış (stacking) ─────
{
  const f = (side: 'call' | 'put', premium: number, strike = 520) => ({ ticker: 'QQQ', expiry: DAY, side, strike, contracts: 100, premium });
  const fs = RS.flowSection(base('intra2', { flow: [f('call', 3e6), f('put', 1e6, 510)] }));
  ok('akış: çağrı payı 0,75', fs.callShare !== null && Math.abs(fs.callShare - 0.75) < 1e-9, String(fs.callShare));
  ok('akış: en büyük ilk sırada (call 3M)', fs.top[0].side === 'call' && fs.top[0].label.includes('520 C'), JSON.stringify(fs.top[0]));
  ok('akış: bilinmiyor (kayıt yok) → known=false', RS.flowSection(base('intra1', { flowKnown: false })).known === false);
  ok('akış: boş → pay null', RS.flowSection(base('intra1')).callShare === null);
}

// ───── 7) Metrik kartları ─────
{
  const chips = RS.metricChips(base('intra2', {
    moves: [{ name: 'NVDA', pct: 0.2 }, { name: 'SPY', pct: -0.1 }, { name: 'QQQ', pct: 0.5, price: 585.2 }],
    vix: { name: 'VIX', pct: -3.1, price: 18.2 },
    futures: [{ name: 'ES (S&P vadeli)', pct: 0.3 }],
  }));
  ok('metrik: QQQ ilk, sonra SPY', chips[0].label === 'QQQ' && chips[1].label === 'SPY', chips.map(c => c.label).join(','));
  ok('metrik: QQQ değeri "+0,50%" ve yeşil ton, fiyat alt metin', chips[0].value === '+0,50%' && chips[0].tone === 'pos' && chips[0].sub === '585,20', JSON.stringify(chips[0]));
  ok('metrik: VIX nötr ton (yön yorumu yok)', chips.find(c => c.label === 'VIX')?.tone === 'text');
  ok('metrik: ES etiketi kısa', chips.some(c => c.label === 'ES' && c.value === '+0,30%'));
  const nul = RS.metricChips(base('intra1', { moves: [{ name: 'QQQ', pct: null }] }));
  ok('metrik: veri yok → "—" ve soluk ton', nul[0].value === '—' && nul[0].tone === 'muted');
}

// ───── 8) Takvim: ET + İstanbul, açıklandı / bekleniyor, yarın ─────
{
  const cal = RS.calendarItems(base('eod', {
    macro: { today: [mac('CPI', '08:30', 'high')], tomorrow: [mac('ISM İmalat', '10:00', 'medium', '2026-11-17')] },
  }));
  ok('takvim: CPI 08:30 ET = 16:30 İst (kış), açıklandı (rapor 18:00 İst)', cal[0].time === '08:30 ET' && cal[0].istTime === '16:30' && cal[0].released && cal[0].impact === 'high', JSON.stringify(cal[0]));
  ok('takvim: yarınki olay bekleniyor ve yarın etiketi', cal[1].tomorrow && !cal[1].released && cal[1].impact === 'med', JSON.stringify(cal[1]));
  const pre = RS.calendarItems(base('premarket', { nowMs: Date.parse('2026-11-16T13:00:00Z'), macro: { today: [mac('NFP', '08:30', 'high')], tomorrow: [] } }));
  ok('takvim: rapor öncesi olay bekleniyor', pre[0].released === false);
  ok('takvim: doğrulanmamış tarih işaretlenir', !RS.calendarItems(base('intra1', { macro: { today: [mac('X', '10:00', 'medium', DAY, false)], tomorrow: [] } }))[0].verified);
}

// ───── 9) Gün sonu incelemesi: isabet / ıska, kaymalar, yarın planı ─────
{
  const eodIn = (expected: 'CALL' | 'PUT' | 'BEKLE' | null, moves: { name: string; pct: number }[]) => base('eod', {
    moves, morningBias: expected,
    walls: [{ ticker: 'QQQ', open: wall(580, 570), now: wall(585, 570) }],
  });
  const hit = RS.buildSections(eodIn('CALL', [{ name: 'QQQ', pct: 0.6 }, { name: 'SPY', pct: 0.4 }]));
  ok('gün sonu: beklenti CALL, sonuç CALL → isabet', hit.eod?.result === 'hit' && hit.eod.actual === 'CALL', JSON.stringify(hit.eod));
  const miss = RS.buildSections(eodIn('CALL', [{ name: 'QQQ', pct: -0.6 }]));
  ok('gün sonu: beklenti CALL, sonuç PUT → ıska', miss.eod?.result === 'miss');
  const nob = RS.buildSections(eodIn(null, [{ name: 'QQQ', pct: 0.6 }]));
  ok('gün sonu: sabah beklentisi yok → "veri yok"', nob.eod?.result === 'veri yok');
  ok('gün sonu: call duvarı kayması ↑ (580→585)', hit.eod?.shifts.some(s => s.what === 'call duvarı' && s.arrow === '↑' && s.from === 580 && s.to === 585) === true, JSON.stringify(hit.eod?.shifts));
  ok('gün sonu: yarın planı var ve tek cümle', !!hit.eod?.plan && hit.eod.plan.endsWith('.'));
  ok('gün sonu: sonuç metni izleme ortalaması', hit.eod?.outcome.includes('+0,50%') === true, hit.eod?.outcome);
  ok('eod dışı türde eod alanı null', RS.buildSections(base('intra2', { moves: [{ name: 'QQQ', pct: 1 }] })).eod === null);
}

// ───── 10) Duvar merdiveni yerleşimi (çakışmasız, sınırlar içinde) ─────
{
  const r = row('QQQ', { spot: 583, callWall: 584, putWall: 570, gammaFlip: 583.5, maxPain: 584 });
  const L = RL.ladderLayout(r, 200);
  const ys = L.marks.map(m => m.y);
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  ok('merdiven: işaretler yukarıdan aşağıya sıralı ve 13 px ayrık', gaps.every(g => g >= 13 - 1e-9), JSON.stringify(gaps));
  ok('merdiven: tüm y değerleri yükseklik içinde', ys.every(y => y >= 0 && y <= 200), JSON.stringify(ys));
  ok('merdiven: yüksek fiyat üstte (call > put)', L.marks.find(m => m.key === 'callWall')!.y < L.marks.find(m => m.key === 'putWall')!.y);
  ok('merdiven: veri yok → boş', RL.ladderLayout(row('QQQ', { spot: null, callWall: null, putWall: null, gammaFlip: null, maxPain: null }), 200).marks.length === 0);
  const same = RL.ladderLayout(row('QQQ', { spot: 580, callWall: 580, putWall: 580, gammaFlip: 580, maxPain: 580 }), 200);
  ok('merdiven: aynı fiyat (tek seviye) → hepsi çakışsa da ayrık ve sınır içinde', same.marks.every(m => m.y >= 0 && m.y <= 200) && same.marks.length === 5);
}

// ───── 11) Tam bölümler: düz metin hâlâ üretilir, bölümler dolu, veri yoksa düşmez ─────
{
  const input = base('eod', {
    moves: [{ name: 'QQQ', pct: 0.6, price: 585 }, { name: 'SPY', pct: 0.4 }],
    walls: [{ ticker: 'QQQ', open: wall(580, 570), now: wall(585, 570) }],
    flow: [{ ticker: 'QQQ', expiry: DAY, side: 'call', strike: 585, contracts: 5000, premium: 2e6 }],
    basis: { wallsHead: 'h', openLabel: '12/11', flowHead: 'f', source: 'önceki kapanış (12/11) zincirine göre' },
    macro: { today: [mac('CPI', '08:30', 'high')], tomorrow: [] },
    failures: ['Yahoo ^N225 alınamadı'],
  });
  const rep = RT.buildReport(input);
  ok('rapor: düz metin hâlâ dolu (eski satır/push için yedek)', rep.body.includes('Gün sonu raporu') && rep.body.includes('Kural tabanlı'));
  ok('rapor: bölümler eklenmiş (sürüm 1, özet, duvarlar, takvim)', rep.sections.v === 1 && rep.sections.walls.length === 1 && rep.sections.calendar.length === 1);
  ok('rapor: kaynak etiketi bölümde', rep.sections.walls[0].source.includes('12/11'));
  ok('rapor: haber kaynağı durumu bölümde (newsOk)', rep.sections.newsOk === input.newsOk);
  ok('rapor: veri sorunları bölümde', rep.sections.failures.includes('Yahoo ^N225 alınamadı'));
  ok('rapor: push kısa ve metin dışında', rep.pushBody.length < 120 && rep.pushBody.includes('SPY'));
  const empty = RT.buildReport(base('premarket'));
  ok('boş girdi: rapor düşmez, özet BEKLE + veri yok', empty.sections.summary.bias === 'BEKLE' && !empty.sections.summary.dataOk && empty.sections.walls.length === 0);
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm rapor bölüm testleri geçti');
if (fail) process.exit(1);
