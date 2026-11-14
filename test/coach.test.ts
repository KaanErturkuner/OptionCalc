// Koç (işlem koçu) saf mantık testleri: zaman/pencere, kurallar, mum analitiği, doğrulama, görüntü denetimi, limitler. Ağ YOK.
import { istToMs, inEntryWindowIst, dteOf, istHm } from '../src/lib/coach/time.ts';
import { ruleFacts, stopPriceOf, targetPriceOf, premiumPct } from '../src/lib/coach/rules.ts';
import { aggregate, afterExitMove, parseYahooBars, sessionBars, vwapAt, volumeSpikeAfter, type Bar } from '../src/lib/coach/bars.ts';
import { buildTradeContext } from '../src/lib/coach/context.ts';
import { parseJsonLoose, validateFills, validateCoach, validateKarne, validateFeedback } from '../src/lib/coach/validate.ts';
import { b64Head, checkImage, MAX_IMAGE_BYTES } from '../src/lib/coach/image.ts';
import { canCoach } from '../src/lib/coach/limits.ts';
import { buildMessagesBody, parseMessagesReply } from '../src/lib/coach/anthropic.ts';
import { coachUserText, COACH_SYSTEM, EXTRACT_SYSTEM } from '../src/lib/coach/prompt.ts';
import type { ExtractedTrade } from '../src/lib/coach/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

// ───── 1) Zaman ve giriş penceresi (İstanbul) ─────
ok('istToMs: geçerli "2026-11-13T18:00"', istToMs('2026-11-13T18:00') === Date.UTC(2026, 10, 13, 15, 0));
ok('istToMs: geçersiz biçim → null', istToMs('13.11.2026 18:00') === null && istToMs('2026-11-13T25:00') === null && istToMs(null) === null);
ok('istHm: 15:00 UTC → 18:00 İst', istHm(Date.UTC(2026, 10, 13, 15, 0)) === '18:00');
ok('pencere: 16:30 dâhil', inEntryWindowIst(istToMs('2026-11-13T16:30')!));
ok('pencere: 16:29 hariç', !inEntryWindowIst(istToMs('2026-11-13T16:29')!));
ok('pencere: 19:59 dâhil', inEntryWindowIst(istToMs('2026-11-13T19:59')!));
ok('pencere: 20:00 hariç', !inEntryWindowIst(istToMs('2026-11-13T20:00')!));
ok('dteOf: aynı gün 0', dteOf('2026-11-13', '2026-11-13') === 0);
ok('dteOf: +3 gün = 3', dteOf('2026-11-16', '2026-11-13') === 3);
ok('dteOf: geçmiş vade → null', dteOf('2026-11-12', '2026-11-13') === null);

// ───── 2) Kurallar (prim stop −%40, hedef 1:5 / 1:4) ─────
ok('stop: giriş 1,00 → 0,60 (−%40)', stopPriceOf(1) === 0.6, String(stopPriceOf(1)));
ok('hedef 1:5: 1,00 → 3,00', targetPriceOf(1, 5) === 3, String(targetPriceOf(1, 5)));
ok('hedef 1:4: 1,00 → 2,60', targetPriceOf(1, 4) === 2.6, String(targetPriceOf(1, 4)));
ok('Kaan örneği 3,00: stop 1,80 · 1:5 9,00 · 1:4 7,80', stopPriceOf(3) === 1.8 && targetPriceOf(3, 5) === 9 && targetPriceOf(3, 4) === 7.8, `${stopPriceOf(3)} ${targetPriceOf(3, 5)} ${targetPriceOf(3, 4)}`);
ok('prim değişimi: 1,00 → 0,50 = −50%', premiumPct(1, 0.5) === -50);

