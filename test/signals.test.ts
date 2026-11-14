/* Fırsat (SINYAL-FIRSAT) Aşama 1–2 testleri: saf mantık, sentetik barlar, sabit girdiler. Ağ ve token yok. */
import { normalizeTicker, dteWarning, DEFAULT_TICKERS, MAX_TICKERS } from '../src/lib/signals/tickers.ts';
import { autoK, quantile, otmDistance } from '../src/lib/signals/otm.ts';
import { profileFor, auxSymbols } from '../src/lib/signals/profiles.ts';
import { gateCheck, gateRecord, COOL_MS, DAILY_CAP } from '../src/lib/signals/gate.ts';
import { resample, frameAligned, orBreak, volRatio, vwapOk } from '../src/lib/signals/features.ts';
import { scoreSignal, betaPost, labelOf, type ScoreInput } from '../src/lib/signals/confidence.ts';
import { evaluateOutcome } from '../src/lib/signals/outcome.ts';
import { calibration, appendLog, LOG_KEEP, type SignalLog } from '../src/lib/signals/log.ts';
import type { Bar } from '../src/lib/odte/analytics.ts';

let fail = 0;
const ok = (name: string, cond: boolean, extra = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${cond ? '' : ' — ' + extra}`); if (!cond) fail++; };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

// ---- tickers
ok('varsayılan 4 ticker', DEFAULT_TICKERS.join(',') === 'QQQ,GLD,SLV,NVDA');
ok('en fazla 8', MAX_TICKERS === 8);
ok('geçerli sembol büyük harfe çevrilir', normalizeTicker(' nvda ', []).ok === true && (normalizeTicker(' nvda ', []) as any).ticker === 'NVDA');
ok('geçersiz sembol reddedilir', normalizeTicker('1-2 x', []).ok === false);
ok('tekrar reddedilir', normalizeTicker('QQQ', ['QQQ']).ok === false);
const eight = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
ok('9. ticker reddedilir', normalizeTicker('IWM', eight).ok === false);
ok('DTE uyarısı: 0–3 yoksa uyarı', dteWarning('X', [5, 9]) !== null);
ok('DTE uyarısı: 2 varsa yok', dteWarning('X', [5, 2]) === null);

// ---- profiles
const gld = profileFor('GLD');
ok('GLD: endeks rejimi (SPY/QQQ) yok', !gld.regime.some(l => l.sym === 'SPY' || l.sym === 'QQQ'));
ok('GLD: UUP ters işaretli (−1)', gld.regime.some(l => l.sym === 'UUP' && l.sign === -1));
ok('SLV: UUP ters işaretli (−1)', profileFor('SLV').regime.some(l => l.sym === 'UUP' && l.sign === -1));
ok('QQQ sabit k 0,45', JSON.stringify(profileFor('QQQ').otm) === JSON.stringify({ mode: 'sabit', k: 0.45 }));
ok('MU sabit 1,8', JSON.stringify(profileFor('MU').otm) === JSON.stringify({ mode: 'sabit', k: 1.8 }));
ok('NVDA sektör SMH', profileFor('NVDA').sector[0]?.sym === 'SMH');
ok('NBIS sektör: SMH ve QQQ birlikte', profileFor('NBIS').sector.map(l => l.sym).join(',') === 'SMH,QQQ');
ok('yardımcı semboller tekil ve kendini içermez', (() => { const a = auxSymbols(['QQQ', 'GLD', 'SLV', 'NVDA']); return new Set(a).size === a.length && !a.includes('SLV') && a.includes('UUP') && a.includes('GLD'); })());

// ---- otm
const q = quantile([1, 2, 3, 4, 5], 0.5);
ok('quantile medyan', q === 3, String(q));
ok('quantile enterpolasyon', near(quantile([0, 10], 0.25), 2.5));
ok('sabit mod: k aynen', autoK({ rule: { mode: 'sabit', k: 0.45 }, ratios: [], ivRank: null }).k === 0.45);
ok('oto: <20 gün → k0 ve başlangıç', (() => { const r = autoK({ rule: { mode: 'oto', k0: 1, kMin: .4, kMax: 2 }, ratios: [1, 2], ivRank: null }); return r.k === 1 && r.source === 'başlangıç'; })());
ok('oto: kMax ile kırpılır', (() => { const r = autoK({ rule: { mode: 'oto', k0: 1, kMin: .4, kMax: 2 }, ratios: Array(30).fill(10), ivRank: null }); return r.k === 2 && r.source === 'oto'; })());
ok('oto: IV rank > 80 küçültür', (() => { const xs = Array(30).fill(1); const a = autoK({ rule: { mode: 'oto', k0: 1, kMin: .1, kMax: 5 }, ratios: xs, ivRank: 90 }); const b = autoK({ rule: { mode: 'oto', k0: 1, kMin: .1, kMax: 5 }, ratios: xs, ivRank: 50 }); return a.k < b.k; })());
ok('oto: IV rank < 20 büyütür', (() => { const xs = Array(30).fill(1); const a = autoK({ rule: { mode: 'oto', k0: 1, kMin: .1, kMax: 5 }, ratios: xs, ivRank: 10 }); const b = autoK({ rule: { mode: 'oto', k0: 1, kMin: .1, kMax: 5 }, ratios: xs, ivRank: 50 }); return a.k > b.k; })());
ok('uzaklık = k × EM', near(otmDistance(0.45, 4), 1.8));

// ---- gate
const sent0 = [] as ReturnType<typeof gateRecord>;
ok('ilk bildirim geçer', gateCheck(sent0, 'NVDA|pb', 1000, '2026-11-13').ok);
const s1 = gateRecord(sent0, 'NVDA|pb', 1000, '2026-11-13');
ok('30 dk soğuma', !gateCheck(s1, 'NVDA|pb', 1000 + COOL_MS - 1, '2026-11-13').ok);
ok('soğuma sonrası geçer', gateCheck(s1, 'NVDA|pb', 1000 + COOL_MS + 1, '2026-11-13').ok);
ok('risk bildirimi soğumaya takılmaz', gateCheck(s1, 'NVDA|pb', 1500, '2026-11-13', true).ok);
let many = [] as ReturnType<typeof gateRecord>;
for (let i = 0; i < DAILY_CAP; i++) many = gateRecord(many, 'K' + i, i, '2026-11-13');
ok('günde en fazla 10', !gateCheck(many, 'YENI', 99999, '2026-11-13').ok);
ok('yeni günde sıfırlanır', gateCheck(many, 'YENI', 99999, '2026-11-14').ok);

// ---- barlar ve özellikler (sentetik)
const mk = (n: number, start: number, slope: number, vol = 100): Bar[] => Array.from({ length: n }, (_, i) => {
  const c = start + slope * i; return { t: 1_700_000_000_000 + i * 60000, o: c - 0.1, h: c + 0.2, l: c - 0.2, c, v: vol };
});
const up = mk(120, 100, 0.05);
ok('resample 5 dk: çubuk sayısı 24–25 (hizalama payı)', [24, 25].includes(resample(up, 5).length));
ok('yükselen seride VWAP altı değil (bull uyumu)', vwapOk(up, 'bull'));
ok('frameAligned: yükseliş bull', frameAligned(up, 'bull', 1));
ok('frameAligned: yükseliş bear değil', !frameAligned(up, 'bear', 1));
ok('orBreak: yükseliş bull', orBreak(up, 'bull'));
ok('volRatio: sabit hacim = 1', near(volRatio(up), 1));
const spike = [...up.slice(0, -1), { ...up.at(-1)!, v: 300 }];
ok('volRatio: 3× tetik barı', near(volRatio(spike), 3, 1e-6));
ok('kısa seri: frameAligned false', !frameAligned(up.slice(0, 10), 'bull', 1));

// ---- confidence
const base: ScoreInput = {
  dir: 'bull', regime: { opposite: false, vwapAll: true, orAll: true }, sector: { present: true, vwapOk: true, rsOk: true },
  frames: { aligned: 3 }, volRatio: 2.5, radar: { same: 1, oppMax: 0 },
  rr: { needMove: 1, remainingEm: 2, pTouch: 0.5, rr: 5, minRr: 4 }, liq: { spreadPct: 3, liquid: true, maxSpreadPct: 8 },
  time: { etMin: 600, dte: 0 }, risk: { newsAgainst: false, macroNear: false, earningsInDte: false, s5: false },
  hist: { n: 200, wins: 150, pBe: 0.2 }, data: { delayedMin: 0, barAgeSec: 30, chainAgeSec: 30 }, marketOpen: true,
};
const full = scoreSignal(base);
ok('tam koşullarda 100', full.score === 100, JSON.stringify(full.components.map(c => [c.key, c.pts])));
ok('etiket Güçlü', full.label === 'Güçlü');
const comp = (r: ReturnType<typeof scoreSignal>, k: string) => r.components.find(c => c.key === k)!.pts;
ok('A2 sektör yok → A1’e +8, A2=0', (() => { const r = scoreSignal({ ...base, sector: { present: false, vwapOk: false, rsOk: false } }); return comp(r, 'A2') === 0 && comp(r, 'A1') === 18; })());
ok('A1 yalnız VWAP → 5', comp(scoreSignal({ ...base, regime: { opposite: false, vwapAll: true, orAll: false } }), 'A1') === 5);
ok('ters rejim vetosu → 0 ve veto', (() => { const r = scoreSignal({ ...base, regime: { opposite: true, vwapAll: false, orAll: false } }); return r.score === 0 && r.vetoes.includes('ters piyasa rejimi'); })());
ok('C ters yön ≥0,5 → −10', comp(scoreSignal({ ...base, radar: { same: 1, oppMax: 0.6 } }), 'C') === 5);
ok('gecikmeli veri tavanı 70', (() => { const r = scoreSignal({ ...base, data: { delayedMin: 15, barAgeSec: 30, chainAgeSec: 30 } }); return r.score <= 70 && r.cap === 70; })());
ok('bar yaşı >2 dk: −5', (() => { const a = scoreSignal({ ...base, data: { delayedMin: 0, barAgeSec: 200, chainAgeSec: 30 } }); return a.score === 95; })());
ok('zincir >5 dk: veto', scoreSignal({ ...base, data: { delayedMin: 0, barAgeSec: 30, chainAgeSec: 400 } }).vetoes.length > 0);
ok('spread > maxSpread: veto', scoreSignal({ ...base, liq: { spreadPct: 9, liquid: true, maxSpreadPct: 8 } }).score === 0);
ok('RR < minRr: veto', scoreSignal({ ...base, rr: { ...base.rr, rr: 3 } }).vetoes.some(v => v.startsWith('RR')));
ok('0DTE 14:30 ET sonrası: veto (TR saatiyle)', scoreSignal({ ...base, time: { etMin: 880, dte: 0 } }).vetoes.some(v => /^0DTE \d{2}:\d{2} TR sonrası$/.test(v)));
ok('bilanço DTE içinde (S5 hariç): veto', scoreSignal({ ...base, risk: { ...base.risk, earningsInDte: true } }).vetoes.includes('bilanço DTE içinde'));
ok('bilanço S5 muaf', scoreSignal({ ...base, risk: { ...base.risk, earningsInDte: true, s5: true } }).vetoes.length === 0);
ok('sermaye yetersiz: veto', scoreSignal({ ...base, budget: { askCost: 200, available: 150 } }).vetoes.includes('sermaye yetersiz'));
ok('piyasa kapalı: veto', scoreSignal({ ...base, marketOpen: false }).vetoes.includes('piyasa kapalı'));
ok('D pTouch < 0,15 → 0', comp(scoreSignal({ ...base, rr: { ...base.rr, pTouch: 0.1 } }), 'D') === 0);
ok('D 0,6–1,2 EM arası doğrusal', (() => { const r = scoreSignal({ ...base, rr: { ...base.rr, needMove: 0.9, remainingEm: 1 } }); return near(comp(r, 'D'), 15 * (1.2 - 0.9) / 0.6, 1e-6); })());
ok('Beta küçültme: (2)/(2+2/0,2) ≈ 0,0909 uçta yumuşar', near(betaPost(0, 0, 0.2), 2 / (2 + 10)));
ok('H n<30 nötr 7,5', comp(scoreSignal({ ...base, hist: { n: 10, wins: 10, pBe: 0.2 } }), 'H') === 7.5);
ok('H n≥30 yüksek isabet → tam puan', comp(scoreSignal({ ...base, hist: { n: 200, wins: 150, pBe: 0.2 } }), 'H') === 15);
ok('etiketler', labelOf(49) === 'Zayıf' && labelOf(50) === 'Orta' && labelOf(65) === 'İyi' && labelOf(80) === 'Güçlü');

// ---- outcome
const bars2: Bar[] = [
  { t: 1, o: 100, h: 101, l: 99.5, c: 100.5, v: 1 },
  { t: 2, o: 100.5, h: 103, l: 100, c: 102.6, v: 1 },
  { t: 3, o: 102.6, h: 106, l: 102, c: 105.5, v: 1 },
];
const tgt = evaluateOutcome({ dir: 'bull', entry: 100, stop: 98, target: 105, bars: bars2, timeLimitT: 10 });
ok('hedef önce vurulur', tgt.result === 'hedef' && near(tgt.r, 2.5), JSON.stringify(tgt));
const stp = evaluateOutcome({ dir: 'bull', entry: 100, stop: 99.7, target: 110, bars: bars2, timeLimitT: 10 });
ok('stop önce vurulur (R = −1)', stp.result === 'stop' && stp.r === -1, JSON.stringify(stp));
const zt = evaluateOutcome({ dir: 'bull', entry: 100, stop: 90, target: 120, bars: bars2.slice(0, 2), timeLimitT: 2 });
ok('zaman çıkışı', zt.result === 'zaman' && near(zt.exitPx, 102.6), JSON.stringify(zt));
const same = evaluateOutcome({ dir: 'bull', entry: 100, stop: 99, target: 101, bars: [{ t: 1, o: 100, h: 102, l: 98, c: 100, v: 1 }], timeLimitT: 5 });
ok('aynı barda iki seviye: konservatif stop', same.result === 'stop', JSON.stringify(same));
const bear = evaluateOutcome({ dir: 'bear', entry: 100, stop: 102, target: 95, bars: [{ t: 1, o: 100, h: 100.5, l: 94, c: 95, v: 1 }], timeLimitT: 5 });
ok('bear hedef (aşağı)', bear.result === 'hedef' && bear.r > 0, JSON.stringify(bear));

// ---- log ve kalibrasyon
const rows: SignalLog[] = [
  { id: '1', t: 1, ticker: 'NVDA', setup: 'S1', dir: 'bull', score: 85, label: 'Güçlü', components: {}, vetoes: [], source: 'cboe', dataAgeSec: 0, result: 'hedef', r: 2 },
  { id: '2', t: 2, ticker: 'NVDA', setup: 'S1', dir: 'bull', score: 82, label: 'Güçlü', components: {}, vetoes: [], source: 'cboe', dataAgeSec: 0, result: 'stop', r: -1 },
  { id: '3', t: 3, ticker: 'NVDA', setup: 'S1', dir: 'bull', score: 30, label: 'Zayıf', components: {}, vetoes: [], source: 'cboe', dataAgeSec: 0, result: 'stop', r: -1 },
];
const cal = calibration(rows);
const b80 = cal.find(b => b.bucket === '80+')!;
ok('kalibrasyon 80+: n=2, kazanma %50, PF 2', b80.n === 2 && near(b80.winPct!, 50) && near(b80.pf!, 2), JSON.stringify(b80));
ok('kalibrasyon: kapanmamış kayıt sayılmaz', cal.find(b => b.bucket === '0–49')!.n === 1);
ok('log en fazla 2000', appendLog(Array(LOG_KEEP).fill(rows[0]), rows[1]).length === LOG_KEEP);

console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nFırsat sinyal testleri geçti'); process.exit(fail ? 1 : 0);
