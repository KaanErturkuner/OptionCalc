import type { Bar } from '../src/lib/odte/analytics.ts';
import * as RD from '../src/lib/radar/detectors/index.ts';
import { pcSurge } from '../src/lib/radar/detectors/pcSurge.ts';
import { unusual } from '../src/lib/radar/detectors/unusual.ts';
import { oiBuild } from '../src/lib/radar/detectors/oiBuild.ts';
import { ivJump } from '../src/lib/radar/detectors/ivJump.ts';
import { skewShift } from '../src/lib/radar/detectors/skew.ts';
import { complacency } from '../src/lib/radar/detectors/complacency.ts';
import { pin } from '../src/lib/radar/detectors/pin.ts';
import { sectorDivergence } from '../src/lib/radar/detectors/sector.ts';
import { earnings } from '../src/lib/radar/detectors/earnings.ts';
import { trend } from '../src/lib/radar/detectors/trend.ts';
import { buildBaseline, ivRankOf, realizedVol } from '../src/lib/radar/baseline.ts';
import { buildAlerts, applyCooldown, groupSignals, type Alert } from '../src/lib/radar/engine.ts';
import { renderAlert, kontratEtiket } from '../src/lib/radar/text.ts';
import { buildSnapshot, oiMap } from '../src/lib/radar/snapshot.ts';
import { hitOf, priceAt, summarize, barrierOf, barrierSummary } from '../src/lib/radar/track.ts';
import { combineScore, isConfirmed } from '../src/lib/radar/engine.ts';
import type { Baseline, Signal, Snapshot } from '../src/lib/radar/types.ts';
import { classify } from '../src/lib/news/classify.ts';
import { tickersIn } from '../src/lib/news/names.ts';
import { parseYahooRss } from '../src/lib/news/yahoo.ts';
import { parseSecSubmissions, cikFor } from '../src/lib/news/sec.ts';
import { parseFinnhubNews, parseFinnhubEarnings } from '../src/lib/news/finnhub.ts';
import { NewsHub } from '../src/lib/news/index.ts';
import type { NewsItem } from '../src/lib/news/types.ts';
import * as CB from '../src/lib/market/cboe.ts';
import { parseYahooChart } from '../src/lib/market/bars.ts';
// @ts-ignore — Node yerleşik modülü (test yalnızca Node'da çalışır)
import { readFileSync } from 'node:fs';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info ? ' ' + info : '')); };
const NOW = Date.parse('2026-11-13T15:00:00Z');
const UNIVERSE = ['MU', 'AMD', 'NVDA', 'SMH', 'QQQ', 'AXTI'];

const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  ticker: 'MU', isEtf: false, spot: 100, changePct: 0, now: NOW, source: 'test', dataAgeSec: 3, delayedMin: 0,
  bars: [], vwap: 99, orHigh: 99, orLow: 98, ema9: 100, ema21: 99, expiry: '2026-11-13', dte: 0,
  chain: { expiry: '2026-11-13', calls: [], puts: [] }, expectedMove: 2, emPct: 0.02,
  atmIv: 0.3, atmIvSession0: 0.3, skew: null, rr25: null, probUp: 0.5,
  callWall: null, putWall: null, maxPain: null, flip: null, netGex: null,
  pcVol: 1, totalVol: 1000, avgContractVol: 50, prevOi: null, sector: null,
  earnings: null, earningsImpliedPct: null, earningsHistPct: null, ...o,
});
const bl = (o: Partial<Baseline> = {}): Baseline => ({
  n: 25, n20: 20, pcVol20: 1, totalVol20: 1000, avgContractVol20: 50,
  ivHist: Array.from({ length: 25 }, (_, i) => 0.2 + i * 0.008), rv10: 0.2, rv20: 0.25, rr25Mean: 0.04, rr25Std: 0.02, ...o,
});
const q = (type: 'call' | 'put', strike: number, o: Partial<{ bid: number; ask: number; last: number; volume: number; oi: number; iv: number | null }> = {}) => ({
  type, strike, bid: 1, ask: 1.1, last: 1.05, iv: 0.3, volume: 100, oi: 100, ...o,
});