const T: ExtractedTrade = { ticker: 'QQQ', side: 'CALL', strike: 600, expiry: '2026-11-13', qty: 2, entryTime: '2026-11-13T18:00', entryPrice: 1, exitTime: '2026-11-13T18:40', exitPrice: 4.4, status: 'kapali', confidence: 'yuksek' };
const rf = ruleFacts(T);
ok('kural: pencere içi → uyuyor', rf.find(r => r.kural.startsWith('Giriş penceresi'))?.durum === 'uyuyor');
ok('kural: 0 DTE → uyuyor', rf.find(r => r.kural.startsWith('0–3'))?.durum === 'uyuyor');
ok('kural: çıkış 4,40 ≥ 1:4 → hedef uyuyor', rf.find(r => r.kural.startsWith('Çıkış'))?.durum === 'uyuyor');
const late = ruleFacts({ ...T, entryTime: '2026-11-13T21:10', expiry: '2026-11-19', exitPrice: 0.33, exitTime: '2026-11-13T21:30' });
ok('kural: pencere dışı → uymuyor', late.find(r => r.kural.startsWith('Giriş penceresi'))?.durum === 'uymuyor');
ok('kural: 6 DTE → uymuyor', late.find(r => r.kural.startsWith('0–3'))?.durum === 'uymuyor');
ok('kural: stop seviyesinde çıkış → uyuyor', late.find(r => r.kural.startsWith('Çıkış'))?.durum === 'uyuyor');
ok('kural: giriş yok → bilinmiyor', ruleFacts({ ...T, entryTime: null }).find(r => r.kural.startsWith('Giriş'))?.durum === 'bilinmiyor');

// ───── 3) Mumlar: ayrıştırma, seans, VWAP, çıkış sonrası, hacim ─────
const DAY = '2026-11-13';
const etMs = (h: number, m: number) => Date.UTC(2026, 10, 13, 14, 30) + ((h - 9) * 60 + (m - 30)) * 60000; // EST = UTC−5; 09:30 ET = 14:30 UTC
const mk = (t: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t, o, h, l, c, v });
const bars: Bar[] = [];
for (let i = 0; i < 60; i++) bars.push(mk(etMs(10, 0) + i * 60000, 600, 600.4, 599.6, 600 + (i % 3 === 0 ? 0.2 : -0.1), 1000));
// çıkıştan (10:30 ET) sonra yükseliş + hacim patlaması
const exitMs = etMs(10, 30);
bars.push(mk(exitMs + 60000, 600.5, 602, 600.4, 601.8, 5000));
bars.push(mk(exitMs + 120000, 601.8, 603, 601.5, 602.9, 1200));
bars.sort((a, b) => a.t - b.t);
const session = sessionBars(bars, DAY);
ok('seans: 09:30–16:00 ET barları', session.length === bars.length);
ok('VWAP: boş değil ve makul', (() => { const v = vwapAt(session, exitMs); return v != null && v > 599 && v < 601; })());
const ex = afterExitMove(session, exitMs, 600, 'CALL', 60);
ok('çıkış sonrası: CALL için lehe = yukarı', ex != null && ex.bestFavPct > 0.4 && ex.worstAgainstPct <= 0, JSON.stringify(ex));
const exPut = afterExitMove(session, exitMs, 600, 'PUT', 60);
ok('çıkış sonrası: PUT için aşağı lehe (yukarı = aleyhe)', exPut != null && exPut.worstAgainstPct < -0.4, JSON.stringify(exPut));
const sp = volumeSpikeAfter(session, exitMs, 30);
ok('hacim patlaması: 5× ortanca, yukarı yönlü', sp != null && sp.ratio >= 4 && sp.dir === 'yukari', JSON.stringify(sp));
ok('aggregate: 5 dk mum sayısı ≈ 14', aggregate(session, etMs(10, 0), etMs(10, 59), 5).length === 12);
const pj = parseYahooBars({ chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{ open: [1, null, 2], high: [2, 2, 3], low: [1, 1, 1], close: [2, 2, 3], volume: [10, 10, 10] }] } }] } });
ok('parseYahooBars: eksik bar atlanır', pj.length === 2 && pj[0].t === 1000, JSON.stringify(pj));
ok('parseYahooBars: bozuk yanıt → []', parseYahooBars({}).length === 0);

// ───── 4) Bağlam (pencereleme ve veri eksiği) ─────
const ctx = buildTradeContext({ trade: { ...T, exitTime: '2026-11-13T18:30', entryTime: '2026-11-13T18:00' }, bars, day: DAY, nowMs: Date.UTC(2026, 10, 14), walls: null, flow: [] });
ok('bağlam: 5 dk mumları üst sınırda', Array.isArray(ctx.facts.mumlar5dk) && (ctx.facts.mumlar5dk as unknown[]).length <= 40);
ok('bağlam: duvar yok → noData', ctx.noData.some(s => s.includes('duvar')));
ok('bağlam: akış yok → noData', ctx.noData.some(s => s.includes('akış')));
ok('bağlam: kurallar eklenir', ctx.rules.length >= 4);

