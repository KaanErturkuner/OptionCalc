// Ara rapor 21:00 (intra4): DST'e çapalı zamanlama, etiketler, ara bölümler ve düz metin (sentetik bar). Ağ YOK.
import * as S from '../src/lib/reports/schedule.ts';
import * as G from '../src/lib/reports/group.ts';
import * as RS from '../src/lib/reports/sections.ts';
import * as RT from '../src/lib/reports/text.ts';
import * as RI from '../src/lib/reports/intra.ts';
import type { ReportInput } from '../src/lib/reports/types.ts';
import type { TapeBar } from '../src/lib/market/regime.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const ist = (ms: number) => S.istHm(ms);
const at = (day: string, kind: S.ReportKind) => S.slotsFor(day).find(s => s.kind === kind)?.atMs ?? NaN;

// ───── 1) Zamanlama: kış 21:00 İst, yaz 20:00 İst (NY açılışına çapalı) ─────
const W = '2026-11-16', SUM = '2026-07-15';   // kış (EST) / yaz (EDT)
ok('kış: intra3 hâlâ 20:00 İst', ist(at(W, 'intra3')) === '20:00');
ok('kış: intra4 = açılış + 3,5 sa → 21:00 İst', ist(at(W, 'intra4')) === '21:00', ist(at(W, 'intra4')));
ok('yaz: intra4 yine 21:00 İst (sabit saat)', ist(at(SUM, 'intra4')) === '21:00', ist(at(SUM, 'intra4')));
ok('yaz: intra1 18:00 İst', ist(at(SUM, 'intra1')) === '18:00', ist(at(SUM, 'intra1')));
ok('kış: 8 slot (intra1..6 dâhil)', S.slotsFor(W).length === 8, String(S.slotsFor(W).length));
ok('kış: intra4 açılış +210 dk farkı', at(W, 'intra4') - at(W, 'intra3') === 60 * 60000);
const EARLY = '2026-11-27';   // Şükran ertesi: erken kapanış 13:00 ET
ok('erken kapanış: intra4 (13:00 ET = kapanış) atlanır', !S.slotsFor(EARLY).some(s => s.kind === 'intra4'));
ok('erken kapanış: intra3 (12:00 ET) korunur', S.slotsFor(EARLY).some(s => s.kind === 'intra3'));
ok('etiket: intra4 → "Ara rapor 21:00"', S.KIND_LABEL.intra4 === 'Ara rapor 21:00');
ok('kutu başlığı: "21:00 Raporu" (kış)', G.reportBoxTitle('intra4', W) === '21:00 Raporu');
ok('kutu başlığı: "21:00 Raporu" (yaz intra4)', G.reportBoxTitle('intra4', SUM) === '21:00 Raporu');
ok('INTRA_KINDS: intra1..intra6', S.INTRA_KINDS.join() === 'intra1,intra2,intra3,intra4,intra5,intra6');
ok('sıra: intra4 eod’dan önce', S.REPORT_KINDS.indexOf('intra4') < S.REPORT_KINDS.indexOf('eod'));