console.log('\n— Taban çizgisi —');
{
  const days = Array.from({ length: 25 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, ticker: 'MU', pcVol: 1 + (i % 2) * 0.2, totalVol: 1000, avgContractVol: 50, atmIv: 0.2 + i * 0.008, rr25: 0.04, close: 100 }));
  const b = buildBaseline(days);
  ok('baseline n=25 (IV geçmişi)', b.n === 25 && b.ivHist.length === 25);
  ok('baseline pcVol20 ort. (son 20)', Math.abs(b.pcVol20! - 1.1) < 1e-9, `(${b.pcVol20})`);
  ok('realize oynaklık sabit kapanış = 0', realizedVol([100, 100, 100, 100, 100, 100], 4) === 0);
  const r = ivRankOf(0.4, b.ivHist);
  ok('IV rank: en yüksek → 100', Math.round(r.rank!) === 100, `(${r.rank})`);
  ok('IV rank yetersiz geçmiş → null', ivRankOf(0.3, [0.2, 0.3]).rank === null);
}

console.log('\n— Dedektörler: pozitif / negatif örnekler —');
{
  const pos = pcSurge(snap({ pcVol: 2.5, totalVol: 2000 }), bl());
  ok('P/C yığılması → bear', pos.length === 1 && pos[0].direction === 'bear');
  ok('P/C yığılması yok (P/C normal)', pcSurge(snap({ pcVol: 1.2, totalVol: 2000 }), bl()).length === 0);
  ok('P/C yığılması yok (hacim düşük)', pcSurge(snap({ pcVol: 2.5, totalVol: 1100 }), bl()).length === 0);
  ok('P/C call yığılması → bull', pcSurge(snap({ pcVol: 0.3, totalVol: 2000 }), bl())[0]?.direction === 'bull');
  ok('P/C baseline yetersiz (n<5) → çalışmaz', pcSurge(snap({ pcVol: 2.5, totalVol: 2000 }), bl({ n: 3 })).length === 0);

  const chainU = { expiry: '2026-11-13', calls: [q('call', 105, { volume: 5000, oi: 500, last: 1.2, bid: 1, ask: 1.1 })], puts: [q('put', 95, { volume: 10, oi: 900 })] };
  const u = unusual(snap({ chain: chainU, dte: 0 }), bl());
  ok('olağan dışı çağrı → bull + agresif + OTM', u.length === 1 && u[0].direction === 'bull' && u[0].facts.agresif === 'evet' && u[0].facts.otm === 'evet', JSON.stringify(u[0]?.facts));
  ok('olağan dışı yok (hacim küçük)', unusual(snap({ chain: { expiry: '', calls: [q('call', 105, { volume: 200, oi: 10 })], puts: [] } }), bl()).length === 0);

  const prev = { C105: 1000 };
  const chainO = { expiry: '2026-11-13', calls: [q('call', 105, { oi: 3200 })], puts: [] };
  const o = oiBuild(snap({ chain: chainO, prevOi: prev }));
  ok('OI birikimi (+%220, +2200) → bull', o.length === 1 && o[0].direction === 'bull' && o[0].facts.artisPct === 220, JSON.stringify(o[0]?.facts));
  ok('OI birikimi yok (küçük artış)', oiBuild(snap({ chain: { expiry: '', calls: [q('call', 105, { oi: 1100 })], puts: [] }, prevOi: prev })).length === 0);

  ok('IV sıçraması +%33 → vol', ivJump(snap({ atmIv: 0.4, atmIvSession0: 0.3 }))[0]?.direction === 'vol');
  ok('IV sıçraması yok (+%3)', ivJump(snap({ atmIv: 0.309, atmIvSession0: 0.3 })).length === 0);
  ok('IV çöküşü bilanço sonrası → bilgi (sev 0,2)', ivJump(snap({ atmIv: 0.2, atmIvSession0: 0.3, earnings: { date: '2026-11-12', days: -1 } }))[0]?.severity === 0.2);

  ok('skew z=3 → bear', skewShift(snap({ rr25: 0.10 }), bl())[0]?.direction === 'bear');
  ok('skew normal → yok', skewShift(snap({ rr25: 0.05 }), bl()).length === 0);

  const lowIv = snap({ atmIv: 0.21, pcVol: 0.5 });
  ok('rehavet: IV rank düşük + P/C düşük + RV>IV → vol', complacency(lowIv, bl({ rv20: 0.35, pcVol20: 1 }))[0]?.kind === 'complacency');
  ok('panik: IV rank yüksek + P/C ×2 → panic', complacency(snap({ atmIv: 0.40, pcVol: 2 }), bl({ pcVol20: 1 }))[0]?.kind === 'panic');
  ok('rehavet/panik yok (normal)', complacency(snap({ atmIv: 0.3, pcVol: 1 }), bl()).length === 0);

  ok('pin: fiyat call duvarına 0,5 yakın (EM=2) → neutral', pin(snap({ callWall: 100.5 }))[0]?.kind === 'pin');
  ok('pin yok: duvar uzak', pin(snap({ callWall: 110 })).length === 0);
  ok('gamma flip altı → vol', pin(snap({ flip: 101 })).some(x => x.kind === 'gamma'));
  ok('pin sadece 0DTE', pin(snap({ dte: 2, callWall: 100.5 })).length === 0);

  ok('sektör ayrışması (hisse −2,5, sektör +1, EM %2 → fark 3,5 ≥ 1,5·2)', sectorDivergence(snap({ changePct: -2.5, emPct: 0.02, sector: { ticker: 'SMH', changePct: 1 } }))[0]?.kind === 'sector');
  ok('sektör aynı yönde → yok', sectorDivergence(snap({ changePct: 1, emPct: 0.02, sector: { ticker: 'SMH', changePct: 1 } })).length === 0);

  ok('bilanço pahalı (zımni 8% / hist 5%)', earnings(snap({ earnings: { date: '2026-11-16', days: 3 }, earningsImpliedPct: 8, earningsHistPct: 5 }), bl())[0]?.facts.durum === 'pahalı');
  ok('bilanço 9 gün sonra → yok', earnings(snap({ earnings: { date: '2026-11-22', days: 9 }, earningsImpliedPct: 8, earningsHistPct: 5 }), bl()).length === 0);

  const UP_BARS = Array.from({ length: 5 }, (_, i) => ({ t: NOW - (5 - i) * 60000, o: 100, h: 100.2, l: 99.9, c: 100.1, v: 1000 }));
  const T = { spot: 100, orHigh: 99, orLow: 98, vwap: 99, ema9: 100, ema21: 99, expectedMove: 1, bars: UP_BARS };
  const tr = trend(snap(T));
  ok('trend: hisse 1,8×EM → 102C', tr[0]?.facts.kontrat === '102C' && tr[0]?.direction === 'bull', JSON.stringify(tr[0]?.facts));
  ok('trend: ETF 0,45×EM → 100C', trend(snap({ ...T, ticker: 'QQQ' }))[0]?.facts.kontrat === '100C');
  ok('trend yok: kırılım yok', trend(snap({ ...T, spot: 98.5 })).length === 0);
  ok('trend yok: %0,1 tampon altında (100,05 / OR 100)', trend(snap({ ...T, orHigh: 100, spot: 100.05 })).length === 0);
  ok('trend yok: VWAP hold bozuk (son bar VWAP altı)', trend(snap({ ...T, bars: [...UP_BARS.slice(0, 4), { ...UP_BARS[4], c: 98.9 }] })).length === 0);
  ok('trend yok: 15:50 ET (pencere dışı)', trend(snap({ ...T, now: Date.parse('2026-11-13T20:50:00Z') })).length === 0);
  ok('trend yok: 09:45 ET (açılış gürültüsü)', trend(snap({ ...T, now: Date.parse('2026-11-13T14:45:00Z') })).length === 0);
  ok('trend yok: spot 4 dk eski (bayat veri)', trend(snap({ ...T, dataAgeSec: 240 })).length === 0);
  ok('trend yok: bar sayısı yetersiz', trend(snap({ ...T, bars: UP_BARS.slice(0, 3) })).length === 0);
  const sFar = trend(snap({ ...T, spot: 101.5 }))[0]?.severity ?? 0, sNear = trend(snap(T))[0]?.severity ?? 0;
  ok('trend şiddeti kırılım mesafesiyle artar', sFar > sNear && sNear >= 0.55, `(${sNear} → ${sFar})`);
  ok('runDetectors çalışır', Array.isArray(RD.runDetectors(snap(), bl())));
}