// ───── 5) Doğrulama ─────
ok('parseJsonLoose: çit + önsöz', parseJsonLoose('Tamam:\n```json\n{"a":1}\n```').ok === true);
ok('parseJsonLoose: JSON yok → hata', parseJsonLoose('merhaba').ok === false);
const vf = validateFills({ fills: [
  { tk: 'qqq', exp: '2026-11-13', k: 600, cp: 'call', q: 2.6, side: 'AL', px: 1.85, t: '2026-11-13T18:05', conf: 'yuksek' },
  { tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'C', q: 2, side: 'sell', px: null, t: '2026-11-13T18:40', conf: 'orta' },
  { tk: 'QQQ', exp: '13-11-2026', k: 600, cp: 'C', q: 1, side: 'buy', px: 1, t: '2026-11-13T18:00' },
  { tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'X', q: 1, side: 'buy', px: 1, t: '2026-11-13T18:00' },
  { tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'P', q: 1, side: 'buy', px: 1, t: '2026-11-13T25:00' },
], note: null });
ok('fills: geçerli satır alınır; ticker büyük harf; adet yuvarlanır; AL → buy; CALL → C', vf.ok && vf.value.fills.length === 1 && vf.value.fills[0].tk === 'QQQ' && vf.value.fills[0].q === 3 && vf.value.fills[0].side === 'buy' && vf.value.fills[0].cp === 'C', JSON.stringify(vf));
ok('fills: eksik/bozuk/geçersiz (vade, cp, saat, px null) satırlar atılır', vf.ok && vf.value.fills.length === 1);
ok('fills: hiç satır yoksa hata (note iletilir)', validateFills({ fills: [], note: 'görüntü bulanık' }).ok === false && (validateFills({ fills: [], note: 'görüntü bulanık' }) as { error: string }).error === 'görüntü bulanık');
ok('fills: en çok 6 satır', validateFills({ fills: Array.from({ length: 9 }, () => ({ tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'C', q: 1, side: 'buy', px: 1, t: '2026-11-13T18:00' })) }).ok && (validateFills({ fills: Array.from({ length: 9 }, (_, i) => ({ tk: 'QQQ', exp: '2026-11-13', k: 600 + i, cp: 'C', q: 1, side: 'buy', px: 1, t: '2026-11-13T18:00' })) }) as { value: { fills: unknown[] } }).value.fills.length === 6);
ok('fills: conf geçerliyse korunur', vf.ok && vf.value.fills[0].conf === 'yuksek');
ok('fills: conf yoksa düşük', validateFills({ fills: [{ tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'C', q: 1, side: 'buy', px: 1, t: '2026-11-13T18:00' }] }).ok && (validateFills({ fills: [{ tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'C', q: 1, side: 'buy', px: 1, t: '2026-11-13T18:00' }] }) as { value: { fills: { conf: string }[] } }).value.fills[0].conf === 'dusuk');
const GOOD = { neOldu: { oncesi: 'a', sirasinda: 'b', sonrasi: 'c' }, cikis: { karar: 'erken', neden: 'd' }, giris: { karar: 'kovalama', neden: 'e' }, strike: { karar: 'belirsiz', neden: 'f' }, kacanFirsatYorum: 'g (tahmini)', birDahakine: ['1', '2', '3'], karne: { disiplinCikis: 14, girisZamanlamasi: 7.4, strikeSecimi: -2, aciklama: 'h' } };
const fb = validateFeedback(GOOD as unknown as Record<string, unknown>);
ok('feedback: geçerli yorum kabul; karar enum; puan 0–10 kırpılır', fb != null && fb.cikis.karar === 'erken' && fb.karne.disiplinCikis === 10 && fb.karne.girisZamanlamasi === 7 && fb.karne.strikeSecimi === 0);
ok('feedback: enum dışı karar → belirsiz', validateFeedback({ ...GOOD, cikis: { karar: 'uydurma', neden: 'x' } }) ? validateFeedback({ ...GOOD, cikis: { karar: 'uydurma', neden: 'x' } })!.cikis.karar === 'belirsiz' : false);
ok('feedback: birDahakine tam 3 madde zorunlu', validateFeedback({ ...GOOD, birDahakine: ['1', '2'] }) === null);
ok('feedback: zorunlu alan yoksa null', validateFeedback({ neOldu: {} }) === null);
const cv = validateCoach({ feedback: [{ index: 1, ...GOOD }] }, 2);
ok('coach: index ile eşleşir, eksik → null', cv.ok && cv.value[0] === null && cv.value[1] != null);
ok('coach: feedback dizisi yok → hata', validateCoach({}, 1).ok === false);