// ───── 2) Ara rapor: sentetik QQQ trendi + konsolidasyon ─────
const MIN = 60000;
const open = Date.parse(`${W}T14:30:00Z`);
function bars(prices: number[], vol: (i: number) => number = () => 1000): TapeBar[] {
  return prices.map((c, i) => { const o = i ? prices[i - 1] : c; return { t: open + i * MIN, o, h: Math.max(o, c) + 0.02, l: Math.min(o, c) - 0.02, c, v: vol(i) }; });
}
const lin = (a: number, b: number, n: number) => Array.from({ length: n }, (_, i) => a + (b - a) * (i + 1) / n);
const wave = (m: number, a: number, n: number) => Array.from({ length: n }, (_, i) => m + a * Math.sin(i * 0.9));
// 21:00 İst = 14:00 ET = açılış + 210 dk → 210 dk seans; 90 dk yükseliş + 75 dk dar bant (hacim düşük)
const cons = bars([500, ...lin(500, 505, 90), ...wave(504.9, 0.25, 119)], i => (i < 90 ? 2000 : 500));
const trend = bars([500, ...lin(500, 510, 240)]);
const base = (kind: ReportInput['kind'], nowMs: number, tape: ReportInput['tape'], over: Partial<ReportInput> = {}): ReportInput => ({
  kind, day: W, nowMs, watch: ['QQQ', 'SPY'], asia: [], europe: [], futures: [], preMarket: [], moves: [{ name: 'QQQ', pct: -0.4, price: 504 }, { name: 'SPY', pct: -0.3 }],
  vix: null, walls: [], flow: [], news: [], newsOk: true, macro: { today: [], tomorrow: [] }, earnings: null, sma: [], failures: [], tape, ...over,
});
{
  const now = at(W, 'intra4');
  const rep = RT.buildReport(base('intra4', now, [{ ticker: 'QQQ', bars: cons }]));
  const s = rep.sections;
  ok('intra4 bölümleri: intra görünümü var', !!s.intra);
  ok('intra4: konsolidasyon → karar BEKLE, etiket bant kırılımı', s.summary.bias === 'BEKLE' && (s.summary.regimeLabel ?? '').includes('bant kırılımı'), `${s.summary.bias} ${s.summary.regimeLabel}`);
  ok('intra4: anahtar seviyeler bant üstü / altı içerir', s.summary.keyLevels.some(k => k.label === 'Bant üstü') && s.summary.keyLevels.some(k => k.label === 'Bant altı'));
  const sc = s.intra!.scenarios;
  ok('intra4: senaryolar devam/dönüş/yatay, toplam 100', sc.map(x => x.key).join() === 'devam,donus,yatay' && sc.reduce((a, x) => a + x.pct, 0) === 100, JSON.stringify(sc.map(x => x.pct)));
  ok('intra4: her senaryonun tetikleyicisi var', sc.every(x => x.trigger.length > 0));
  ok('intra4: düz metin "Şu ana kadar ne oldu" ve "Bundan sonra ne bekleniyor" içerir', rep.body.includes('Şu ana kadar ne oldu') && rep.body.includes('Bundan sonra ne bekleniyor'));
  ok('intra4: düz metin eski "Kalan seans" beklentisini içermez', !rep.body.includes('Kalan seans'));
  ok('intra4: başlık 21:00 saatini taşır', rep.title.includes('21:00'), rep.title);
}
{
  const now = Date.parse(`${W}T15:30:00Z`);   // 18:30 İst (açılış + 60 dk), trend
  const rep = RT.buildReport(base('intra1', now, [{ ticker: 'QQQ', bars: trend }]));
  ok('intra1 trend: bias CALL (yükseliş rejimi)', rep.sections.summary.bias === 'CALL' && rep.sections.intra?.kind === 'trend_up', `${rep.sections.summary.bias} ${rep.sections.intra?.kind}`);
}
{
  // Erken seans (açılıştan 20 dk): rejim yok → eğilim kuralı; ara bölüm yine de var (bias null → kural)
  const now = Date.parse(`${W}T14:50:00Z`);
  const rep = RT.buildReport(base('intra1', now, [{ ticker: 'QQQ', bars: bars([500, ...lin(500, 499, 19)]) }]));
  ok('erken: karar eğilim kuralından (QQQ/SPY ort. −0,35 → PUT)', rep.sections.summary.bias === 'PUT' && rep.sections.intra?.bias == null, rep.sections.summary.bias);
}
{
  // Bar yoksa: ara bölüm yok, eski davranış (eğilim kuralı; metin "Kalan seans")
  const rep = RT.buildReport(base('intra2', at(W, 'intra2'), undefined));
  ok('bar yok: intra bölümü null, eski beklenti metni', rep.sections.intra === null && rep.body.includes('Kalan seans'));
  ok('bar yok: eski PUT kararı korunur (geriye uyum)', rep.sections.summary.bias === 'PUT');
}
{
  // Premarket ve gün sonu: intra bölümü yok
  const pre = RT.buildReport(base('premarket', at(W, 'premarket'), [{ ticker: 'QQQ', bars: trend }]));
  ok('piyasa öncesi: intra alanı null', pre.sections.intra == null);
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nreports-intra: tümü geçti');
if (fail) process.exit(1);