console.log('\n— Metin —');
{
  const s1: Signal = { id: 'x', ticker: 'MU', kind: 'pcSurge', severity: 0.7, direction: 'bear', at: NOW, facts: { pc: 3.4, tabanPc: 0.9, hacimOran: 2.1 } };
  const t1 = renderAlert({ ticker: 'MU', direction: 'bear', score: 0.7, signals: [s1], news: null, noNews: true, dataAgeSec: 5, source: 'CBOE', delayedMin: 15, probUp: 0.24, now: NOW });
  ok('metin "Başkan," ile başlar', t1.body.startsWith('Başkan, MU'));
  ok('metin sayıları Türkçe biçimde içerir (3,4)', t1.body.includes('3,4') && t1.body.includes('0,9'));
  ok('metin: uyarı başlığı yön ve yüzde içerir', t1.title.includes('düşüş') && t1.title.includes('%70'));
  ok('metin: tavsiye değil notu', t1.body.includes('Yatırım tavsiyesi değildir'));
  ok('metin: haber yok → söylenti uyarısı (IV/OI türleri için)', renderAlert({ ticker: 'X', direction: 'bull', score: 0.7, signals: [{ ...s1, kind: 'unusual', direction: 'bull' }], news: null, noNews: true, dataAgeSec: 0, source: 'CBOE', delayedMin: 0, probUp: null, now: NOW }).body.includes('söylenti'));
  ok('trend metni "Trend teyit ederse: 13 Kas 857,5C" biçiminde', kontratEtiket(857.5, 'C', '2026-11-13') === '13 Kas 857,5C');
  ok('metin: 16:30–20:00 dışı → yarın için not', renderAlert({ ticker: 'MU', direction: 'bear', score: 0.7, signals: [s1], news: null, noNews: true, dataAgeSec: 0, source: 'CBOE', delayedMin: 0, probUp: null, now: Date.parse('2026-11-13T19:00:00Z') }).body.includes('yarın için not'));
}