// ───── 5b) Rapor: net/brüt P/L (kod), emoji, pencere, DTE ─────
import { pnlOf, buildReport } from '../src/lib/coach/report.ts';
import { optionEstimate, sigma1mPct } from '../src/lib/coach/context.ts';
const PN = pnlOf({ entryPrice: 1, exitPrice: 4.4, qty: 2, status: 'kapali' });
ok('P/L: brüt (4,40−1,00)×100×2 = 680', PN.gross === 680, JSON.stringify(PN));
ok('P/L: komisyon 2 × 1,50 × 2 = 6 (giriş+çıkış)', PN.fees === 6);
ok('P/L: net = brüt − komisyon = 674', PN.net === 674);
ok('P/L: açık pozisyonda null', pnlOf({ entryPrice: 1, exitPrice: null, qty: 2, status: 'acik' }).net === null);
const RPT = buildReport({ trade: { ...T, entryTime: '2026-11-13T18:00', exitTime: '2026-11-13T18:40' }, nums: { sBefore: null, sEntry: 600, sExit: 601, holdHigh: 602, holdLow: 599.5, holdFavPct: 0.33, holdFavAt: '18:20', afterFavPct: 0.5, afterAgainstPct: -0.1, afterAt15: 0.2, afterAt30: 0.4, afterAt60: 0.5, vwapEntry: 600.2, vwapDistPct: -0.03, otmPct: 0, otmPerEm: 0, sigma1mPct: 0.05, optHoldFav: 90, optAfterFav: 40 } as never, rules: [], noData: [], model: 'm', feedback: validateFeedback(GOOD as unknown as Record<string, unknown>)! });
ok('rapor: çıkış emojisi erken → ⚠️', RPT.cikis.emoji === '⚠️');
ok('rapor: başlık C yön, 0 DTE, net 674', RPT.header.side === 'C' && RPT.header.dte === 0 && RPT.header.netPnl === 674, JSON.stringify(RPT.header));
ok('rapor: pencere içinde (18:00 İst)', RPT.giris.pencere === 'icinde');
ok('rapor: birDahakine 3 madde', RPT.birDahakine.length === 3);
ok('rapor: tahmini etiketi', RPT.kacanFirsat.etiket === 'tahmini');
const oc = optionEstimate({ side: 'CALL', K: 600, entryPrice: 1, sEntry: 600, tEntryMin: 60, sExt: 602, tExtMin: 40 });
const op = optionEstimate({ side: 'PUT', K: 600, entryPrice: 1, sEntry: 600, tEntryMin: 60, sExt: 598, tExtMin: 40 });
ok('BS tahmini: CALL, yukarı hareket → prim artar', oc > 1, String(oc));
ok('BS tahmini: PUT, aşağı hareket → prim artar', op > 1, String(op));
const flat = Array.from({ length: 12 }, (_, i) => ({ t: i, o: 100, h: 100, l: 100, c: 100, v: 1 }));
const wig = Array.from({ length: 12 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: i % 2 ? 100.5 : 99.5, v: 1 }));
ok('σ(1 dk): sabit fiyat → 0; oynak → > 0', sigma1mPct(flat) === 0 && (sigma1mPct(wig) ?? 0) > 0, `${sigma1mPct(flat)} ${sigma1mPct(wig)}`);
const kv = validateKarne({ ozet: 'özet', guclu: ['a'], tekrarlayanHata: 'x', yarinOdak: 'odak' });
ok('karne: doğrulanır, dizi olmayan alan boş', kv.ok && kv.value.tekrarlayanHata.length === 0);