console.log('\n— Uyarı motoru: gruplama, puanlama, eşikler, soğuma —');
{
  const mk = (kind: Signal['kind'], sev: number, dir: Signal['direction'] = 'bear', at = NOW): Signal => ({ id: kind + at, ticker: 'MU', kind, severity: sev, direction: dir, at, facts: { pc: 1, tabanPc: 1, hacimOran: 2 } });
  const snaps = new Map([['MU', snap({ sector: null })]]);
  const a2 = buildAlerts(snaps, [mk('pcSurge', 0.5), mk('skew', 0.5, 'bear', NOW + 5 * 60000)], []);
  ok('iki sinyal aynı grup → skor 0,75 → bildirim', a2.length === 1 && Math.abs(a2[0].score - 0.75) < 1e-9 && a2[0].level === 'bildirim', `(${a2[0]?.score})`);
  const withNews: NewsItem = { id: 'n', tickers: ['MU'], title: 'Micron shares fall after downgrade', source: 'Yahoo', url: 'u', publishedAt: NOW, kind: 'news', sentiment: -0.6, tags: ['downgrade'] };
  const a3 = buildAlerts(new Map([['MU', snap({ sector: { ticker: 'SMH', changePct: -1 } })]]), [mk('pcSurge', 0.5), mk('skew', 0.5, 'bear', NOW + 1000)], [withNews]);
  ok('haber + sektör teyidi → +0,2 (0,75 → 0,95)', a3[0].newsConfirm && a3[0].sectorConfirm && Math.abs(a3[0].score - 0.95) < 1e-9, `(${a3[0]?.score})`);
  ok('tek aile (yalnız akış) 0,7 → yalnız liste (teyit yok)', buildAlerts(snaps, [mk('pcSurge', 0.7)], [])[0].level === 'liste');
  ok('aile birleşimi: aynı aileden 2 sinyal → max (0,5 ⊕ 0,4 = 0,5)', Math.abs(combineScore([mk('pcSurge', 0.5), mk('unusual', 0.4)]) - 0.5) < 1e-9);
  ok('aile birleşimi: iki farklı aile → 1 − 0,5·0,5', Math.abs(combineScore([mk('pcSurge', 0.5), mk('skew', 0.5)]) - 0.75) < 1e-9);
  ok('teyit: onaylı trend tek başına bildirim', isConfirmed([mk('trend', 0.7)], false, false));
  ok('zayıf sinyal (0,3) → listeye bile girmez', buildAlerts(snaps, [mk('pcSurge', 0.3)], []).length === 0);
  const a4 = buildAlerts(snaps, [mk('pcSurge', 0.4)], []);
  ok('orta sinyal (0,4) → yalnız liste', a4.length === 1 && a4[0].level === 'liste');
  ok('gruplama: 30 dk dışı ayrı', groupSignals([mk('pcSurge', 0.5), mk('skew', 0.5, 'bear', NOW + 40 * 60000)]).length === 2);

  const first = buildAlerts(snaps, [mk('pcSurge', 0.7)], [])[0];
  const later = buildAlerts(snaps, [mk('pcSurge', 0.7, 'bear', NOW + 10 * 60000)], [])[0];
  applyCooldown([later], [first]);
  ok('soğuma: 10 dk sonra aynı skor → bastırılır', later.suppressed === true);
  const stronger = buildAlerts(snaps, [mk('pcSurge', 0.95, 'bear', NOW + 10 * 60000)], [])[0];
  applyCooldown([stronger], [first]);
  ok('soğuma: skor +0,2 artarsa bastırılmaz', stronger.suppressed === false);
  const hist: Alert[] = Array.from({ length: 12 }, (_, i) => ({ ...first, id: 'h' + i, ticker: 'T' + i, at: NOW - 60000 * i, suppressed: false, level: 'bildirim' as const }));
  const capped = buildAlerts(snaps, [mk('pcSurge', 0.7, 'bear', NOW + 2 * 3600000), mk('skew', 0.5, 'bear', NOW + 2 * 3600000)], [])[0];
  applyCooldown([capped], hist);
  ok('günlük bildirim tavanı 12 → liste', capped.level === 'liste');
}

console.log('\n— Haber katmanı —');
{
  const c1 = classify('Micron cuts guidance on weak HBM demand');
  ok('sınıflandırma: guidance cut → negatif', c1.tags.includes('guidance cut') && c1.sentiment <= -0.8, JSON.stringify(c1));
  const c2 = classify('Marvell beats estimates, raises guidance');
  ok('sınıflandırma: beat + raise → pozitif', c2.tags.includes('beat') && c2.tags.includes('raise') && c2.sentiment > 0.6);
  ok('sınıflandırma: eşleşme yok → 0', classify('Quiet day for markets').sentiment === 0);
  ok('sınıflandırma: SEC probe + lawsuit', classify('Company faces SEC probe and lawsuit').tags.length === 2);
  ok('ticker eşleme: sembol ve şirket adı', JSON.stringify(tickersIn('Micron (MU) and Nvidia rally', UNIVERSE)) === '["MU","NVDA"]', JSON.stringify(tickersIn('Micron (MU) and Nvidia rally', UNIVERSE)));
  ok('ticker eşleme: küçük harf sembol eşleşmez', tickersIn('mu is a word', UNIVERSE).length === 0);
  ok('ticker eşleme: AMD alt dizge değil', tickersIn('AMDX launches', UNIVERSE).length === 0);

  const rss = `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Micron cuts guidance &amp; stock falls]]></title><link>https://x.test/a</link><pubDate>Fri, 13 Nov 2026 14:00:00 +0000</pubDate><description>Micron (MU) warns</description></item>
    <item><title>Old story</title><link>https://x.test/old</link><pubDate>Fri, 01 Jan 2016 14:00:00 +0000</pubDate></item>
  </channel></rss>`;
  const items = parseYahooRss(rss, UNIVERSE, NOW - 3600000);
  ok('RSS: yalnız yeni öğe, CDATA+entity çözülür', items.length === 1 && items[0].title === 'Micron cuts guidance & stock falls', JSON.stringify(items.map(i => i.title)));
  ok('RSS: ticker ve duygu', items[0].tickers.includes('MU') && (items[0].sentiment ?? 0) < 0);

  const sec = { cik: '723125', filings: { recent: { form: ['8-K', '10-Q', '4'], filingDate: ['2026-11-12', '2026-11-10', '2026-11-11'], accessionNumber: ['0000723125-26-000010', '0000723125-26-000009', '0000723125-26-000011'], primaryDocument: ['a.htm', 'b.htm', 'c.xml'] } } };
  const sf = parseSecSubmissions(sec, 'MU', 0);
  ok('SEC: 8-K ve Form 4 alınır, 10-Q elenir', sf.length === 2 && sf.some(x => x.kind === 'insider') && sf.some(x => x.kind === 'filing'));
  ok('SEC: URL arşiv biçiminde', sf[0].url.startsWith('https://www.sec.gov/Archives/edgar/data/723125/'));
  ok('SEC: CIK eşleme', cikFor({ 0: { cik_str: 723125, ticker: 'MU' } }, 'mu') === '0000723125');

  const fh = parseFinnhubNews([{ datetime: Math.floor(NOW / 1000), headline: 'Nvidia wins contract', source: 'X', url: 'u1', id: 7 }, { headline: '' }], 'NVDA', 0);
  ok('Finnhub: haber ayrıştırma + sınıflandırma', fh.length === 1 && fh[0].tags.includes('contract') && fh[0].id === '7');
  ok('Finnhub: bilanço tarihi', parseFinnhubEarnings({ earningsCalendar: [{ symbol: 'MU', date: '2026-12-17' }, { symbol: 'MU', date: '2026-12-10' }] }, 'MU') === '2026-12-10');

  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('<rss></rss>', { status: 200 }); }) as typeof fetch;
  const hub = new NewsHub();
  await hub.poll(['MU'], UNIVERSE, 0, {}, NOW);
  await hub.poll(['MU'], UNIVERSE, 0, {}, NOW + 60000);
  ok('haber: 5 dk içinde ikinci çekim yok', calls === 1, `(çağrı ${calls})`);
  globalThis.fetch = realFetch;
}