// ───── 6) Görüntü denetimi ─────
const PNG = 'iVBORw0KGgoAAAANSUhEUg=='; // 89 50 4E 47 0D 0A 1A 0A …
const JPG = '/9j/4AAQSkZJRg==';         // FF D8 FF E0 …
ok('görüntü: PNG kabul', checkImage('image/png', PNG).ok === true);
ok('görüntü: JPEG kabul', checkImage('image/jpeg', JPG).ok === true);
ok('görüntü: GIF reddedilir', checkImage('image/gif', PNG).ok === false);
ok('görüntü: tür uyuşmazlığı reddedilir', checkImage('image/jpeg', PNG).ok === false);
ok('görüntü: 4 MB üstü reddedilir', checkImage('image/png', 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 10) * 4 / 3))).ok === false);
ok('görüntü: base64 dışı karakter reddedilir', checkImage('image/png', 'ab$%').ok === false);

ok('b64Head: PNG imzası çözülür', b64Head(PNG, 4).join(',') === '137,80,78,71', b64Head(PNG, 4).join(','));

// ───── 7) Hız sınırı ─────
ok('limit: ilk istek serbest', canCoach({ nowMs: 1e12, countToday: 0, lastAtMs: null }).ok);
ok('limit: 2 sn içinde ikinci yükleme reddedilir (kind=gap)', (() => { const r = canCoach({ nowMs: 1e12 + 1000, countToday: 1, lastAtMs: 1e12 }); return !r.ok && r.kind === 'gap' && r.retryAfterSec === 1; })());
ok('limit: 2 sn sonra serbest', canCoach({ nowMs: 1e12 + 2000, countToday: 1, lastAtMs: 1e12 }).ok);
ok('limit: 24 saatte 100 doluysa reddedilir (kind=daily)', (() => { const r = canCoach({ nowMs: 1e12, countToday: 100, lastAtMs: null }); return !r.ok && r.kind === 'daily'; })());
ok('limit: 99 iken serbest', canCoach({ nowMs: 1e12, countToday: 99, lastAtMs: null }).ok);