console.log('\n— Anlık görüntü (CBOE SPY 0DTE fikstürü) ve senaryo —');
{
  const cj = JSON.parse(readFileSync(new URL('./fixtures/cboe-SPY-0dte.json', import.meta.url), 'utf8'));
  const now = Date.parse('2026-11-11T15:00:00Z');
  const quote = CB.parseCboeQuote(cj, 'SPY', now);
  const chains = CB.parseCboeChains(cj, 'SPY', now);
  const expiry = [...chains.keys()].sort()[0];
  const ch = chains.get(expiry)!;
  const bars = parseYahooChart(JSON.parse(readFileSync(new URL('./fixtures/yahoo-SPY-1m.json', import.meta.url), 'utf8')));
  const s = buildSnapshot({ ticker: 'SPY', price: quote.price, changePct: quote.changePct, chain: ch, expiry, bars, now, source: 'CBOE', delayedMin: 15, prevOi: null, atmIvSession0: null });
  ok('anlık görüntü: ATM IV ve beklenen hareket var', s.atmIv != null && s.atmIv > 0 && s.expectedMove != null && s.expectedMove > 0, `(IV ${s.atmIv}, EM ${s.expectedMove})`);
  ok('anlık görüntü: olasılık [0,1] ve skew hesaplandı', s.probUp != null && s.probUp >= 0 && s.probUp <= 1 && s.rr25 != null, `(P↑ ${s.probUp})`);
  ok('anlık görüntü: OI haritası anahtarları', Object.keys(oiMap(ch)).length > 0);

  // Senaryo: P/C yığılması + OI birikimi + IV sıçraması + olağan dışı kontrat → en az 3 tür, Türkçe metin
  const bigCall = ch.calls.find(o => o.strike > s.spot && o.oi > 0)!;
  const chS = { ...ch, calls: ch.calls.map(o => o === bigCall ? { ...o, volume: 9000, oi: 300, last: (o.bid + o.ask) / 2 + 0.05 } : o) };
  const sc: Snapshot = { ...s, chain: chS, dte: 0, pcVol: 3.2, totalVol: 20000, avgContractVol: 60, prevOi: { [`C${bigCall.strike}`]: 1000 }, atmIv: (s.atmIv ?? 0.2) * 1.4, atmIvSession0: s.atmIv, sector: null };
  const b = bl({ pcVol20: 1, totalVol20: 5000, avgContractVol20: 60 });
  const sigs = RD.runDetectors(sc, b);
  const kinds = new Set(sigs.map(x => x.kind));
  ok('senaryo: en az 3 farklı tür üretilir', kinds.size >= 3, `(${[...kinds].join(', ')})`);
  const alerts = buildAlerts(new Map([['SPY', sc]]), sigs, []);
  ok('senaryo: uyarı üretilir ve Türkçe', alerts.length >= 1 && alerts[0].body.startsWith('Başkan, SPY'));
  ok('senaryo: en az bir bildirim seviyesi', alerts.some(a => a.level === 'bildirim' || a.level === 'liste'));
  console.log('      örnek uyarı:', alerts[0]?.title);

  // İsabet: fiyat ve özet
  const p = priceAt(bars, bars[bars.length - 1].t);
  ok('isabet: priceAt son bar', p === bars[bars.length - 1].c);
  ok('isabet: bear yön + düşüş = isabet', hitOf('bear', 100, 99, 0.01) === true && hitOf('bull', 100, 99, 0.01) === false && hitOf('neutral', 100, 99, 0.01) === null);
  ok('isabet: vol → |hareket| ≥ ½ EM', hitOf('vol', 100, 100.6, 0.01) === true && hitOf('vol', 100, 100.2, 0.01) === false);
  const sm = summarize([{ kinds: ['pcSurge'], direction: 'bear', spot: 100, emPct: 0.01, outcome: { h2: 98 } }, { kinds: ['pcSurge'], direction: 'bear', spot: 100, emPct: 0.01, outcome: { h2: 101 } }]);
  const ub: Bar[] = Array.from({ length: 130 }, (_, i) => ({ t: NOW + (i + 1) * 60000, o: 100, h: 100.1, l: 99.9, c: 100, v: 1 }));
  ok('bariyer: hedef önce → win', barrierOf('bull', 100, ub.map((b, i) => i === 3 ? { ...b, h: 101 } : b), NOW, 0.01) === 'win');
  ok('bariyer: stop önce → loss (bull)', barrierOf('bull', 100, ub.map((b, i) => i === 3 ? { ...b, l: 99 } : b), NOW, 0.01) === 'loss');
  ok('bariyer: bear yönde düşüş hedefi → win', barrierOf('bear', 100, ub.map((b, i) => i === 5 ? { ...b, l: 99 } : b), NOW, 0.01) === 'win');
  ok('bariyer: aynı barda ikisi → loss', barrierOf('bull', 100, ub.map((b, i) => i === 2 ? { ...b, h: 101, l: 99 } : b), NOW, 0.01) === 'loss');
  ok('bariyer: hiç vurmadı → timeout', barrierOf('bull', 100, ub, NOW, 0.01) === 'timeout');
  ok('bariyer: veri ufku kapsamıyor → null', barrierOf('bull', 100, ub.slice(0, 5), NOW, 0.01) === null);
  ok('bariyer: vol yönü ölçülmez → null', barrierOf('vol', 100, ub, NOW, 0.01) === null);
  const bsum = barrierSummary(['win', 'win', 'loss', 'timeout', null]);
  ok('bariyer özeti: win% = win/(win+loss)', bsum.n === 4 && bsum.winPct === 67 && bsum.timeoutPct === 25, JSON.stringify(bsum));
  ok('isabet özeti: 2 uyarıdan %50 isabet', sm[0]?.n === 2 && sm[0]?.hitPct === 50, JSON.stringify(sm));
}

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nRadar testleri geçti'); process.exit(fail ? 1 : 0);