// ───── 8) Anthropic gövdesi ve yanıt ─────
const body = buildMessagesBody({ model: 'claude-haiku-5-5', system: 'S', content: [{ type: 'text', text: 'x' }], maxTokens: 500 });
ok('anthropic: gövde model/max_tokens/messages', body.model === 'claude-haiku-5-5' && body.max_tokens === 500 && body.messages[0].role === 'user');
const rep = parseMessagesReply({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' });
ok('anthropic: metin birleşir, usage okunur', rep.text === 'a\nb' && rep.inTokens === 10 && rep.outTokens === 5);
ok('anthropic: bozuk yanıt → boş metin', parseMessagesReply({}).text === '');

// ───── 9) Promptlar: Türkçe, JSON şartı, kurallar ─────
ok('prompt: sistem metinleri JSON şartı içerir', COACH_SYSTEM.includes('JSON') && EXTRACT_SYSTEM.includes('"fills"') && EXTRACT_SYSTEM.includes('Midas'));
ok('prompt: kullanıcı metni bağlamı taşır', coachUserText([{ index: 0, trade: {}, rules: [], facts: {}, noData: [] }]).includes('"index":0') && coachUserText([{ index: 0, trade: {}, rules: [], facts: {}, noData: [] }]).includes('TAM 1'));
ok('prompt: kural özeti (1:5, %40, 16:30)', COACH_SYSTEM.includes('1:5') && COACH_SYSTEM.includes('%40') && !COACH_SYSTEM.includes('%67') && COACH_SYSTEM.includes('16:30'));

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm koç testleri geçti');
process.exit(fail ? 1 : 0);

// ───── Çıkarma: toleranslı JSON ayrıştırma, araç yanıtı, dolum dizisi, günlük örneği ─────
import { parseModelJson, sampleText, balancedEnd } from '../src/lib/coach/validate.ts';
import { EXTRACT_TOOL } from '../src/lib/coach/prompt.ts';
const ROW = '{"tk":"QQQ","exp":"2026-11-13","k":600,"cp":"C","q":2,"side":"buy","px":1.85,"t":"2026-11-13T18:05"}';
const ROWX = '{"tk":"QQQ","exp":"2026-11-13","k":600,"cp":"C","q":2,"side":"sell","px":2.4,"t":"2026-11-13T18:32"}';
const fillsOf = (r: { ok: boolean; value?: unknown }) => (r.ok ? (validateFills(r.value) as { ok: boolean; value?: { fills: unknown[] } }) : null);

ok('parse: ```json çitli', fillsOf(parseModelJson('```json\n{"fills":[' + ROW + '],"note":null}\n```'))?.value?.fills.length === 1);
ok('parse: çit (düz ``` ) ve önsöz/sonsöz', fillsOf(parseModelJson('İşte sonuç:\n```\n{"fills":[' + ROW + ']}\n```\nYardımcı olursa sevinirim.'))?.value?.fills.length === 1);
ok('parse: önsöz + JSON (köşeli parantez önsözde)', fillsOf(parseModelJson('Görüntüde [2] satır var: {"fills":[' + ROW + ']}'))?.value?.fills.length === 1);
ok('parse: prefill "{" devam metni', fillsOf(parseModelJson('"fills":[' + ROW + '],"note":null}', '{'))?.value?.fills.length === 1);
ok('parse: prefill + model tekrar "{" yazdı', fillsOf(parseModelJson('{"fills":[' + ROW + ']}', '{'))?.value?.fills.length === 1);
ok('parse: dize içinde { } ve \\" kaçışı dengeyi bozmaz', (() => { const r = parseModelJson('{"note":"a } b { \\"c\\" [","fills":[' + ROW + ']}'); return r.ok && (r.value as { note: string }).note === 'a } b { "c" ['; })());
ok('parse: çıplak dolum dizisi (2 satır: giriş + çıkış)', (() => { const f = fillsOf(parseModelJson('[' + ROW + ',' + ROWX + ']')); return !!f && f.value?.fills.length === 2; })());
ok('parse: dizi → validateFills dizi girdisi kabul eder', fillsOf({ ok: true, value: JSON.parse('[' + ROW + ']') })?.value?.fills.length === 1);
ok('parse: boş metin → hata', parseModelJson('').ok === false && parseModelJson('   \n ').ok === false);
ok('parse: JSON yok → hata', parseModelJson('Görüntüde işlem yok.').ok === false && (parseModelJson('Görüntüde işlem yok.') as { error?: string }).error === 'Model çıktısında JSON yok');
ok('parse: kesik çıktı → "tam JSON yok"', parseModelJson('{"fills":[' + ROW + ',{"tk":"QQ').ok === false && (parseModelJson('{"fills":[' + ROW + ',{"tk":"QQ') as { error: string }).error.includes('kesilmiş'));
ok('parse: bozuk JSON (sonda virgül) → ayrıştırılamadı', (parseModelJson('{"fills":[],}') as { error?: string }).error === 'JSON ayrıştırılamadı');
ok('parse: sayı dizisi tek başına kabul edilmez', parseModelJson('[1,2,3]').ok === false);
ok('parseJsonLoose: dizi nesne değildir', parseJsonLoose('[{"a":1}]').ok === false);
ok('balancedEnd: dengesiz → -1', balancedEnd('{"a":[1}', 0) === -1);
ok('sampleText: ≤300, kontrol yok, base64 kırpılır', (() => { const s = sampleText('a\n\tb' + 'Q'.repeat(200) + 'x'.repeat(400)); return s.length <= 300 && !/[\n\t]/.test(s) && s.includes('[…]'); })());
ok('sampleText: boş/undefined güvenli', sampleText('') === '' && sampleText(undefined as unknown as string) === '');
const toolBody = buildMessagesBody({ model: 'claude-haiku-5-5', system: 'S', content: [{ type: 'text', text: 'x' }], maxTokens: 1024, tool: EXTRACT_TOOL });
ok('anthropic: araç → tools + zorunlu tool_choice', toolBody.tools?.[0].name === 'record_fills' && toolBody.tool_choice?.type === 'tool' && toolBody.tool_choice.name === 'record_fills');
ok('anthropic: araçsız gövdede tool_choice yok', !('tool_choice' in body) && !('tools' in body));
ok('anthropic: araç yanıtı toolInput', parseMessagesReply({ content: [{ type: 'tool_use', name: 'record_fills', input: { fills: [] } }], stop_reason: 'tool_use' }).toolInput !== null && parseMessagesReply({ content: [{ type: 'text', text: 'x' }] }).toolInput === null);
ok('araç şeması: zorunlu alanlar ve en çok 6 satır', (EXTRACT_TOOL.input_schema as { required: string[] }).required.join() === 'fills,note' && (EXTRACT_TOOL.input_schema as { properties: { fills: { maxItems: number } } }).properties.fills.maxItems === 6);
